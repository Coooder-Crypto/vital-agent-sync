import YAML from "yaml";
import {
  buildVitalAgentMcpServerConfig,
  formatOpenClawMcpConfig,
  formatStandardMcpConfig,
  formatWorkBuddyMcpConfig,
  getHermesMcpInstallStatus,
  getOpenClawMcpInstallStatus,
  getWorkBuddyMcpInstallStatus,
  installHermesMcpConfig,
  installOpenClawMcpConfig,
  installWorkBuddyMcpConfig,
  type HermesInstallOptions,
  type McpCommandConfig,
  type McpConfigOptions,
  type OpenClawInstallOptions,
  type WorkBuddyInstallOptions
} from "./mcp-config.js";
import { installHermesVitalAgentSkill, type SkillInstallOptions, type SkillInstallResult } from "./skill.js";

export const AGENT_ADAPTER_IDS = [
  "generic",
  "hermes",
  "openclaw",
  "workbuddy"
] as const;

export type AgentAdapterId = typeof AGENT_ADAPTER_IDS[number];

export type AgentInstallStatus = {
  id: AgentAdapterId;
  available: boolean;
  configured: boolean;
  installed: boolean;
  detail: string;
  configPath?: string;
};

export type AgentAutoDetectResult = {
  id: AgentAdapterId;
  status?: AgentInstallStatus;
  statuses: AgentInstallStatus[];
};

export type AgentInstallResult = {
  id: AgentAdapterId;
  configPath?: string;
  backupPath?: string;
  server: McpCommandConfig;
  message: string;
};

export type AgentAdapter = {
  id: AgentAdapterId;
  displayName: string;
  detect(options?: AgentAdapterOptions): AgentInstallStatus;
  installMcp(config: McpConfigOptions, options?: AgentAdapterOptions): AgentInstallResult;
  installSkill?(options?: AgentAdapterOptions): SkillInstallResult;
  formatMcpConfig(config: McpConfigOptions): string;
  reloadHint(): string;
};

export type AgentAdapterOptions = {
  hermesConfigPath?: string;
  hermesHome?: string;
  hermesSkillPath?: string;
  openclawConfigPath?: string;
  openclawHome?: string;
  workbuddyConfigPath?: string;
  workbuddyProjectPath?: string;
};

export function getAgentAdapter(id: AgentAdapterId): AgentAdapter {
  switch (id) {
  case "generic":
    return genericAgentAdapter;
  case "hermes":
    return hermesAgentAdapter;
  case "openclaw":
    return openClawAgentAdapter;
  case "workbuddy":
    return workBuddyAgentAdapter;
  }
}

export function isAgentAdapterId(value: string): value is AgentAdapterId {
  return AGENT_ADAPTER_IDS.includes(value as AgentAdapterId);
}

export function detectPreferredAgentAdapter(options?: AgentAdapterOptions): AgentAutoDetectResult {
  const statuses = (["workbuddy", "hermes", "openclaw"] as AgentAdapterId[]).map((id) => getAgentAdapter(id).detect(options));
  const workbuddy = statuses.find((status) => status.id === "workbuddy");
  if (workbuddy?.available) {
    return {
      id: "workbuddy",
      status: workbuddy,
      statuses
    };
  }
  const installed = statuses.find((status) => status.installed);
  if (installed) {
    return {
      id: installed.id,
      status: installed,
      statuses
    };
  }
  const available = statuses.find((status) => status.available);
  if (available) {
    return {
      id: available.id,
      status: available,
      statuses
    };
  }
  return {
    id: "generic",
    statuses
  };
}

function toHermesOptions(options: AgentAdapterOptions | undefined, config: McpConfigOptions): HermesInstallOptions {
  return {
    databasePath: config.databasePath,
    configPath: options?.hermesConfigPath,
    hermesHome: options?.hermesHome
  };
}

function toOpenClawOptions(options: AgentAdapterOptions | undefined, config: McpConfigOptions): OpenClawInstallOptions {
  return {
    databasePath: config.databasePath,
    configPath: options?.openclawConfigPath,
    openclawHome: options?.openclawHome
  };
}

function toWorkBuddyOptions(options: AgentAdapterOptions | undefined, config: McpConfigOptions): WorkBuddyInstallOptions {
  return {
    databasePath: config.databasePath,
    configPath: options?.workbuddyConfigPath,
    projectPath: options?.workbuddyProjectPath
  };
}

const genericAgentAdapter: AgentAdapter = {
  id: "generic",
  displayName: "Generic MCP Agent",
  detect() {
    return {
      id: "generic",
      available: true,
      configured: true,
      installed: true,
      detail: "Generic agents use the printed mcpServers JSON; Vital Agent Sync does not write agent-specific config."
    };
  },
  installMcp(config) {
    return {
      id: "generic",
      server: buildVitalAgentMcpServerConfig(config),
      message: "Generic MCP agents are configured by copying the printed mcpServers.vital-agent-sync JSON."
    };
  },
  formatMcpConfig(config) {
    return formatStandardMcpConfig(config);
  },
  reloadHint() {
    return "Copy the printed mcpServers.vital-agent-sync JSON into your agent MCP config and restart or reload that agent.";
  }
};

const hermesAgentAdapter: AgentAdapter = {
  id: "hermes",
  displayName: "Hermes",
  detect(options) {
    const status = getHermesMcpInstallStatus({
      configPath: options?.hermesConfigPath,
      hermesHome: options?.hermesHome
    });
    return {
      id: "hermes",
      available: status.exists,
      configured: status.installed,
      installed: status.installed,
      configPath: status.configPath,
      detail: status.installed
        ? `vital-agent-sync MCP is installed in ${status.configPath}`
        : `${status.configPath} ${status.exists ? "does not include" : "does not exist for"} vital-agent-sync`
    };
  },
  installMcp(config, options) {
    const result = installHermesMcpConfig(toHermesOptions(options, config));
    return {
      id: "hermes",
      configPath: result.configPath,
      backupPath: result.backupPath,
      server: result.server,
      message: `Vital Agent Sync MCP installed for Hermes in ${result.configPath}`
    };
  },
  installSkill(options) {
    return installHermesVitalAgentSkill(toHermesSkillOptions(options));
  },
  formatMcpConfig(config) {
    return YAML.stringify({
      mcp_servers: {
        "vital-agent-sync": buildVitalAgentMcpServerConfig(config)
      }
    });
  },
  reloadHint() {
    return "Restart Hermes or run /reload-mcp to load the vital-agent-sync tools.";
  }
};

const openClawAgentAdapter: AgentAdapter = {
  id: "openclaw",
  displayName: "OpenClaw",
  detect(options) {
    try {
      const status = getOpenClawMcpInstallStatus({
        configPath: options?.openclawConfigPath,
        openclawHome: options?.openclawHome
      });
      return {
        id: "openclaw",
        available: status.exists,
        configured: status.installed,
        installed: status.installed,
        configPath: status.configPath,
        detail: status.installed
          ? `vital-agent-sync MCP is installed in ${status.configPath}`
          : `${status.configPath} ${status.exists ? "does not include" : "does not exist for"} vital-agent-sync`
      };
    } catch (error) {
      return {
        id: "openclaw",
        available: true,
        configured: false,
        installed: false,
        configPath: options?.openclawConfigPath,
        detail: error instanceof Error ? error.message : String(error)
      };
    }
  },
  installMcp(config, options) {
    const result = installOpenClawMcpConfig(toOpenClawOptions(options, config));
    return {
      id: "openclaw",
      configPath: result.configPath,
      backupPath: result.backupPath,
      server: result.server,
      message: `Vital Agent Sync MCP installed for OpenClaw in ${result.configPath}`
    };
  },
  formatMcpConfig(config) {
    return formatOpenClawMcpConfig(config);
  },
  reloadHint() {
    return "OpenClaw should load MCP config changes automatically; restart OpenClaw if the vital-agent-sync tools do not appear.";
  }
};

const workBuddyAgentAdapter: AgentAdapter = {
  id: "workbuddy",
  displayName: "WorkBuddy",
  detect(options) {
    try {
      const status = getWorkBuddyMcpInstallStatus({
        configPath: options?.workbuddyConfigPath,
        projectPath: options?.workbuddyProjectPath
      });
      return {
        id: "workbuddy",
        available: status.exists,
        configured: status.configured,
        installed: status.installed,
        configPath: status.configPath,
        detail: status.configured
          ? `vital-agent-sync MCP is registered in ${status.configPath}; WorkBuddy user approval and Agent reload are still required`
          : `${status.configPath} ${status.exists ? "does not include" : "does not exist for"} vital-agent-sync`
      };
    } catch (error) {
      return {
        id: "workbuddy",
        available: true,
        configured: false,
        installed: false,
        configPath: options?.workbuddyConfigPath,
        detail: error instanceof Error ? error.message : String(error)
      };
    }
  },
  installMcp(config, options) {
    const result = installWorkBuddyMcpConfig(toWorkBuddyOptions(options, config));
    return {
      id: "workbuddy",
      configPath: result.configPath,
      backupPath: result.backupPath,
      server: result.server,
      message: `Vital Agent Sync MCP registered for WorkBuddy in ${result.configPath}; user approval and Agent reload are required`
    };
  },
  formatMcpConfig(config) {
    return formatWorkBuddyMcpConfig(config);
  },
  reloadHint() {
    return "Open WorkBuddy MCP settings and confirm vital-agent-sync is green; restart WorkBuddy if the tools do not appear.";
  }
};

function toHermesSkillOptions(options: AgentAdapterOptions | undefined): SkillInstallOptions {
  return {
    hermesHome: options?.hermesHome,
    skillPath: options?.hermesSkillPath
  };
}
