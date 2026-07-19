import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";

export const VITALMCP_RUNTIME_METADATA_VERSION = 1 as const;

export type VitalMcpRuntimeMetadata = {
  schema_version: typeof VITALMCP_RUNTIME_METADATA_VERSION;
  node_path: string;
  node_version: string;
  modules_abi: string;
  cli_path: string;
  recorded_at: string;
};

const runtimeMetadataSchema = z.object({
  schema_version: z.literal(VITALMCP_RUNTIME_METADATA_VERSION),
  node_path: z.string().min(1),
  node_version: z.string().regex(/^v?\d+\.\d+\.\d+/),
  modules_abi: z.string().min(1),
  cli_path: z.string().min(1),
  recorded_at: z.string().datetime()
});

export function getRuntimeMetadataPath(options: { homeDir?: string } = {}): string {
  return join(options.homeDir ?? homedir(), ".vital-agent-sync", "runtime-v1.json");
}

export function recordRuntimeMetadata(options: {
  homeDir?: string;
  nodePath?: string;
  nodeVersion?: string;
  modulesAbi?: string;
  cliPath: string;
  now?: Date;
}): VitalMcpRuntimeMetadata {
  const metadata: VitalMcpRuntimeMetadata = {
    schema_version: VITALMCP_RUNTIME_METADATA_VERSION,
    node_path: resolve(options.nodePath ?? process.execPath),
    node_version: options.nodeVersion ?? process.version,
    modules_abi: options.modulesAbi ?? process.versions.modules,
    cli_path: resolve(options.cliPath),
    recorded_at: (options.now ?? new Date()).toISOString()
  };
  const path = getRuntimeMetadataPath(options);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(metadata, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  return metadata;
}

export function readRuntimeMetadata(options: { homeDir?: string } = {}): VitalMcpRuntimeMetadata | undefined {
  const path = getRuntimeMetadataPath(options);
  if (!existsSync(path)) {
    return undefined;
  }
  try {
    return runtimeMetadataSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Vital Agent Sync runtime metadata is invalid: ${path}. Re-run setup from the trusted Agent runtime. ${detail}`);
  }
}

export function runtimeMetadataMatchesCurrentProcess(metadata: VitalMcpRuntimeMetadata): boolean {
  return resolve(metadata.node_path) === resolve(process.execPath) &&
    metadata.node_version === process.version &&
    metadata.modules_abi === process.versions.modules;
}

export function runtimeMetadataPathsExist(metadata: VitalMcpRuntimeMetadata): boolean {
  return existsSync(metadata.node_path) && existsSync(metadata.cli_path);
}
