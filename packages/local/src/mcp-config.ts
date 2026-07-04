import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { getDefaultDatabasePath } from "./database.js";

export type McpCommandConfig = {
  command: string;
  args: string[];
};

export type McpConfigOptions = {
  databasePath?: string;
};

export type HermesInstallOptions = McpConfigOptions & {
  hermesHome?: string;
  configPath?: string;
};

export type HermesInstallResult = {
  configPath: string;
  backupPath?: string;
  server: McpCommandConfig;
};

export function buildHealthLinkMcpServerConfig(options: McpConfigOptions = {}): McpCommandConfig {
  return {
    command: getCliCommandPath(),
    args: [
      "mcp",
      "--db",
      resolveHomePath(options.databasePath ?? getDefaultDatabasePath())
    ]
  };
}

export function buildStandardMcpConfig(options: McpConfigOptions = {}): {
  mcpServers: {
    healthlink: McpCommandConfig;
  };
} {
  return {
    mcpServers: {
      healthlink: buildHealthLinkMcpServerConfig(options)
    }
  };
}

export function formatStandardMcpConfig(options: McpConfigOptions = {}): string {
  return `${JSON.stringify(buildStandardMcpConfig(options), null, 2)}\n`;
}

export function installHermesMcpConfig(options: HermesInstallOptions = {}): HermesInstallResult {
  const configPath = resolveHomePath(options.configPath ?? join(options.hermesHome ?? process.env.HERMES_HOME ?? "~/.hermes", "config.yaml"));
  mkdirSync(dirname(configPath), { recursive: true });

  const existing = existsSync(configPath) ? readFileSync(configPath, "utf8") : "";
  const backupPath = existsSync(configPath) ? `${configPath}.healthlink-backup-${timestampForFilename()}` : undefined;
  if (backupPath) {
    copyFileSync(configPath, backupPath);
  }

  const document = existing.trim().length > 0
    ? YAML.parseDocument(existing)
    : new YAML.Document({});
  const value = document.toJSON() as unknown;
  const root = isRecord(value) ? value : {};
  const mcpServers = isRecord(root.mcp_servers) ? root.mcp_servers : {};
  const server = buildHealthLinkMcpServerConfig(options);

  root.mcp_servers = {
    ...mcpServers,
    healthlink: server
  };

  writeFileSync(configPath, YAML.stringify(root), "utf8");

  return {
    configPath,
    backupPath,
    server
  };
}

function getCliCommandPath(): string {
  const currentFile = fileURLToPath(import.meta.url);
  if (currentFile.endsWith("/dist/mcp-config.js")) {
    return resolve(dirname(currentFile), "cli.js");
  }

  return "healthlink-local";
}

function resolveHomePath(path: string): string {
  if (path === "~") {
    return homedir();
  }
  if (path.startsWith("~/")) {
    return join(homedir(), path.slice(2));
  }
  return path;
}

function timestampForFilename(): string {
  const iso = new Date().toISOString();
  return iso
    .replaceAll("-", "")
    .replace("T", "-")
    .replaceAll(":", "")
    .replace(".", "")
    .replace("Z", "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
