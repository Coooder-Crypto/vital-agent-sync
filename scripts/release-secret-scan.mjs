import { spawnSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const maxTextFileBytes = 2 * 1024 * 1024;
const findings = [];
let scannedFiles = 0;
let skippedBinaryFiles = 0;
let skippedOversizedFiles = 0;

const tokenRules = [
  { id: "private-key-pem", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { id: "age-secret-key", pattern: /AGE-SECRET-KEY-1[0-9A-Z]{40,}/ },
  { id: "aws-access-key", pattern: /AKIA[0-9A-Z]{16}/ },
  { id: "github-token", pattern: /(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})/ },
  { id: "npm-token", pattern: /npm_[A-Za-z0-9]{36,}/ },
  { id: "slack-token", pattern: /xox[baprs]-[A-Za-z0-9-]{24,}/ },
  { id: "stripe-live-key", pattern: /sk_live_[A-Za-z0-9]{20,}/ },
  { id: "openai-key", pattern: /sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}/ }
];

runSelfTest();

for (const relativePath of listReleaseFiles()) {
  const normalizedPath = relativePath.replaceAll("\\", "/");
  const sensitivePathRule = classifySensitivePath(normalizedPath);
  if (sensitivePathRule) {
    findings.push({ rule: sensitivePathRule, path: normalizedPath, line: null });
    continue;
  }

  const absolutePath = resolve(root, relativePath);
  const stat = lstatSync(absolutePath);
  if (!stat.isFile()) {
    continue;
  }
  if (stat.size > maxTextFileBytes) {
    skippedOversizedFiles += 1;
    continue;
  }

  const buffer = readFileSync(absolutePath);
  if (buffer.includes(0)) {
    skippedBinaryFiles += 1;
    continue;
  }

  scannedFiles += 1;
  const lines = buffer.toString("utf8").split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    for (const rule of tokenRules) {
      if (rule.pattern.test(line)) {
        findings.push({ rule: rule.id, path: normalizedPath, line: index + 1 });
      }
    }
    if (containsLiteralHealthLinkSecret(line)) {
      findings.push({ rule: "healthlink-secret-literal", path: normalizedPath, line: index + 1 });
    }
  }
}

if (findings.length > 0) {
  console.error(`Vital Agent Sync release secret scan failed with ${findings.length} finding(s).`);
  for (const finding of findings) {
    const location = finding.line === null ? finding.path : `${finding.path}:${finding.line}`;
    console.error(`${finding.rule}: ${location}`);
  }
  process.exitCode = 1;
} else {
  console.log("Vital Agent Sync release secret scan passed.");
  console.log(JSON.stringify({
    files_scanned: scannedFiles,
    skipped_binary_files: skippedBinaryFiles,
    skipped_oversized_files: skippedOversizedFiles,
    findings: 0,
    self_test: true,
    sensitive_values_printed: false,
    excluded_scope: ["apps/www", "docs/website-media-plan.md"]
  }, null, 2));
}

function listReleaseFiles() {
  const result = spawnSync("git", [
    "ls-files",
    "-z",
    "--cached",
    "--others",
    "--exclude-standard",
    "--",
    ".",
    ":(exclude)apps/www",
    ":(exclude)docs/website-media-plan.md"
  ], {
    cwd: root,
    encoding: "buffer",
    maxBuffer: 64 * 1024 * 1024
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.stderr.write(result.stderr.toString("utf8"));
    throw new Error(`git ls-files exited with status ${result.status ?? "unknown"}.`);
  }
  return result.stdout
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
}

function classifySensitivePath(path) {
  const lower = path.toLowerCase();
  const basename = lower.split("/").at(-1) ?? lower;
  if ((basename === ".env" || basename.startsWith(".env.")) && !basename.endsWith(".example")) {
    return "unignored-env-file";
  }
  if (/\.(?:sqlite|sqlite-shm|sqlite-wal|pem|key|p8|p12|mobileprovision|ipa)$/i.test(path)) {
    return "sensitive-artifact-file";
  }
  if (lower.includes("/.healthlink/") || lower.startsWith(".healthlink/") || lower.includes("/secrets/")) {
    return "sensitive-runtime-path";
  }
  return undefined;
}

function containsLiteralHealthLinkSecret(line) {
  const match = /(?:upload_auth_secret|relay_access_token|relay_api_token|relay_metrics_token|encryption_private_key)\s*[=:]\s*["']([^"']+)["']/i.exec(line);
  if (!match) {
    return false;
  }
  const value = match[1].trim();
  if (value.length < 24 || isClearlyNonSecret(value)) {
    return false;
  }
  return /[A-Za-z]/.test(value) && /[0-9_-]/.test(value);
}

function isClearlyNonSecret(value) {
  return /(?:\$\{|process\.env|<[^>]+>|replace|example|placeholder|changeme|dummy|fixture|local[-_ ]?audit|test[-_ ])/i.test(value);
}

function runSelfTest() {
  const samples = new Map([
    ["private-key-pem", ["-----BEGIN ", "PRIVATE KEY-----"].join("")],
    ["age-secret-key", ["AGE-SECRET-KEY-1", "A".repeat(48)].join("")],
    ["aws-access-key", ["AKIA", "A1B2C3D4E5F6G7H8"].join("")],
    ["github-token", ["ghp_", "A".repeat(40)].join("")],
    ["npm-token", ["npm_", "B".repeat(40)].join("")],
    ["slack-token", ["xoxb-", "A".repeat(12), "-", "B".repeat(20)].join("")],
    ["stripe-live-key", ["sk_", "live_", "C".repeat(24)].join("")],
    ["openai-key", ["sk-", "proj-", "D".repeat(40)].join("")]
  ]);
  for (const rule of tokenRules) {
    if (!rule.pattern.test(samples.get(rule.id) ?? "")) {
      throw new Error(`Secret scan self-test failed for ${rule.id}.`);
    }
  }

  const literal = ["relay_access_token=\"", "AbCdEfGhIjKlMnOpQrStUvWxYz_123456", "\""].join("");
  if (!containsLiteralHealthLinkSecret(literal)) {
    throw new Error("Secret scan self-test failed for a Vital Agent Sync secret literal.");
  }
  if (containsLiteralHealthLinkSecret("relay_access_token=\"replace-with-a-random-32-byte-value\"")) {
    throw new Error("Secret scan self-test incorrectly rejected a documented placeholder.");
  }
  if (classifySensitivePath("deploy/relay/.env.production") !== "unignored-env-file" ||
      classifySensitivePath("tmp/health.sqlite") !== "sensitive-artifact-file" ||
      classifySensitivePath(".healthlink/secrets/private.key") !== "sensitive-artifact-file") {
    throw new Error("Secret scan self-test failed for sensitive file paths.");
  }
}
