import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = process.cwd();
const tempDir = mkdtempSync(join(tmpdir(), "healthlink-package-audit-"));
const packDir = join(tempDir, "pack");
const installPrefix = join(tempDir, "prefix");
const npmCache = join(tempDir, "npm-cache");
const isolatedHome = join(tempDir, "home");
const stateDir = join(tempDir, "state");
const databasePath = join(tempDir, "healthlink.sqlite");
const relayDatabasePath = join(tempDir, "relay.sqlite");
const skillDir = join(tempDir, "openclaw-skill");
const workBuddySkillDir = join(tempDir, "workbuddy-skill");
const relayApiToken = randomBytes(32).toString("base64url");
const metricsToken = randomBytes(32).toString("base64url");
const npmEnv = {
  ...process.env,
  HOME: isolatedHome,
  npm_config_audit: "false",
  npm_config_cache: npmCache,
  npm_config_fetch_retries: "2",
  npm_config_fetch_retry_maxtimeout: "10000",
  npm_config_fetch_retry_mintimeout: "1000",
  npm_config_fetch_timeout: "60000",
  npm_config_fund: "false",
  npm_config_update_notifier: "false"
};
let relay;
let installProcess;
let relayLogs = "";
let cleaning = false;

mkdirSync(packDir, { recursive: true });
mkdirSync(isolatedHome, { recursive: true });

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, async () => {
    await cleanup();
    process.exit(signal === "SIGINT" ? 130 : 143);
  });
}

try {
  const tarballPath = packVitalAgentSync();
  verifyPinnedNpxFallback(tarballPath);
  await installTarball(tarballPath);
  const binaryPath = resolveInstalledBinary();
  verifyInstalledCli(binaryPath);
  await verifyInstalledRelayFlow(binaryPath);
  verifyInstalledSkillExport(binaryPath);
  verifyRelayLogs();
  console.log("\nVital Agent Sync relay package audit passed.");
} finally {
  await cleanup();
}

function verifyPinnedNpxFallback(tarballPath) {
  console.log("\n==> pinned npx-compatible cold invocation");
  const version = capture("npm", [
    "exec",
    "--yes",
    "--package",
    tarballPath,
    "--",
    "vitalmcp",
    "--version"
  ], { cwd: tempDir, env: npmEnv, timeoutMs: 5 * 60_000 }).trim();
  assert(version === "vitalmcp 0.4.1", "Pinned npm exec fallback reports the wrong version.");
  console.log(version);
  const status = JSON.parse(capture("npm", [
    "exec",
    "--yes",
    "--package",
    tarballPath,
    "--",
    "vitalmcp",
    "status",
    "--state-dir",
    join(tempDir, "npx-state"),
    "--db",
    join(tempDir, "npx-healthlink.sqlite"),
    "--output",
    "json"
  ], { cwd: tempDir, env: npmEnv, timeoutMs: 5 * 60_000 }));
  assert(status.schema_version === 1, "Pinned npm exec fallback did not emit versioned JSON.");
  assert(status.command === "status", "Pinned npm exec fallback ran the wrong command.");
}

function packVitalAgentSync() {
  console.log("\n==> pack vitalmcp tarball");
  const output = capture("npm", [
    "pack",
    "--workspace",
    "vitalmcp",
    "--pack-destination",
    packDir,
    "--json"
  ], { cwd: root, env: npmEnv });
  const packed = JSON.parse(output);
  const artifact = packed[0];
  assert(artifact?.name === "vitalmcp", "npm pack returned the wrong package name.");
  assert(artifact.version === "0.4.1", "npm pack returned the wrong package version.");
  assert(Array.isArray(artifact.files), "npm pack did not report package files.");
  const packagePaths = artifact.files.map((entry) => entry.path);
  for (const required of [
    "README.md",
    "package.json",
    "dist/cli.js",
    "dist/relay-audit.js",
    "dist/relay-crypto.js",
    "dist/relay-pull.js",
    "dist/relay-server.js"
  ]) {
    assert(packagePaths.includes(required), `Packed vitalmcp is missing ${required}.`);
  }
  assert(
    packagePaths.every((path) => !path.startsWith("src/") && !path.startsWith("tests/")),
    "Packed vitalmcp contains source or test files."
  );
  const tarballPath = join(packDir, artifact.filename);
  assert(existsSync(tarballPath), "npm pack did not create the reported tarball.");
  console.log(JSON.stringify({
    name: artifact.name,
    version: artifact.version,
    filename: artifact.filename,
    files: packagePaths.length
  }));
  return tarballPath;
}

async function installTarball(tarballPath) {
  console.log("\n==> install tarball into isolated global prefix");
  await runWithHeartbeat("npm", [
    "install",
    "--global",
    "--prefix",
    installPrefix,
    tarballPath
  ], {
    cwd: tempDir,
    env: npmEnv,
    heartbeatMs: 15_000,
    timeoutMs: 5 * 60_000
  });
}

function resolveInstalledBinary() {
  const path = process.platform === "win32"
    ? join(installPrefix, "vitalmcp.cmd")
    : join(installPrefix, "bin", "vitalmcp");
  assert(existsSync(path), "Isolated global install did not create vitalmcp.");
  return path;
}

function verifyInstalledCli(binaryPath) {
  console.log("\n==> isolated installed CLI");
  const version = capture(binaryPath, ["--version"], { cwd: tempDir, env: npmEnv }).trim();
  assert(version === "vitalmcp 0.4.1", "Installed CLI reports the wrong version.");
  const help = capture(binaryPath, ["--help"], { cwd: tempDir, env: npmEnv });
  for (const expected of [
    "setup --transport relay",
    "relay audit --relay-url <url> --active --yes",
    "export-skill --agent <openclaw|workbuddy>"
  ]) {
    assert(help.includes(expected), `Installed CLI help is missing: ${expected}.`);
  }
  console.log(version);
}

async function verifyInstalledRelayFlow(binaryPath) {
  console.log("\n==> isolated installed relay fixture, pull, and active audit");
  const port = await findAvailablePort();
  const relayUrl = `http://127.0.0.1:${port}`;
  relay = spawn(binaryPath, ["relay", "serve"], {
    cwd: tempDir,
    env: {
      ...npmEnv,
      HEALTHLINK_RELAY_HOST: "127.0.0.1",
      HEALTHLINK_RELAY_PORT: String(port),
      HEALTHLINK_RELAY_DB: relayDatabasePath,
      HEALTHLINK_RELAY_API_TOKEN: relayApiToken,
      HEALTHLINK_RELAY_METRICS_TOKEN: metricsToken
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  relay.stdout.on("data", (chunk) => {
    relayLogs += chunk.toString();
  });
  relay.stderr.on("data", (chunk) => {
    relayLogs += chunk.toString();
  });
  await waitForRelay(relayUrl);

  const envelopeOutput = capture(binaryPath, [
    "relay",
    "fixture",
    "--transport",
    "self-hosted-relay",
    "--relay-url",
    relayUrl,
    "--relay-api-token",
    relayApiToken,
    "--state-dir",
    stateDir,
    "--sequence",
    "1",
    "--date",
    "2026-07-08",
    "--steps",
    "7777"
  ], { cwd: tempDir, env: npmEnv });
  const envelope = JSON.parse(envelopeOutput);
  assert(envelope.protocol === "healthlink-e2ee-v1", "Installed CLI emitted the wrong relay protocol.");
  assert(envelope.sequence === 1, "Installed CLI emitted the wrong fixture sequence.");
  assert(typeof envelope.crypto?.ciphertext === "string", "Installed CLI fixture is missing ciphertext.");
  assert(!envelopeOutput.includes("PRIVATE KEY"), "Installed CLI fixture exposed private key material.");

  const config = JSON.parse(readFileSync(join(stateDir, "config.json"), "utf8"));
  assert(typeof config.relay_access_token === "string", "Installed relay config is missing its tenant token.");
  const upload = await fetch(`${relayUrl}/v1/envelopes`, {
    method: "POST",
    redirect: "error",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.relay_access_token}`,
      "x-healthlink-relay-api-key": relayApiToken
    },
    body: JSON.stringify(envelope),
    signal: AbortSignal.timeout(3000)
  });
  assert(upload.ok, `Installed relay fixture upload returned HTTP ${upload.status}.`);

  const pull = capture(binaryPath, [
    "pull",
    "--once",
    "--relay-url",
    relayUrl,
    "--relay-api-token",
    relayApiToken,
    "--state-dir",
    stateDir,
    "--db",
    databasePath
  ], { cwd: tempDir, env: npmEnv });
  assert(pull.includes("Fetched:         1"), "Installed relay pull did not fetch the fixture.");
  assert(pull.includes("Ingested:        1"), "Installed relay pull did not ingest the fixture.");
  assert(pull.includes("Acked:           1"), "Installed relay pull did not acknowledge the fixture.");

  const status = capture(binaryPath, [
    "status",
    "--state-dir",
    stateDir,
    "--db",
    databasePath
  ], { cwd: tempDir, env: npmEnv });
  assert(status.includes("Syncs:      1"), "Installed CLI status did not see the pulled sync.");
  assert(status.includes("Transport:  self_hosted_relay"), "Installed CLI status lost relay transport metadata.");

  const auditOutput = capture(binaryPath, [
    "relay",
    "audit",
    "--relay-url",
    relayUrl,
    "--relay-api-token",
    relayApiToken,
    "--metrics-token",
    metricsToken,
    "--active",
    "--yes"
  ], { cwd: tempDir, env: npmEnv });
  const audit = JSON.parse(auditOutput);
  assert(audit.ok === true && audit.mode === "active", "Installed CLI active relay audit failed.");
  assert(!auditOutput.includes(relayApiToken), "Installed CLI audit exposed the deployment token.");
  assert(!auditOutput.includes(metricsToken), "Installed CLI audit exposed the metrics token.");
  console.log(JSON.stringify({
    fixture_uploaded: true,
    fixture_pulled: true,
    local_syncs: 1,
    active_audit: audit.ok
  }));
}

function verifyInstalledSkillExport(binaryPath) {
  console.log("\n==> isolated installed OpenClaw skill export");
  capture(binaryPath, [
    "export-skill",
    "--agent",
    "openclaw",
    "--output-dir",
    skillDir
  ], { cwd: tempDir, env: npmEnv });
  assert(
    JSON.stringify(readdirSync(skillDir).sort()) === JSON.stringify(["README.md", "SKILL.md"]),
    "Installed CLI exported unexpected OpenClaw package files."
  );
  const skill = readFileSync(join(skillDir, "SKILL.md"), "utf8");
  const readme = readFileSync(join(skillDir, "README.md"), "utf8");
  for (const expected of [
    "name: vitalmcp-personal-context",
    "version: 0.4.1",
    "vitalmcp@0.4.1",
    "vitalmcp pull"
  ]) {
    assert(skill.includes(expected), `Installed CLI skill export is missing: ${expected}.`);
  }
  assert(readme.includes("clawhub skill publish"), "Installed CLI skill README lacks ClawHub publishing guidance.");
  const exported = `${skill}\n${readme}`;
  for (const forbidden of [relayApiToken, metricsToken, "BEGIN PRIVATE KEY"]) {
    assert(!exported.includes(forbidden), "Installed CLI skill export contains sensitive runtime material.");
  }
  console.log(JSON.stringify({ files: ["README.md", "SKILL.md"], version: "0.4.1" }));

  console.log("\n==> isolated installed WorkBuddy SkillHub export");
  capture(binaryPath, [
    "export-skill",
    "--agent",
    "workbuddy",
    "--output-dir",
    workBuddySkillDir
  ], { cwd: tempDir, env: npmEnv });
  assert(
    JSON.stringify(readdirSync(workBuddySkillDir)) === JSON.stringify(["SKILL.md"]),
    "Installed CLI exported unexpected WorkBuddy package files."
  );
  const workBuddySkill = readFileSync(join(workBuddySkillDir, "SKILL.md"), "utf8");
  for (const expected of [
    "name: vital-agent-sync",
    "vitalmcp@0.4.1",
    "~/.workbuddy/mcp.json",
    "setup --transport lan --agent workbuddy --output json",
    "next_action.url"
  ]) {
    assert(workBuddySkill.includes(expected), `Installed CLI WorkBuddy export is missing: ${expected}.`);
  }
  for (const forbidden of [relayApiToken, metricsToken, "BEGIN PRIVATE KEY", "relay_access_token", "upload_auth_secret"]) {
    assert(!workBuddySkill.includes(forbidden), "Installed CLI WorkBuddy export contains sensitive runtime material.");
  }
  console.log(JSON.stringify({ files: ["SKILL.md"], version: "0.4.1", agent: "workbuddy" }));
}

function verifyRelayLogs() {
  const forbiddenPatterns = [
    /ciphertext/i,
    /signature/i,
    /upload_auth_secret/i,
    /relay_access_token/i,
    /relay_api_token/i,
    /health_daily_summaries/i,
    /private_key/i
  ];
  assert(forbiddenPatterns.every((pattern) => !pattern.test(relayLogs)), "Installed relay logs contain sensitive fields.");
  assert(!relayLogs.includes(relayApiToken), "Installed relay logs exposed the deployment token.");
  assert(!relayLogs.includes(metricsToken), "Installed relay logs exposed the metrics token.");
}

async function waitForRelay(relayUrl) {
  const deadline = Date.now() + 15_000;
  let lastError = "not ready";
  while (Date.now() < deadline) {
    if (relay?.exitCode !== null) {
      throw new Error(`Installed relay exited before becoming ready with status ${relay?.exitCode}.`);
    }
    try {
      const response = await fetch(`${relayUrl}/v1/status`, {
        redirect: "error",
        signal: AbortSignal.timeout(1000)
      });
      if (response.ok) {
        return;
      }
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : "request failed";
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error(`Installed relay did not become ready: ${lastError}`);
}

function findAvailablePort() {
  return new Promise((resolvePromise, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0 }, () => {
      const address = server.address();
      server.close(() => {
        if (!address || typeof address === "string") {
          reject(new Error("Unable to allocate a relay package-audit port."));
          return;
        }
        resolvePromise(address.port);
      });
    });
  });
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    env: options.env ?? process.env,
    stdio: "inherit"
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status ?? "unknown"}.`);
  }
}

function runWithHeartbeat(command, args, options = {}) {
  const startedAt = Date.now();
  const heartbeatMs = options.heartbeatMs ?? 15_000;
  const timeoutMs = options.timeoutMs ?? 5 * 60_000;
  const child = spawn(command, args, {
    cwd: options.cwd ?? root,
    env: options.env ?? process.env,
    stdio: "inherit"
  });
  installProcess = child;

  return new Promise((resolvePromise, reject) => {
    let timedOut = false;
    let settled = false;
    let forceKillTimer;
    const heartbeat = setInterval(() => {
      const elapsedSeconds = Math.round((Date.now() - startedAt) / 1000);
      console.log(`Package audit install still running (${elapsedSeconds}s elapsed)...`);
    }, heartbeatMs);
    const timeout = setTimeout(() => {
      timedOut = true;
      console.error(`Package audit install exceeded ${Math.round(timeoutMs / 1000)}s; terminating npm.`);
      child.kill("SIGTERM");
      forceKillTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill("SIGKILL");
        }
      }, 3000);
    }, timeoutMs);

    const finish = () => {
      clearInterval(heartbeat);
      clearTimeout(timeout);
      if (forceKillTimer) {
        clearTimeout(forceKillTimer);
      }
      if (installProcess === child) {
        installProcess = undefined;
      }
    };

    child.once("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      finish();
      reject(error);
    });
    child.once("close", (code, signal) => {
      if (settled) {
        return;
      }
      settled = true;
      finish();
      if (timedOut) {
        reject(new Error(`npm install timed out after ${Math.round(timeoutMs / 1000)} seconds.`));
        return;
      }
      if (code !== 0) {
        reject(new Error(`npm install exited with status ${code ?? signal ?? "unknown"}.`));
        return;
      }
      resolvePromise();
    });
  });
}

function capture(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    env: options.env ?? process.env,
    encoding: "utf8",
    timeout: options.timeoutMs
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.stderr.write(result.stdout);
    process.stderr.write(result.stderr);
    throw new Error(`${command} exited with status ${result.status ?? "unknown"}.`);
  }
  return result.stdout;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function cleanup() {
  if (cleaning) {
    return;
  }
  cleaning = true;
  if (installProcess && installProcess.exitCode === null) {
    const child = installProcess;
    child.kill("SIGTERM");
    await Promise.race([
      new Promise((resolvePromise) => child.once("close", resolvePromise)),
      new Promise((resolvePromise) => setTimeout(resolvePromise, 3000))
    ]);
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
    }
  }
  if (relay && relay.exitCode === null) {
    relay.kill("SIGTERM");
    await Promise.race([
      new Promise((resolvePromise) => relay.once("close", resolvePromise)),
      new Promise((resolvePromise) => setTimeout(resolvePromise, 3000))
    ]);
    if (relay.exitCode === null) {
      relay.kill("SIGKILL");
    }
  }
  rmSync(tempDir, { recursive: true, force: true });
  cleaning = false;
}
