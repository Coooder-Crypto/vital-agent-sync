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

export type OpenClawInstallOptions = McpConfigOptions & {
  openclawHome?: string;
  configPath?: string;
};

export type WorkBuddyInstallOptions = McpConfigOptions & {
  projectPath?: string;
  configPath?: string;
};

export type HermesInstallResult = {
  configPath: string;
  backupPath?: string;
  server: McpCommandConfig;
};

export type OpenClawInstallResult = {
  configPath: string;
  backupPath?: string;
  server: McpCommandConfig;
};

export type WorkBuddyInstallResult = {
  configPath: string;
  backupPath?: string;
  server: McpCommandConfig;
};

export type HermesMcpInstallStatus = {
  configPath: string;
  exists: boolean;
  installed: boolean;
  server?: unknown;
};

export type OpenClawMcpInstallStatus = {
  configPath: string;
  exists: boolean;
  installed: boolean;
  server?: unknown;
};

export type WorkBuddyMcpInstallStatus = {
  configPath: string;
  exists: boolean;
  installed: boolean;
  server?: unknown;
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

export function buildWorkBuddyMcpConfig(options: McpConfigOptions = {}): {
  mcpServers: {
    healthlink: McpCommandConfig;
  };
} {
  const server = buildHealthLinkMcpServerConfig(options);
  const guiSafeServer = server.command.endsWith(".js")
    ? {
        command: process.execPath,
        args: [server.command, ...server.args]
      }
    : server;
  return {
    mcpServers: {
      healthlink: guiSafeServer
    }
  };
}

export function formatWorkBuddyMcpConfig(options: McpConfigOptions = {}): string {
  return `${JSON.stringify(buildWorkBuddyMcpConfig(options), null, 2)}\n`;
}

export function buildOpenClawMcpConfig(options: McpConfigOptions = {}): {
  mcp: {
    servers: {
      healthlink: McpCommandConfig;
    };
  };
} {
  return {
    mcp: {
      servers: {
        healthlink: buildHealthLinkMcpServerConfig(options)
      }
    }
  };
}

export function formatOpenClawMcpConfig(options: McpConfigOptions = {}): string {
  return `${JSON.stringify(buildOpenClawMcpConfig(options), null, 2)}\n`;
}

export function installHermesMcpConfig(options: HermesInstallOptions = {}): HermesInstallResult {
  const configPath = getHermesConfigPath(options);
  mkdirSync(dirname(configPath), { recursive: true });

  const existing = existsSync(configPath) ? readFileSync(configPath, "utf8") : "";
  const backupPath = existsSync(configPath) ? uniqueBackupPath(configPath) : undefined;
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

export function installOpenClawMcpConfig(options: OpenClawInstallOptions = {}): OpenClawInstallResult {
  const configPath = getOpenClawConfigPath(options);
  mkdirSync(dirname(configPath), { recursive: true });

  const existing = existsSync(configPath) ? readFileSync(configPath, "utf8") : "";
  const backupPath = existsSync(configPath) ? uniqueBackupPath(configPath) : undefined;
  if (backupPath) {
    copyFileSync(configPath, backupPath);
  }

  const root = existing.trim().length > 0 ? parseJsonRecord(existing, "OpenClaw") : {};
  const mcp = isRecord(root.mcp) ? root.mcp : {};
  const servers = isRecord(mcp.servers) ? mcp.servers : {};
  const server = buildHealthLinkMcpServerConfig(options);

  root.mcp = {
    ...mcp,
    servers: {
      ...servers,
      healthlink: server
    }
  };

  writeFileSync(configPath, `${JSON.stringify(root, null, 2)}\n`, "utf8");

  return {
    configPath,
    backupPath,
    server
  };
}

export function installWorkBuddyMcpConfig(options: WorkBuddyInstallOptions = {}): WorkBuddyInstallResult {
  const configPath = getWorkBuddyConfigPath(options);
  mkdirSync(dirname(configPath), { recursive: true });

  const existing = existsSync(configPath) ? readFileSync(configPath, "utf8") : "";
  const root = existing.trim().length > 0 ? parseJsonRecord(existing, "WorkBuddy") : {};
  const mcpServers = isRecord(root.mcpServers) ? root.mcpServers : {};
  const server = buildWorkBuddyMcpConfig(options).mcpServers.healthlink;
  const backupPath = existsSync(configPath) ? uniqueBackupPath(configPath) : undefined;
  if (backupPath) {
    copyFileSync(configPath, backupPath);
  }

  root.mcpServers = {
    ...mcpServers,
    healthlink: server
  };

  writeFileSync(configPath, `${JSON.stringify(root, null, 2)}\n`, "utf8");

  return {
    configPath,
    backupPath,
    server
  };
}

export function getHermesMcpInstallStatus(options: HermesInstallOptions = {}): HermesMcpInstallStatus {
  const configPath = getHermesConfigPath(options);
  if (!existsSync(configPath)) {
    return {
      configPath,
      exists: false,
      installed: false
    };
  }

  const config = parseYamlRecord(readFileSync(configPath, "utf8"));
  const mcpServers = isRecord(config.mcp_servers) ? config.mcp_servers : {};
  const server = mcpServers.healthlink;
  return {
    configPath,
    exists: true,
    installed: isRecord(server),
    server
  };
}

export function getOpenClawMcpInstallStatus(options: OpenClawInstallOptions = {}): OpenClawMcpInstallStatus {
  const configPath = getOpenClawConfigPath(options);
  if (!existsSync(configPath)) {
    return {
      configPath,
      exists: false,
      installed: false
    };
  }

  const config = parseJsonRecord(readFileSync(configPath, "utf8"), "OpenClaw");
  const mcp = isRecord(config.mcp) ? config.mcp : {};
  const servers = isRecord(mcp.servers) ? mcp.servers : {};
  const server = servers.healthlink;
  return {
    configPath,
    exists: true,
    installed: isRecord(server),
    server
  };
}

export function getWorkBuddyMcpInstallStatus(options: WorkBuddyInstallOptions = {}): WorkBuddyMcpInstallStatus {
  const configPath = getWorkBuddyConfigPath(options);
  if (!existsSync(configPath)) {
    return {
      configPath,
      exists: false,
      installed: false
    };
  }

  const config = parseJsonRecord(readFileSync(configPath, "utf8"), "WorkBuddy");
  const mcpServers = isRecord(config.mcpServers) ? config.mcpServers : {};
  const server = mcpServers.healthlink;
  return {
    configPath,
    exists: true,
    installed: isRecord(server),
    server
  };
}

function getHermesConfigPath(options: HermesInstallOptions = {}): string {
  return resolveHomePath(options.configPath ?? join(options.hermesHome ?? process.env.HERMES_HOME ?? "~/.hermes", "config.yaml"));
}

function getOpenClawConfigPath(options: OpenClawInstallOptions = {}): string {
  return resolveHomePath(options.configPath ?? join(options.openclawHome ?? process.env.OPENCLAW_HOME ?? "~/.openclaw", "openclaw.json"));
}

function getWorkBuddyConfigPath(options: WorkBuddyInstallOptions = {}): string {
  if (options.configPath) {
    return resolve(resolveHomePath(options.configPath));
  }
  return join(resolve(resolveHomePath(options.projectPath ?? process.cwd())), "workbuddy.mcp.json");
}

function parseYamlRecord(value: string): Record<string, unknown> {
  const parsed = YAML.parse(value) as unknown;
  return isRecord(parsed) ? parsed : {};
}

function parseJsonRecord(value: string, owner: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${owner} config must be valid JSON for automatic VitalMCP install. Use print-agent-config to merge manually if the config uses comments or JSON5 syntax. ${detail}`);
  }
}

function getCliCommandPath(): string {
  const currentFile = fileURLToPath(import.meta.url);
  if (currentFile.endsWith("/dist/mcp-config.js")) {
    return resolve(dirname(currentFile), "cli.js");
  }

  return "vitalmcp";
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

function uniqueBackupPath(configPath: string): string {
  const base = `${configPath}.healthlink-backup-${timestampForFilename()}`;
  if (!existsSync(base)) {
    return base;
  }

  for (let index = 1; index < 1000; index += 1) {
    const candidate = `${base}-${index}`;
    if (!existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error("Could not allocate a unique VitalMCP config backup path.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
