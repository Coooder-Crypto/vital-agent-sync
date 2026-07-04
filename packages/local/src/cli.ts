#!/usr/bin/env node
import {
  formatStandardMcpConfig,
  getHermesMcpInstallStatus,
  installHermesMcpConfig,
  buildHealthLinkMcpServerConfig
} from "./mcp-config.js";
import { openHealthLinkDatabase } from "./database.js";
import { listDevices } from "./devices.js";
import { getHealthStatus } from "./health-ingest.js";
import { startLocalServer } from "./server.js";
import { startMcpServer } from "./mcp.js";

type CliOptions = {
  command: "server" | "init" | "mcp" | "print-mcp-config" | "install-hermes" | "status" | "doctor";
  port: number;
  host: string;
  installHermes: boolean;
  databasePath?: string;
  serverUrl?: string;
  agentName?: string;
  hermesConfigPath?: string;
};

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    command: "server",
    port: 8787,
    host: "0.0.0.0",
    installHermes: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "server" || arg === "init" || arg === "mcp" || arg === "print-mcp-config" || arg === "install-hermes" || arg === "status" || arg === "doctor") {
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
    } else if (arg === "--agent-name") {
      options.agentName = argv[index + 1];
      index += 1;
    } else if (arg === "--hermes-config") {
      options.hermesConfigPath = argv[index + 1];
      index += 1;
    } else if (arg === "--hermes" || arg === "--install-hermes") {
      options.installHermes = true;
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

  if (options.command === "install-hermes") {
    const result = installHermesMcpConfig({
      databasePath: options.databasePath,
      configPath: options.hermesConfigPath
    });
    console.log("HealthLink MCP installed for Hermes");
    console.log(`Config: ${result.configPath}`);
    if (result.backupPath) {
      console.log(`Backup: ${result.backupPath}`);
    }
    console.log("");
    console.log("Restart Hermes or run /reload-mcp to load the healthlink tools.");
    console.log("If Hermes reports that MCP support is missing, run it with the Hermes environment that includes the Python mcp SDK.");
    return;
  }

  if (options.command === "status") {
    printStatus(options);
    return;
  }

  if (options.command === "doctor") {
    printDoctor(options);
    return;
  }

  const hermesInstall = options.command === "init" && options.installHermes
    ? installHermesMcpConfig({
        databasePath: options.databasePath,
        configPath: options.hermesConfigPath
      })
    : undefined;

  await startLocalServer({
    host: options.host,
    port: options.port,
    databasePath: options.databasePath,
    serverUrl: options.serverUrl,
    agentName: options.agentName ?? (options.installHermes ? "Hermes Agent" : undefined),
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
    if (hermesInstall) {
      console.log(`  installed healthlink MCP in ${hermesInstall.configPath}`);
      if (hermesInstall.backupPath) {
        console.log(`  backup: ${hermesInstall.backupPath}`);
      }
      console.log("  restart Hermes or run /reload-mcp to load the healthlink tools");
    } else {
      console.log("  healthlink-local init --hermes");
      console.log("  healthlink-local install-hermes");
    }
    console.log("");
  }
}

function printStatus(options: CliOptions): void {
  const database = openHealthLinkDatabase({ path: options.databasePath });
  try {
    const status = getHealthStatus(database);
    const devices = listDevices(database);
    console.log("HealthLink Local status");
    console.log(`Database:   ${database.path}`);
    console.log(`Devices:    ${status.device_count}`);
    console.log(`Syncs:      ${status.sync_count}`);
    console.log(`Last sync:  ${status.last_sync_at ?? "never"}`);
    console.log("");
    if (devices.length === 0) {
      console.log("No paired devices.");
      return;
    }

    for (const device of devices) {
      const state = device.revoked_at ? `revoked ${device.revoked_at}` : "active";
      console.log(`${device.device_id}  ${device.device_name}  ${state}  syncs=${device.sync_count}  last=${device.last_sync_at ?? "never"}`);
    }
  } finally {
    database.close();
  }
}

function printDoctor(options: CliOptions): void {
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
      detail: `${database.path} (${status.device_count} active devices, ${status.sync_count} syncs)`
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

  const hermes = getHermesMcpInstallStatus({ configPath: options.hermesConfigPath, databasePath });
  results.push({
    status: hermes.installed ? "OK" : "WARN",
    label: "Hermes config",
    detail: hermes.installed
      ? `healthlink installed in ${hermes.configPath}`
      : `${hermes.configPath} ${hermes.exists ? "does not include" : "does not exist for"} healthlink`
  });

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
