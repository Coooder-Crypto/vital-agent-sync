import { randomBytes, randomUUID } from "node:crypto";
import type { VitalAgentEncryptedEnvelope } from "./relay-crypto.js";
import { VITALMCP_E2EE_PROTOCOL } from "./relay-runtime.js";
import { normalizeRelayUrl } from "./relay-runtime.js";

export type RelayAuditOptions = {
  relayUrl: string;
  metricsToken?: string;
  relayApiToken?: string;
  active?: boolean;
  fetchImpl?: typeof fetch;
};

export type RelayAuditCheck = {
  id: string;
  status: "ok" | "fail";
  detail: string;
};

export type RelayAuditResult = {
  ok: boolean;
  mode: "passive" | "active";
  relay_url: string;
  checked_at: string;
  checks: RelayAuditCheck[];
};

const forbiddenBodyPatterns = [
  "ciphertext",
  "signature",
  "upload_auth_secret",
  "relay_access_token",
  "relay_api_token",
  "access_token_hash",
  "new_access_token",
  "private_key",
  "health_daily_summaries",
  "device_token"
];

export async function auditRelayDeployment(options: RelayAuditOptions): Promise<RelayAuditResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const relayUrl = normalizeRelayUrl(options.relayUrl);
  const checks: RelayAuditCheck[] = [];
  const status = await fetchText(fetchImpl, `${relayUrl}/v1/status`);
  const metrics = await fetchText(fetchImpl, `${relayUrl}/v1/metrics`, bearerHeaders(options.metricsToken));
  const page = await fetchText(fetchImpl, `${relayUrl}/`);
  const anonymousData = await fetchText(
    fetchImpl,
    `${relayUrl}/v1/envelopes?user_id=usr_vital-agent-sync_audit_probe&after=0`
  );

  checks.push(httpOkCheck("status_http", status, "/v1/status"));
  const metricsAccessible = metrics.status >= 200 && metrics.status < 300;
  const metricsProtected = metrics.status === 401 || metrics.status === 403;
  checks.push(metricsHttpCheck(metrics));
  checks.push(httpOkCheck("status_page_http", page, "/"));
  checks.push(dataEndpointProtectionCheck(anonymousData));

  checks.push(jsonFieldCheck("status_shape", status.text, ["ok", "service", "limits"], "/v1/status"));
  if (metricsAccessible) {
    checks.push(jsonFieldCheck("metrics_shape", metrics.text, ["ok", "metrics", "limits"], "/v1/metrics"));
  } else if (metricsProtected && !options.metricsToken) {
    checks.push({ id: "metrics_shape", status: "ok", detail: "/v1/metrics is access-controlled; shape check requires a metrics token." });
  } else {
    checks.push({ id: "metrics_shape", status: "fail", detail: "/v1/metrics could not be inspected." });
  }
  checks.push(forbiddenPatternCheck("status_no_sensitive_fields", status.text, "/v1/status"));
  if (metricsAccessible) {
    checks.push(forbiddenPatternCheck("metrics_no_sensitive_fields", metrics.text, "/v1/metrics"));
  } else if (metricsProtected && !options.metricsToken) {
    checks.push({ id: "metrics_no_sensitive_fields", status: "ok", detail: "/v1/metrics is access-controlled; public response does not expose aggregate fields." });
  } else {
    checks.push({ id: "metrics_no_sensitive_fields", status: "fail", detail: "/v1/metrics could not be inspected for sensitive field names." });
  }
  checks.push(forbiddenPatternCheck("page_no_sensitive_fields", page.text, "/"));
  checks.push(relayLimitsCheck(status.text));
  checks.push(tenantProtectionCheck(status.text));

  if (options.active) {
    checks.push(...await runActiveRelayAudit({
      fetchImpl,
      relayUrl,
      relayApiToken: options.relayApiToken
    }));
  }

  return {
    ok: checks.every((check) => check.status === "ok"),
    mode: options.active ? "active" : "passive",
    relay_url: relayUrl,
    checked_at: new Date().toISOString(),
    checks
  };
}

type AuditHttpResponse = {
  status: number;
  text: string;
  error?: string;
};

type ActiveAuditIdentity = {
  userId: string;
  deviceId: string;
  accessToken: string;
};

async function runActiveRelayAudit(input: {
  fetchImpl: typeof fetch;
  relayUrl: string;
  relayApiToken?: string;
}): Promise<RelayAuditCheck[]> {
  const suffix = randomUUID().replaceAll("-", "");
  const tenantA: ActiveAuditIdentity = {
    userId: `usr_audit_a_${suffix}`,
    deviceId: `dev_audit_a_${suffix}`,
    accessToken: randomAuditSecret()
  };
  const tenantB: ActiveAuditIdentity = {
    userId: `usr_audit_b_${suffix}`,
    deviceId: `dev_audit_b_${suffix}`,
    accessToken: randomAuditSecret()
  };
  const rotatedTenantBToken = randomAuditSecret();
  const checks: RelayAuditCheck[] = [];
  const envelopeA1 = buildOpaqueAuditEnvelope(tenantA, 1);
  const envelopeA2 = buildOpaqueAuditEnvelope(tenantA, 2);
  const envelopeA3 = buildOpaqueAuditEnvelope(tenantA, 3);
  const envelopeA4 = buildOpaqueAuditEnvelope(tenantA, 4);
  const envelopeB1 = buildOpaqueAuditEnvelope(tenantB, 1);
  let tenantACreated = false;
  let tenantBCreated = false;
  let tenantARevoked = false;
  let tenantBRevoked = false;

  try {
    const uploadA = await postAuditJson(input, "/v1/envelopes", envelopeA1, tenantA.accessToken);
    tenantACreated = uploadA.status >= 200 && uploadA.status < 300;
    checks.push(jsonResponseCheck(
      "active_upload_tenant_a",
      uploadA,
      200,
      (body) => body.ok === true && body.envelope_id === envelopeA1.envelope_id,
      "Disposable tenant A accepted an opaque test envelope."
    ));

    const uploadB = await postAuditJson(input, "/v1/envelopes", envelopeB1, tenantB.accessToken);
    tenantBCreated = uploadB.status >= 200 && uploadB.status < 300;
    checks.push(jsonResponseCheck(
      "active_upload_tenant_b",
      uploadB,
      200,
      (body) => body.ok === true && body.envelope_id === envelopeB1.envelope_id,
      "Disposable tenant B accepted an opaque test envelope."
    ));

    if (input.relayApiToken?.trim()) {
      const query = new URLSearchParams({ user_id: tenantA.userId, after: "0" });
      const withoutDeploymentKey = await requestText(
        input.fetchImpl,
        `${input.relayUrl}/v1/envelopes?${query}`,
        { headers: relayDataHeaders(tenantA.accessToken, undefined) }
      );
      const withWrongDeploymentKey = await requestText(
        input.fetchImpl,
        `${input.relayUrl}/v1/envelopes?${query}`,
        { headers: relayDataHeaders(tenantA.accessToken, randomAuditSecret()) }
      );
      checks.push(statusResponseCheck(
        "active_deployment_api_key",
        [withoutDeploymentKey, withWrongDeploymentKey],
        [401, 403],
        "Data endpoints reject missing and incorrect deployment API keys."
      ));
    }

    const ownListA = await getAuditEnvelopes(input, tenantA.userId, tenantA.accessToken);
    checks.push(jsonResponseCheck(
      "active_own_tenant_list",
      ownListA,
      200,
      (body) => responseContainsOnlyEnvelope(body, envelopeA1),
      "Tenant A can list only its own queued envelope."
    ));

    const crossListA = await getAuditEnvelopes(input, tenantA.userId, tenantB.accessToken);
    const crossListB = await getAuditEnvelopes(input, tenantB.userId, tenantA.accessToken);
    checks.push(statusResponseCheck(
      "active_cross_tenant_list",
      [crossListA, crossListB],
      [401, 403],
      "Cross-tenant list requests are rejected in both directions."
    ));

    const crossAck = await postAuditJson(
      input,
      `/v1/envelopes/${encodeURIComponent(envelopeA1.envelope_id)}/ack`,
      {},
      tenantB.accessToken
    );
    checks.push(jsonResponseCheck(
      "active_cross_tenant_ack",
      crossAck,
      200,
      (body) => body.ok === true && body.acked === false,
      "Tenant B cannot acknowledge tenant A's envelope."
    ));

    const crossPurge = await postAuditJson(
      input,
      "/v1/purge",
      { user_id: tenantA.userId },
      tenantB.accessToken
    );
    checks.push(statusResponseCheck(
      "active_cross_tenant_purge",
      [crossPurge],
      [401, 403],
      "Tenant B cannot purge tenant A's envelopes."
    ));

    const crossUnlink = await postAuditJson(
      input,
      `/v1/devices/${encodeURIComponent(tenantA.deviceId)}/unlink`,
      { user_id: tenantA.userId },
      tenantB.accessToken
    );
    const crossRotate = await postAuditJson(
      input,
      "/v1/credentials/rotate",
      { user_id: tenantA.userId, new_access_token: randomAuditSecret() },
      tenantB.accessToken
    );
    const crossRevoke = await postAuditJson(
      input,
      "/v1/users/revoke",
      { user_id: tenantA.userId },
      tenantB.accessToken
    );
    checks.push(statusResponseCheck(
      "active_cross_tenant_lifecycle",
      [crossUnlink, crossRotate, crossRevoke],
      [401, 403],
      "Tenant B cannot unlink, rotate, or revoke tenant A."
    ));

    const afterCrossTenantProbes = await getAuditEnvelopes(input, tenantA.userId, tenantA.accessToken);
    checks.push(jsonResponseCheck(
      "active_cross_tenant_no_effect",
      afterCrossTenantProbes,
      200,
      (body) => responseContainsOnlyEnvelope(body, envelopeA1),
      "Rejected cross-tenant operations leave tenant A's queue unchanged."
    ));

    const ownAck = await postAuditJson(
      input,
      `/v1/envelopes/${encodeURIComponent(envelopeA1.envelope_id)}/ack`,
      {},
      tenantA.accessToken
    );
    checks.push(jsonResponseCheck(
      "active_own_ack",
      ownAck,
      200,
      (body) => body.ok === true && body.acked === true,
      "Tenant A can acknowledge its own envelope."
    ));

    const uploadA2 = await postAuditJson(input, "/v1/envelopes", envelopeA2, tenantA.accessToken);
    checks.push(jsonResponseCheck(
      "active_pre_purge_upload",
      uploadA2,
      200,
      (body) => body.ok === true && body.envelope_id === envelopeA2.envelope_id,
      "Tenant A queued a second envelope for purge verification."
    ));

    const ownPurge = await postAuditJson(
      input,
      "/v1/purge",
      { user_id: tenantA.userId },
      tenantA.accessToken
    );
    checks.push(jsonResponseCheck(
      "active_own_purge",
      ownPurge,
      200,
      (body) => body.ok === true && body.purged === 2,
      "Purge removed both queued and acknowledged envelopes for tenant A."
    ));

    const uploadA3 = await postAuditJson(input, "/v1/envelopes", envelopeA3, tenantA.accessToken);
    checks.push(jsonResponseCheck(
      "active_pre_unlink_upload",
      uploadA3,
      200,
      (body) => body.ok === true && body.envelope_id === envelopeA3.envelope_id,
      "Tenant A queued an envelope for unlink verification."
    ));

    const ownUnlink = await postAuditJson(
      input,
      `/v1/devices/${encodeURIComponent(tenantA.deviceId)}/unlink`,
      { user_id: tenantA.userId },
      tenantA.accessToken
    );
    checks.push(jsonResponseCheck(
      "active_own_unlink",
      ownUnlink,
      200,
      (body) => body.ok === true && body.unlinked === true && body.purged === 1,
      "Unlink revoked tenant A's source device and purged its queued envelope."
    ));

    const uploadAfterUnlink = await postAuditJson(input, "/v1/envelopes", envelopeA4, tenantA.accessToken);
    checks.push(jsonResponseCheck(
      "active_unlinked_device_rejected",
      uploadAfterUnlink,
      403,
      (body) => body.ok === false && body.error === "device_unlinked",
      "The unlinked source device cannot upload another envelope."
    ));

    const ownRotate = await postAuditJson(
      input,
      "/v1/credentials/rotate",
      { user_id: tenantB.userId, new_access_token: rotatedTenantBToken },
      tenantB.accessToken
    );
    checks.push(jsonResponseCheck(
      "active_own_rotate",
      ownRotate,
      200,
      (body) => body.ok === true && body.rotated === true && body.purged === 1,
      "Credential rotation purged tenant B's queue and activated a replacement token."
    ));

    const oldCredentialList = await getAuditEnvelopes(input, tenantB.userId, tenantB.accessToken);
    checks.push(statusResponseCheck(
      "active_old_credential_rejected",
      [oldCredentialList],
      [401, 403],
      "Tenant B's old credential is rejected after rotation."
    ));

    const newCredentialList = await getAuditEnvelopes(input, tenantB.userId, rotatedTenantBToken);
    checks.push(jsonResponseCheck(
      "active_new_credential_accepted",
      newCredentialList,
      200,
      (body) => Array.isArray(body.envelopes) && body.envelopes.length === 0,
      "Tenant B's replacement credential can access its empty queue."
    ));

    const ownRevokeB = await postAuditJson(
      input,
      "/v1/users/revoke",
      { user_id: tenantB.userId },
      rotatedTenantBToken
    );
    tenantBRevoked = ownRevokeB.status === 200;
    checks.push(jsonResponseCheck(
      "active_own_revoke",
      ownRevokeB,
      200,
      (body) => body.ok === true && body.revoked === true,
      "Tenant B can revoke its disposable identity."
    ));

    const revokedCredentialList = await getAuditEnvelopes(input, tenantB.userId, rotatedTenantBToken);
    checks.push(statusResponseCheck(
      "active_revoked_credential_rejected",
      [revokedCredentialList],
      [403],
      "Tenant B's replacement credential is rejected after identity revocation."
    ));

    const cleanupA = await postAuditJson(
      input,
      "/v1/users/revoke",
      { user_id: tenantA.userId },
      tenantA.accessToken
    );
    tenantARevoked = cleanupA.status === 200;
    checks.push(jsonResponseCheck(
      "active_disposable_identity_cleanup",
      cleanupA,
      200,
      (body) => body.ok === true && body.revoked === true && body.purged === 0,
      "The remaining disposable audit identity was revoked with no queued envelopes left behind."
    ));
  } finally {
    if (tenantACreated && !tenantARevoked) {
      await bestEffortRevoke(input, tenantA.userId, tenantA.accessToken);
    }
    if (tenantBCreated && !tenantBRevoked) {
      await bestEffortRevoke(input, tenantB.userId, tenantB.accessToken);
      await bestEffortRevoke(input, tenantB.userId, rotatedTenantBToken);
    }
  }

  return checks;
}

function buildOpaqueAuditEnvelope(identity: ActiveAuditIdentity, sequence: number): VitalAgentEncryptedEnvelope {
  return {
    protocol: VITALMCP_E2EE_PROTOCOL,
    user_id: identity.userId,
    device_id: identity.deviceId,
    envelope_id: `env_audit_${randomUUID().replaceAll("-", "")}`,
    sequence,
    payload_type: "health.sync",
    created_at: new Date().toISOString(),
    content_encoding: "canonical-json",
    crypto: {
      alg: "x25519-hkdf-sha256-chacha20poly1305-hmac-sha256",
      sender_public_key_x25519: randomBytes(32).toString("base64url"),
      nonce: randomBytes(12).toString("base64url"),
      tag: randomBytes(16).toString("base64url"),
      ciphertext: randomBytes(32).toString("base64url"),
      signature: randomBytes(32).toString("base64url")
    }
  };
}

function randomAuditSecret(): string {
  return randomBytes(32).toString("base64url");
}

async function getAuditEnvelopes(
  input: { fetchImpl: typeof fetch; relayUrl: string; relayApiToken?: string },
  userId: string,
  accessToken: string
): Promise<AuditHttpResponse> {
  const query = new URLSearchParams({ user_id: userId, after: "0" });
  return requestText(input.fetchImpl, `${input.relayUrl}/v1/envelopes?${query}`, {
    headers: relayDataHeaders(accessToken, input.relayApiToken)
  });
}

async function postAuditJson(
  input: { fetchImpl: typeof fetch; relayUrl: string; relayApiToken?: string },
  path: string,
  body: unknown,
  accessToken: string
): Promise<AuditHttpResponse> {
  return requestText(input.fetchImpl, `${input.relayUrl}${path}`, {
    method: "POST",
    headers: relayDataHeaders(accessToken, input.relayApiToken),
    body: JSON.stringify(body)
  });
}

async function bestEffortRevoke(
  input: { fetchImpl: typeof fetch; relayUrl: string; relayApiToken?: string },
  userId: string,
  accessToken: string
): Promise<void> {
  try {
    await postAuditJson(input, "/v1/users/revoke", { user_id: userId }, accessToken);
  } catch {
    // The audit result already records the primary failure; cleanup remains best effort.
  }
}

function relayDataHeaders(accessToken: string, relayApiToken: string | undefined): Record<string, string> {
  return {
    "content-type": "application/json",
    authorization: `Bearer ${accessToken}`,
    ...(relayApiToken?.trim() ? { "x-vital-agent-relay-api-key": relayApiToken.trim() } : {})
  };
}

function responseContainsOnlyEnvelope(body: Record<string, unknown>, envelope: VitalAgentEncryptedEnvelope): boolean {
  if (!Array.isArray(body.envelopes) || body.envelopes.length !== 1) {
    return false;
  }
  const item = body.envelopes[0];
  return typeof item === "object" && item !== null &&
    (item as Record<string, unknown>).envelope_id === envelope.envelope_id &&
    (item as Record<string, unknown>).user_id === envelope.user_id;
}

function jsonResponseCheck(
  id: string,
  response: AuditHttpResponse,
  expectedStatus: number,
  predicate: (body: Record<string, unknown>) => boolean,
  okDetail: string
): RelayAuditCheck {
  if (response.error) {
    return { id, status: "fail", detail: `Active probe request failed: ${response.error}.` };
  }
  if (response.status !== expectedStatus) {
    return { id, status: "fail", detail: `Active probe returned HTTP ${response.status}; expected ${expectedStatus}.` };
  }
  try {
    const body = JSON.parse(response.text) as unknown;
    if (typeof body !== "object" || body === null || !predicate(body as Record<string, unknown>)) {
      return { id, status: "fail", detail: "Active probe returned an unexpected JSON response shape." };
    }
    return { id, status: "ok", detail: okDetail };
  } catch {
    return { id, status: "fail", detail: "Active probe did not return JSON." };
  }
}

function statusResponseCheck(
  id: string,
  responses: AuditHttpResponse[],
  expectedStatuses: number[],
  okDetail: string
): RelayAuditCheck {
  const failedRequest = responses.find((response) => response.error);
  if (failedRequest?.error) {
    return { id, status: "fail", detail: `Active probe request failed: ${failedRequest.error}.` };
  }
  const unexpected = responses.find((response) => !expectedStatuses.includes(response.status));
  if (unexpected) {
    return {
      id,
      status: "fail",
      detail: `Active probe returned HTTP ${unexpected.status}; expected ${expectedStatuses.join(" or ")}.`
    };
  }
  return { id, status: "ok", detail: okDetail };
}

async function fetchText(fetchImpl: typeof fetch, url: string, headers?: HeadersInit): Promise<{
  status: number;
  text: string;
  error?: string;
}> {
  return requestText(fetchImpl, url, { headers });
}

async function requestText(fetchImpl: typeof fetch, url: string, init: RequestInit = {}): Promise<AuditHttpResponse> {
  try {
    const response = await fetchImpl(url, {
      ...init,
      redirect: init.redirect ?? "error",
      signal: init.signal ?? AbortSignal.timeout(3000)
    });
    return {
      status: response.status,
      text: await response.text()
    };
  } catch (error) {
    return {
      status: 0,
      text: "",
      error: error instanceof Error ? error.message : "request_failed"
    };
  }
}

function bearerHeaders(token: string | undefined): HeadersInit | undefined {
  const trimmed = token?.trim();
  return trimmed ? { authorization: `Bearer ${trimmed}` } : undefined;
}

function httpOkCheck(id: string, response: { status: number; error?: string }, path: string): RelayAuditCheck {
  if (response.error) {
    return { id, status: "fail", detail: `${path} request failed: ${response.error}.` };
  }
  return response.status >= 200 && response.status < 300
    ? { id, status: "ok", detail: `${path} returned HTTP ${response.status}.` }
    : { id, status: "fail", detail: `${path} returned HTTP ${response.status}.` };
}

function metricsHttpCheck(response: { status: number; error?: string }): RelayAuditCheck {
  if (response.error) {
    return { id: "metrics_http", status: "fail", detail: `/v1/metrics request failed: ${response.error}.` };
  }
  if (response.status >= 200 && response.status < 300) {
    return { id: "metrics_http", status: "ok", detail: `/v1/metrics returned HTTP ${response.status}.` };
  }
  if (response.status === 401 || response.status === 403) {
    return { id: "metrics_http", status: "ok", detail: `/v1/metrics is access-controlled with HTTP ${response.status}.` };
  }
  return { id: "metrics_http", status: "fail", detail: `/v1/metrics returned HTTP ${response.status}.` };
}

function dataEndpointProtectionCheck(response: { status: number; error?: string }): RelayAuditCheck {
  if (response.error) {
    return { id: "data_endpoint_auth", status: "fail", detail: `/v1/envelopes protection probe failed: ${response.error}.` };
  }
  return response.status === 401 || response.status === 403
    ? { id: "data_endpoint_auth", status: "ok", detail: `/v1/envelopes rejects anonymous tenant access with HTTP ${response.status}.` }
    : { id: "data_endpoint_auth", status: "fail", detail: `/v1/envelopes anonymous probe returned HTTP ${response.status}; expected 401 or 403.` };
}

function jsonFieldCheck(id: string, text: string, fields: string[], path: string): RelayAuditCheck {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const missing = fields.filter((field) => !(field in parsed));
    return missing.length === 0
      ? { id, status: "ok", detail: `${path} contains required aggregate fields.` }
      : { id, status: "fail", detail: `${path} is missing fields: ${missing.join(", ")}.` };
  } catch {
    return { id, status: "fail", detail: `${path} did not return JSON.` };
  }
}

function forbiddenPatternCheck(id: string, text: string, path: string): RelayAuditCheck {
  const lowerText = text.toLowerCase();
  const found = forbiddenBodyPatterns.filter((pattern) => lowerText.includes(pattern));
  return found.length === 0
    ? { id, status: "ok", detail: `${path} does not expose known sensitive field names.` }
    : { id, status: "fail", detail: `${path} exposes forbidden field names: ${found.join(", ")}.` };
}

function relayLimitsCheck(text: string): RelayAuditCheck {
  try {
    const parsed = JSON.parse(text) as {
      limits?: {
        retentionMs?: number;
        maxEnvelopeBytes?: number;
        maxUploadsPerMinute?: number;
        maxQueuedEnvelopesPerUser?: number;
        maxDevicesPerUser?: number;
      };
    };
    const limits = parsed.limits;
    if (!limits) {
      return { id: "limits_configured", status: "fail", detail: "/v1/status did not include relay limits." };
    }
    const ok = positiveNumber(limits.retentionMs) &&
      positiveNumber(limits.maxEnvelopeBytes) &&
      positiveNumber(limits.maxUploadsPerMinute) &&
      positiveNumber(limits.maxQueuedEnvelopesPerUser) &&
      positiveNumber(limits.maxDevicesPerUser);
    return ok
      ? { id: "limits_configured", status: "ok", detail: "Relay reports retention, size, rate, queue, and device limits." }
      : { id: "limits_configured", status: "fail", detail: "Relay limits must be positive numbers." };
  } catch {
    return { id: "limits_configured", status: "fail", detail: "/v1/status did not return valid JSON." };
  }
}

function positiveNumber(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function tenantProtectionCheck(text: string): RelayAuditCheck {
  try {
    const parsed = JSON.parse(text) as { limits?: { tenantProtected?: unknown } };
    return parsed.limits?.tenantProtected === true
      ? { id: "tenant_access_protected", status: "ok", detail: "Relay reports per-user access-token enforcement for data endpoints." }
      : { id: "tenant_access_protected", status: "fail", detail: "Relay does not report per-user access-token enforcement." };
  } catch {
    return { id: "tenant_access_protected", status: "fail", detail: "/v1/status did not return valid JSON." };
  }
}
