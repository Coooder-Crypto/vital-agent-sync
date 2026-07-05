import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getDefaultDatabasePath } from "./database.js";
import type { TransportProviderId } from "./transports.js";

export const HEALTHLINK_LAUNCHD_LABEL = "com.healthlink.local";

export type LaunchdServiceOptions = {
  homeDir?: string;
  cliCommand?: string;
  databasePath?: string;
  host: string;
  port: number;
  transport: TransportProviderId;
  serverUrl?: string;
  tailscaleName?: string;
};

export type HealthLinkServicePaths = {
  plistPath: string;
  logDir: string;
  stdoutPath: string;
  stderrPath: string;
  databasePath: string;
};

export type HealthLinkServiceStatus = HealthLinkServicePaths & {
  label: string;
  installed: boolean;
  running: boolean;
};

export function getLaunchdServicePaths(options: Pick<LaunchdServiceOptions, "homeDir" | "databasePath"> = {}): HealthLinkServicePaths {
  const home = options.homeDir ?? homedir();
  const healthlinkDir = join(home, ".healthlink");
  const logDir = join(healthlinkDir, "logs");
  return {
    plistPath: join(home, "Library", "LaunchAgents", `${HEALTHLINK_LAUNCHD_LABEL}.plist`),
    logDir,
    stdoutPath: join(logDir, "daemon.out.log"),
    stderrPath: join(logDir, "daemon.err.log"),
    databasePath: resolveHomePath(options.databasePath ?? getDefaultDatabasePath(), home)
  };
}

export function buildLaunchdPlist(options: LaunchdServiceOptions): string {
  const paths = getLaunchdServicePaths(options);
  const args = buildDaemonProgramArguments(options, paths.databasePath);
  const argumentXml = args.map((arg) => `    <string>${escapeXml(arg)}</string>`).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${HEALTHLINK_LAUNCHD_LABEL}</string>
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

export function buildDaemonProgramArguments(options: LaunchdServiceOptions, databasePath = getLaunchdServicePaths(options).databasePath): string[] {
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

export function installLaunchdService(options: LaunchdServiceOptions): HealthLinkServiceStatus {
  assertMacOSLaunchd();
  const paths = getLaunchdServicePaths(options);
  mkdirSync(dirname(paths.plistPath), { recursive: true });
  mkdirSync(paths.logDir, { recursive: true });
  writeFileSync(paths.plistPath, buildLaunchdPlist(options), "utf8");
  return getLaunchdServiceStatus(options);
}

export function startLaunchdService(options: LaunchdServiceOptions): HealthLinkServiceStatus {
  assertMacOSLaunchd();
  const paths = getLaunchdServicePaths(options);
  if (!existsSync(paths.plistPath)) {
    throw new Error(`HealthLink launchd service is not installed: ${paths.plistPath}`);
  }
  runLaunchctl(["bootstrap", launchdDomain(), paths.plistPath], { allowFailure: true });
  runLaunchctl(["kickstart", "-k", `${launchdDomain()}/${HEALTHLINK_LAUNCHD_LABEL}`], { allowFailure: true });
  return getLaunchdServiceStatus(options);
}

export function stopLaunchdService(options: LaunchdServiceOptions): HealthLinkServiceStatus {
  assertMacOSLaunchd();
  runLaunchctl(["bootout", launchdDomain(), getLaunchdServicePaths(options).plistPath], { allowFailure: true });
  return getLaunchdServiceStatus(options);
}

export function uninstallLaunchdService(options: LaunchdServiceOptions): HealthLinkServiceStatus {
  assertMacOSLaunchd();
  const paths = getLaunchdServicePaths(options);
  stopLaunchdService(options);
  if (existsSync(paths.plistPath)) {
    unlinkSync(paths.plistPath);
  }
  return getLaunchdServiceStatus(options);
}

export function getLaunchdServiceStatus(options: Pick<LaunchdServiceOptions, "homeDir" | "databasePath"> = {}): HealthLinkServiceStatus {
  const paths = getLaunchdServicePaths(options);
  return {
    label: HEALTHLINK_LAUNCHD_LABEL,
    installed: existsSync(paths.plistPath),
    running: isLaunchdServiceRunning(),
    ...paths
  };
}

export function readLaunchdPlist(options: Pick<LaunchdServiceOptions, "homeDir" | "databasePath"> = {}): string | undefined {
  const plistPath = getLaunchdServicePaths(options).plistPath;
  return existsSync(plistPath) ? readFileSync(plistPath, "utf8") : undefined;
}

function isLaunchdServiceRunning(): boolean {
  if (process.platform !== "darwin") {
    return false;
  }
  try {
    execFileSync("launchctl", ["print", `${launchdDomain()}/${HEALTHLINK_LAUNCHD_LABEL}`], {
      stdio: ["ignore", "ignore", "ignore"]
    });
    return true;
  } catch {
    return false;
  }
}

function assertMacOSLaunchd(): void {
  if (process.platform !== "darwin") {
    throw new Error("HealthLink service install/start/stop/uninstall currently supports macOS launchd only. Use healthlink-local daemon with systemd, Docker, PM2, or another process manager on remote hosts.");
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

function launchdDomain(): string {
  return `gui/${typeof process.getuid === "function" ? process.getuid() : 501}`;
}

function getDaemonCommandPrefix(cliCommand?: string): string[] {
  if (cliCommand) {
    return [cliCommand];
  }
  const cliPath = getCliCommandPath();
  return cliPath === "healthlink-local" ? [cliPath] : [process.execPath, cliPath];
}

function getCliCommandPath(): string {
  const currentFile = fileURLToPath(import.meta.url);
  if (currentFile.endsWith("/dist/service.js")) {
    return resolve(dirname(currentFile), "cli.js");
  }
  return "healthlink-local";
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

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
