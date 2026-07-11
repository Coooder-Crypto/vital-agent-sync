import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";

const root = process.cwd();
const suffix = `${process.pid}-${Date.now()}`;
const containerName = `healthlink-relay-container-audit-${suffix}`;
const composeProject = `healthlink-relay-audit-${suffix}`;
const relayImage = "healthlink-relay:dev";
const relayApiToken = randomBytes(32).toString("base64url");
const metricsToken = randomBytes(32).toString("base64url");
const developmentCompose = "deploy/relay/docker-compose.yml";
const productionCompose = "deploy/relay/docker-compose.production.yml";
const productionEnv = "deploy/relay/.env.production.example";
let containerStarted = false;
let composeTouched = false;
let cleaning = false;

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    cleanup();
    process.exit(signal === "SIGINT" ? 130 : 143);
  });
}

try {
  ensureDockerDaemon();
  run("healthlink-local build", "npm", ["run", "build", "--workspace", "healthlink-local"]);
  run("development Compose config", "docker", ["compose", "-f", developmentCompose, "config", "--quiet"]);
  run("production Compose config", "docker", [
    "compose",
    "--env-file",
    productionEnv,
    "-f",
    productionCompose,
    "config",
    "--quiet"
  ]);
  run("relay image build", "docker", [
    "compose",
    "-f",
    developmentCompose,
    "build",
    "--pull=false",
    "healthlink-relay"
  ]);

  verifyImageConfig();
  verifyRuntimeImage();
  validateCaddyfile();
  await verifyHardenedRelayContainer();

  console.log("\nHealthLink E2EE relay container audit passed.");
} finally {
  cleanup();
}

function ensureDockerDaemon() {
  try {
    const version = capture("docker", ["info", "--format", "{{.ServerVersion}}"]).trim();
    if (!version) {
      throw new Error("Docker did not report a server version.");
    }
    console.log(`Docker server: ${version}`);
  } catch {
    throw new Error("Docker daemon is unavailable. Start Docker Desktop or another Docker daemon, then rerun npm run audit:relay-container.");
  }
}

function verifyImageConfig() {
  console.log("\n==> relay image config");
  const parsed = JSON.parse(capture("docker", ["image", "inspect", relayImage]));
  const image = parsed[0];
  assert(image?.Config?.User === "node", "Relay runtime image must run as the node user.");
  const env = Array.isArray(image.Config.Env) ? image.Config.Env : [];
  assert(
    !env.some((entry) => /^HEALTHLINK_RELAY_(?:API|METRICS)_TOKEN=/.test(entry)),
    "Relay runtime image must not contain API or metrics token defaults."
  );
  assert(
    Array.isArray(image.Config.Cmd) && image.Config.Cmd.join(" ") === "node packages/local/dist/cli.js relay serve",
    "Relay runtime image command is incorrect."
  );
  console.log(JSON.stringify({ user: image.Config.User, command: image.Config.Cmd }));
}

function verifyRuntimeImage() {
  console.log("\n==> relay runtime dependency and toolchain probe");
  const script = [
    "const fs=require('node:fs')",
    "const Database=require('better-sqlite3')",
    "const forbidden=['/usr/bin/python3','/usr/bin/make','/usr/bin/g++'].filter(fs.existsSync)",
    "if(forbidden.length)throw new Error('build tools present: '+forbidden.join(','))",
    "if('HEALTHLINK_RELAY_API_TOKEN' in process.env||'HEALTHLINK_RELAY_METRICS_TOKEN' in process.env)throw new Error('secret-shaped defaults present')",
    "const db=new Database(':memory:')",
    "db.exec('create table probe(value integer)')",
    "db.close()",
    "console.log(JSON.stringify({node:process.version,uid:process.getuid?.(),nativeSqlite:true,buildToolsAbsent:true,secretDefaultsAbsent:true}))"
  ].join(";");
  const output = capture("docker", [
    "run",
    "--rm",
    "--entrypoint",
    "node",
    relayImage,
    "-e",
    script
  ]);
  const result = JSON.parse(output);
  assert(result.uid === 1000, "Relay runtime process must use UID 1000.");
  assert(result.nativeSqlite === true, "Relay runtime must load the native SQLite binding.");
  assert(result.buildToolsAbsent === true, "Relay runtime must exclude compiler tooling.");
  console.log(output.trim());

  const version = capture("docker", [
    "run",
    "--rm",
    "--entrypoint",
    "node",
    relayImage,
    "packages/local/dist/cli.js",
    "--version"
  ]).trim();
  assert(version === "healthlink-local 0.2.0", "Relay image contains the wrong healthlink-local version.");
  console.log(version);
}

function validateCaddyfile() {
  console.log("\n==> production Caddy validation");
  composeTouched = true;
  run(undefined, "docker", [
    "compose",
    "--project-name",
    composeProject,
    "--env-file",
    productionEnv,
    "-f",
    productionCompose,
    "run",
    "--rm",
    "--no-deps",
    "caddy",
    "caddy",
    "validate",
    "--config",
    "/etc/caddy/Caddyfile",
    "--adapter",
    "caddyfile"
  ]);
}

async function verifyHardenedRelayContainer() {
  console.log("\n==> hardened relay container active audit");
  capture("docker", [
    "run",
    "--rm",
    "-d",
    "--init",
    "--name",
    containerName,
    "--read-only",
    "--tmpfs",
    "/tmp:size=64m,mode=1777",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges:true",
    "--volume",
    "/data",
    "--publish",
    "127.0.0.1::8790",
    "--env",
    `HEALTHLINK_RELAY_API_TOKEN=${relayApiToken}`,
    "--env",
    `HEALTHLINK_RELAY_METRICS_TOKEN=${metricsToken}`,
    relayImage
  ]);
  containerStarted = true;

  const portOutput = capture("docker", ["port", containerName, "8790/tcp"]).trim();
  const port = Number(portOutput.match(/:(\d+)$/)?.[1]);
  assert(Number.isInteger(port) && port > 0, "Docker did not publish a relay audit port.");
  const relayUrl = `http://127.0.0.1:${port}`;
  await waitForRelay(relayUrl);

  const auditOutput = capture("node", [
    "packages/local/dist/cli.js",
    "relay",
    "audit",
    "--relay-url",
    relayUrl,
    "--metrics-token",
    metricsToken,
    "--relay-api-token",
    relayApiToken,
    "--active",
    "--yes"
  ]);
  const audit = JSON.parse(auditOutput);
  assert(audit.ok === true && audit.mode === "active", "Hardened relay container active audit failed.");
  assert(!auditOutput.includes(relayApiToken), "Active audit output exposed the deployment API token.");
  assert(!auditOutput.includes(metricsToken), "Active audit output exposed the metrics token.");
  console.log(auditOutput.trim());

  const countsScript = [
    "const Database=require('better-sqlite3')",
    "const db=new Database('/data/relay.sqlite',{readonly:true})",
    "const row=db.prepare(\"select (select count(*) from relay_envelopes) envelope_count,(select count(*) from relay_users where revoked_at is null) active_users,(select count(*) from relay_users where revoked_at is not null) revoked_users\").get()",
    "db.close()",
    "console.log(JSON.stringify(row))"
  ].join(";");
  const countsOutput = capture("docker", ["exec", containerName, "node", "-e", countsScript]);
  const counts = JSON.parse(countsOutput);
  assert(counts.envelope_count === 0, "Active audit left relay envelopes behind.");
  assert(counts.active_users === 0, "Active audit left an active disposable identity behind.");
  assert(counts.revoked_users === 2, "Active audit did not revoke both disposable identities.");
  console.log(countsOutput.trim());

  const hostConfig = JSON.parse(capture("docker", [
    "inspect",
    containerName,
    "--format",
    "{{json .HostConfig}}"
  ]));
  assert(hostConfig.ReadonlyRootfs === true, "Relay container root filesystem must be read-only.");
  assert(hostConfig.Init === true, "Relay container must run with an init process.");
  assert(hostConfig.CapDrop?.includes("ALL"), "Relay container must drop all Linux capabilities.");
  assert(
    hostConfig.SecurityOpt?.includes("no-new-privileges:true"),
    "Relay container must enable no-new-privileges."
  );
  assert(typeof hostConfig.Tmpfs?.["/tmp"] === "string", "Relay container must mount a bounded /tmp tmpfs.");

  const logs = captureCombined("docker", ["logs", containerName]);
  const forbiddenLogPatterns = [
    /ciphertext/i,
    /signature/i,
    /upload_auth_secret/i,
    /relay_access_token/i,
    /relay_api_token/i,
    /private_key/i,
    /health_daily_summaries/i,
    /device_token/i
  ];
  assert(
    forbiddenLogPatterns.every((pattern) => !pattern.test(logs)),
    "Relay container logs contain a forbidden sensitive field name."
  );
  assert(!logs.includes(relayApiToken) && !logs.includes(metricsToken), "Relay container logs exposed an audit token.");
  console.log(logs.trim());
}

async function waitForRelay(relayUrl) {
  const deadline = Date.now() + 15_000;
  let lastError = "not ready";
  while (Date.now() < deadline) {
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
  throw new Error(`Relay container did not become ready: ${lastError}`);
}

function run(label, command, args) {
  if (label) {
    console.log(`\n==> ${label}`);
  }
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit"
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status ?? "unknown"}.`);
  }
}

function capture(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8"
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

function captureCombined(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8"
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.stderr.write(result.stdout);
    process.stderr.write(result.stderr);
    throw new Error(`${command} exited with status ${result.status ?? "unknown"}.`);
  }
  return `${result.stdout}${result.stderr}`;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function cleanup() {
  if (cleaning) {
    return;
  }
  cleaning = true;
  if (containerStarted) {
    spawnSync("docker", ["stop", "--time", "5", containerName], {
      cwd: root,
      stdio: "ignore"
    });
    containerStarted = false;
  }
  if (composeTouched) {
    spawnSync("docker", [
      "compose",
      "--project-name",
      composeProject,
      "--env-file",
      productionEnv,
      "-f",
      productionCompose,
      "down",
      "--volumes",
      "--remove-orphans"
    ], {
      cwd: root,
      stdio: "ignore"
    });
    composeTouched = false;
  }
  cleaning = false;
}
