import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const composePath = resolve(root, "deploy", "relay", "docker-compose.production.yml");
const caddyfilePath = resolve(root, "deploy", "relay", "Caddyfile");
const domain = requireDomain(process.env.VITALMCP_RELAY_DOMAIN);
const relayApiToken = requireToken("VITALMCP_RELAY_API_TOKEN");
const metricsToken = requireToken("VITALMCP_RELAY_METRICS_TOKEN");
const image = requirePinnedImage(process.env.VITALMCP_RELAY_IMAGE ?? "vital-agent-sync-relay:0.5.3");

if (relayApiToken === metricsToken) {
  throw new Error("VITALMCP_RELAY_API_TOKEN and VITALMCP_RELAY_METRICS_TOKEN must be different values.");
}

const composeEnv = {
  ...process.env,
  VITALMCP_RELAY_DOMAIN: domain,
  VITALMCP_RELAY_API_TOKEN: relayApiToken,
  VITALMCP_RELAY_METRICS_TOKEN: metricsToken,
  VITALMCP_RELAY_IMAGE: image
};
const compose = JSON.parse(capture("docker", [
  "compose",
  "-f",
  composePath,
  "config",
  "--format",
  "json"
], { env: composeEnv }));

const relay = requireService(compose, "vital-agent-sync-relay");
const caddy = requireService(compose, "caddy");
verifyRelayService(relay);
verifyCaddyService(caddy);
verifyCaddyfile();

console.log("Vital Agent Sync production relay preflight passed.");
console.log(JSON.stringify({
  domain,
  relay_url: `https://${domain}`,
  image,
  relay_public_ports: 0,
  caddy_public_ports: ["80/tcp", "443/tcp", "443/udp"],
  retention_days: Number(relay.environment.VITALMCP_RELAY_RETENTION_DAYS),
  max_envelope_bytes: Number(relay.environment.VITALMCP_RELAY_MAX_ENVELOPE_BYTES),
  max_uploads_per_minute: Number(relay.environment.VITALMCP_RELAY_MAX_UPLOADS_PER_MINUTE),
  max_queued_envelopes_per_user: Number(relay.environment.VITALMCP_RELAY_MAX_QUEUED_ENVELOPES_PER_USER),
  max_devices_per_user: Number(relay.environment.VITALMCP_RELAY_MAX_DEVICES_PER_USER),
  api_token_bytes: Buffer.byteLength(relayApiToken),
  metrics_token_bytes: Buffer.byteLength(metricsToken),
  secrets_printed: false
}, null, 2));

function verifyRelayService(service) {
  assert(service.image === image, "Production relay does not use the configured pinned image.");
  assert(service.read_only === true, "Production relay root filesystem must be read-only.");
  assert(service.init === true, "Production relay must run with an init process.");
  assert(service.restart === "unless-stopped", "Production relay must restart unless stopped.");
  assert(arrayIncludes(service.cap_drop, "ALL"), "Production relay must drop all Linux capabilities.");
  assert(
    arrayIncludes(service.security_opt, "no-new-privileges:true"),
    "Production relay must enable no-new-privileges."
  );
  assert(!Array.isArray(service.ports) || service.ports.length === 0, "Production relay must not publish a host port.");
  assert(arrayIncludes(service.expose?.map(String), "8790"), "Production relay must expose port 8790 only to Compose peers.");
  assert(
    Array.isArray(service.volumes) && service.volumes.some((volume) => volume.target === "/data" && volume.type === "volume"),
    "Production relay must persist /data in a named volume."
  );
  assert(service.healthcheck?.test?.length > 0, "Production relay must define a healthcheck.");
  assert(service.environment?.VITALMCP_RELAY_TRUST_PROXY === "true", "Production relay must trust only its private proxy path.");
  assert(service.environment?.VITALMCP_RELAY_API_TOKEN === relayApiToken, "Compose lost the deployment API token.");
  assert(service.environment?.VITALMCP_RELAY_METRICS_TOKEN === metricsToken, "Compose lost the metrics token.");
  for (const [name, expected] of Object.entries({
    VITALMCP_RELAY_RETENTION_DAYS: "30",
    VITALMCP_RELAY_MAX_ENVELOPE_BYTES: "524288",
    VITALMCP_RELAY_MAX_UPLOADS_PER_MINUTE: "120",
    VITALMCP_RELAY_MAX_QUEUED_ENVELOPES_PER_USER: "1000",
    VITALMCP_RELAY_MAX_DEVICES_PER_USER: "5"
  })) {
    assert(service.environment?.[name] === expected, `Production relay has an unexpected ${name} value.`);
  }
}

function verifyCaddyService(service) {
  assert(service.read_only === true, "Production Caddy root filesystem must be read-only.");
  assert(service.restart === "unless-stopped", "Production Caddy must restart unless stopped.");
  assert(
    arrayIncludes(service.security_opt, "no-new-privileges:true"),
    "Production Caddy must enable no-new-privileges."
  );
  assert(service.environment?.VITALMCP_RELAY_DOMAIN === domain, "Compose lost the relay domain.");
  assert(
    Array.isArray(service.volumes) && service.volumes.some((volume) => volume.target === "/etc/caddy/Caddyfile" && volume.read_only === true),
    "Production Caddy must mount Caddyfile read-only."
  );

  const ports = new Set((service.ports ?? []).map((port) => `${port.published}/${port.protocol}`));
  for (const expected of ["80/tcp", "443/tcp", "443/udp"]) {
    assert(ports.has(expected), `Production Caddy is missing ${expected}.`);
  }
  assert(ports.size === 3, "Production Caddy publishes unexpected ports.");
}

function verifyCaddyfile() {
  const value = readFileSync(caddyfilePath, "utf8");
  for (const expected of [
    "{$VITALMCP_RELAY_DOMAIN}",
    "max_size 512KiB",
    "Strict-Transport-Security",
    "X-Content-Type-Options \"nosniff\"",
    "Referrer-Policy \"no-referrer\"",
    "Cache-Control \"no-store\"",
    "reverse_proxy vital-agent-sync-relay:8790"
  ]) {
    assert(value.includes(expected), `Production Caddyfile is missing: ${expected}`);
  }
  assert(!/^\s*log\s/m.test(value), "Production Caddyfile must not enable access logs containing request metadata.");
}

function requireService(config, name) {
  const service = config.services?.[name];
  if (!service) {
    throw new Error(`Production Compose is missing the ${name} service.`);
  }
  return service;
}

function requireDomain(value) {
  const domainValue = value?.trim().toLowerCase();
  if (!domainValue || domainValue.length > 253 || !/^[a-z0-9.-]+$/.test(domainValue)) {
    throw new Error("VITALMCP_RELAY_DOMAIN must be a DNS hostname without a scheme, port, path, or wildcard.");
  }
  const labels = domainValue.split(".");
  if (labels.length < 2 || labels.some((label) => !label || label.length > 63 || label.startsWith("-") || label.endsWith("-"))) {
    throw new Error("VITALMCP_RELAY_DOMAIN must be a valid multi-label DNS hostname.");
  }
  return domainValue;
}

function requireToken(name) {
  const value = process.env[name]?.trim();
  const forbidden = /replace|example|changeme|placeholder|your[-_ ]/i;
  if (!value || Buffer.byteLength(value) < 32 || Buffer.byteLength(value) > 512 || /\s/.test(value) || forbidden.test(value)) {
    throw new Error(`${name} must be a non-placeholder random value between 32 and 512 bytes without whitespace.`);
  }
  return value;
}

function requirePinnedImage(value) {
  const imageValue = value.trim();
  if (!imageValue || imageValue.endsWith(":latest") || (!/:[^/]+$/.test(imageValue) && !/@sha256:[a-f0-9]{64}$/i.test(imageValue))) {
    throw new Error("VITALMCP_RELAY_IMAGE must use an explicit non-latest tag or sha256 digest.");
  }
  return imageValue;
}

function capture(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: options.env ?? process.env,
    encoding: "utf8",
    timeout: 30_000
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.stderr.write(redact(result.stderr ?? ""));
    throw new Error(`${command} exited with status ${result.status ?? "unknown"}.`);
  }
  return result.stdout;
}

function redact(value) {
  return value
    .replaceAll(relayApiToken, "[REDACTED_API_TOKEN]")
    .replaceAll(metricsToken, "[REDACTED_METRICS_TOKEN]");
}

function arrayIncludes(value, expected) {
  return Array.isArray(value) && value.includes(expected);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
