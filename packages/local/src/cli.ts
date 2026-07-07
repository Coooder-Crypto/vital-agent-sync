#!/usr/bin/env node
import {
  formatStandardMcpConfig,
  buildHealthLinkMcpServerConfig
} from "./mcp-config.js";
import { detectPreferredAgentAdapter, getAgentAdapter, isAgentAdapterId, type AgentAdapterId } from "./agents.js";
import { openHealthLinkDatabase } from "./database.js";
import { buildDockerComposeYaml } from "./docker-compose.js";
import { getHealthStatus } from "./health-ingest.js";
import { startLocalServer } from "./server.js";
import { startMcpServer } from "./mcp.js";
import {
  getHealthLinkServiceStatus,
  installHealthLinkService,
  isServiceManagerId,
  readHealthLinkServiceLog,
  startHealthLinkService,
  stopHealthLinkService,
  uninstallHealthLinkService,
  type HealthLinkServiceStatus,
  type LaunchdServiceOptions,
  type ServiceManagerId
} from "./service.js";
import { requestPairingSession } from "./pairing-client.js";
import { describePortListeners } from "./port-diagnostics.js";
import { runServiceEnsureWorkflow, runServiceSetupWorkflow } from "./setup.js";
import { buildHealthLinkSkillMarkdown } from "./skill.js";
import { listSourceDevices } from "./source-devices.js";
import { renderTerminalQr } from "./terminal-qr.js";
import { createTransportProvider, getServerUrlDiagnostics, isContainerRuntime, isTransportProviderId, type TransportProviderId } from "./transports.js";

type CliOptions = {
  command: "server" | "init" | "daemon" | "pair" | "setup" | "ensure" | "service" | "logs" | "mcp" | "print-mcp-config" | "print-agent-config" | "print-docker-compose" | "print-skill" | "install-hermes" | "install-hermes-skill" | "status" | "doctor";
  serviceAction?: "install" | "start" | "stop" | "status" | "uninstall";
  port: number;
  host: string;
  useService: boolean;
  installHermes: boolean;
  installSkill: boolean;
  agentAuto: boolean;
  logLines: number;
  agentId: AgentAdapterId;
  transportId: TransportProviderId;
  serviceManager: ServiceManagerId;
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
    useService: false,
    installHermes: false,
    installSkill: false,
    agentAuto: true,
    logLines: 80,
    agentId: "generic",
    transportId: "lan",
    serviceManager: "auto"
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "service") {
      options.command = "service";
      const action = argv[index + 1];
      if (action && !action.startsWith("--")) {
        if (!isServiceAction(action)) {
          throw new Error("Expected service action to be one of: install, start, stop, status, uninstall.");
        }
        options.serviceAction = action;
        index += 1;
      }
    } else if (arg === "server" || arg === "init" || arg === "daemon" || arg === "pair" || arg === "setup" || arg === "ensure" || arg === "service" || arg === "logs" || arg === "mcp" || arg === "print-mcp-config" || arg === "print-agent-config" || arg === "print-docker-compose" || arg === "print-skill" || arg === "install-hermes" || arg === "install-hermes-skill" || arg === "status" || arg === "doctor") {
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
    } else if (arg === "--lines") {
      options.logLines = Number(argv[index + 1]);
      index += 1;
    } else if (arg === "--agent") {
      const value = argv[index + 1];
      if (value === "auto") {
        options.agentId = "generic";
        options.agentAuto = true;
        index += 1;
        continue;
      }
      if (!value || !isAgentAdapterId(value)) {
        throw new Error("Expected --agent to be one of: auto, generic, hermes, openclaw, workbuddy.");
      }
      options.agentId = value;
      options.agentAuto = false;
      index += 1;
    } else if (arg === "--transport") {
      const value = argv[index + 1];
      if (!value || !isTransportProviderId(value)) {
        throw new Error("Expected --transport to be one of: lan, tailscale, cloudflare, ngrok, public_https.");
      }
      options.transportId = value;
      index += 1;
    } else if (arg === "--manager") {
      const value = argv[index + 1];
      if (!value || !isServiceManagerId(value)) {
        throw new Error("Expected --manager to be one of: auto, launchd, systemd, manual.");
      }
      options.serviceManager = value;
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
      options.agentAuto = false;
    } else if (arg === "--install-skill") {
      options.installSkill = true;
    } else if (arg === "--service") {
      options.useService = true;
    }
  }

  if (!Number.isInteger(options.port) || options.port <= 0) {
    throw new Error("Expected --port to be a positive integer.");
  }
  if (!Number.isInteger(options.logLines) || options.logLines <= 0) {
    throw new Error("Expected --lines to be a positive integer.");
  }
  if (options.command === "setup" || options.command === "ensure") {
    options.useService = true;
  }

  return options;
}

function isServiceAction(value: string): value is NonNullable<CliOptions["serviceAction"]> {
  return value === "install" || value === "start" || value === "stop" || value === "status" || value === "uninstall";
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

  if (options.command === "print-docker-compose") {
    if (!options.serverUrl) {
      throw new Error("print-docker-compose requires --server-url with an iPhone-reachable host URL, for example http://192.168.31.53:8787.");
    }
    process.stdout.write(buildDockerComposeYaml({
      serverUrl: options.serverUrl,
      port: options.port
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

  if (options.command === "service") {
    await runServiceCommand(options);
    return;
  }

  if (options.command === "logs") {
    printServiceLogs(options);
    return;
  }

  if (options.command === "pair") {
    await printPairingSession(options);
    return;
  }

  if (options.command === "setup") {
    await runSetup(options);
    return;
  }

  if (options.command === "ensure") {
    await runEnsure(options);
    return;
  }

  const agent = getAgentAdapter(options.agentId);
  const shouldInstallAgent = options.command === "init" && (options.installHermes || options.agentId !== "generic");
  const shouldInstallSkill = options.installSkill || options.agentId === "hermes";
  if (shouldInstallSkill && options.agentId !== "hermes") {
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

async function runServiceCommand(options: CliOptions): Promise<void> {
  const action = options.serviceAction ?? "status";
  const serviceOptions = toServiceOptions(options);
  if (action === "install") {
    const status = installHealthLinkService(serviceOptions);
    console.log("HealthLink service installed");
    await printServiceStatusDetails(status, options);
    return;
  }
  if (action === "start") {
    const status = startHealthLinkService(serviceOptions);
    console.log("HealthLink service start requested");
    await printServiceStatusDetails(status, options);
    return;
  }
  if (action === "stop") {
    const status = stopHealthLinkService(serviceOptions);
    console.log("HealthLink service stop requested");
    await printServiceStatusDetails(status, options);
    return;
  }
  if (action === "uninstall") {
    const status = uninstallHealthLinkService(serviceOptions);
    console.log("HealthLink service uninstalled");
    await printServiceStatusDetails(status, options);
    return;
  }
  await printServiceStatusDetails(getHealthLinkServiceStatus(serviceOptions), options);
}

async function runSetup(options: CliOptions): Promise<void> {
  const agentId = resolveSetupAgentId(options);
  const effectiveOptions = {
    ...options,
    agentId
  };
  const shouldInstallSkill = options.installSkill || agentId === "hermes";
  if (shouldInstallSkill && agentId !== "hermes") {
    throw new Error("--install-skill currently supports --agent hermes only.");
  }

  const agent = getAgentAdapter(agentId);
  console.log(`Setting up HealthLink for ${agent.displayName}`);
  printAgentAutoDetectSummary(options, agentId);
  await runServiceSetupWorkflow({
    installAgent: () => {
      if (agentId === "generic") {
        console.log("Agent config: generic MCP config will be printed on request.");
        return;
      }
      const agentInstall = agent.installMcp({
        databasePath: options.databasePath
      }, {
        hermesConfigPath: options.hermesConfigPath,
        openclawConfigPath: options.openclawConfigPath
      });
      console.log(`Agent config: ${agentInstall.message}`);
      if (agentInstall.backupPath) {
        console.log(`Agent backup: ${agentInstall.backupPath}`);
      }
    },
    installSkill: () => {
      const skillInstall = agent.installSkill?.({
        hermesSkillPath: options.hermesSkillPath
      });
      if (skillInstall) {
        console.log(`Agent skill: HealthLink skill installed at ${skillInstall.skillPath}`);
      }
    },
    installService: () => {
      const status = installHealthLinkService(toServiceOptions(effectiveOptions));
      console.log(`Service manager:   ${status.manager}`);
      console.log(`Service installed: ${status.configPath}`);
      console.log(`Service logs:      ${status.stdoutPath}`);
      console.log(`Service errors:    ${status.stderrPath}`);
    },
    startService: () => {
      startHealthLinkService(toServiceOptions(effectiveOptions));
      console.log("Service start requested.");
    },
    waitForReady: () => waitForLocalReceiver(effectiveOptions),
    pair: () => printPairingSession(effectiveOptions),
    printReloadHint: () => {
      printSetupNextSteps(agent, resolveServiceManagerIdForCli(options));
    }
  }, {
    installSkill: shouldInstallSkill
  });
}

async function runEnsure(options: CliOptions): Promise<void> {
  const serviceOptions = toServiceOptions(options);
  let lastStatus: HealthLinkServiceStatus | undefined;
  console.log("Ensuring HealthLink receiver service");
  await runServiceEnsureWorkflow({
    getStatus: () => {
      lastStatus = getHealthLinkServiceStatus(serviceOptions);
      return lastStatus;
    },
    installService: () => {
      if (lastStatus?.manager === "manual") {
        throw new Error(`${lastStatus.detail ?? "This platform does not have a supported service manager."} Run healthlink-local daemon under Docker, PM2, Task Scheduler, or another process manager.`);
      }
      console.log(`Service not installed for ${lastStatus?.manager ?? resolveServiceManagerIdForCli(options)}; installing...`);
      lastStatus = installHealthLinkService(serviceOptions);
    },
    startService: () => {
      if (lastStatus?.manager === "manual") {
        throw new Error(`${lastStatus.detail ?? "This platform does not have a supported service manager."} Run healthlink-local daemon under Docker, PM2, Task Scheduler, or another process manager.`);
      }
      console.log("Service not running; starting...");
      lastStatus = startHealthLinkService(serviceOptions);
    },
    waitForReady: () => waitForLocalReceiver(options),
    printStatus: async () => {
      const status = getHealthLinkServiceStatus(serviceOptions);
      console.log("HealthLink receiver is ready.");
      await printServiceStatusDetails(status, options);
    }
  });
}

function resolveSetupAgentId(options: CliOptions): AgentAdapterId {
  if (!options.agentAuto) {
    return options.agentId;
  }
  return detectPreferredAgentAdapter({
    hermesConfigPath: options.hermesConfigPath,
    openclawConfigPath: options.openclawConfigPath
  }).id;
}

function printAgentAutoDetectSummary(options: CliOptions, agentId: AgentAdapterId): void {
  if (!options.agentAuto) {
    return;
  }
  const detected = detectPreferredAgentAdapter({
    hermesConfigPath: options.hermesConfigPath,
    openclawConfigPath: options.openclawConfigPath
  });
  if (agentId === "generic") {
    console.log("Agent auto-detect: no Hermes/OpenClaw config found; using generic MCP output.");
    console.log("Agent auto-detect: pass --agent hermes or --agent openclaw to force a specific adapter.");
    return;
  }
  console.log(`Agent auto-detect: ${getAgentAdapter(agentId).displayName} (${detected.status?.detail ?? "detected"})`);
}

async function printPairingSession(options: CliOptions): Promise<void> {
  const response = await createPairingSession(options);
  const qr = renderTerminalQr(response.pairing_url);
  const loopback = `http://127.0.0.1:${options.port}`;
  console.log("");
  console.log("Pair with iPhone:");
  console.log(`Pairing code: ${response.pairing_code}`);
  console.log(`Pairing URL:  ${response.pairing_url}`);
  console.log(`Expires:      ${Math.round(response.expires_in_seconds / 60)} minutes`);
  console.log("");
  if (qr.rendered) {
    console.log("Scan QR:");
    console.log(qr.text);
  } else {
    console.log(`Scan QR: terminal is too narrow (${qr.requiredColumns} columns needed).`);
    console.log(`Open ${loopback}/pair to scan the browser QR, or paste the Pairing URL in the app.`);
  }
  console.log("");
  console.log("Next:");
  console.log("  1. Scan with HealthLink iOS Settings -> Pairing -> Scan QR.");
  console.log("  2. Confirm pairing in the app, grant Health access, then Sync.");
  console.log("  3. If this code expires, run healthlink-local pair to print a fresh QR.");
  console.log("");
}

async function createPairingSession(options: CliOptions): Promise<{
  pairing_code: string;
  pairing_url: string;
  expires_in_seconds: number;
}> {
  return requestPairingSession({
    port: options.port,
    agentName: options.agentName ?? defaultAgentName(options.agentId),
    transport: options.transportId,
    serverUrl: options.serverUrl
  });
}

async function waitForLocalReceiver(options: CliOptions): Promise<void> {
  const deadline = Date.now() + 5000;
  let lastError = "";
  while (Date.now() < deadline) {
    const probe = await probeLocalReceiver(options);
    if (probe.reachable) {
      return;
    }
    lastError = probe.detail;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`HealthLink service did not become ready at ${localReceiverStatusEndpoint(options)} within 5 seconds. ${lastError}`);
}

function toServiceOptions(options: CliOptions): LaunchdServiceOptions {
  return {
    manager: options.serviceManager,
    databasePath: options.databasePath,
    host: options.host,
    port: options.port,
    transport: options.transportId,
    serverUrl: options.serverUrl,
    tailscaleName: options.tailscaleName
  };
}

async function printServiceStatusDetails(status: HealthLinkServiceStatus, options: CliOptions): Promise<void> {
  const database = openHealthLinkDatabase({ path: options.databasePath });
  try {
    const health = getHealthStatus(database);
    const receiver = await probeLocalReceiver(options);
    console.log("HealthLink service");
    console.log(`Manager:   ${status.manager}`);
    console.log(`Label:     ${status.label}`);
    console.log(`Installed: ${status.installed ? "yes" : "no"}`);
    console.log(`Running:   ${status.running ? "yes" : "no"}`);
    console.log(`Receiver:  ${receiver.reachable ? "reachable" : "not reachable"} (${receiver.detail})`);
    console.log(`Config:    ${status.configPath}`);
    console.log(`Local API: http://127.0.0.1:${options.port}`);
    console.log(`Database:  ${database.path}`);
    console.log(`Stdout:    ${status.stdoutPath}`);
    console.log(`Stderr:    ${status.stderrPath}`);
    console.log(`Last sync: ${health.last_sync_at ?? "never"}`);
    console.log("");
    if (!status.installed) {
      console.log("Next: run healthlink-local setup to install and start the receiver.");
    } else if (!status.running) {
      console.log("Next: run healthlink-local service start, then healthlink-local pair.");
    } else if (!receiver.reachable) {
      console.log(`Next: check healthlink-local logs and confirm port ${options.port} is not occupied by another process.`);
    } else {
      console.log("Next: run healthlink-local pair to print a new QR, or scan the browser QR at the Local API /pair page.");
    }
  } finally {
    database.close();
  }
}

function printServiceLogs(options: CliOptions): void {
  const stdout = readHealthLinkServiceLog({
    manager: options.serviceManager,
    databasePath: options.databasePath,
    stream: "stdout",
    lines: options.logLines
  });
  const stderr = readHealthLinkServiceLog({
    manager: options.serviceManager,
    databasePath: options.databasePath,
    stream: "stderr",
    lines: options.logLines
  });

  console.log(`HealthLink service logs (${options.logLines} lines)`);
  printLogSection("stdout", stdout);
  printLogSection("stderr", stderr);
}

function printLogSection(label: string, log: ReturnType<typeof readHealthLinkServiceLog>): void {
  console.log("");
  console.log(`[${label}] ${log.path}`);
  if (!log.exists) {
    console.log("(not created yet)");
    return;
  }
  console.log(log.content.length > 0 ? log.content : "(empty)");
}

function printSetupNextSteps(agent: ReturnType<typeof getAgentAdapter>, manager: Exclude<ServiceManagerId, "auto">): void {
  console.log("");
  console.log("Setup complete");
  console.log("");
  console.log("Next:");
  console.log("  1. Scan the QR with HealthLink iOS.");
  console.log("  2. Confirm pairing, grant Health access, then run Sync in the app.");
  console.log(`  3. ${agent.reloadHint()}`);
  console.log("");
  console.log(`After the first sync, this terminal can close. The ${manager} background receiver keeps accepting iOS syncs.`);
  console.log("Useful commands:");
  console.log("  healthlink-local service status");
  console.log("  healthlink-local doctor --agent hermes");
  console.log("  healthlink-local logs");
  console.log("  healthlink-local pair");
  console.log("  healthlink-local service stop");
}

function resolveServiceManagerIdForCli(options: Pick<CliOptions, "serviceManager">): Exclude<ServiceManagerId, "auto"> {
  if (options.serviceManager === "auto") {
    if (process.platform === "darwin") {
      return "launchd";
    }
    if (process.platform === "linux") {
      return "systemd";
    }
    return "manual";
  }
  return options.serviceManager;
}

function defaultAgentName(agentId: AgentAdapterId): string {
  if (agentId === "hermes") {
    return "Hermes Agent";
  }
  if (agentId === "openclaw") {
    return "OpenClaw Agent";
  }
  if (agentId === "workbuddy") {
    return "WorkBuddy Agent";
  }
  return "Local Agent";
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

  const serviceStatus = getHealthLinkServiceStatus(toServiceOptions(options));
  results.push({
    status: serviceStatus.running ? "OK" : serviceStatus.installed ? "WARN" : "WARN",
    label: `${serviceStatus.manager} service`,
    detail: serviceStatus.installed
      ? `${serviceStatus.running ? "running" : "installed but not running"} (${serviceStatus.configPath})`
      : serviceStatus.detail ?? `not installed (${serviceStatus.configPath})`
  });

  const receiverStatus = await checkLocalReceiver(options);
  results.push(receiverStatus);

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

  for (const diagnostic of getServerUrlDiagnostics({
    serverUrl: options.serverUrl,
    runningInContainer: isContainerRuntime()
  })) {
    results.push({
      status: diagnostic.status.toUpperCase() as "OK" | "WARN" | "FAIL",
      label: "Advertised server URL",
      detail: diagnostic.detail
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

async function checkLocalReceiver(options: CliOptions): Promise<{
  status: "OK" | "WARN" | "FAIL";
  label: string;
  detail: string;
}> {
  const probe = await probeLocalReceiver(options);
  return {
    status: probe.reachable ? "OK" : "WARN",
    label: "Local receiver",
    detail: probe.detail
  };
}

type ReceiverProbeResult = {
  reachable: boolean;
  detail: string;
};

async function probeLocalReceiver(options: CliOptions): Promise<ReceiverProbeResult> {
  const endpoint = localReceiverStatusEndpoint(options);
  try {
    const response = await fetch(endpoint, {
      signal: AbortSignal.timeout(1500)
    });
    if (!response.ok) {
      return {
        reachable: false,
        detail: `${endpoint} returned HTTP ${response.status}`
      };
    }
    const body = await response.json() as unknown;
    if (!isReceiverHealthStatus(body)) {
      return {
        reachable: false,
        detail: `${endpoint} responded, but it does not look like a HealthLink receiver`
      };
    }
    return {
      reachable: true,
      detail: `${endpoint} reachable (${String(body.device_count ?? 0)} source devices, ${String(body.sync_count ?? 0)} syncs, last sync ${String(body.last_sync_at ?? "never")})`
    };
  } catch (error) {
    const listener = describePortListeners(options.port);
    const listenerDetail = listener ? ` Listener on port ${options.port}: ${listener}.` : "";
    return {
      reachable: false,
      detail: `${endpoint} is not reachable. Run healthlink-local service start or healthlink-local setup.${listenerDetail} ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

function localReceiverStatusEndpoint(options: Pick<CliOptions, "port">): string {
  return `http://127.0.0.1:${options.port}/health/status`;
}

function isReceiverHealthStatus(value: unknown): value is {
  device_count?: unknown;
  sync_count?: unknown;
  last_sync_at?: unknown;
} {
  return typeof value === "object" && value !== null && (
    "device_count" in value ||
    "sync_count" in value ||
    "last_sync_at" in value ||
    "status" in value
  );
}

main().catch((error: unknown) => {
  console.error(formatCliError(error));
  process.exitCode = 1;
});

function formatCliError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("EADDRINUSE")) {
    const portMatch = message.match(/:(\d+)\b/);
    const port = portMatch?.[1] ?? "8787";
    const portNumber = Number(port);
    const listener = describePortListeners(Number.isInteger(portNumber) ? portNumber : 8787);
    return [
      `HealthLink Local failed: ${message}`,
      "",
      `Port ${port} is already in use.`,
      listener ? `Current listener: ${listener}` : "Current listener: could not be identified automatically.",
      `Check the process with: lsof -nP -iTCP:${port} -sTCP:LISTEN`,
      "If it is an old foreground receiver, stop it with Ctrl-C and retry.",
      "If the background service is already running, use: healthlink-local pair"
    ].join("\n");
  }
  if (message.includes("did not become ready")) {
    return [
      `HealthLink Local failed: ${message}`,
      "",
      "Check service status with: healthlink-local service status",
      "Check daemon logs with: healthlink-local logs",
      "If port 8787 is occupied, stop the old receiver or rerun with --port <free-port>."
    ].join("\n");
  }
  return `HealthLink Local failed: ${message}`;
}
