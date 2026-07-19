#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type RuntimeMetadata = {
  schema_version: 1;
  node_path: string;
  node_version: string;
  modules_abi: string;
  cli_path: string;
};

const launcherPath = fileURLToPath(import.meta.url);
const packagedCliPath = resolve(dirname(launcherPath), "cli.js");
const metadataPath = join(homedir(), ".vital-agent-sync", "runtime-v1.json");
const metadata = readMetadata(metadataPath);

if (metadata && resolve(metadata.node_path) === resolve(process.execPath) && metadata.modules_abi !== process.versions.modules) {
  fail(`The pinned Vital Agent Sync Node runtime ABI changed from ${metadata.modules_abi} to ${process.versions.modules}. Reinstall vitalmcp with this Node runtime before reading the local database.`);
}

if (metadata && resolve(metadata.node_path) !== resolve(process.execPath)) {
  if (!existsSync(metadata.node_path) || !existsSync(metadata.cli_path)) {
    fail(`The pinned Vital Agent Sync Node runtime is no longer available (${metadata.node_path}). Reinstall vitalmcp from WorkBuddy or another trusted Node runtime, then rerun setup.`);
  }
  const probe = spawnSync(metadata.node_path, ["-p", "process.versions.modules"], { encoding: "utf8" });
  const candidateAbi = probe.stdout?.trim();
  if (probe.error || probe.status !== 0 || candidateAbi !== metadata.modules_abi) {
    fail(`The pinned Vital Agent Sync Node runtime no longer matches ABI ${metadata.modules_abi} (${metadata.node_path}). Reinstall vitalmcp from WorkBuddy or another trusted Node runtime.`);
  }
  const child = spawnSync(metadata.node_path, [metadata.cli_path, ...process.argv.slice(2)], {
    stdio: "inherit"
  });
  if (child.error) {
    fail(`Could not start the pinned Vital Agent Sync runtime: ${child.error.message}`);
  }
  process.exit(child.status ?? 1);
}

await import(packagedCliPath);

function readMetadata(path: string): RuntimeMetadata | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<RuntimeMetadata>;
    if (parsed.schema_version !== 1 || typeof parsed.node_path !== "string" ||
      typeof parsed.node_version !== "string" || typeof parsed.modules_abi !== "string" ||
      typeof parsed.cli_path !== "string") {
      fail(`Vital Agent Sync runtime metadata is invalid: ${path}. Re-run setup from the trusted Agent runtime.`);
    }
    return parsed as RuntimeMetadata;
  } catch (error) {
    fail(`Vital Agent Sync runtime metadata is invalid: ${path}. ${error instanceof Error ? error.message : String(error)}`);
  }
}

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
