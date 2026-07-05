#!/usr/bin/env node
import {
  formatStandardMcpConfig,
  buildHealthLinkMcpServerConfig
} from "./mcp-config.js";
import { getAgentAdapter, isAgentAdapterId, type AgentAdapterId } from "./agents.js";
import { openHealthLinkDatabase } from "./database.js";
import { getHealthStatus } from "./health-ingest.js";
import { startLocalServer } from "./server.js";
import { startMcpServer } from "./mcp.js";
import { buildHealthLinkSkillMarkdown } from "./skill.js";
import { listSourceDevices } from "./source-devices.js";
import { createTransportProvider, isTransportProviderId, type TransportProviderId } from "./transports.js";

type CliOptions = {
  command: "server" | "init" | "mcp" | "print-mcp-config" | "print-agent-config" | "print-skill" | "install-hermes" | "install-hermes-skill" | "status" | "doctor";
  port: number;
  host: string;
  installHermes: boolean;
  installSkill: boolean;
  agentId: AgentAdapterId;
  transportId: TransportProviderId;
  databasePath?: string;
  serverUrl?: string;
  tailscaleName?: string;
  agentName?: string;
  hermesConfigPath?: string;
  hermesSkillPath?: string;
  openclawConfigPath?: string;
};

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    command: "server",
    port: 8787,
    host: "0.0.0.0",
    installHermes: false,
    installSkill: false,
    agentId: "generic",
    transportId: "lan"
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "server" || arg === "init" || arg === "mcp" || arg === "print-mcp-config" || arg === "print-agent-config" || arg === "print-skill" || arg === "install-hermes" || arg === "install-hermes-skill" || arg === "status" || arg === "doctor") {
      options.command = arg;
    } else if (arg === "--port") {
      options.port = Number(argv[index + 1]);
      index += 1;
    } else if (arg === "--host") {
      options.host = argv[index + 1] ?? options.host;
      index += 1;
    } else if (arg === "--db") {
      options.databasePath = argv[index + 1];
      index += 1;
    } else if (arg === "--server-url") {
      options.serverUrl = argv[index + 1];
      index += 1;
    } else if (arg === "--tailscale-name") {
      options.tailscaleName = argv[index + 1];
      index += 1;
    } else if (arg === "--agent-name") {
      options.agentName = argv[index + 1];
      index += 1;
    } else if (arg === "--agent") {
      const value = argv[index + 1];
      if (!value || !isAgentAdapterId(value)) {
        throw new Error("Expected --agent to be one of: generic, hermes, openclaw, workbuddy.");
      }
      options.agentId = value;
      index += 1;
    } else if (arg === "--transport") {
      const value = argv[index + 1];
      if (!value || !isTransportProviderId(value)) {
        throw new Error("Expected --transport to be one of: lan, tailscale, cloudflare, ngrok, public_https.");
      }
      options.transportId = value;
      index += 1;
    } else if (arg === "--hermes-config") {
      options.hermesConfigPath = argv[index + 1];
      index += 1;
    } else if (arg === "--openclaw-config") {
      options.openclawConfigPath = argv[index + 1];
      index += 1;
    } else if (arg === "--hermes-skill-path") {
      options.hermesSkillPath = argv[index + 1];
      index += 1;
    } else if (arg === "--format") {
      const value = argv[index + 1];
      if (value !== "markdown") {
        throw new Error("Expected --format markdown.");
      }
      index += 1;
    } else if (arg === "--hermes" || arg === "--install-hermes") {
      options.installHermes = true;
      options.agentId = "hermes";
    } else if (arg === "--install-skill") {
      options.installSkill = true;
    }
  }

  if (!Number.isInteger(options.port) || options.port <= 0) {
    throw new Error("Expected --port to be a positive integer.");
  }

  return options;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (options.command === "mcp") {
    await startMcpServer({
      databasePath: options.databasePath
    });
    return;
  }

  if (options.command === "print-mcp-config") {
    process.stdout.write(formatStandardMcpConfig({
      databasePath: options.databasePath
    }));
    return;
  }

  if (options.command === "print-agent-config") {
    const adapter = getAgentAdapter(options.agentId);
    process.stdout.write(adapter.formatMcpConfig({
      databasePath: options.databasePath
    }));
    return;
  }

  if (options.command === "print-skill") {
    process.stdout.write(buildHealthLinkSkillMarkdown());
    return;
  }

  if (options.command === "install-hermes") {
    const adapter = getAgentAdapter("hermes");
    const result = adapter.installMcp({
      databasePath: options.databasePath
    }, {
      hermesConfigPath: options.hermesConfigPath
    });
    console.log(result.message);
    console.log(`Config: ${result.configPath}`);
    if (result.backupPath) {
      console.log(`Backup: ${result.backupPath}`);
    }
    console.log("");
    console.log(adapter.reloadHint());
    console.log("If Hermes reports that MCP support is missing, run it with the Hermes environment that includes the Python mcp SDK.");
    return;
  }

  if (options.command === "install-hermes-skill") {
    const adapter = getAgentAdapter("hermes");
    const result = adapter.installSkill?.({
      hermesSkillPath: options.hermesSkillPath
    });
    if (!result) {
      throw new Error("Hermes adapter does not support skill installation.");
    }
    console.log("HealthLink skill installed for Hermes");
    console.log(`Skill: ${result.skillPath}`);
    if (result.backupPath) {
      console.log(`Backup: ${result.backupPath}`);
    }
    console.log("");
    console.log("Restart Hermes or reload skills to make the HealthLink skill visible.");
    return;
  }

  if (options.command === "status") {
    printStatus(options);
    return;
  }

  if (options.command === "doctor") {
    await printDoctor(options);
    return;
  }

  const agent = getAgentAdapter(options.agentId);
  const shouldInstallAgent = options.command === "init" && (options.installHermes || options.agentId !== "generic");
  if (options.installSkill && options.agentId !== "hermes") {
    throw new Error("--install-skill currently supports --agent hermes only.");
  }
  const agentInstall = shouldInstallAgent
    ? agent.installMcp({
      databasePath: options.databasePath
    }, {
      hermesConfigPath: options.hermesConfigPath,
      openclawConfigPath: options.openclawConfigPath
    })
    : undefined;
  const skillInstall = options.command === "init" && options.installSkill
    ? agent.installSkill?.({
        hermesSkillPath: options.hermesSkillPath
      })
    : undefined;

  await startLocalServer({
    host: options.host,
    port: options.port,
    databasePath: options.databasePath,
    serverUrl: options.serverUrl,
    tailscaleName: options.tailscaleName,
    transport: options.transportId,
    agentName: options.agentName ?? (options.agentId === "hermes" ? "Hermes Agent" : undefined),
    mode: options.command === "init" ? "init" : "server"
  });

  if (options.command === "init") {
    const server = buildHealthLinkMcpServerConfig({
      databasePath: options.databasePath
    });
    console.log("Agent MCP:");
    console.log(`  ${server.command} ${server.args.join(" ")}`);
    console.log("");
    console.log("Hermes:");
    if (agentInstall) {
      console.log(`  ${agentInstall.message}`);
      if (agentInstall.backupPath) {
        console.log(`  backup: ${agentInstall.backupPath}`);
      }
      console.log(`  ${agent.reloadHint()}`);
      if (skillInstall) {
        console.log(`  installed HealthLink skill in ${skillInstall.skillPath}`);
      }
    } else {
      console.log("  healthlink-local init --agent hermes");
      console.log("  healthlink-local init --hermes");
      console.log("  healthlink-local install-hermes");
      console.log("  healthlink-local install-hermes-skill");
    }
    console.log("");
  }
}

function printStatus(options: CliOptions): void {
  const database = openHealthLinkDatabase({ path: options.databasePath });
  try {
    const status = getHealthStatus(database);
    const sourceDevices = listSourceDevices(database);
    console.log("HealthLink Local status");
    console.log(`Database:   ${database.path}`);
    console.log(`Sources:    ${status.device_count}`);
    console.log(`Syncs:      ${status.sync_count}`);
    console.log(`Last sync:  ${status.last_sync_at ?? "never"}`);
    console.log("");
    if (sourceDevices.length === 0) {
      console.log("No paired source devices.");
      return;
    }

    for (const sourceDevice of sourceDevices) {
      const state = sourceDevice.revoked_at ? `revoked ${sourceDevice.revoked_at}` : "active";
      console.log(`${sourceDevice.source_device_id}  ${sourceDevice.name}  ${sourceDevice.platform}  ${state}  syncs=${sourceDevice.sync_count}  last=${sourceDevice.last_sync_at ?? "never"}`);
    }
  } finally {
    database.close();
  }
}

async function printDoctor(options: CliOptions): Promise<void> {
  const results: Array<{
    status: "OK" | "WARN" | "FAIL";
    label: string;
    detail: string;
  }> = [];

  const nodeMajor = Number(process.versions.node.split(".")[0]);
  results.push({
    status: nodeMajor >= 22 ? "OK" : "FAIL",
    label: "Node.js",
    detail: `${process.version} ${nodeMajor >= 22 ? "meets" : "does not meet"} >=22`
  });

  let databasePath = options.databasePath ?? "";
  try {
    const database = openHealthLinkDatabase({ path: options.databasePath });
    databasePath = database.path;
    const status = getHealthStatus(database);
    results.push({
      status: "OK",
      label: "Database",
      detail: `${database.path} (${status.device_count} active source devices, ${status.sync_count} syncs)`
    });
    database.close();
  } catch (error) {
    results.push({
      status: "FAIL",
      label: "Database",
      detail: error instanceof Error ? error.message : String(error)
    });
  }

  try {
    const mcp = buildHealthLinkMcpServerConfig({ databasePath: options.databasePath });
    results.push({
      status: "OK",
      label: "MCP config",
      detail: `${mcp.command} ${mcp.args.join(" ")}`
    });
  } catch (error) {
    results.push({
      status: "FAIL",
      label: "MCP config",
      detail: error instanceof Error ? error.message : String(error)
    });
  }

  const agent = getAgentAdapter(options.agentId);
  const agentStatus = agent.detect({
    hermesConfigPath: options.hermesConfigPath,
    openclawConfigPath: options.openclawConfigPath
  });
  results.push({
    status: agentStatus.installed ? "OK" : "WARN",
    label: `${agent.displayName} adapter`,
    detail: agentStatus.detail
  });

  try {
    const transport = createTransportProvider({
      id: options.transportId,
      bindHost: options.host,
      port: options.port,
      serverUrl: options.serverUrl,
      tailscaleName: options.tailscaleName
    });
    const transportStatus = await transport.healthCheck?.();
    if (transportStatus) {
      results.push({
        status: transportStatus.status.toUpperCase() as "OK" | "WARN" | "FAIL",
        label: `${transport.label} transport`,
        detail: transportStatus.detail
      });
    }
  } catch (error) {
    results.push({
      status: "FAIL",
      label: "Transport",
      detail: error instanceof Error ? error.message : String(error)
    });
  }

  console.log("HealthLink doctor");
  for (const result of results) {
    console.log(`[${result.status}] ${result.label}: ${result.detail}`);
  }

  const hasFailure = results.some((result) => result.status === "FAIL");
  if (hasFailure) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`HealthLink Local failed: ${message}`);
  process.exitCode = 1;
});
