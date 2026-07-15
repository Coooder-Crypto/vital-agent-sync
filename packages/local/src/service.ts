import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getDefaultDatabasePath } from "./database.js";
import type { TransportProviderId } from "./transports.js";

export const VITALMCP_LAUNCHD_LABEL = "com.vitalmcp.local";
export const VITALMCP_SYSTEMD_UNIT = "vitalmcp.service";
export const VITALMCP_RELAY_PULL_LAUNCHD_LABEL = "com.vitalmcp.local.relay-pull";
export const VITALMCP_RELAY_PULL_SYSTEMD_UNIT = "vitalmcp-relay-pull.service";

export type ServiceManagerId = "auto" | "launchd" | "systemd" | "manual";
export type VitalAgentServiceMode = "receiver" | "relay_pull";

export type LaunchdServiceOptions = {
  homeDir?: string;
  cliCommand?: string;
  manager?: ServiceManagerId;
  platform?: NodeJS.Platform;
  mode?: VitalAgentServiceMode;
  databasePath?: string;
  stateDir?: string;
  host: string;
  port: number;
  transport: TransportProviderId;
  serverUrl?: string;
  relayUrl?: string;
  tailscaleName?: string;
  pullIntervalSeconds?: number;
};

export type VitalAgentServicePaths = {
  manager: Exclude<ServiceManagerId, "auto">;
  mode: VitalAgentServiceMode;
  configPath: string;
  plistPath: string;
  logDir: string;
  stdoutPath: string;
  stderrPath: string;
  databasePath: string;
};

export type VitalAgentServiceStatus = VitalAgentServicePaths & {
  label: string;
  installed: boolean;
  running: boolean;
  detail?: string;
};

export type VitalAgentServiceLog = {
  path: string;
  exists: boolean;
  content: string;
};

export function isServiceManagerId(value: string): value is ServiceManagerId {
  return value === "auto" || value === "launchd" || value === "systemd" || value === "manual";
}

export function resolveServiceManagerId(options: Pick<LaunchdServiceOptions, "manager" | "platform"> = {}): Exclude<ServiceManagerId, "auto"> {
  if (options.manager && options.manager !== "auto") {
    return options.manager;
  }
  const platform = options.platform ?? process.platform;
  if (platform === "darwin") {
    return "launchd";
  }
  if (platform === "linux") {
    return "systemd";
  }
  return "manual";
}

export function getLaunchdServicePaths(options: Pick<LaunchdServiceOptions, "homeDir" | "databasePath" | "mode"> = {}): VitalAgentServicePaths {
  const home = options.homeDir ?? homedir();
  const vitalAgentSyncDir = join(home, ".vital-agent-sync");
  const logDir = join(vitalAgentSyncDir, "logs");
  const mode = options.mode ?? "receiver";
  const label = serviceLaunchdLabel(mode);
  const logPrefix = mode === "relay_pull" ? "relay-pull" : "daemon";
  return {
    manager: "launchd",
    mode,
    configPath: join(home, "Library", "LaunchAgents", `${label}.plist`),
    plistPath: join(home, "Library", "LaunchAgents", `${label}.plist`),
    logDir,
    stdoutPath: join(logDir, `${logPrefix}.out.log`),
    stderrPath: join(logDir, `${logPrefix}.err.log`),
    databasePath: resolveHomePath(options.databasePath ?? getDefaultDatabasePath(), home)
  };
}

export function getSystemdServicePaths(options: Pick<LaunchdServiceOptions, "homeDir" | "databasePath" | "mode"> = {}): VitalAgentServicePaths {
  const home = options.homeDir ?? homedir();
  const vitalAgentSyncDir = join(home, ".vital-agent-sync");
  const logDir = join(vitalAgentSyncDir, "logs");
  const mode = options.mode ?? "receiver";
  const unit = serviceSystemdUnit(mode);
  const unitPath = join(home, ".config", "systemd", "user", unit);
  return {
    manager: "systemd",
    mode,
    configPath: unitPath,
    plistPath: unitPath,
    logDir,
    stdoutPath: `journalctl --user -u ${unit}`,
    stderrPath: `journalctl --user -u ${unit}`,
    databasePath: resolveHomePath(options.databasePath ?? getDefaultDatabasePath(), home)
  };
}

export function buildLaunchdPlist(options: LaunchdServiceOptions): string {
  const paths = getLaunchdServicePaths(options);
  const args = buildServiceProgramArguments(options, paths.databasePath);
  const argumentXml = args.map((arg) => `    <string>${escapeXml(arg)}</string>`).join("\n");
  const label = serviceLaunchdLabel(options.mode ?? "receiver");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${label}</string>
  <key>ProgramArguments</key>
  <array>
${argumentXml}
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${escapeXml(paths.stdoutPath)}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(paths.stderrPath)}</string>
</dict>
</plist>
`;
}

export function buildSystemdUnit(options: LaunchdServiceOptions): string {
  const paths = getSystemdServicePaths(options);
  const command = buildServiceProgramArguments(options, paths.databasePath)
    .map(quoteSystemdArg)
    .join(" ");
  const description = options.mode === "relay_pull" ? "Vital Agent Sync Relay Puller" : "Vital Agent Sync Local Receiver";

  return `[Unit]
Description=${description}
After=network-online.target

[Service]
Type=simple
ExecStart=${command}
Restart=on-failure
RestartSec=3
WorkingDirectory=${quoteSystemdArg(options.homeDir ?? homedir())}

[Install]
WantedBy=default.target
`;
}

export function buildDaemonProgramArguments(options: LaunchdServiceOptions, databasePath = getLaunchdServicePaths(options).databasePath): string[] {
  return buildReceiverProgramArguments(options, databasePath);
}

export function buildServiceProgramArguments(options: LaunchdServiceOptions, databasePath = getLaunchdServicePaths(options).databasePath): string[] {
  return options.mode === "relay_pull"
    ? buildRelayPullProgramArguments(options, databasePath)
    : buildReceiverProgramArguments(options, databasePath);
}

function buildReceiverProgramArguments(options: LaunchdServiceOptions, databasePath: string): string[] {
  const args = [
    ...getDaemonCommandPrefix(options.cliCommand),
    "daemon",
    "--host",
    options.host,
    "--port",
    String(options.port),
    "--db",
    databasePath,
    "--transport",
    options.transport
  ];
  if (options.serverUrl) {
    args.push("--server-url", options.serverUrl);
  }
  if (options.tailscaleName) {
    args.push("--tailscale-name", options.tailscaleName);
  }
  return args;
}

export function buildRelayPullProgramArguments(options: LaunchdServiceOptions, databasePath = getLaunchdServicePaths(options).databasePath): string[] {
  const args = [
    ...getDaemonCommandPrefix(options.cliCommand),
    "pull",
    "--watch",
    "--interval-seconds",
    String(options.pullIntervalSeconds ?? 300),
    "--db",
    databasePath
  ];
  if (options.stateDir) {
    args.push("--state-dir", options.stateDir);
  }
  if (options.relayUrl) {
    args.push("--relay-url", options.relayUrl);
  }
  return args;
}

export function installLaunchdService(options: LaunchdServiceOptions): VitalAgentServiceStatus {
  assertMacOSLaunchd(options.platform);
  const paths = getLaunchdServicePaths(options);
  mkdirSync(dirname(paths.plistPath), { recursive: true });
  mkdirSync(paths.logDir, { recursive: true });
  writeFileSync(paths.plistPath, buildLaunchdPlist(options), "utf8");
  return getLaunchdServiceStatus(options);
}

export function startLaunchdService(options: LaunchdServiceOptions): VitalAgentServiceStatus {
  assertMacOSLaunchd(options.platform);
  const paths = getLaunchdServicePaths(options);
  const label = serviceLaunchdLabel(options.mode ?? "receiver");
  if (!existsSync(paths.plistPath)) {
    throw new Error(`Vital Agent Sync launchd service is not installed: ${paths.plistPath}`);
  }
  runLaunchctl(["bootstrap", launchdDomain(), paths.plistPath], { allowFailure: true });
  runLaunchctl(["kickstart", "-k", `${launchdDomain()}/${label}`], { allowFailure: true });
  return getLaunchdServiceStatus(options);
}

export function stopLaunchdService(options: LaunchdServiceOptions): VitalAgentServiceStatus {
  assertMacOSLaunchd(options.platform);
  runLaunchctl(["bootout", launchdDomain(), getLaunchdServicePaths(options).plistPath], { allowFailure: true });
  return getLaunchdServiceStatus(options);
}

export function uninstallLaunchdService(options: LaunchdServiceOptions): VitalAgentServiceStatus {
  assertMacOSLaunchd(options.platform);
  const paths = getLaunchdServicePaths(options);
  stopLaunchdService(options);
  if (existsSync(paths.plistPath)) {
    unlinkSync(paths.plistPath);
  }
  return getLaunchdServiceStatus(options);
}

export function installSystemdService(options: LaunchdServiceOptions): VitalAgentServiceStatus {
  assertLinuxSystemd();
  const paths = getSystemdServicePaths(options);
  const unit = serviceSystemdUnit(options.mode ?? "receiver");
  mkdirSync(dirname(paths.configPath), { recursive: true });
  mkdirSync(paths.logDir, { recursive: true });
  writeFileSync(paths.configPath, buildSystemdUnit(options), "utf8");
  runSystemctl(["--user", "daemon-reload"]);
  runSystemctl(["--user", "enable", unit]);
  return getSystemdServiceStatus(options);
}

export function startSystemdService(options: LaunchdServiceOptions): VitalAgentServiceStatus {
  assertLinuxSystemd();
  const paths = getSystemdServicePaths(options);
  const unit = serviceSystemdUnit(options.mode ?? "receiver");
  if (!existsSync(paths.configPath)) {
    throw new Error(`Vital Agent Sync systemd service is not installed: ${paths.configPath}`);
  }
  runSystemctl(["--user", "daemon-reload"], { allowFailure: true });
  runSystemctl(["--user", "start", unit]);
  return getSystemdServiceStatus(options);
}

export function stopSystemdService(options: LaunchdServiceOptions): VitalAgentServiceStatus {
  assertLinuxSystemd();
  runSystemctl(["--user", "stop", serviceSystemdUnit(options.mode ?? "receiver")], { allowFailure: true });
  return getSystemdServiceStatus(options);
}

export function uninstallSystemdService(options: LaunchdServiceOptions): VitalAgentServiceStatus {
  assertLinuxSystemd();
  const paths = getSystemdServicePaths(options);
  const unit = serviceSystemdUnit(options.mode ?? "receiver");
  stopSystemdService(options);
  runSystemctl(["--user", "disable", unit], { allowFailure: true });
  if (existsSync(paths.configPath)) {
    unlinkSync(paths.configPath);
  }
  runSystemctl(["--user", "daemon-reload"], { allowFailure: true });
  return getSystemdServiceStatus(options);
}

export function getLaunchdServiceStatus(options: Pick<LaunchdServiceOptions, "homeDir" | "databasePath" | "mode"> = {}): VitalAgentServiceStatus {
  const paths = getLaunchdServicePaths(options);
  const mode = options.mode ?? "receiver";
  return {
    label: serviceLaunchdLabel(mode),
    installed: existsSync(paths.plistPath),
    running: isLaunchdServiceRunning(mode),
    ...paths
  };
}

export function getSystemdServiceStatus(options: Pick<LaunchdServiceOptions, "homeDir" | "databasePath" | "mode"> = {}): VitalAgentServiceStatus {
  const paths = getSystemdServicePaths(options);
  const mode = options.mode ?? "receiver";
  return {
    label: serviceSystemdUnit(mode),
    installed: existsSync(paths.configPath),
    running: isSystemdServiceRunning(mode),
    ...paths
  };
}

export function getManualServiceStatus(options: Pick<LaunchdServiceOptions, "homeDir" | "databasePath" | "platform" | "mode"> = {}): VitalAgentServiceStatus {
  const home = options.homeDir ?? homedir();
  const vitalAgentSyncDir = join(home, ".vital-agent-sync");
  const logDir = join(vitalAgentSyncDir, "logs");
  const mode = options.mode ?? "receiver";
  return {
    manager: "manual",
    mode,
    label: "manual",
    installed: false,
    running: false,
    configPath: "manual",
    plistPath: "manual",
    logDir,
    stdoutPath: "manual daemon stdout",
    stderrPath: "manual daemon stderr",
    databasePath: resolveHomePath(options.databasePath ?? getDefaultDatabasePath(), home),
    detail: manualServiceMessage(options.platform)
  };
}

export function getVitalAgentServiceStatus(options: Pick<LaunchdServiceOptions, "homeDir" | "databasePath" | "manager" | "platform" | "mode"> = {}): VitalAgentServiceStatus {
  const manager = resolveServiceManagerId(options);
  if (manager === "launchd") {
    return getLaunchdServiceStatus(options);
  }
  if (manager === "systemd") {
    return getSystemdServiceStatus(options);
  }
  return getManualServiceStatus(options);
}

export function installVitalAgentService(options: LaunchdServiceOptions): VitalAgentServiceStatus {
  const manager = resolveServiceManagerId(options);
  if (manager === "launchd") {
    return installLaunchdService(options);
  }
  if (manager === "systemd") {
    return installSystemdService(options);
  }
  throw new Error(manualServiceMessage(options.platform));
}

export function startVitalAgentService(options: LaunchdServiceOptions): VitalAgentServiceStatus {
  const manager = resolveServiceManagerId(options);
  if (manager === "launchd") {
    return startLaunchdService(options);
  }
  if (manager === "systemd") {
    return startSystemdService(options);
  }
  throw new Error(manualServiceMessage(options.platform));
}

export function stopVitalAgentService(options: LaunchdServiceOptions): VitalAgentServiceStatus {
  const manager = resolveServiceManagerId(options);
  if (manager === "launchd") {
    return stopLaunchdService(options);
  }
  if (manager === "systemd") {
    return stopSystemdService(options);
  }
  throw new Error(manualServiceMessage(options.platform));
}

export function uninstallVitalAgentService(options: LaunchdServiceOptions): VitalAgentServiceStatus {
  const manager = resolveServiceManagerId(options);
  if (manager === "launchd") {
    return uninstallLaunchdService(options);
  }
  if (manager === "systemd") {
    return uninstallSystemdService(options);
  }
  throw new Error(manualServiceMessage(options.platform));
}

export function readLaunchdPlist(options: Pick<LaunchdServiceOptions, "homeDir" | "databasePath" | "mode"> = {}): string | undefined {
  const plistPath = getLaunchdServicePaths(options).plistPath;
  return existsSync(plistPath) ? readFileSync(plistPath, "utf8") : undefined;
}

export function readSystemdUnit(options: Pick<LaunchdServiceOptions, "homeDir" | "databasePath" | "mode"> = {}): string | undefined {
  const unitPath = getSystemdServicePaths(options).configPath;
  return existsSync(unitPath) ? readFileSync(unitPath, "utf8") : undefined;
}

export function readLaunchdServiceLog(options: Pick<LaunchdServiceOptions, "homeDir" | "databasePath" | "mode"> & {
  stream: "stdout" | "stderr";
  lines?: number;
}): VitalAgentServiceLog {
  const paths = getLaunchdServicePaths(options);
  const path = options.stream === "stdout" ? paths.stdoutPath : paths.stderrPath;
  if (!existsSync(path)) {
    return {
      path,
      exists: false,
      content: ""
    };
  }

  return {
    path,
    exists: true,
    content: tailLines(readFileSync(path, "utf8"), options.lines ?? 80)
  };
}

export function readVitalAgentServiceLog(options: Pick<LaunchdServiceOptions, "homeDir" | "databasePath" | "manager" | "platform" | "mode"> & {
  stream: "stdout" | "stderr";
  lines?: number;
}): VitalAgentServiceLog {
  const manager = resolveServiceManagerId(options);
  if (manager === "launchd") {
    return readLaunchdServiceLog(options);
  }
  if (manager === "systemd") {
    return readSystemdServiceLog(options);
  }
  return {
    path: "manual daemon stdout/stderr",
    exists: false,
    content: manualServiceMessage(options.platform)
  };
}

function isLaunchdServiceRunning(mode: VitalAgentServiceMode): boolean {
  if (process.platform !== "darwin") {
    return false;
  }
  try {
    execFileSync("launchctl", ["print", `${launchdDomain()}/${serviceLaunchdLabel(mode)}`], {
      stdio: ["ignore", "ignore", "ignore"]
    });
    return true;
  } catch {
    return false;
  }
}

function isSystemdServiceRunning(mode: VitalAgentServiceMode): boolean {
  if (process.platform !== "linux") {
    return false;
  }
  try {
    execFileSync("systemctl", ["--user", "is-active", "--quiet", serviceSystemdUnit(mode)], {
      stdio: ["ignore", "ignore", "ignore"]
    });
    return true;
  } catch {
    return false;
  }
}

function assertMacOSLaunchd(platform: NodeJS.Platform = process.platform): void {
  if (platform !== "darwin") {
    throw new Error("Vital Agent Sync service install/start/stop/uninstall currently supports macOS launchd only. Use vitalmcp daemon with systemd, Docker, PM2, or another process manager on remote hosts.");
  }
}

function assertLinuxSystemd(): void {
  if (process.platform !== "linux") {
    throw new Error("Vital Agent Sync systemd service management is only available on Linux. Use --manager launchd on macOS, or run vitalmcp daemon under your own process manager.");
  }
}

function runLaunchctl(args: string[], options: { allowFailure?: boolean } = {}): void {
  try {
    execFileSync("launchctl", args, {
      stdio: ["ignore", "pipe", "pipe"]
    });
  } catch (error) {
    if (!options.allowFailure) {
      throw error;
    }
  }
}

function runSystemctl(args: string[], options: { allowFailure?: boolean } = {}): void {
  try {
    execFileSync("systemctl", args, {
      stdio: ["ignore", "pipe", "pipe"]
    });
  } catch (error) {
    if (!options.allowFailure) {
      throw error;
    }
  }
}

function readSystemdServiceLog(options: { lines?: number; mode?: VitalAgentServiceMode }): VitalAgentServiceLog {
  const unit = serviceSystemdUnit(options.mode ?? "receiver");
  const path = `journalctl --user -u ${unit}`;
  try {
    const output = execFileSync("journalctl", ["--user", "-u", unit, "-n", String(options.lines ?? 80), "--no-pager"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
    return {
      path,
      exists: true,
      content: output.trimEnd()
    };
  } catch (error) {
    return {
      path,
      exists: false,
      content: error instanceof Error ? error.message : String(error)
    };
  }
}

function serviceLaunchdLabel(mode: VitalAgentServiceMode): string {
  return mode === "relay_pull" ? VITALMCP_RELAY_PULL_LAUNCHD_LABEL : VITALMCP_LAUNCHD_LABEL;
}

function serviceSystemdUnit(mode: VitalAgentServiceMode): string {
  return mode === "relay_pull" ? VITALMCP_RELAY_PULL_SYSTEMD_UNIT : VITALMCP_SYSTEMD_UNIT;
}

function launchdDomain(): string {
  return `gui/${typeof process.getuid === "function" ? process.getuid() : 501}`;
}

function getDaemonCommandPrefix(cliCommand?: string): string[] {
  if (cliCommand) {
    return [cliCommand];
  }
  const cliPath = getCliCommandPath();
  return cliPath === "vitalmcp" ? [cliPath] : [process.execPath, cliPath];
}

function getCliCommandPath(): string {
  const currentFile = fileURLToPath(import.meta.url);
  if (currentFile.endsWith("/dist/service.js")) {
    return resolve(dirname(currentFile), "cli.js");
  }
  return "vitalmcp";
}

function resolveHomePath(path: string, home: string): string {
  if (path === "~") {
    return home;
  }
  if (path.startsWith("~/")) {
    return join(home, path.slice(2));
  }
  return path;
}

function manualServiceMessage(platform = process.platform): string {
  if (platform === "win32") {
    return "Windows background service installation is not implemented yet. Run vitalmcp daemon manually, use Docker/PM2, or wait for Task Scheduler/Windows Service support.";
  }
  return "No native background service manager is available for this platform. Run vitalmcp daemon manually or use systemd, Docker, PM2, or another process manager.";
}

function quoteSystemdArg(value: string): string {
  if (/^[A-Za-z0-9_@%+=:,./~-]+$/.test(value)) {
    return value;
  }
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function tailLines(value: string, lines: number): string {
  const count = Math.max(1, Math.min(Math.floor(lines), 1000));
  const normalized = value.trimEnd();
  if (normalized.length === 0) {
    return "";
  }
  const allLines = normalized.split(/\r?\n/);
  return allLines.slice(-count).join("\n");
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
