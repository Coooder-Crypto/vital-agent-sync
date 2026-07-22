#!/usr/bin/env node
import {
  formatStandardMcpConfig,
  buildVitalAgentMcpServerConfig
} from "./mcp-config.js";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { detectPreferredAgentAdapter, getAgentAdapter, isAgentAdapterId, type AgentAdapterId } from "./agents.js";
import {
  BOOTSTRAP_SCHEMA_VERSION,
  bootstrapStageComplete,
  classifyBootstrapError,
  createBootstrapState,
  failBootstrapState,
  markBootstrapStage,
  pauseBootstrapForServiceActivation,
  readBootstrapState,
  runBootstrapWorkflow,
  safeErrorMessage,
  sanitizeAgentOutput,
  withBootstrapLock,
  writeBootstrapState,
  type BootstrapConfig,
  type BootstrapOutput,
  type BootstrapState
} from "./bootstrap.js";
import { getDatabaseId, openVitalAgentDatabase, readExistingDatabaseId } from "./database.js";
import { buildDockerComposeYaml, buildRelayDockerComposeYaml } from "./docker-compose.js";
import { getHealthStatus } from "./health-ingest.js";
import { startLocalServer } from "./server.js";
import { startMcpServer } from "./mcp.js";
import {
  getVitalAgentServiceStatus,
  installVitalAgentService,
  isWorkBuddySandbox,
  isServiceManagerId,
  readVitalAgentServiceLog,
  startVitalAgentService,
  stopVitalAgentService,
  uninstallVitalAgentService,
  type VitalAgentServiceMode,
  type VitalAgentServiceStatus,
  type LaunchdServiceOptions,
  type ServiceManagerId
} from "./service.js";
import { requestPairingSession } from "./pairing-client.js";
import { describePortListeners, findAvailableTcpPort } from "./port-diagnostics.js";
import { buildRelayFixtureEnvelope } from "./relay-fixture.js";
import { migrateRelayRuntime, resetRelayRuntime, rotateRelayRuntime, unlinkRelaySourceDevice } from "./relay-lifecycle.js";
import { auditRelayDeployment } from "./relay-audit.js";
import { pullRelayEnvelopes } from "./relay-pull.js";
import { resolveRelayServeConfig } from "./relay-serve-config.js";
import { getRelayLocalStatus } from "./relay-status.js";
import {
  DEFAULT_RELAY_URL,
  formatRelayOnboarding,
  initializeRelayRuntime,
  normalizeRelayUrlForMode,
  readRelayRuntimeConfig,
  resolveDefaultRelayUrl,
  validateRelayRuntimeState
} from "./relay-runtime.js";
import { startRelayServer } from "./relay-server.js";
import { runServiceEnsureWorkflow, runServiceSetupWorkflow } from "./setup.js";
import { buildVitalAgentSkillMarkdown, exportVitalAgentSkillPackage } from "./skill.js";
import { listSourceDevices } from "./source-devices.js";
import { renderTerminalQr } from "./terminal-qr.js";
import { writeRelayOnboardingArtifact } from "./onboarding-artifact.js";
import {
  parseCompatibleReceiverRuntimeStatus,
  VITALMCP_RUNTIME_VERSION,
  type ReceiverRuntimeStatus
} from "./runtime-status.js";
import {
  getRuntimeMetadataPath,
  readRuntimeMetadata,
  recordRuntimeMetadata,
  runtimeMetadataMatchesCurrentProcess,
  runtimeMetadataPathsExist
} from "./runtime.js";
import { createTransportProvider, getServerUrlDiagnostics, isContainerRuntime, isTransportProviderId, type TransportProviderId } from "./transports.js";

type CliOptions = {
  command: "server" | "init" | "daemon" | "pair" | "setup" | "ensure" | "service" | "logs" | "mcp" | "print-mcp-config" | "print-agent-config" | "print-docker-compose" | "print-relay-docker-compose" | "print-skill" | "export-skill" | "print-onboarding" | "install-hermes" | "install-hermes-skill" | "status" | "doctor" | "pull" | "relay" | "version" | "help";
  serviceAction?: "install" | "start" | "stop" | "status" | "uninstall";
  serviceMode: VitalAgentServiceMode;
  relayAction?: "serve" | "status" | "fixture" | "audit" | "unlink" | "rotate" | "reset" | "migrate";
  port: number;
  portProvided: boolean;
  pullWatch: boolean;
  pullIntervalSeconds: number;
  relayRetentionDays: number;
  relayRetentionDaysProvided: boolean;
  relayMaxEnvelopeBytes: number;
  relayMaxEnvelopeBytesProvided: boolean;
  relayMaxUploadsPerMinute: number;
  relayMaxUploadsPerMinuteProvided: boolean;
  relayMaxQueuedEnvelopesPerUser: number;
  relayMaxQueuedEnvelopesPerUserProvided: boolean;
  relayMaxDevicesPerUser: number;
  relayMaxDevicesPerUserProvided: boolean;
  relayTrustProxy: boolean;
  relayTrustProxyProvided: boolean;
  relayApiToken?: string;
  relayApiTokenProvided: boolean;
  relayMetricsToken?: string;
  relayMetricsTokenProvided: boolean;
  relayAuditActive: boolean;
  fixtureDate?: string;
  fixtureSteps: number;
  fixtureSleepMinutes: number;
  fixtureActiveEnergyKcal: number;
  fixtureSequence?: number;
  fixtureSyncId?: string;
  fixtureGeneratedAt?: string;
  fixtureCreatedAt?: string;
  fixtureTimezone?: string;
  host: string;
  hostProvided: boolean;
  useService: boolean;
  installHermes: boolean;
  installSkill: boolean;
  agentAuto: boolean;
  logLines: number;
  agentId: AgentAdapterId;
  transportId: TransportProviderId;
  transportProvided: boolean;
  serviceManager: ServiceManagerId;
  databasePath?: string;
  databasePathProvided: boolean;
  serverUrl?: string;
  tailscaleName?: string;
  relayUrl?: string;
  stateDir?: string;
  agentName?: string;
  outputDir?: string;
  hermesConfigPath?: string;
  hermesSkillPath?: string;
  openclawConfigPath?: string;
  workbuddyConfigPath?: string;
  workbuddyProjectPath?: string;
  yes: boolean;
  resume: boolean;
  mcpVerified: boolean;
  outputFormat: "text" | "json";
  onboardingFormat: "qr" | "deeplink" | "text";
};

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    command: "server",
    port: 8787,
    portProvided: false,
    pullWatch: false,
    pullIntervalSeconds: 300,
    relayRetentionDays: 30,
    relayRetentionDaysProvided: false,
    relayMaxEnvelopeBytes: 512 * 1024,
    relayMaxEnvelopeBytesProvided: false,
    relayMaxUploadsPerMinute: 120,
    relayMaxUploadsPerMinuteProvided: false,
    relayMaxQueuedEnvelopesPerUser: 1000,
    relayMaxQueuedEnvelopesPerUserProvided: false,
    relayMaxDevicesPerUser: 5,
    relayMaxDevicesPerUserProvided: false,
    relayTrustProxy: false,
    relayTrustProxyProvided: false,
    relayApiTokenProvided: false,
    relayMetricsTokenProvided: false,
    relayAuditActive: false,
    fixtureSteps: 7777,
    fixtureSleepMinutes: 420,
    fixtureActiveEnergyKcal: 520,
    host: "0.0.0.0",
    hostProvided: false,
    useService: false,
    installHermes: false,
    installSkill: false,
    agentAuto: true,
    logLines: 80,
    agentId: "generic",
    transportId: "lan",
    transportProvided: false,
    serviceManager: "auto",
    serviceMode: "receiver",
    databasePathProvided: false,
    yes: false,
    resume: false,
    mcpVerified: false,
    outputFormat: "text",
    onboardingFormat: "qr"
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h" || arg === "help") {
      options.command = "help";
    } else if (arg === "--version" || arg === "-v" || arg === "version") {
      options.command = "version";
    } else if (arg === "service") {
      options.command = "service";
      const action = argv[index + 1];
      if (action && !action.startsWith("--")) {
        if (!isServiceAction(action)) {
          throw new Error("Expected service action to be one of: install, start, stop, status, uninstall.");
        }
        options.serviceAction = action;
        index += 1;
      }
    } else if (arg === "relay") {
      options.command = "relay";
      const action = argv[index + 1];
      if (action && !action.startsWith("--")) {
        if (!isRelayAction(action)) {
          throw new Error("Expected relay action to be one of: serve, status, fixture, audit, unlink, rotate, reset, migrate.");
        }
        options.relayAction = action;
        index += 1;
      }
    } else if (arg === "server" || arg === "init" || arg === "daemon" || arg === "pair" || arg === "setup" || arg === "ensure" || arg === "service" || arg === "logs" || arg === "mcp" || arg === "print-mcp-config" || arg === "print-agent-config" || arg === "print-docker-compose" || arg === "print-relay-docker-compose" || arg === "print-skill" || arg === "export-skill" || arg === "print-onboarding" || arg === "install-hermes" || arg === "install-hermes-skill" || arg === "status" || arg === "doctor" || arg === "pull") {
      options.command = arg;
    } else if (arg === "--port") {
      options.port = Number(requiredOptionValue(argv, index, arg));
      options.portProvided = true;
      index += 1;
    } else if (arg === "--host") {
      options.host = requiredOptionValue(argv, index, arg);
      options.hostProvided = true;
      index += 1;
    } else if (arg === "--db") {
      options.databasePath = requiredOptionValue(argv, index, arg);
      options.databasePathProvided = true;
      index += 1;
    } else if (arg === "--server-url") {
      options.serverUrl = requiredOptionValue(argv, index, arg);
      index += 1;
    } else if (arg === "--relay-url") {
      options.relayUrl = requiredOptionValue(argv, index, arg);
      index += 1;
    } else if (arg === "--state-dir") {
      options.stateDir = requiredOptionValue(argv, index, arg);
      index += 1;
    } else if (arg === "--tailscale-name") {
      options.tailscaleName = requiredOptionValue(argv, index, arg);
      index += 1;
    } else if (arg === "--agent-name") {
      options.agentName = requiredOptionValue(argv, index, arg);
      index += 1;
    } else if (arg === "--output-dir") {
      options.outputDir = requiredOptionValue(argv, index, arg);
      index += 1;
    } else if (arg === "--lines") {
      options.logLines = Number(requiredOptionValue(argv, index, arg));
      index += 1;
    } else if (arg === "--once") {
      options.pullWatch = false;
    } else if (arg === "--watch") {
      options.pullWatch = true;
    } else if (arg === "--interval-seconds") {
      options.pullIntervalSeconds = Number(requiredOptionValue(argv, index, arg));
      index += 1;
    } else if (arg === "--retention-days") {
      options.relayRetentionDays = Number(requiredOptionValue(argv, index, arg));
      options.relayRetentionDaysProvided = true;
      index += 1;
    } else if (arg === "--max-envelope-bytes") {
      options.relayMaxEnvelopeBytes = Number(requiredOptionValue(argv, index, arg));
      options.relayMaxEnvelopeBytesProvided = true;
      index += 1;
    } else if (arg === "--max-uploads-per-minute") {
      options.relayMaxUploadsPerMinute = Number(requiredOptionValue(argv, index, arg));
      options.relayMaxUploadsPerMinuteProvided = true;
      index += 1;
    } else if (arg === "--max-queued-envelopes-per-user") {
      options.relayMaxQueuedEnvelopesPerUser = Number(requiredOptionValue(argv, index, arg));
      options.relayMaxQueuedEnvelopesPerUserProvided = true;
      index += 1;
    } else if (arg === "--max-devices-per-user") {
      options.relayMaxDevicesPerUser = Number(requiredOptionValue(argv, index, arg));
      options.relayMaxDevicesPerUserProvided = true;
      index += 1;
    } else if (arg === "--trust-proxy") {
      options.relayTrustProxy = true;
      options.relayTrustProxyProvided = true;
    } else if (arg === "--no-trust-proxy") {
      options.relayTrustProxy = false;
      options.relayTrustProxyProvided = true;
    } else if (arg === "--relay-api-token") {
      options.relayApiToken = requiredOptionValue(argv, index, arg);
      options.relayApiTokenProvided = true;
      index += 1;
    } else if (arg === "--metrics-token") {
      options.relayMetricsToken = requiredOptionValue(argv, index, arg);
      options.relayMetricsTokenProvided = true;
      index += 1;
    } else if (arg === "--active") {
      options.relayAuditActive = true;
    } else if (arg === "--date") {
      options.fixtureDate = requiredOptionValue(argv, index, arg);
      index += 1;
    } else if (arg === "--steps") {
      options.fixtureSteps = Number(requiredOptionValue(argv, index, arg));
      index += 1;
    } else if (arg === "--sleep-minutes") {
      options.fixtureSleepMinutes = Number(requiredOptionValue(argv, index, arg));
      index += 1;
    } else if (arg === "--active-energy-kcal") {
      options.fixtureActiveEnergyKcal = Number(requiredOptionValue(argv, index, arg));
      index += 1;
    } else if (arg === "--sequence") {
      options.fixtureSequence = Number(requiredOptionValue(argv, index, arg));
      index += 1;
    } else if (arg === "--sync-id") {
      options.fixtureSyncId = requiredOptionValue(argv, index, arg);
      index += 1;
    } else if (arg === "--generated-at") {
      options.fixtureGeneratedAt = requiredOptionValue(argv, index, arg);
      index += 1;
    } else if (arg === "--created-at") {
      options.fixtureCreatedAt = requiredOptionValue(argv, index, arg);
      index += 1;
    } else if (arg === "--timezone") {
      options.fixtureTimezone = requiredOptionValue(argv, index, arg);
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
      const normalizedValue = normalizeTransportOption(value);
      if (!normalizedValue || !isTransportProviderId(normalizedValue)) {
        throw new Error("Expected --transport to be one of: lan, tailscale, cloudflare, ngrok, public_https, relay, hosted-relay, self_hosted_relay, self-hosted-relay.");
      }
      options.transportId = normalizedValue;
      options.transportProvided = true;
      index += 1;
    } else if (arg === "--manager") {
      const value = argv[index + 1];
      if (!value || !isServiceManagerId(value)) {
        throw new Error("Expected --manager to be one of: auto, launchd, systemd, session, manual.");
      }
      options.serviceManager = value;
      index += 1;
    } else if (arg === "--mode") {
      const value = argv[index + 1];
      if (value === "receiver") {
        options.serviceMode = "receiver";
      } else if (value === "relay-pull" || value === "relay_pull") {
        options.serviceMode = "relay_pull";
      } else {
        throw new Error("Expected --mode to be one of: receiver, relay-pull.");
      }
      index += 1;
    } else if (arg === "--hermes-config") {
      options.hermesConfigPath = requiredOptionValue(argv, index, arg);
      index += 1;
    } else if (arg === "--openclaw-config") {
      options.openclawConfigPath = requiredOptionValue(argv, index, arg);
      index += 1;
    } else if (arg === "--workbuddy-config") {
      options.workbuddyConfigPath = requiredOptionValue(argv, index, arg);
      index += 1;
    } else if (arg === "--workbuddy-project") {
      options.workbuddyProjectPath = requiredOptionValue(argv, index, arg);
      index += 1;
    } else if (arg === "--hermes-skill-path") {
      options.hermesSkillPath = requiredOptionValue(argv, index, arg);
      index += 1;
    } else if (arg === "--format") {
      const value = argv[index + 1];
      if (value === "qr" || value === "deeplink" || value === "text") {
        options.onboardingFormat = value;
      } else if (value !== "markdown") {
        throw new Error("Expected --format to be one of: markdown, qr, deeplink, text.");
      }
      index += 1;
    } else if (arg === "--output") {
      const value = requiredOptionValue(argv, index, arg);
      if (value !== "text" && value !== "json") {
        throw new Error("Expected --output to be one of: text, json.");
      }
      options.outputFormat = value;
      index += 1;
    } else if (arg === "--resume") {
      options.resume = true;
    } else if (arg === "--mcp-verified") {
      options.mcpVerified = true;
    } else if (arg === "--hermes" || arg === "--install-hermes") {
      options.installHermes = true;
      options.agentId = "hermes";
      options.agentAuto = false;
    } else if (arg === "--install-skill") {
      options.installSkill = true;
    } else if (arg === "--yes") {
      options.yes = true;
    } else if (arg === "--service") {
      options.useService = true;
    } else {
      throw new Error(arg.startsWith("-") ? `Unknown option: ${arg}` : `Unexpected argument: ${arg}`);
    }
  }

  if (!Number.isInteger(options.port) || options.port <= 0) {
    throw new Error("Expected --port to be a positive integer.");
  }
  if (options.workbuddyConfigPath && options.workbuddyProjectPath) {
    throw new Error("Use either --workbuddy-config or --workbuddy-project, not both.");
  }
  if (!Number.isInteger(options.logLines) || options.logLines <= 0) {
    throw new Error("Expected --lines to be a positive integer.");
  }
  if (!Number.isInteger(options.pullIntervalSeconds) || options.pullIntervalSeconds <= 0) {
    throw new Error("Expected --interval-seconds to be a positive integer.");
  }
  if (!Number.isFinite(options.relayRetentionDays) || options.relayRetentionDays <= 0) {
    throw new Error("Expected --retention-days to be a positive number.");
  }
  if (!Number.isInteger(options.relayMaxEnvelopeBytes) || options.relayMaxEnvelopeBytes <= 0) {
    throw new Error("Expected --max-envelope-bytes to be a positive integer.");
  }
  if (!Number.isInteger(options.relayMaxUploadsPerMinute) || options.relayMaxUploadsPerMinute <= 0) {
    throw new Error("Expected --max-uploads-per-minute to be a positive integer.");
  }
  if (!Number.isInteger(options.relayMaxQueuedEnvelopesPerUser) || options.relayMaxQueuedEnvelopesPerUser <= 0) {
    throw new Error("Expected --max-queued-envelopes-per-user to be a positive integer.");
  }
  if (!Number.isInteger(options.relayMaxDevicesPerUser) || options.relayMaxDevicesPerUser <= 0) {
    throw new Error("Expected --max-devices-per-user to be a positive integer.");
  }
  if (!Number.isInteger(options.fixtureSteps) || options.fixtureSteps < 0) {
    throw new Error("Expected --steps to be a non-negative integer.");
  }
  if (!Number.isInteger(options.fixtureSleepMinutes) || options.fixtureSleepMinutes < 0) {
    throw new Error("Expected --sleep-minutes to be a non-negative integer.");
  }
  if (!Number.isInteger(options.fixtureActiveEnergyKcal) || options.fixtureActiveEnergyKcal < 0) {
    throw new Error("Expected --active-energy-kcal to be a non-negative integer.");
  }
  if (options.fixtureSequence !== undefined && (!Number.isInteger(options.fixtureSequence) || options.fixtureSequence <= 0)) {
    throw new Error("Expected --sequence to be a positive integer.");
  }
  if (options.relayMetricsTokenProvided && !options.relayMetricsToken?.trim()) {
    throw new Error("Expected --metrics-token to be a non-empty string.");
  }
  if (options.relayApiTokenProvided && !options.relayApiToken?.trim()) {
    throw new Error("Expected --relay-api-token to be a non-empty string.");
  }
  if (options.command === "setup" || options.command === "ensure") {
    options.useService = true;
  }
  if (options.transportId === "tailscale" && !options.hostProvided) {
    options.host = "127.0.0.1";
  }

  return options;
}

function requiredOptionValue(argv: string[], index: number, option: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${option} requires a value.`);
  }
  return value;
}

function isServiceAction(value: string): value is NonNullable<CliOptions["serviceAction"]> {
  return value === "install" || value === "start" || value === "stop" || value === "status" || value === "uninstall";
}

function isRelayAction(value: string): value is NonNullable<CliOptions["relayAction"]> {
  return value === "serve" || value === "status" || value === "fixture" || value === "audit" ||
    value === "unlink" || value === "rotate" || value === "reset" || value === "migrate";
}

function normalizeTransportOption(value: string | undefined): string | undefined {
  if (value === "hosted-relay") {
    return "relay";
  }
  if (value === "self-hosted-relay") {
    return "self_hosted_relay";
  }
  return value;
}

function normalizeWorkBuddyProjectPath(projectPath: string | undefined): string | undefined {
  if (!projectPath) {
    return undefined;
  }
  if (projectPath === "~" || projectPath.startsWith("~/")) {
    return projectPath;
  }
  return resolve(projectPath);
}

function normalizeWorkBuddyConfigPath(configPath: string | undefined): string | undefined {
  if (!configPath || configPath === "~" || configPath.startsWith("~/")) {
    return configPath;
  }
  return resolve(configPath);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (options.command === "help") {
    process.stdout.write(buildCliHelp());
    return;
  }

  if (options.command === "version") {
    console.log(`vitalmcp ${VITALMCP_RUNTIME_VERSION}`);
    return;
  }

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

  if (options.command === "print-relay-docker-compose") {
    process.stdout.write(buildRelayDockerComposeYaml({
      port: options.portProvided ? options.port : undefined
    }));
    return;
  }

  if (options.command === "print-skill") {
    process.stdout.write(buildVitalAgentSkillMarkdown({
      agent: options.agentId
    }));
    return;
  }

  if (options.command === "export-skill") {
    const defaultOutputDir = options.agentId === "workbuddy"
      ? "vital-agent-sync-workbuddy-skill"
      : "vitalmcp-openclaw-skill";
    const result = exportVitalAgentSkillPackage({
      agent: options.agentId,
      outputDir: options.outputDir ?? defaultOutputDir
    });
    console.log("Vital Agent Sync skill package exported");
    console.log(`Package:  ${result.packageDir}`);
    console.log(`Skill:    ${result.skillPath}`);
    if (result.readmePath) {
      console.log(`README:   ${result.readmePath}`);
    }
    return;
  }

  if (options.command === "print-onboarding") {
    await printRelayOnboarding(options);
    return;
  }

  if (options.command === "pull") {
    await runRelayPull(options);
    return;
  }

  if (options.command === "relay") {
    await runRelayCommand(options);
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
    console.log("Vital Agent Sync skill installed for Hermes");
    console.log(`Skill: ${result.skillPath}`);
    if (result.backupPath) {
      console.log(`Backup: ${result.backupPath}`);
    }
    console.log("");
    console.log("Restart Hermes or reload skills to make the Vital Agent Sync skill visible.");
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
      openclawConfigPath: options.openclawConfigPath,
      workbuddyConfigPath: options.workbuddyConfigPath,
      workbuddyProjectPath: options.workbuddyProjectPath
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
    const server = buildVitalAgentMcpServerConfig({
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
        console.log(`  installed Vital Agent Sync skill in ${skillInstall.skillPath}`);
      }
    } else {
      console.log("  vitalmcp init --agent hermes");
      console.log("  vitalmcp init --hermes");
      console.log("  vitalmcp install-hermes");
      console.log("  vitalmcp install-hermes-skill");
    }
    console.log("");
  }
}

function buildCliHelp(): string {
  return `Vital Agent Sync runtime ${VITALMCP_RUNTIME_VERSION}

Usage:
  vitalmcp <command> [options]

Core setup:
  setup --transport lan --agent <generic|hermes|openclaw|workbuddy> [--output json]  # Local Preview default
  setup --transport lan --agent workbuddy                                           # user MCP config
  setup --transport lan --agent workbuddy --workbuddy-project <dir>                 # project MCP config
  setup --transport tailscale --tailscale-name <host.tailnet.ts.net> --agent <agent> # optional private HTTPS remote
  setup --transport self-hosted-relay --relay-url http://HOST:8790 --agent <agent>
  setup --transport relay --relay-url https://HOSTED-RELAY --agent <agent> [--output json] # future/experimental
  setup --resume --yes [--output json]
  pair
  status
  doctor --agent <agent>

Relay:
  pull [--once|--watch] [--interval-seconds 300]
  relay serve [--host 0.0.0.0] [--port 8790]
  relay serve [--trust-proxy|--no-trust-proxy]
  relay status
  relay audit --relay-url <url> [--metrics-token <token>]
  relay audit --relay-url <url> --active --yes [--relay-api-token <token>]
  relay fixture [--date YYYY-MM-DD] [--steps N]
  relay unlink|rotate|reset --yes
  relay migrate --yes --transport <hosted-relay|self-hosted-relay> --relay-url <url>
  print-onboarding --transport <relay|self-hosted-relay> [--relay-url <url>] [--format qr|deeplink|text] [--output json]
  print-relay-docker-compose

Agent integration:
  mcp
  print-mcp-config
  print-agent-config --agent <agent>
  print-skill --agent <generic|hermes|openclaw|workbuddy>
  install-hermes
  install-hermes-skill
  export-skill --agent <openclaw|workbuddy> --output-dir <directory>

Service:
  service <install|start|stop|status|uninstall> [--mode receiver|relay-pull]
  logs [--mode receiver|relay-pull] [--lines N]

Global:
  --db <path>        Vital Agent Sync SQLite path
  --state-dir <path> Relay runtime state directory
  --server-url <url> Explicit iPhone-reachable URL (HTTPS required for Tailscale)
  --tailscale-name   MagicDNS name used by private Tailscale Serve HTTPS
  --workbuddy-project <dir> Project directory for <dir>/.workbuddy/mcp.json
  --workbuddy-config <path> Explicit WorkBuddy MCP configuration path
  --manager <id>     auto, launchd, systemd, session, or manual
  --output text|json Versioned Agent-safe command output
  --yes              Apply a reviewed setup plan
  --mcp-verified     Resume only after WorkBuddy loaded and called vital_agent_status
  --version, -v      Print version
  --help, -h         Show this help
`;
}

async function runServiceCommand(options: CliOptions): Promise<void> {
  const action = options.serviceAction ?? "status";
  const serviceOptions = toServiceOptions(options);
  if (action === "install") {
    const status = installVitalAgentService(serviceOptions);
    console.log("Vital Agent Sync service installed");
    await printServiceStatusDetails(status, options);
    return;
  }
  if (action === "start") {
    const status = startVitalAgentService(serviceOptions);
    console.log("Vital Agent Sync service start requested");
    await printServiceStatusDetails(status, options);
    return;
  }
  if (action === "stop") {
    const status = stopVitalAgentService(serviceOptions);
    console.log("Vital Agent Sync service stop requested");
    await printServiceStatusDetails(status, options);
    return;
  }
  if (action === "uninstall") {
    const status = uninstallVitalAgentService(serviceOptions);
    console.log("Vital Agent Sync service uninstalled");
    await printServiceStatusDetails(status, options);
    return;
  }
  await printServiceStatusDetails(getVitalAgentServiceStatus(serviceOptions), options);
}

async function runSetup(options: CliOptions): Promise<void> {
  const requested = options.resume
    ? restoreBootstrapOptions(options)
    : await prepareNewBootstrapOptions(options);
  let state = options.resume
    ? requireBootstrapState(requested)
    : createAndPersistBootstrapState(requested);

  if (!options.yes) {
    printBootstrapPlan(state, requested);
    if (requested.outputFormat === "json" || !input.isTTY) {
      return;
    }
    if (!await confirmBootstrapPlan()) {
      console.log("Setup cancelled before persistent changes.");
      return;
    }
  }

  try {
    await withBootstrapLock({ stateDir: requested.stateDir }, async () => {
      state = readBootstrapState({ stateDir: requested.stateDir }) ?? state;
      try {
        state = await executeBootstrapSetup(state, requested);
        printBootstrapResult(state, requested);
      } catch (error) {
        state = classifyBootstrapError(error) === "service_activation_required"
          ? pauseBootstrapForServiceActivation(state, error, { stateDir: requested.stateDir })
          : failBootstrapState(state, error, { stateDir: requested.stateDir });
        if (requested.outputFormat === "json") {
          printJson(buildBootstrapOutput(state, requested));
          if (state.status === "failed") {
            process.exitCode = 1;
          }
          return;
        }
        if (state.status === "awaiting_service_activation") {
          printBootstrapResult(state, requested);
          return;
        }
        throw error;
      }
    });
  } catch (error) {
    if (requested.outputFormat !== "json") {
      throw error;
    }
    printJson({
      schema_version: BOOTSTRAP_SCHEMA_VERSION,
      command: "setup",
      status: "failed",
      setup_id: state.setup_id,
      current_stage: state.current_stage,
      completed_stages: state.completed_stages,
      next_action: {
        type: "retry",
        command: "vitalmcp setup --resume --yes --output json"
      },
      error: {
        code: classifyBootstrapError(error),
        message: safeErrorMessage(error)
      }
    } satisfies BootstrapOutput);
    process.exitCode = 1;
  }
}

async function prepareNewBootstrapOptions(options: CliOptions): Promise<CliOptions> {
  const resolved = options.transportId === "relay" || options.transportId === "self_hosted_relay"
    ? options
    : await resolveAutoServicePort(options);
  const agentId = resolveSetupAgentId(resolved);
  const serviceMode = resolved.transportId === "relay" || resolved.transportId === "self_hosted_relay"
    ? "relay_pull"
    : "receiver";
  const workbuddyProjectPath = agentId === "workbuddy" && !resolved.workbuddyConfigPath
    ? normalizeWorkBuddyProjectPath(resolved.workbuddyProjectPath)
    : resolved.workbuddyProjectPath;
  const workbuddyConfigPath = agentId === "workbuddy"
    ? normalizeWorkBuddyConfigPath(resolved.workbuddyConfigPath)
    : resolved.workbuddyConfigPath;
  const serviceManager = agentId === "workbuddy" && resolved.serviceManager === "auto" && isWorkBuddySandbox()
    ? "session"
    : resolved.serviceManager;
  return {
    ...resolved,
    agentId,
    agentAuto: false,
    serviceMode,
    serviceManager,
    workbuddyConfigPath,
    workbuddyProjectPath
  };
}

function createAndPersistBootstrapState(options: CliOptions): BootstrapState {
  const shouldInstallSkill = options.installSkill || options.agentId === "hermes";
  if (shouldInstallSkill && options.agentId !== "hermes") {
    throw new Error("--install-skill currently supports --agent hermes only.");
  }
  const config = toBootstrapConfig(options, shouldInstallSkill);
  const existing = readBootstrapState({ stateDir: options.stateDir });
  if (existing && JSON.stringify(existing.config) === JSON.stringify(config)) {
    return existing;
  }
  if (existing && existing.status !== "complete") {
    throw new Error("An unfinished Vital Agent Sync setup already exists with different options. Resume it with setup --resume, or finish it before starting a different setup plan.");
  }
  const state = createBootstrapState(config);
  return writeBootstrapState(state, { stateDir: options.stateDir });
}

function restoreBootstrapOptions(options: CliOptions): CliOptions {
  const state = requireBootstrapState(options);
  const config = state.config;
  return {
    ...options,
    agentId: config.agent_id,
    agentAuto: false,
    transportId: config.transport_id,
    transportProvided: true,
    serviceManager: config.service_manager,
    serviceMode: config.service_mode,
    host: config.host,
    hostProvided: true,
    port: config.port,
    portProvided: true,
    pullIntervalSeconds: config.pull_interval_seconds,
    installSkill: config.install_skill,
    databasePath: config.database_path,
    databasePathProvided: config.database_path !== undefined,
    serverUrl: config.server_url,
    relayUrl: config.relay_url,
    stateDir: config.state_dir ?? options.stateDir,
    tailscaleName: config.tailscale_name,
    agentName: config.agent_name,
    hermesConfigPath: config.hermes_config_path,
    hermesSkillPath: config.hermes_skill_path,
    openclawConfigPath: config.openclaw_config_path,
    workbuddyConfigPath: config.workbuddy_config_path,
    workbuddyProjectPath: config.workbuddy_project_path
  };
}

function requireBootstrapState(options: Pick<CliOptions, "stateDir">): BootstrapState {
  const state = readBootstrapState({ stateDir: options.stateDir });
  if (!state) {
    throw new Error("No resumable Vital Agent Sync setup was found. Run vitalmcp setup with the desired Agent and transport first.");
  }
  return state;
}

function toBootstrapConfig(options: CliOptions, installSkill: boolean): BootstrapConfig {
  return {
    agent_id: options.agentId,
    transport_id: options.transportId,
    service_manager: options.serviceManager,
    service_mode: options.serviceMode,
    host: options.host,
    port: options.port,
    pull_interval_seconds: options.pullIntervalSeconds,
    install_skill: installSkill,
    database_path: options.databasePath,
    server_url: options.serverUrl,
    relay_url: options.relayUrl,
    state_dir: options.stateDir,
    tailscale_name: options.tailscaleName,
    agent_name: options.agentName,
    hermes_config_path: options.hermesConfigPath,
    hermes_skill_path: options.hermesSkillPath,
    openclaw_config_path: options.openclawConfigPath,
    workbuddy_config_path: options.workbuddyConfigPath,
    workbuddy_project_path: options.workbuddyProjectPath
  };
}

async function confirmBootstrapPlan(): Promise<boolean> {
  const readline = createInterface({ input, output });
  try {
    const answer = await readline.question("Apply these persistent changes? [y/N] ");
    return answer.trim().toLowerCase() === "y" || answer.trim().toLowerCase() === "yes";
  } finally {
    readline.close();
  }
}

function printBootstrapPlan(state: BootstrapState, options: CliOptions): void {
  if (options.outputFormat === "json") {
    printJson(buildBootstrapOutput(state, options));
    return;
  }
  console.log(`Vital Agent Sync setup plan for ${getAgentAdapter(state.config.agent_id).displayName}`);
  for (const [index, item] of state.plan.entries()) {
    console.log(`${index + 1}. ${item.description}${item.persistent_change ? " (persistent change)" : ""}`);
  }
  console.log("");
}

async function executeBootstrapSetup(state: BootstrapState, options: CliOptions): Promise<BootstrapState> {
  const relayMode = options.transportId === "relay" || options.transportId === "self_hosted_relay";
  let effectiveOptions = options;
  let relayConfig: ReturnType<typeof initializeRelayRuntime> | undefined;
  const agent = getAgentAdapter(options.agentId);
  recordRuntimeMetadata({ cliPath: fileURLToPath(import.meta.url) });
  const database = openVitalAgentDatabase({ path: options.databasePath });
  const expectedDatabaseId = getDatabaseId(database);
  try {
    if (state.initial_sync_count === undefined) {
      state = writeBootstrapState({
        ...state,
        initial_sync_count: getHealthStatus(database).sync_count
      }, { stateDir: options.stateDir });
    }
  } finally {
    database.close();
  }
  return runBootstrapWorkflow(state, {
    runtime_initialized: async () => {
      if (relayMode) {
        const mode = options.transportId === "relay" ? "hosted_relay" : "self_hosted_relay";
        const relayUrl = resolveDefaultRelayUrl({ mode, relayUrl: options.relayUrl });
        relayConfig = initializeRelayRuntime({
          stateDir: options.stateDir,
          relayUrl,
          relayApiToken: options.relayApiToken,
          agentName: options.agentName ?? defaultAgentName(options.agentId),
          mode
        });
        effectiveOptions = { ...options, relayUrl: relayConfig.relay_url };
        return;
      }
      if (options.transportId === "tailscale") {
        const transport = createTransportProvider({
          id: options.transportId,
          bindHost: options.host,
          port: options.port,
          serverUrl: options.serverUrl,
          tailscaleName: options.tailscaleName
        });
        await transport.start?.();
      }
      const database = openVitalAgentDatabase({ path: options.databasePath });
      database.close();
    },
    agent_configured: () => {
      const detected = agent.detect({
        hermesConfigPath: effectiveOptions.hermesConfigPath,
        openclawConfigPath: effectiveOptions.openclawConfigPath,
        workbuddyConfigPath: effectiveOptions.workbuddyConfigPath,
        workbuddyProjectPath: effectiveOptions.workbuddyProjectPath
      });
      if (effectiveOptions.agentId !== "generic" && !detected.configured) {
        agent.installMcp({ databasePath: effectiveOptions.databasePath }, {
          hermesConfigPath: effectiveOptions.hermesConfigPath,
          openclawConfigPath: effectiveOptions.openclawConfigPath,
          workbuddyConfigPath: effectiveOptions.workbuddyConfigPath,
          workbuddyProjectPath: effectiveOptions.workbuddyProjectPath
        });
      }
      if (state.config.install_skill) {
        agent.installSkill?.({ hermesSkillPath: effectiveOptions.hermesSkillPath });
      }
    },
    service_installed: () => {
      const serviceOptions = toServiceOptions(effectiveOptions);
      if (!getVitalAgentServiceStatus(serviceOptions).configured) {
        installVitalAgentService(serviceOptions);
      }
    },
    service_started: async () => {
      const serviceOptions = toServiceOptions(effectiveOptions);
      if (!getVitalAgentServiceStatus(serviceOptions).loaded) {
        startVitalAgentService(serviceOptions);
      }
      if (!relayMode) {
        await waitForLocalReceiver(effectiveOptions, expectedDatabaseId);
      }
    },
    mcp_verified: () => effectiveOptions.agentId !== "workbuddy" || effectiveOptions.mcpVerified,
    onboarding_created: async () => {
      if (relayMode) {
        relayConfig ??= readRelayRuntimeConfig({ stateDir: effectiveOptions.stateDir });
        effectiveOptions = { ...effectiveOptions, relayUrl: relayConfig.relay_url };
        const artifact = await writeRelayOnboardingArtifact({
          config: relayConfig,
          stateDir: effectiveOptions.stateDir,
          format: effectiveOptions.onboardingFormat
        });
        return { onboarding_url: artifact.local_url };
      }
      return { onboarding_url: `http://127.0.0.1:${effectiveOptions.port}/pair` };
    },
    first_sync_observed: async () => {
      if (!relayMode) {
        await requireCompatibleLocalReceiver(effectiveOptions, expectedDatabaseId);
      }
      const database = openVitalAgentDatabase({ path: effectiveOptions.databasePath });
      try {
        return getHealthStatus(database).sync_count > (state.initial_sync_count ?? 0);
      } finally {
        database.close();
      }
    }
  }, { stateDir: options.stateDir });
}

function buildBootstrapOutput(state: BootstrapState, options: CliOptions): BootstrapOutput {
  const resumeCommand = buildSetupResumeCommand(state);
  if (state.status === "awaiting_consent") {
    return sanitizeAgentOutput({
      schema_version: BOOTSTRAP_SCHEMA_VERSION,
      command: "setup",
      status: state.status,
      setup_id: state.setup_id,
      current_stage: state.current_stage,
      completed_stages: state.completed_stages,
      plan: state.plan,
      next_action: {
        type: "confirm",
        command: resumeCommand
      }
    });
  }
  if (state.status === "awaiting_service_activation") {
    return sanitizeAgentOutput({
      schema_version: BOOTSTRAP_SCHEMA_VERSION,
      command: "setup",
      status: state.status,
      setup_id: state.setup_id,
      current_stage: state.current_stage,
      completed_stages: state.completed_stages,
      next_action: {
        type: "activate_service",
        command: resumeCommand
      },
      details: {
        execution_boundary: "macos_terminal",
        sudo_required: false,
        reason: "WorkBuddy's sandbox cannot activate user launchd services. Run the command in macOS Terminal, then return to WorkBuddy."
      }
    });
  }
  if (state.status === "awaiting_mcp_approval") {
    return sanitizeAgentOutput({
      schema_version: BOOTSTRAP_SCHEMA_VERSION,
      command: "setup",
      status: state.status,
      setup_id: state.setup_id,
      current_stage: state.current_stage,
      completed_stages: state.completed_stages,
      next_action: {
        type: "approve_mcp",
        url: state.onboarding_url,
        command: `${resumeCommand} --mcp-verified`,
        suggested_prompt: "The private local pairing page is ready now. Approve vital-agent-sync in WorkBuddy MCP settings before any health data is read. After reload, call vital_agent_status and resume automatically."
      },
      details: {
        config_registered: true,
        onboarding_ready: state.onboarding_url !== undefined,
        approval_required: true,
        direct_approval_file_edits_allowed: false
      }
    });
  }
  const database = openVitalAgentDatabase({ path: options.databasePath ?? state.config.database_path });
  try {
    const health = getHealthStatus(database);
    const relay = getRelayLocalStatus({ stateDir: options.stateDir });
    const nextAction = state.status === "awaiting_first_sync"
        ? { type: "sync_ios" as const, url: state.onboarding_url, command: resumeCommand }
        : state.status === "complete"
          ? { type: "ask_agent" as const, suggested_prompt: "How am I doing today?" }
          : state.status === "failed"
            ? { type: "retry" as const, command: resumeCommand }
            : undefined;
    return sanitizeAgentOutput({
      schema_version: BOOTSTRAP_SCHEMA_VERSION,
      command: "setup",
      status: state.status,
      setup_id: state.setup_id,
      current_stage: state.current_stage,
      completed_stages: state.completed_stages,
      next_action: nextAction,
      freshness: {
        source_count: health.device_count,
        sync_count: health.sync_count,
        last_sync_at: health.last_sync_at,
        relay_last_pull_at: relay.last_successful_pull_at
      },
      error: state.last_error_code ? {
        code: state.last_error_code,
        message: state.last_error_message ?? "Vital Agent Sync setup failed."
      } : undefined
    });
  } finally {
    database.close();
  }
}

function printBootstrapResult(state: BootstrapState, options: CliOptions): void {
  if (options.outputFormat === "json") {
    printJson(buildBootstrapOutput(state, options));
    return;
  }
  const agent = getAgentAdapter(state.config.agent_id);
  console.log(`Vital Agent Sync setup status: ${state.status}`);
  if (state.onboarding_url && state.status !== "complete") {
    console.log(`Open this local onboarding page: ${state.onboarding_url}`);
    console.log("This page contains credentials. Do not upload or paste it into an Agent chat.");
  }
  if (state.status === "awaiting_service_activation") {
    console.log("WorkBuddy's sandbox cannot activate launchd. Run this in macOS Terminal; do not use sudo:");
    console.log(`  ${buildSetupResumeCommand(state)}`);
  } else if (state.status === "awaiting_mcp_approval") {
    console.log("The private local pairing page is ready. Approve vital-agent-sync in WorkBuddy MCP settings before any health data is read; after reload, call vital_agent_status and resume automatically.");
  } else if (state.status === "awaiting_first_sync") {
    console.log("Next: connect the Vital Agent app, run the first sync, then run vitalmcp setup --resume --yes.");
  } else if (state.status === "complete") {
    console.log("First sync observed. Verify freshness with vital_agent_status, then ask: How am I doing today?");
    console.log(agent.reloadHint());
  }
}

function buildSetupResumeCommand(state: BootstrapState): string {
  const runtime = state.config.agent_id === "workbuddy"
    ? `"$HOME/.vitalmcp/npm-global/bin/vitalmcp"`
    : "vitalmcp";
  const stateDir = state.config.state_dir ? ` --state-dir ${quoteShellArgument(state.config.state_dir)}` : "";
  return `${runtime} setup --resume --yes${stateDir} --output json`;
}

function quoteShellArgument(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(sanitizeAgentOutput(value), null, 2)}\n`);
}

async function runEnsure(options: CliOptions): Promise<void> {
  const ensureOptions = await resolveAutoServicePort(options);
  const serviceOptions = toServiceOptions(ensureOptions);
  const database = openVitalAgentDatabase({ path: ensureOptions.databasePath });
  const expectedDatabaseId = getDatabaseId(database);
  database.close();
  let lastStatus: VitalAgentServiceStatus | undefined;
  console.log("Ensuring Vital Agent Sync receiver service");
  await runServiceEnsureWorkflow({
    getStatus: () => {
      lastStatus = getVitalAgentServiceStatus(serviceOptions);
      return lastStatus;
    },
    installService: () => {
      if (lastStatus?.manager === "manual") {
        throw new Error(`${lastStatus.detail ?? "This platform does not have a supported service manager."} Run vitalmcp daemon under Docker, PM2, Task Scheduler, or another process manager.`);
      }
      console.log(`Service not installed for ${lastStatus?.manager ?? resolveServiceManagerIdForCli(options)}; installing...`);
      lastStatus = installVitalAgentService(serviceOptions);
    },
    startService: () => {
      if (lastStatus?.manager === "manual") {
        throw new Error(`${lastStatus.detail ?? "This platform does not have a supported service manager."} Run vitalmcp daemon under Docker, PM2, Task Scheduler, or another process manager.`);
      }
      console.log("Service not running; starting...");
      lastStatus = startVitalAgentService(serviceOptions);
    },
    waitForReady: () => waitForLocalReceiver(ensureOptions, expectedDatabaseId),
    printStatus: async () => {
      const status = getVitalAgentServiceStatus(serviceOptions);
      console.log("Vital Agent Sync receiver is ready.");
      await printServiceStatusDetails(status, ensureOptions);
    }
  });
}

async function resolveAutoServicePort(options: CliOptions): Promise<CliOptions> {
  const existingReceiver = await probeLocalReceiver(options);
  if (existingReceiver.reachable) {
    if (existingReceiver.compatible) {
      const expectedDatabaseId = readExistingDatabaseId(options.databasePath);
      if (!expectedDatabaseId || existingReceiver.status?.database_id !== expectedDatabaseId) {
        throw receiverIdentityConflict(options.port, "a compatible runtime is using a different local database");
      }
      return options;
    }
    throw receiverIdentityConflict(options.port, existingReceiver.detail);
  }

  const selected = await findAvailableTcpPort({
    preferredPort: options.port,
    host: options.host,
    maxAttempts: 20
  });
  if (!selected.changed) {
    return options;
  }

  const listener = describePortListeners(options.port);
  if (options.portProvided) {
    throw receiverIdentityConflict(options.port, listener
      ? `the requested port is occupied by ${listener}`
      : "the requested port is occupied by another process");
  }
  if (options.outputFormat === "text") {
    console.log(`Port ${options.port} is already in use; using ${selected.port} for Vital Agent Sync.`);
    if (listener) {
      console.log(`Current listener: ${listener}`);
    }
    console.log("Pass --port to choose a specific port.");
  }
  return {
    ...options,
    port: selected.port
  };
}

function resolveSetupAgentId(options: CliOptions): AgentAdapterId {
  if (!options.agentAuto) {
    return options.agentId;
  }
  return detectPreferredAgentAdapter({
    hermesConfigPath: options.hermesConfigPath,
    openclawConfigPath: options.openclawConfigPath,
    workbuddyConfigPath: options.workbuddyConfigPath,
    workbuddyProjectPath: options.workbuddyProjectPath
  }).id;
}

function printAgentAutoDetectSummary(options: CliOptions, agentId: AgentAdapterId): void {
  if (!options.agentAuto) {
    return;
  }
  const detected = detectPreferredAgentAdapter({
    hermesConfigPath: options.hermesConfigPath,
    openclawConfigPath: options.openclawConfigPath,
    workbuddyConfigPath: options.workbuddyConfigPath,
    workbuddyProjectPath: options.workbuddyProjectPath
  });
  if (agentId === "generic") {
    console.log("Agent auto-detect: no WorkBuddy/Hermes/OpenClaw config found; using generic MCP output.");
    console.log("Agent auto-detect: pass --agent workbuddy, --agent hermes, or --agent openclaw to force a specific adapter.");
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
  console.log(`Expires:      ${Math.round(response.expires_in_seconds / 60)} minutes`);
  console.log("");
  if (qr.rendered) {
    console.log("Scan QR:");
    console.log(qr.text);
  } else {
    console.log(`Scan QR: terminal is too narrow (${qr.requiredColumns} columns needed).`);
    console.log(`Open ${loopback}/pair on the receiver host to scan the browser QR.`);
  }
  console.log("");
  console.log("Next:");
  console.log("  1. In Vital Agent, open Settings -> Pairing -> Scan QR.");
  console.log("  2. Confirm pairing in the app, grant Health access, then Sync.");
  console.log("  3. If this code expires, run vitalmcp pair to print a fresh QR.");
  console.log("");
}

async function createPairingSession(options: CliOptions): Promise<{
  pairing_code: string;
  pairing_url: string;
  expires_in_seconds: number;
}> {
  const database = openVitalAgentDatabase({ path: options.databasePath });
  try {
    await requireCompatibleLocalReceiver(options, getDatabaseId(database));
  } finally {
    database.close();
  }
  return requestPairingSession({
    port: options.port,
    agentName: options.agentName ?? defaultAgentName(options.agentId),
    transport: options.transportId,
    serverUrl: options.serverUrl
  });
}

async function waitForLocalReceiver(options: CliOptions, expectedDatabaseId?: string): Promise<void> {
  const deadline = Date.now() + 5000;
  let lastError = "";
  while (Date.now() < deadline) {
    const probe = await probeLocalReceiver(options, { expectedDatabaseId });
    if (probe.compatible) {
      return;
    }
    if (probe.reachable) {
      throw receiverIdentityConflict(options.port, probe.detail);
    }
    lastError = probe.detail;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Vital Agent Sync service did not become ready at ${localReceiverStatusEndpoint(options)} within 5 seconds. ${lastError}`);
}

function toServiceOptions(options: CliOptions): LaunchdServiceOptions {
  return {
    manager: options.serviceManager,
    mode: options.serviceMode,
    databasePath: options.databasePath,
    stateDir: options.stateDir,
    host: options.host,
    port: options.port,
    transport: options.transportId,
    serverUrl: options.serverUrl,
    relayUrl: options.relayUrl,
    pullIntervalSeconds: options.pullIntervalSeconds,
    tailscaleName: options.tailscaleName
  };
}

async function printServiceStatusDetails(status: VitalAgentServiceStatus, options: CliOptions): Promise<void> {
  const database = openVitalAgentDatabase({ path: options.databasePath });
  try {
    const health = getHealthStatus(database);
    const receiver = await probeLocalReceiver(options, { expectedDatabaseId: getDatabaseId(database) });
    console.log("Vital Agent Sync service");
    console.log(`Manager:   ${status.manager}`);
    console.log(`Label:     ${status.label}`);
    console.log(`Configured: ${status.configured ? "yes" : "no"}`);
    console.log(`Loaded:    ${status.loaded ? "yes" : "no"}`);
    console.log(`Receiver:  ${receiver.compatible ? "verified" : receiver.reachable ? "identity mismatch" : "not reachable"} (${receiver.detail})`);
    console.log(`Config:    ${status.configPath}`);
    console.log(`Local API: http://127.0.0.1:${options.port}`);
    console.log(`Database:  ${database.path}`);
    console.log(`Stdout:    ${status.stdoutPath}`);
    console.log(`Stderr:    ${status.stderrPath}`);
    console.log(`Last sync: ${health.last_sync_at ?? "never"}`);
    console.log("");
    if (!status.configured) {
      console.log("Next: run vitalmcp setup to configure and activate the receiver.");
    } else if (!status.loaded) {
      console.log("Next: run vitalmcp service start outside an Agent sandbox, then vitalmcp pair.");
    } else if (!receiver.compatible) {
      console.log(`Next: check vitalmcp logs and confirm port ${options.port} is not occupied by another process.`);
    } else {
      console.log("Next: run vitalmcp pair to print a new QR, or scan the browser QR at the Local API /pair page.");
    }
  } finally {
    database.close();
  }
}

function printServiceLogs(options: CliOptions): void {
  const stdout = readVitalAgentServiceLog({
    manager: options.serviceManager,
    databasePath: options.databasePath,
    stream: "stdout",
    lines: options.logLines
  });
  const stderr = readVitalAgentServiceLog({
    manager: options.serviceManager,
    databasePath: options.databasePath,
    stream: "stderr",
    lines: options.logLines
  });

  console.log(`Vital Agent Sync service logs (${options.logLines} lines)`);
  printLogSection("stdout", stdout);
  printLogSection("stderr", stderr);
}

function printLogSection(label: string, log: ReturnType<typeof readVitalAgentServiceLog>): void {
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
  console.log("  1. Scan the QR with Vital Agent.");
  console.log("  2. Confirm pairing, grant Health access, then run Sync in the app.");
  console.log(`  3. ${agent.reloadHint()}`);
  console.log("");
  console.log(`After the first sync, this terminal can close. The ${manager} background receiver keeps accepting iOS syncs.`);
  console.log("Useful commands:");
  console.log("  vitalmcp service status");
  console.log(`  vitalmcp doctor --agent ${agent.id}`);
  console.log("  vitalmcp logs");
  console.log("  vitalmcp pair");
  console.log("  vitalmcp service stop");
}

function runRelaySetup(options: CliOptions): void {
  const agentId = resolveSetupAgentId(options);
  const agent = getAgentAdapter(agentId);
  const mode = options.transportId === "relay" ? "hosted_relay" : "self_hosted_relay";
  const relayUrl = resolveDefaultRelayUrl({
    mode,
    relayUrl: options.relayUrl
  });
  const config = initializeRelayRuntime({
    stateDir: options.stateDir,
    relayUrl,
    relayApiToken: options.relayApiToken,
    agentName: options.agentName ?? defaultAgentName(agentId),
    mode
  });
  const onboarding = formatRelayOnboarding(config, { mode });

  console.log(`Setting up Vital Agent Sync relay for ${agent.displayName}`);
  printAgentAutoDetectSummary(options, agentId);
  if (agentId === "generic") {
    console.log("Agent config: generic MCP config will be printed on request.");
  } else {
    const agentInstall = agent.installMcp({
      databasePath: options.databasePath
    }, {
      hermesConfigPath: options.hermesConfigPath,
      openclawConfigPath: options.openclawConfigPath,
      workbuddyConfigPath: options.workbuddyConfigPath,
      workbuddyProjectPath: options.workbuddyProjectPath
    });
    console.log(`Agent config: ${agentInstall.message}`);
    if (agentInstall.backupPath) {
      console.log(`Agent backup: ${agentInstall.backupPath}`);
    }
  }

  const serviceOptions = {
    ...options,
    serviceMode: "relay_pull" as const,
    relayUrl: config.relay_url
  };
  const serviceStatus = installVitalAgentService(toServiceOptions(serviceOptions));
  startVitalAgentService(toServiceOptions(serviceOptions));
  console.log(`Relay pull service: installed for ${serviceStatus.manager}`);
  console.log(`Relay pull config:  ${serviceStatus.configPath}`);
  console.log(`Relay pull logs:    ${serviceStatus.stdoutPath}`);

  console.log("");
  console.log(`State: ${options.stateDir ?? "~/.vital-agent-sync"}`);
  console.log(`Relay: ${config.relay_url}`);
  console.log("");
  process.stdout.write(onboarding);
  console.log("Next:");
  if (mode === "self_hosted_relay") {
    console.log("  1. Run vitalmcp relay serve to start the self-hosted relay.");
    console.log("  2. Scan the onboarding QR from Vital Agent or a compatible mobile app.");
    console.log("  3. The background relay-pull service will decrypt synced envelopes into the local MCP database.");
  } else {
    console.log("  1. Scan the onboarding QR from Vital Agent or a compatible mobile app.");
    console.log("  2. The background relay-pull service will decrypt hosted relay envelopes into the local MCP database.");
  }
  console.log(`  4. ${agent.reloadHint()}`);
  console.log("  5. Use vitalmcp status and vitalmcp logs --mode relay-pull to inspect freshness.");
}

async function printRelayOnboarding(options: CliOptions): Promise<void> {
  const requestedMode = options.transportId === "relay" ? "hosted_relay" : "self_hosted_relay";
  const config = readRelayRuntimeConfig({ stateDir: options.stateDir });
  if (options.transportProvided && config.relay_mode !== requestedMode) {
    throw new Error(`Existing runtime uses ${config.relay_mode}; run vitalmcp setup to review and approve a transport change.`);
  }
  if (options.relayUrl && normalizeRelayUrlForMode(options.relayUrl, config.relay_mode) !== config.relay_url) {
    throw new Error("Existing runtime uses a different relay URL; run vitalmcp setup to review and approve the change.");
  }
  const mode = config.relay_mode;
  const artifact = await writeRelayOnboardingArtifact({
    config: { ...config, relay_mode: mode },
    stateDir: options.stateDir,
    format: options.onboardingFormat
  });
  if (options.outputFormat === "json") {
    printJson({
      schema_version: BOOTSTRAP_SCHEMA_VERSION,
      command: "print-onboarding",
      status: "awaiting_ios",
      next_action: {
        type: "open_local_onboarding",
        url: artifact.local_url
      },
      details: {
        format: artifact.format,
        relay_mode: mode,
        relay_url: config.relay_url,
        sensitive_local_artifact: true
      }
    } satisfies BootstrapOutput);
    return;
  }
  console.log("Vital Agent Sync relay onboarding is ready.");
  console.log(`Open this local credential-bearing page: ${artifact.local_url}`);
  console.log("Do not upload, paste, or attach this page in an Agent chat.");
}

async function runRelayPull(options: CliOptions): Promise<void> {
  do {
    const result = await pullRelayEnvelopes({
      stateDir: options.stateDir,
      databasePath: options.databasePath,
      relayUrl: options.relayUrl,
      relayApiToken: options.relayApiToken
    });
    console.log("Vital Agent Sync relay pull complete");
    console.log(`Fetched:         ${result.fetched}`);
    console.log(`Ingested:        ${result.ingested}`);
    console.log(`Acked:           ${result.acked}`);
    console.log(`Latest sequence: ${result.latest_sequence}`);
    if (!options.pullWatch) {
      return;
    }
    console.log(`Next pull in ${options.pullIntervalSeconds} seconds.`);
    await new Promise((resolve) => setTimeout(resolve, options.pullIntervalSeconds * 1000));
  } while (options.pullWatch);
}

async function runRelayCommand(options: CliOptions): Promise<void> {
  const action = options.relayAction ?? "serve";
  if (action === "unlink" || action === "rotate" || action === "reset" || action === "migrate") {
    if (!options.yes) {
      throw new Error(`relay ${action} changes relay credentials or connectivity. Re-run with --yes after reviewing the lifecycle documentation.`);
    }
    const lifecycleOptions = {
      stateDir: options.stateDir,
      relayUrl: options.relayUrl,
      relayApiToken: options.relayApiToken,
      databasePath: options.databasePath
    };
    if (action === "migrate" && !options.relayUrl) {
      throw new Error("relay migrate requires --relay-url with the target hosted or self-hosted relay URL.");
    }
    const result = action === "unlink"
      ? await unlinkRelaySourceDevice(lifecycleOptions)
      : action === "rotate"
        ? await rotateRelayRuntime(lifecycleOptions)
        : action === "reset"
          ? await resetRelayRuntime(lifecycleOptions)
          : await migrateRelayRuntime({
              stateDir: options.stateDir,
              databasePath: options.databasePath,
              targetRelayUrl: options.relayUrl!,
              targetRelayApiToken: options.relayApiToken ?? process.env.VITALMCP_RELAY_API_TOKEN,
              targetMode: options.transportId === "self_hosted_relay" ? "self_hosted_relay" : "hosted_relay"
            });
    console.log(`Vital Agent Sync relay ${result.action} complete`);
    console.log(`Relay:      ${result.relay_url}`);
    console.log(`User:       ${result.user_id}`);
    console.log(`Device:     ${result.source_device_id}`);
    console.log(`Purged:     ${result.purged}`);
    console.log("Onboarding: required in the Vital Agent app");
    if (action !== "unlink") {
      console.log("Next: run vitalmcp print-onboarding and reconnect the iOS app.");
    } else {
      console.log("Next: run vitalmcp relay rotate --yes before reconnecting this device.");
    }
    return;
  }
  if (action === "status") {
    const local = getRelayLocalStatus({ stateDir: options.stateDir });
    const config = readRelayRuntimeConfig({ stateDir: options.stateDir });
    const relayUrl = normalizeRelayUrlForMode(options.relayUrl ?? local.relay_url ?? config.relay_url, config.relay_mode);
    const response = await fetch(`${relayUrl}/v1/status`, {
      signal: AbortSignal.timeout(1500)
    });
    if (!response.ok) {
      throw new Error(`Relay returned HTTP ${response.status} from /v1/status.`);
    }
    console.log(JSON.stringify({
      local,
      remote: await response.json()
    }, null, 2));
    return;
  }
  if (action === "fixture") {
    const config = initializeRelayRuntime({
      stateDir: options.stateDir,
      relayUrl: options.relayUrl,
      relayApiToken: options.relayApiToken,
      agentName: options.agentName ?? defaultAgentName(options.agentId),
      mode: options.transportId === "relay" ? "hosted_relay" : "self_hosted_relay"
    });
    const envelope = buildRelayFixtureEnvelope({
      config,
      options: {
        date: options.fixtureDate,
        steps: options.fixtureSteps,
        sleepMinutes: options.fixtureSleepMinutes,
        activeEnergyKcal: options.fixtureActiveEnergyKcal,
        sequence: options.fixtureSequence,
        syncId: options.fixtureSyncId,
        generatedAt: options.fixtureGeneratedAt,
        createdAt: options.fixtureCreatedAt,
        timezone: options.fixtureTimezone
      }
    });
    console.log(JSON.stringify(envelope, null, 2));
    return;
  }
  if (action === "audit") {
    if (options.relayAuditActive && !options.yes) {
      throw new Error("relay audit --active creates and revokes disposable relay identities. Re-run with --yes after reviewing the hosted runbook.");
    }
    const local = getRelayLocalStatus({ stateDir: options.stateDir });
    const relayUrl = options.relayUrl ?? local.relay_url ?? readRelayRuntimeConfig({ stateDir: options.stateDir }).relay_url;
    const result = await auditRelayDeployment({
      relayUrl,
      metricsToken: options.relayMetricsToken ?? process.env.VITALMCP_RELAY_METRICS_TOKEN,
      relayApiToken: options.relayApiToken ?? process.env.VITALMCP_RELAY_API_TOKEN,
      active: options.relayAuditActive
    });
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) {
      process.exitCode = 1;
    }
    return;
  }

  const serveOptions = resolveRelayServeConfig(options);
  await startRelayServer({
    host: serveOptions.host,
    port: serveOptions.port,
    databasePath: serveOptions.databasePath,
    retentionMs: serveOptions.retentionDays * 24 * 60 * 60 * 1000,
    maxEnvelopeBytes: serveOptions.maxEnvelopeBytes,
    maxUploadsPerMinute: serveOptions.maxUploadsPerMinute,
    maxQueuedEnvelopesPerUser: serveOptions.maxQueuedEnvelopesPerUser,
    maxDevicesPerUser: serveOptions.maxDevicesPerUser,
    trustProxy: serveOptions.trustProxy,
    apiToken: serveOptions.apiToken,
    metricsToken: serveOptions.metricsToken
  });
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
  const database = openVitalAgentDatabase({ path: options.databasePath });
  try {
    const status = getHealthStatus(database);
    const sourceDevices = listSourceDevices(database);
    const relay = getRelayLocalStatus({ stateDir: options.stateDir });
    const bootstrap = readBootstrapState({ stateDir: options.stateDir });
    if (options.outputFormat === "json") {
      printJson({
        schema_version: BOOTSTRAP_SCHEMA_VERSION,
        command: "status",
        status: bootstrap?.status ?? (status.sync_count > 0 ? "complete" : "awaiting_ios"),
        setup_id: bootstrap?.setup_id,
        current_stage: bootstrap?.current_stage,
        completed_stages: bootstrap?.completed_stages,
        next_action: status.sync_count > 0
          ? { type: "ask_agent", suggested_prompt: "How am I doing today?" }
          : { type: "sync_ios", url: bootstrap?.onboarding_url },
        freshness: {
          source_count: status.device_count,
          sync_count: status.sync_count,
          last_sync_at: status.last_sync_at,
          relay_last_pull_at: relay.last_successful_pull_at
        },
        details: {
          transport: relay.transport_mode,
          relay_initialized: relay.initialized,
          source_devices: sourceDevices.map((device) => ({
            id: device.source_device_id,
            platform: device.platform,
            state: device.revoked_at ? "revoked" : "active",
            sync_count: device.sync_count,
            last_sync_at: device.last_sync_at
          }))
        }
      } satisfies BootstrapOutput);
      return;
    }
    console.log("Vital Agent Sync runtime status");
    console.log(`Database:   ${database.path}`);
    console.log(`Sources:    ${status.device_count}`);
    console.log(`Syncs:      ${status.sync_count}`);
    console.log(`Last sync:  ${status.last_sync_at ?? "never"}`);
    console.log(`Transport:  ${relay.transport_mode}`);
    if (relay.initialized) {
      console.log(`Relay:      ${relay.relay_url}`);
      console.log(`Last pull:  ${relay.last_successful_pull_at ?? "never"}`);
      if (relay.last_error) {
        console.log(`Pull error: ${relay.last_error}`);
      }
      console.log(`Next:       ${relay.suggested_next_action}`);
    }
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

  try {
    const runtime = readRuntimeMetadata();
    results.push({
      status: runtime && runtimeMetadataPathsExist(runtime) && runtimeMetadataMatchesCurrentProcess(runtime) ? "OK" : "WARN",
      label: "Pinned runtime",
      detail: runtime
        ? `${runtime.node_path} ${runtime.node_version} ABI ${runtime.modules_abi}; metadata ${getRuntimeMetadataPath()}`
        : `not recorded; run vitalmcp setup from the trusted Agent runtime (${getRuntimeMetadataPath()})`
    });
  } catch (error) {
    results.push({
      status: "FAIL",
      label: "Pinned runtime",
      detail: error instanceof Error ? error.message : String(error)
    });
  }

  let databasePath = options.databasePath ?? "";
  try {
    const database = openVitalAgentDatabase({ path: options.databasePath });
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
    const mcp = buildVitalAgentMcpServerConfig({ databasePath: options.databasePath });
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
    openclawConfigPath: options.openclawConfigPath,
    workbuddyConfigPath: options.workbuddyConfigPath,
    workbuddyProjectPath: options.workbuddyProjectPath
  });
  const setupState = readBootstrapState({ stateDir: options.stateDir });
  const workBuddyMcpVerified = options.agentId === "workbuddy" &&
    setupState?.config.agent_id === "workbuddy" &&
    bootstrapStageComplete(setupState, "mcp_verified");
  results.push({
    status: agentStatus.installed || workBuddyMcpVerified ? "OK" : "WARN",
    label: `${agent.displayName} adapter`,
    detail: workBuddyMcpVerified
      ? `vital-agent-sync MCP is registered and native tool verification is recorded for setup ${setupState?.setup_id}`
      : agentStatus.detail
  });

  const serviceStatus = getVitalAgentServiceStatus(toServiceOptions(options));
  results.push({
    status: serviceStatus.loaded ? "OK" : "WARN",
    label: `${serviceStatus.manager} service`,
    detail: serviceStatus.configured
      ? `${serviceStatus.loaded ? "configured and loaded" : "configured but not loaded"} (${serviceStatus.configPath})`
      : serviceStatus.detail ?? `not configured (${serviceStatus.configPath})`
  });

  const receiverStatus = await checkLocalReceiver(options);
  results.push(receiverStatus);

  const relayStatus = getRelayLocalStatus({ stateDir: options.stateDir });
  results.push({
    status: relayStatus.last_error ? "WARN" : options.transportId === "relay" || options.transportId === "self_hosted_relay"
      ? relayStatus.initialized ? "OK" : "WARN"
      : "OK",
    label: "Relay runtime",
    detail: relayStatus.initialized
      ? `${relayStatus.transport_mode} ${relayStatus.relay_url} last pull ${relayStatus.last_successful_pull_at ?? "never"}. ${relayStatus.suggested_next_action}`
      : relayStatus.suggested_next_action
  });
  if (relayStatus.initialized) {
    try {
      const relayConfig = readRelayRuntimeConfig({ stateDir: options.stateDir });
      const issues = validateRelayRuntimeState(relayConfig);
      results.push({
        status: issues.length === 0 ? "OK" : "FAIL",
        label: "Relay keys and credentials",
        detail: issues.length === 0 ? "private keys match configured public keys; relay credentials are valid" : issues.join("; ")
      });
    } catch (error) {
      results.push({
        status: "FAIL",
        label: "Relay keys and credentials",
        detail: error instanceof Error ? error.message : String(error)
      });
    }
  }

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

  const hasFailure = results.some((result) => result.status === "FAIL");
  if (options.outputFormat === "json") {
    printJson({
      schema_version: BOOTSTRAP_SCHEMA_VERSION,
      command: "doctor",
      status: hasFailure ? "failed" : "complete",
      details: {
        checks: results
      },
      error: hasFailure ? {
        code: "doctor_failed",
        message: "One or more Vital Agent Sync diagnostic checks failed."
      } : undefined
    } satisfies BootstrapOutput);
  } else {
    console.log("Vital Agent Sync doctor");
    for (const result of results) {
      console.log(`[${result.status}] ${result.label}: ${result.detail}`);
    }
  }

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
    status: probe.compatible ? "OK" : probe.reachable ? "FAIL" : "WARN",
    label: "Local receiver",
    detail: probe.detail
  };
}

type ReceiverProbeResult = {
  reachable: boolean;
  compatible: boolean;
  detail: string;
  status?: ReceiverRuntimeStatus;
};

async function probeLocalReceiver(
  options: CliOptions,
  validation: { expectedDatabaseId?: string } = {}
): Promise<ReceiverProbeResult> {
  const endpoint = localReceiverStatusEndpoint(options);
  try {
    const response = await fetch(endpoint, {
      signal: AbortSignal.timeout(1500)
    });
    if (!response.ok) {
      return {
        reachable: true,
        compatible: false,
        detail: `${endpoint} returned HTTP ${response.status}; the listener is not a compatible Vital Agent Sync ${VITALMCP_RUNTIME_VERSION} receiver`
      };
    }
    const body = await response.json() as unknown;
    const status = parseCompatibleReceiverRuntimeStatus(body, validation);
    if (!status) {
      return {
        reachable: true,
        compatible: false,
        detail: `${endpoint} responded, but its product, runtime, protocol, or database identity does not match this installation`
      };
    }
    return {
      reachable: true,
      compatible: true,
      status,
      detail: `${endpoint} verified (${status.device_count} source devices, ${status.sync_count} syncs, last sync ${status.last_sync_at ?? "never"})`
    };
  } catch (error) {
    const listener = describePortListeners(options.port);
    const listenerDetail = listener ? ` Listener on port ${options.port}: ${listener}.` : "";
    return {
      reachable: listener !== undefined,
      compatible: false,
      detail: `${endpoint} is not reachable. Run vitalmcp service start or vitalmcp setup.${listenerDetail} ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

function localReceiverStatusEndpoint(options: Pick<CliOptions, "port">): string {
  return `http://127.0.0.1:${options.port}/runtime/status`;
}

async function requireCompatibleLocalReceiver(options: CliOptions, expectedDatabaseId?: string): Promise<ReceiverRuntimeStatus> {
  const probe = await probeLocalReceiver(options, { expectedDatabaseId });
  if (!probe.compatible || !probe.status) {
    if (probe.reachable) {
      throw receiverIdentityConflict(options.port, probe.detail);
    }
    throw new Error(probe.detail);
  }
  return probe.status;
}

function receiverIdentityConflict(port: number, detail: string): Error {
  return new Error([
    `Receiver identity conflict on port ${port}: ${detail}.`,
    "Vital Agent Sync will not stop another service, migrate a legacy database, or reuse an unverified receiver automatically.",
    `Inspect the listener with: lsof -nP -iTCP:${port} -sTCP:LISTEN`,
    "If it is a legacy HealthLink installation, back it up and choose an explicit migration or removal path before retrying.",
    "To keep the existing service, rerun setup with --port <free-port> and pair the iPhone with the new receiver."
  ].join(" "));
}

main().catch((error: unknown) => {
  const outputIndex = process.argv.indexOf("--output");
  if (outputIndex >= 0 && process.argv[outputIndex + 1] === "json") {
    printJson({
      schema_version: BOOTSTRAP_SCHEMA_VERSION,
      command: process.argv[2] ?? "unknown",
      status: "failed",
      error: {
        code: classifyBootstrapError(error),
        message: safeErrorMessage(error)
      }
    });
    process.exitCode = 1;
    return;
  }
  console.error(formatCliError(error));
  process.exitCode = 1;
});

function formatCliError(error: unknown): string {
  const message = safeErrorMessage(error);
  if (message.includes("EADDRINUSE")) {
    const portMatch = message.match(/:(\d+)\b/);
    const port = portMatch?.[1] ?? "8787";
    const portNumber = Number(port);
    const listener = describePortListeners(Number.isInteger(portNumber) ? portNumber : 8787);
    return [
      `Vital Agent Sync runtime failed: ${message}`,
      "",
      `Port ${port} is already in use.`,
      listener ? `Current listener: ${listener}` : "Current listener: could not be identified automatically.",
      `Check the process with: lsof -nP -iTCP:${port} -sTCP:LISTEN`,
      "If it is an old foreground receiver, stop it with Ctrl-C and retry.",
      "If the background service is already running, use: vitalmcp pair"
    ].join("\n");
  }
  if (message.includes("did not become ready")) {
    return [
      `Vital Agent Sync runtime failed: ${message}`,
      "",
      "Check service status with: vitalmcp service status",
      "Check daemon logs with: vitalmcp logs",
      "If port 8787 is occupied, stop the old receiver or rerun with --port <free-port>."
    ].join("\n");
  }
  return `Vital Agent Sync runtime failed: ${message}`;
}
