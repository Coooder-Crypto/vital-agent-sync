import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = process.cwd();
const cliPath = resolve(root, "packages", "local", "dist", "cli.js");
const args = new Set(process.argv.slice(2));

for (const arg of args) {
  if (arg !== "--yes") {
    throw new Error(`Unknown option: ${arg}`);
  }
}

if (!args.has("--yes")) {
  throw new Error(
    "Hosted active audit creates and revokes disposable relay identities. Re-run with: npm run audit:relay-hosted -- --yes"
  );
}

const relayUrl = requireHostedRelayUrl(process.env.HEALTHLINK_HOSTED_RELAY_URL);
const relayApiToken = requireSecret("HEALTHLINK_RELAY_API_TOKEN");
const metricsToken = requireSecret("HEALTHLINK_RELAY_METRICS_TOKEN");
const auditEnv = {
  ...process.env,
  HEALTHLINK_HOSTED_RELAY_URL: relayUrl,
  HEALTHLINK_RELAY_API_TOKEN: relayApiToken,
  HEALTHLINK_RELAY_METRICS_TOKEN: metricsToken
};

run("vitalmcp build", "npm", [
  "run",
  "build",
  "--workspace",
  "vitalmcp"
]);

const passive = runAudit("passive", []);
const active = runAudit("active", ["--active", "--yes"]);

console.log("\nVitalMCP hosted relay audit passed.");
console.log(JSON.stringify({
  relay_url: relayUrl,
  passive: passive.ok,
  active: active.ok,
  disposable_identity_cleanup: true
}, null, 2));

function runAudit(mode, extraArgs) {
  console.log(`\n==> hosted relay ${mode} audit`);
  const output = capture("node", [
    cliPath,
    "relay",
    "audit",
    "--relay-url",
    relayUrl,
    ...extraArgs
  ], { env: auditEnv, timeout: mode === "active" ? 120_000 : 30_000 });

  for (const secret of [relayApiToken, metricsToken]) {
    if (output.includes(secret)) {
      throw new Error(`Hosted relay ${mode} audit exposed a configured secret in output.`);
    }
  }

  const result = JSON.parse(output);
  if (result.ok !== true || result.mode !== mode) {
    throw new Error(`Hosted relay ${mode} audit returned an unsuccessful result.`);
  }
  console.log(JSON.stringify({ mode, ok: true }));
  return result;
}

function requireHostedRelayUrl(value) {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new Error("HEALTHLINK_HOSTED_RELAY_URL is required for the hosted relay audit.");
  }

  let url;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("HEALTHLINK_HOSTED_RELAY_URL must be a valid absolute HTTPS URL.");
  }
  if (url.protocol !== "https:" || !url.hostname) {
    throw new Error("HEALTHLINK_HOSTED_RELAY_URL must use HTTPS and include a hostname.");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("HEALTHLINK_HOSTED_RELAY_URL must not contain credentials, query parameters, or a fragment.");
  }
  return url.toString().replace(/\/$/, "");
}

function requireSecret(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for the hosted relay audit.`);
  }
  return value;
}

function run(label, command, commandArgs) {
  console.log(`\n==> ${label}`);
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    env: process.env,
    stdio: "inherit",
    timeout: 120_000
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status ?? "unknown"}.`);
  }
}

function capture(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    env: options.env ?? process.env,
    encoding: "utf8",
    timeout: options.timeout ?? 30_000
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.stderr.write(result.stderr ?? "");
    throw new Error(`${command} exited with status ${result.status ?? "unknown"}.`);
  }
  return result.stdout;
}
