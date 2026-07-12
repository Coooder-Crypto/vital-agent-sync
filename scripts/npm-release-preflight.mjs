import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = process.cwd();
const localOnly = process.argv.includes("--local");
const unknownArgs = process.argv.slice(2).filter((arg) => arg !== "--local");
if (unknownArgs.length > 0) {
  throw new Error(`Unknown option: ${unknownArgs[0]}`);
}

const packagePath = join(root, "packages", "local", "package.json");
const manifest = JSON.parse(readFileSync(packagePath, "utf8"));
const tempDir = mkdtempSync(join(tmpdir(), "healthlink-npm-release-preflight-"));
const npmCache = join(tempDir, "npm-cache");
const npmEnv = {
  ...process.env,
  npm_config_audit: "false",
  npm_config_cache: npmCache,
  npm_config_fund: "false",
  npm_config_update_notifier: "false"
};

try {
  assertReleaseManifest(manifest);
  runSecretScan();
  assertCleanWorktree();
  const artifact = inspectPack();
  if (!localOnly) {
    verifyRegistry(manifest);
  }
  console.log("\nHealthLink npm release preflight passed.");
  console.log(JSON.stringify({
    package: manifest.name,
    local_version: manifest.version,
    packed_files: artifact.files.length,
    registry_checked: !localOnly,
    publish_executed: false
  }, null, 2));
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

function assertReleaseManifest(value) {
  if (value.name !== "healthlink-local" || value.version !== "0.3.0") {
    throw new Error("Expected the release manifest to be healthlink-local@0.3.0.");
  }
  if (value.private === true || value.publishConfig?.access !== "public") {
    throw new Error("healthlink-local must be a public publishable package.");
  }
}

function runSecretScan() {
  console.log("\n==> scan release scope for secrets and sensitive data");
  const result = spawnSync("npm", ["run", "audit:secrets"], {
    cwd: root,
    env: process.env,
    stdio: "inherit",
    timeout: 30_000
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`Release secret scan exited with status ${result.status ?? "unknown"}.`);
  }
}

function assertCleanWorktree() {
  if (process.env.HEALTHLINK_NPM_RELEASE_ALLOW_DIRTY === "1") {
    console.warn("Release preflight is allowing a dirty worktree by explicit environment override.");
    return;
  }
  const status = capture("git", [
    "status",
    "--porcelain",
    "--",
    ".",
    ":(exclude)apps/www",
    ":(exclude)docs/website-media-plan.md"
  ], { env: process.env });
  if (status.trim()) {
    throw new Error(
      "The non-website worktree is dirty. Commit or intentionally stage/review the release changes before publishing. " +
      "For local script testing only, set HEALTHLINK_NPM_RELEASE_ALLOW_DIRTY=1."
    );
  }
}

function inspectPack() {
  console.log("\n==> inspect npm release artifact");
  const output = capture("npm", [
    "pack",
    "--workspace",
    "healthlink-local",
    "--pack-destination",
    tempDir,
    "--dry-run",
    "--json"
  ], { env: npmEnv, timeout: 120_000 });
  const artifact = JSON.parse(output)[0];
  if (artifact?.name !== "healthlink-local" || artifact.version !== manifest.version) {
    throw new Error("npm pack reported an unexpected package or version.");
  }
  const paths = artifact.files.map((entry) => entry.path);
  for (const required of ["README.md", "package.json", "dist/cli.js", "dist/relay-server.js"]) {
    if (!paths.includes(required)) {
      throw new Error(`npm release artifact is missing ${required}.`);
    }
  }
  if (paths.some((path) => path.startsWith("src/") || path.startsWith("tests/"))) {
    throw new Error("npm release artifact contains source or test files.");
  }
  const unexpectedTarball = join(tempDir, artifact.filename);
  if (existsSync(unexpectedTarball)) {
    throw new Error("npm pack --dry-run unexpectedly wrote a tarball.");
  }
  return artifact;
}

function verifyRegistry(value) {
  console.log("\n==> verify npm publisher and registry version");
  const publisher = capture("npm", ["whoami"], { env: npmEnv, timeout: 30_000 }).trim();
  if (!publisher) {
    throw new Error("npm whoami returned an empty publisher identity.");
  }
  const registryVersion = capture("npm", ["view", value.name, "version"], {
    env: npmEnv,
    timeout: 30_000
  }).trim();
  if (compareVersions(value.version, registryVersion) <= 0) {
    throw new Error(
      `Local version ${value.version} must be greater than registry version ${registryVersion}.`
    );
  }
  console.log(JSON.stringify({ publisher, registry_version: registryVersion }));
}

function compareVersions(left, right) {
  const leftParts = parseVersion(left);
  const rightParts = parseVersion(right);
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      return leftParts[index] - rightParts[index];
    }
  }
  return 0;
}

function parseVersion(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value);
  if (!match) {
    throw new Error(`Expected a stable semantic version, received: ${value}`);
  }
  return match.slice(1).map(Number);
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
