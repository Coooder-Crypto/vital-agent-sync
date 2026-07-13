import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";

const root = process.cwd();
const swiftSources = readdirSync(join(root, "App"))
  .filter((file) => file.endsWith(".swift"))
  .sort()
  .map((file) => join("App", file));
const iosSdkPath = resolveIOSSDKPath();

const checks = [
  {
    label: "vitalmcp typecheck",
    command: "npm",
    args: ["run", "typecheck", "--workspace", "vitalmcp"]
  },
  {
    label: "vitalmcp tests",
    command: "npm",
    args: ["test", "--workspace", "vitalmcp"]
  },
  {
    label: "vitalmcp build",
    command: "npm",
    args: ["run", "build", "--workspace", "vitalmcp"]
  },
  {
    label: "compiled CLI version",
    command: "node",
    args: ["packages/local/dist/cli.js", "--version"]
  },
  {
    label: "compiled relay fixture flow",
    command: "node",
    args: ["packages/local/dist/relay-fixture-flow.js"]
  },
  {
    label: "Swift source parse",
    command: "swiftc",
    args: ["-parse", ...swiftSources]
  },
  {
    label: "iOS SDK full source typecheck",
    command: "swiftc",
    args: [
      "-module-cache-path",
      join(tmpdir(), "healthlink-ios-swift-module-cache"),
      "-target",
      "arm64-apple-ios17.0",
      "-sdk",
      iosSdkPath,
      "-typecheck",
      ...swiftSources
    ]
  },
  {
    label: "Swift relay crypto typecheck",
    command: "swiftc",
    args: [
      "-module-cache-path",
      join(tmpdir(), "healthlink-swift-module-cache"),
      "-typecheck",
      "App/Models.swift",
      "App/GatewayAPIClient.swift"
    ]
  },
  {
    label: "iOS CryptoKit to Node relay interop",
    command: "node",
    args: ["scripts/e2ee-relay-ios-interop.mjs"]
  }
];

for (const check of checks) {
  run(check);
}

runHostedSetupFailClosedCheck();
runCliArgumentValidationCheck();
runSavedRelayModeCheck();
await runCompiledRelayAudit();
console.log("\nVitalMCP E2EE relay local audit passed.");

function run(check) {
  console.log(`\n==> ${check.label}`);
  const result = spawnSync(check.command, check.args, {
    cwd: root,
    stdio: "inherit"
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function resolveIOSSDKPath() {
  const result = spawnSync("xcrun", ["--sdk", "iphoneos", "--show-sdk-path"], {
    cwd: root,
    encoding: "utf8"
  });
  if (result.error) {
    throw result.error;
  }
  const path = result.stdout.trim();
  if (result.status !== 0 || !path) {
    process.stderr.write(result.stderr);
    throw new Error("Unable to resolve the installed iPhoneOS SDK for the local relay audit.");
  }
  return path;
}

function runHostedSetupFailClosedCheck() {
  console.log("\n==> compiled hosted setup fail-closed");
  const tempDir = mkdtempSync(join(tmpdir(), "healthlink-hosted-setup-audit-"));
  const stateDir = join(tempDir, "state");
  const env = { ...process.env };
  delete env.HEALTHLINK_HOSTED_RELAY_URL;
  delete env.HEALTHLINK_RELAY_URL;
  try {
    const result = spawnSync("node", [
      "packages/local/dist/cli.js",
      "setup",
      "--transport",
      "relay",
      "--agent",
      "generic",
      "--yes",
      "--state-dir",
      stateDir,
      "--output",
      "json"
    ], {
      cwd: root,
      env,
      encoding: "utf8"
    });
    if (result.error) {
      throw result.error;
    }
    const output = result.stdout.trim() ? JSON.parse(result.stdout) : {};
    if (result.status === 0 || output.error?.code !== "relay_url_invalid" ||
        !output.error?.message?.includes("Hosted VitalMCP relay URL is not configured")) {
      process.stderr.write(result.stdout);
      process.stderr.write(result.stderr);
      throw new Error("Hosted relay setup did not fail with the expected missing-URL error.");
    }
    if (existsSync(join(stateDir, "config.json"))) {
      throw new Error("Hosted relay setup wrote config.json before rejecting a missing hosted URL.");
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function runCliArgumentValidationCheck() {
  console.log("\n==> compiled CLI argument validation");
  const cases = [
    {
      args: ["--definitely-unknown"],
      expected: "Unknown option: --definitely-unknown"
    },
    {
      args: ["export-skill", "--output-dir"],
      expected: "--output-dir requires a value"
    },
    {
      args: ["relay", "audit", "--relay-url", "http://127.0.0.1:8790", "--active"],
      expected: "relay audit --active creates and revokes disposable relay identities"
    }
  ];
  for (const testCase of cases) {
    const result = spawnSync("node", ["packages/local/dist/cli.js", ...testCase.args], {
      cwd: root,
      encoding: "utf8"
    });
    if (result.error) {
      throw result.error;
    }
    if (result.status === 0 || !result.stderr.includes(testCase.expected)) {
      process.stderr.write(result.stdout);
      process.stderr.write(result.stderr);
      throw new Error(`CLI argument validation did not reject: ${testCase.args.join(" ")}.`);
    }
  }
  const help = spawnSync("node", ["packages/local/dist/cli.js", "--help"], {
    cwd: root,
    encoding: "utf8"
  });
  if (help.error) {
    throw help.error;
  }
  if (help.status !== 0 || !help.stdout.includes("Usage:") || !help.stdout.includes("https://HOSTED-RELAY") ||
      !help.stdout.includes("--active --yes")) {
    process.stderr.write(help.stdout);
    process.stderr.write(help.stderr);
    throw new Error("Compiled CLI help output is incomplete.");
  }
}

function runSavedRelayModeCheck() {
  console.log("\n==> compiled onboarding saved-mode inheritance");
  const tempDir = mkdtempSync(join(tmpdir(), "healthlink-onboarding-mode-audit-"));
  const stateDir = join(tempDir, "state");
  const databasePath = join(tempDir, "healthlink.sqlite");
  try {
    const plan = spawnSync("node", [
      "packages/local/dist/cli.js",
      "setup",
      "--transport",
      "relay",
      "--relay-url",
      "https://relay.example.test",
      "--manager",
      "manual",
      "--state-dir",
      stateDir,
      "--db",
      databasePath,
      "--output",
      "json"
    ], {
      cwd: root,
      encoding: "utf8"
    });
    const consentedSetup = spawnSync("node", [
      "packages/local/dist/cli.js",
      "setup",
      "--resume",
      "--yes",
      "--state-dir",
      stateDir,
      "--db",
      databasePath,
      "--output",
      "json"
    ], {
      cwd: root,
      encoding: "utf8"
    });
    const repeat = spawnSync("node", [
      "packages/local/dist/cli.js",
      "print-onboarding",
      "--state-dir",
      stateDir,
      "--output",
      "json"
    ], {
      cwd: root,
      encoding: "utf8"
    });
    if (plan.error) {
      throw plan.error;
    }
    if (consentedSetup.error) {
      throw consentedSetup.error;
    }
    if (repeat.error) {
      throw repeat.error;
    }
    const planOutput = plan.status === 0 ? JSON.parse(plan.stdout) : {};
    const repeatOutput = repeat.status === 0 ? JSON.parse(repeat.stdout) : {};
    if (plan.status !== 0 || planOutput.status !== "awaiting_consent" ||
        consentedSetup.status !== 1 || repeat.status !== 0 ||
        repeatOutput.details?.relay_mode !== "hosted_relay") {
      process.stderr.write(plan.stderr);
      process.stderr.write(consentedSetup.stderr);
      process.stderr.write(repeat.stderr);
      throw new Error("Consented setup did not preserve the hosted relay mode for print-onboarding.");
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function runCompiledRelayAudit() {
  console.log("\n==> compiled relay audit");
  const port = await findAvailablePort();
  const tempDir = mkdtempSync(join(tmpdir(), "healthlink-relay-audit-"));
  const relay = spawn("node", [
    "packages/local/dist/cli.js",
    "relay",
    "serve"
  ], {
    cwd: root,
    env: {
      ...process.env,
      HEALTHLINK_RELAY_HOST: "127.0.0.1",
      HEALTHLINK_RELAY_PORT: String(port),
      HEALTHLINK_RELAY_DB: join(tempDir, "relay.sqlite"),
      HEALTHLINK_RELAY_RETENTION_DAYS: "30",
      HEALTHLINK_RELAY_MAX_ENVELOPE_BYTES: "524288",
      HEALTHLINK_RELAY_MAX_UPLOADS_PER_MINUTE: "120",
      HEALTHLINK_RELAY_MAX_QUEUED_ENVELOPES_PER_USER: "1000",
      HEALTHLINK_RELAY_MAX_DEVICES_PER_USER: "5",
      HEALTHLINK_RELAY_API_TOKEN: "local-audit-relay-api-token",
      HEALTHLINK_RELAY_METRICS_TOKEN: "local-audit-metrics-token"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  relay.stdout.on("data", (chunk) => process.stdout.write(chunk));
  relay.stderr.on("data", (chunk) => process.stderr.write(chunk));

  try {
    await waitForRelay(`http://127.0.0.1:${port}/v1/status`, relay);
    run({
      label: "relay audit CLI",
      command: "node",
      args: [
        "packages/local/dist/cli.js",
        "relay",
        "audit",
        "--relay-url",
        `http://127.0.0.1:${port}`,
        "--metrics-token",
        "local-audit-metrics-token",
        "--relay-api-token",
        "local-audit-relay-api-token",
        "--active",
        "--yes"
      ]
    });
  } finally {
    relay.kill("SIGTERM");
    await new Promise((resolve) => relay.once("close", resolve));
  }
}

function findAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0 }, () => {
      const address = server.address();
      server.close(() => {
        if (!address || typeof address === "string") {
          reject(new Error("Unable to allocate a local TCP port."));
          return;
        }
        resolve(address.port);
      });
    });
  });
}

async function waitForRelay(url, child) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 5000) {
    if (child.exitCode !== null) {
      throw new Error(`Relay process exited before audit with code ${child.exitCode}.`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // Retry until the relay has opened its socket.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for local relay status endpoint.");
}
