import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const devicesResult = spawnSync("xcrun", ["simctl", "list", "devices", "available", "--json"], {
  cwd: repositoryRoot,
  encoding: "utf8"
});

if (devicesResult.status !== 0) {
  process.stderr.write(devicesResult.stderr || "Unable to list iOS simulators.\n");
  process.exit(devicesResult.status ?? 1);
}

const simulatorGroups = Object.values(JSON.parse(devicesResult.stdout).devices ?? {});
const simulators = simulatorGroups
  .flat()
  .filter((device) => device.isAvailable !== false && device.name?.startsWith("iPhone"));
const simulator = simulators.find((device) => device.state === "Booted") ?? simulators[0];

if (!simulator) {
  process.stderr.write("No available iPhone Simulator was found. Install an iOS Simulator runtime in Xcode.\n");
  process.exit(1);
}

const configuredDerivedData = process.env.HEALTHLINK_IOS_TEST_DERIVED_DATA?.trim();
const derivedDataPath = configuredDerivedData || mkdtempSync(join(tmpdir(), "healthlink-ios-tests-"));
const shouldKeepArtifacts = process.env.HEALTHLINK_KEEP_IOS_TEST_ARTIFACTS === "1";

process.stdout.write(`Running HealthLinkTests on ${simulator.name} (${simulator.udid}).\n`);

const testResult = spawnSync("xcodebuild", [
  "test",
  "-project", "HealthLink.xcodeproj",
  "-scheme", "HealthLink",
  "-destination", `platform=iOS Simulator,id=${simulator.udid}`,
  "-derivedDataPath", derivedDataPath,
  "CODE_SIGNING_ALLOWED=NO"
], {
  cwd: repositoryRoot,
  env: {
    ...process.env,
    NSUnbufferedIO: "YES"
  },
  stdio: "inherit"
});

if (!configuredDerivedData && testResult.status === 0 && !shouldKeepArtifacts) {
  rmSync(derivedDataPath, { recursive: true, force: true });
} else {
  process.stdout.write(`iOS test artifacts: ${derivedDataPath}\n`);
}

if (testResult.error) {
  throw testResult.error;
}
process.exit(testResult.status ?? 1);
