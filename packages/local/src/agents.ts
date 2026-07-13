import YAML from "yaml";
import {
  buildHealthLinkMcpServerConfig,
  formatOpenClawMcpConfig,
  formatStandardMcpConfig,
  getHermesMcpInstallStatus,
  getOpenClawMcpInstallStatus,
  installHermesMcpConfig,
  installOpenClawMcpConfig,
  type HermesInstallOptions,
  type McpCommandConfig,
  type McpConfigOptions,
  type OpenClawInstallOptions
} from "./mcp-config.js";
import { installHermesHealthLinkSkill, type SkillInstallOptions, type SkillInstallResult } from "./skill.js";

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
    return createResearchAgentAdapter(id);
  }
}

export function isAgentAdapterId(value: string): value is AgentAdapterId {
  return AGENT_ADAPTER_IDS.includes(value as AgentAdapterId);
}

export function detectPreferredAgentAdapter(options?: AgentAdapterOptions): AgentAutoDetectResult {
  const statuses = (["hermes", "openclaw"] as AgentAdapterId[]).map((id) => getAgentAdapter(id).detect(options));
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

const genericAgentAdapter: AgentAdapter = {
  id: "generic",
  displayName: "Generic MCP Agent",
  detect() {
    return {
      id: "generic",
      available: true,
      installed: true,
      detail: "Generic agents use the printed mcpServers JSON; VitalMCP does not write agent-specific config."
    };
  },
  installMcp(config) {
    return {
      id: "generic",
      server: buildHealthLinkMcpServerConfig(config),
      message: "Generic MCP agents are configured by copying the printed mcpServers.healthlink JSON."
    };
  },
  formatMcpConfig(config) {
    return formatStandardMcpConfig(config);
  },
  reloadHint() {
    return "Copy the printed mcpServers.healthlink JSON into your agent MCP config and restart or reload that agent.";
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
      installed: status.installed,
      configPath: status.configPath,
      detail: status.installed
        ? `healthlink MCP is installed in ${status.configPath}`
        : `${status.configPath} ${status.exists ? "does not include" : "does not exist for"} healthlink`
    };
  },
  installMcp(config, options) {
    const result = installHermesMcpConfig(toHermesOptions(options, config));
    return {
      id: "hermes",
      configPath: result.configPath,
      backupPath: result.backupPath,
      server: result.server,
      message: `VitalMCP MCP installed for Hermes in ${result.configPath}`
    };
  },
  installSkill(options) {
    return installHermesHealthLinkSkill(toHermesSkillOptions(options));
  },
  formatMcpConfig(config) {
    return YAML.stringify({
      mcp_servers: {
        healthlink: buildHealthLinkMcpServerConfig(config)
      }
    });
  },
  reloadHint() {
    return "Restart Hermes or run /reload-mcp to load the healthlink tools.";
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
        installed: status.installed,
        configPath: status.configPath,
        detail: status.installed
          ? `healthlink MCP is installed in ${status.configPath}`
          : `${status.configPath} ${status.exists ? "does not include" : "does not exist for"} healthlink`
      };
    } catch (error) {
      return {
        id: "openclaw",
        available: true,
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
      message: `VitalMCP MCP installed for OpenClaw in ${result.configPath}`
    };
  },
  formatMcpConfig(config) {
    return formatOpenClawMcpConfig(config);
  },
  reloadHint() {
    return "OpenClaw should load MCP config changes automatically; restart OpenClaw if the healthlink tools do not appear.";
  }
};

function createResearchAgentAdapter(id: "workbuddy"): AgentAdapter {
  const displayName = "WorkBuddy";
  return {
    id,
    displayName,
    detect() {
      return {
        id,
        available: false,
        installed: false,
        detail: `${displayName} adapter research is not implemented yet. Use print-agent-config --agent generic for MCP-compatible setup.`
      };
    },
    installMcp(config) {
      return {
        id,
        server: buildHealthLinkMcpServerConfig(config),
        message: `${displayName} automatic install is not implemented yet. Use generic MCP config output for now.`
      };
    },
    formatMcpConfig(config) {
      return formatStandardMcpConfig(config);
    },
    reloadHint() {
      return `${displayName} reload behavior is still under adapter research. Use that agent's MCP reload or restart flow.`;
    }
  };
}

function toHermesSkillOptions(options: AgentAdapterOptions | undefined): SkillInstallOptions {
  return {
    hermesHome: options?.hermesHome,
    skillPath: options?.hermesSkillPath
  };
}
