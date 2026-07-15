import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import QRCode from "qrcode";
import { buildRelayOnboardingDeepLink, buildRelayOnboardingPayload, encodeRelayOnboardingPayload, type RelayRuntimeConfig } from "./relay-runtime.js";

export type OnboardingArtifact = {
  format: "qr" | "deeplink" | "text";
  local_path: string;
  local_url: string;
  contains_credentials: true;
};

export async function writeRelayOnboardingArtifact(options: {
  config: RelayRuntimeConfig;
  stateDir?: string;
  format?: "qr" | "deeplink" | "text";
}): Promise<OnboardingArtifact> {
  const format = options.format ?? "qr";
  const stateDir = expandHome(options.stateDir ?? join(homedir(), ".vital-agent-sync"));
  const path = join(stateDir, "onboarding", "index.html");
  const payload = buildRelayOnboardingPayload(options.config, { mode: options.config.relay_mode });
  const deepLink = buildRelayOnboardingDeepLink(payload);
  const textCode = encodeRelayOnboardingPayload(payload);
  const qrDataUrl = await QRCode.toDataURL(deepLink, {
    errorCorrectionLevel: "M",
    margin: 2,
    width: 520
  });
  const html = buildOnboardingHtml({
    deepLink,
    textCode,
    qrDataUrl,
    relayUrl: payload.relay_url,
    fingerprint: payload.fingerprint,
    format
  });
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  chmodIfPossible(dirname(path), 0o700);
  writeFileSync(path, html, { encoding: "utf8", mode: 0o600 });
  chmodIfPossible(path, 0o600);
  return {
    format,
    local_path: path,
    local_url: pathToFileURL(path).href,
    contains_credentials: true
  };
}

function buildOnboardingHtml(options: {
  deepLink: string;
  textCode: string;
  qrDataUrl: string;
  relayUrl: string;
  fingerprint: string;
  format: "qr" | "deeplink" | "text";
}): string {
  const link = escapeHtml(options.deepLink);
  const showQr = options.format === "qr";
  const showDeepLink = options.format === "deeplink";
  const showText = options.format === "text";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Vital Agent onboarding</title>
  <style>
    :root { color-scheme: light dark; font-family: -apple-system, BlinkMacSystemFont, sans-serif; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0b1220; color: #f8fafc; }
    main { width: min(92vw, 620px); padding: 32px; border: 1px solid #334155; border-radius: 24px; background: #111827; text-align: center; }
    img { width: min(78vw, 420px); border-radius: 16px; background: white; padding: 12px; }
    a { display: inline-block; margin-top: 18px; padding: 12px 18px; border-radius: 999px; background: #22c55e; color: #052e16; font-weight: 700; text-decoration: none; }
    textarea { box-sizing: border-box; width: 100%; min-height: 140px; padding: 12px; border-radius: 12px; overflow-wrap: anywhere; }
    .warning { color: #fbbf24; }
    .meta { color: #94a3b8; overflow-wrap: anywhere; }
  </style>
</head>
<body>
  <main>
    <h1>Connect Vital Agent</h1>
    <p class="warning">This local page contains pairing credentials. Do not share or upload it.</p>
    ${showQr ? `<img src="${options.qrDataUrl}" alt="Vital Agent Sync onboarding QR code">` : ""}
    ${showDeepLink ? `<div><a href="${link}">Open Vital Agent Sync</a></div>` : ""}
    ${showText ? `<textarea readonly aria-label="Vital Agent Sync onboarding text code">${escapeHtml(options.textCode)}</textarea>` : ""}
    <p class="meta">Relay: ${escapeHtml(options.relayUrl)}</p>
    <p class="meta">Fingerprint: ${escapeHtml(options.fingerprint)}</p>
  </main>
</body>
</html>
`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function expandHome(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return join(homedir(), path.slice(2));
  return resolve(path);
}

function chmodIfPossible(path: string, mode: number): void {
  try {
    chmodSync(path, mode);
  } catch {
    // Windows and some filesystems do not expose POSIX modes.
  }
}
