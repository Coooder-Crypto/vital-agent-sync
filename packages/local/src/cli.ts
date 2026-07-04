#!/usr/bin/env node
import {
  formatStandardMcpConfig,
  installHermesMcpConfig,
  buildHealthLinkMcpServerConfig
} from "./mcp-config.js";
import { startLocalServer } from "./server.js";
import { startMcpServer } from "./mcp.js";

type CliOptions = {
  command: "server" | "init" | "mcp" | "print-mcp-config" | "install-hermes";
  port: number;
  host: string;
  databasePath?: string;
  serverUrl?: string;
  agentName?: string;
  hermesConfigPath?: string;
};

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    command: "server",
    port: 8787,
    host: "0.0.0.0"
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "server" || arg === "init" || arg === "mcp" || arg === "print-mcp-config" || arg === "install-hermes") {
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
    return;
  }

  await startLocalServer({
    host: options.host,
    port: options.port,
    databasePath: options.databasePath,
    serverUrl: options.serverUrl,
    agentName: options.agentName,
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
    console.log("  healthlink-local install-hermes");
    console.log("");
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`HealthLink Local failed: ${message}`);
  process.exitCode = 1;
});
