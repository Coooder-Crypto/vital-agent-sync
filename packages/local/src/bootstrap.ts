import { randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import type { AgentAdapterId } from "./agents.js";
import type { ServiceManagerId } from "./service.js";
import type { TransportProviderId } from "./transports.js";

export const BOOTSTRAP_SCHEMA_VERSION = 1 as const;

export const BOOTSTRAP_STAGES = [
  "environment_checked",
  "plan_created",
  "consent_received",
  "runtime_initialized",
  "agent_configured",
  "service_installed",
  "service_started",
  "onboarding_created",
  "first_sync_observed",
  "complete"
] as const;

export type BootstrapStage = typeof BOOTSTRAP_STAGES[number];
export type BootstrapStatus =
  | "planning"
  | "awaiting_consent"
  | "running"
  | "awaiting_ios"
  | "awaiting_first_sync"
  | "complete"
  | "failed";

export type BootstrapConfig = {
  agent_id: AgentAdapterId;
  transport_id: TransportProviderId;
  service_manager: ServiceManagerId;
  service_mode: "receiver" | "relay_pull";
  host: string;
  port: number;
  pull_interval_seconds: number;
  install_skill: boolean;
  database_path?: string;
  server_url?: string;
  relay_url?: string;
  state_dir?: string;
  tailscale_name?: string;
  agent_name?: string;
  hermes_config_path?: string;
  hermes_skill_path?: string;
  openclaw_config_path?: string;
  workbuddy_config_path?: string;
  workbuddy_project_path?: string;
};

export type BootstrapPlanItem = {
  id: string;
  description: string;
  persistent_change: boolean;
};

export type BootstrapState = {
  schema_version: typeof BOOTSTRAP_SCHEMA_VERSION;
  setup_id: string;
  status: BootstrapStatus;
  current_stage: BootstrapStage;
  completed_stages: BootstrapStage[];
  config: BootstrapConfig;
  plan: BootstrapPlanItem[];
  created_at: string;
  updated_at: string;
  initial_sync_count?: number;
  onboarding_url?: string;
  last_error_code?: string;
  last_error_message?: string;
};

export type BootstrapNextAction = {
  type: "confirm" | "open_local_onboarding" | "sync_ios" | "ask_agent" | "retry";
  command?: string;
  url?: string;
  suggested_prompt?: string;
};

export type BootstrapOutput = {
  schema_version: typeof BOOTSTRAP_SCHEMA_VERSION;
  command: "setup" | "status" | "print-onboarding" | "doctor";
  status: BootstrapStatus;
  setup_id?: string;
  current_stage?: BootstrapStage;
  completed_stages?: BootstrapStage[];
  plan?: BootstrapPlanItem[];
  next_action?: BootstrapNextAction;
  freshness?: {
    source_count: number;
    sync_count: number;
    last_sync_at: string | null;
    relay_last_pull_at?: string | null;
  };
  details?: Record<string, unknown>;
  error?: {
    code: string;
    message: string;
  };
};

export type BootstrapWorkflowActions = {
  runtime_initialized: () => Promise<void> | void;
  agent_configured: () => Promise<void> | void;
  service_installed: () => Promise<void> | void;
  service_started: () => Promise<void> | void;
  onboarding_created: () => Promise<{ onboarding_url: string }> | { onboarding_url: string };
  first_sync_observed: () => Promise<boolean> | boolean;
};

const bootstrapConfigSchema = z.object({
  agent_id: z.enum(["generic", "hermes", "openclaw", "workbuddy"]),
  transport_id: z.enum(["lan", "tailscale", "cloudflare", "ngrok", "public_https", "relay", "self_hosted_relay"]),
  service_manager: z.enum(["auto", "launchd", "systemd", "manual"]),
  service_mode: z.enum(["receiver", "relay_pull"]),
  host: z.string().min(1),
  port: z.number().int().positive(),
  pull_interval_seconds: z.number().int().positive(),
  install_skill: z.boolean(),
  database_path: z.string().min(1).optional(),
  server_url: z.string().min(1).optional(),
  relay_url: z.string().min(1).optional(),
  state_dir: z.string().min(1).optional(),
  tailscale_name: z.string().min(1).optional(),
  agent_name: z.string().min(1).optional(),
  hermes_config_path: z.string().min(1).optional(),
  hermes_skill_path: z.string().min(1).optional(),
  openclaw_config_path: z.string().min(1).optional(),
  workbuddy_config_path: z.string().min(1).optional(),
  workbuddy_project_path: z.string().min(1).optional()
});

const bootstrapStateSchema = z.object({
  schema_version: z.literal(BOOTSTRAP_SCHEMA_VERSION),
  setup_id: z.string().regex(/^setup_[a-f0-9]{32}$/),
  status: z.enum(["planning", "awaiting_consent", "running", "awaiting_ios", "awaiting_first_sync", "complete", "failed"]),
  current_stage: z.enum(BOOTSTRAP_STAGES),
  completed_stages: z.array(z.enum(BOOTSTRAP_STAGES)),
  config: bootstrapConfigSchema,
  plan: z.array(z.object({
    id: z.string().min(1),
    description: z.string().min(1),
    persistent_change: z.boolean()
  })),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  initial_sync_count: z.number().int().nonnegative().optional(),
  onboarding_url: z.string().url().optional(),
  last_error_code: z.string().min(1).optional(),
  last_error_message: z.string().min(1).optional()
});

const sensitiveKeyPattern = /(?:private|secret|token|credential|authorization|ciphertext|envelope|payload|pairing_(?:code|url)|raw|sqlite_rows?)/i;
const sensitiveValuePattern = /-----BEGIN [^-]*PRIVATE KEY-----|vital-agent-e2ee-v1:|vitalmcp:\/\/onboard\?payload=|vitalmcp:\/\/pair\?|\b[A-Za-z0-9_-]{43}\b/i;

export function buildBootstrapPlan(config: BootstrapConfig): BootstrapPlanItem[] {
  const agentLabel = config.agent_id === "generic"
    ? "print generic MCP configuration"
    : config.agent_id === "workbuddy"
      ? `configure WorkBuddy MCP in ${config.workbuddy_config_path ?? (config.workbuddy_project_path
        ? join(config.workbuddy_project_path, ".workbuddy", "mcp.json")
        : "~/.workbuddy/mcp.json")}`
      : `configure ${config.agent_id} MCP`;
  const serviceLabel = config.service_mode === "relay_pull" ? "relay-pull" : "receiver";
  return [
    {
      id: "initialize_runtime",
      description: config.service_mode === "relay_pull"
        ? "Initialize or reuse the private Vital Agent Sync relay runtime and local database"
        : config.transport_id === "tailscale"
          ? "Initialize or reuse the private Vital Agent Sync local database and configure tailnet-only Tailscale Serve HTTPS"
          : "Initialize or reuse the private Vital Agent Sync local database",
      persistent_change: true
    },
    {
      id: "configure_agent",
      description: agentLabel,
      persistent_change: config.agent_id !== "generic"
    },
    {
      id: "install_service",
      description: `Install and start the ${serviceLabel} service with ${config.service_manager}`,
      persistent_change: true
    },
    {
      id: "create_onboarding",
      description: "Create one local credential-bearing onboarding action for the Vital Agent app",
      persistent_change: true
    },
    {
      id: "verify_first_sync",
      description: "Verify the first sync through the shared local database and MCP status",
      persistent_change: false
    }
  ];
}

export function createBootstrapState(config: BootstrapConfig, now = new Date()): BootstrapState {
  const timestamp = now.toISOString();
  return {
    schema_version: BOOTSTRAP_SCHEMA_VERSION,
    setup_id: `setup_${randomUUID().replaceAll("-", "")}`,
    status: "awaiting_consent",
    current_stage: "plan_created",
    completed_stages: ["environment_checked", "plan_created"],
    config,
    plan: buildBootstrapPlan(config),
    created_at: timestamp,
    updated_at: timestamp
  };
}

export function getBootstrapStatePath(options: { stateDir?: string; homeDir?: string } = {}): string {
  const home = options.homeDir ?? homedir();
  const stateDir = expandHome(options.stateDir ?? join(home, ".vital-agent-sync"), home);
  return join(stateDir, "setup", "state-v1.json");
}

export function readBootstrapState(options: { stateDir?: string; homeDir?: string } = {}): BootstrapState | undefined {
  const path = getBootstrapStatePath(options);
  if (!existsSync(path)) {
    return undefined;
  }
  return bootstrapStateSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

export function writeBootstrapState(state: BootstrapState, options: { stateDir?: string; homeDir?: string } = {}): BootstrapState {
  const parsed = bootstrapStateSchema.parse({
    ...state,
    updated_at: new Date().toISOString()
  });
  const path = getBootstrapStatePath(options);
  mkdirPrivate(dirname(path));
  const temporaryPath = `${path}.tmp-${process.pid}-${randomUUID()}`;
  writeFileSync(temporaryPath, `${JSON.stringify(parsed, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  chmodIfPossible(temporaryPath, 0o600);
  renameSync(temporaryPath, path);
  chmodIfPossible(path, 0o600);
  return parsed;
}

export function markBootstrapStage(
  state: BootstrapState,
  stage: BootstrapStage,
  options: { status?: BootstrapStatus; stateDir?: string; homeDir?: string } = {}
): BootstrapState {
  const completed = state.completed_stages.includes(stage)
    ? state.completed_stages
    : [...state.completed_stages, stage];
  return writeBootstrapState({
    ...state,
    status: options.status ?? state.status,
    current_stage: stage,
    completed_stages: completed,
    last_error_code: undefined,
    last_error_message: undefined
  }, options);
}

export function failBootstrapState(
  state: BootstrapState,
  error: unknown,
  options: { stateDir?: string; homeDir?: string } = {}
): BootstrapState {
  return writeBootstrapState({
    ...state,
    status: "failed",
    last_error_code: classifyBootstrapError(error),
    last_error_message: safeErrorMessage(error)
  }, options);
}

export function bootstrapStageComplete(state: BootstrapState, stage: BootstrapStage): boolean {
  return state.completed_stages.includes(stage);
}

export async function runBootstrapWorkflow(
  initialState: BootstrapState,
  actions: BootstrapWorkflowActions,
  options: { stateDir?: string; homeDir?: string } = {}
): Promise<BootstrapState> {
  let state = initialState;
  if (!bootstrapStageComplete(state, "consent_received")) {
    state = markBootstrapStage(state, "consent_received", { ...options, status: "running" });
  }

  for (const stage of ["runtime_initialized", "agent_configured", "service_installed", "service_started"] as const) {
    if (bootstrapStageComplete(state, stage)) continue;
    await actions[stage]();
    state = markBootstrapStage(state, stage, { ...options, status: "running" });
  }

  if (!bootstrapStageComplete(state, "onboarding_created")) {
    const artifact = await actions.onboarding_created();
    state = writeBootstrapState({
      ...state,
      status: "awaiting_first_sync",
      current_stage: "onboarding_created",
      completed_stages: [...state.completed_stages, "onboarding_created"],
      onboarding_url: artifact.onboarding_url
    }, options);
  }

  if (await actions.first_sync_observed()) {
    if (!bootstrapStageComplete(state, "first_sync_observed")) {
      state = markBootstrapStage(state, "first_sync_observed", { ...options, status: "running" });
    }
    if (!bootstrapStageComplete(state, "complete")) {
      state = markBootstrapStage(state, "complete", { ...options, status: "complete" });
    }
  } else if (state.status !== "awaiting_first_sync") {
    state = writeBootstrapState({ ...state, status: "awaiting_first_sync" }, options);
  }
  return state;
}

export async function withBootstrapLock<T>(
  options: { stateDir?: string; homeDir?: string },
  callback: () => Promise<T>
): Promise<T> {
  const statePath = getBootstrapStatePath(options);
  const lockPath = `${statePath}.lock`;
  mkdirPrivate(dirname(statePath));
  clearStaleLock(lockPath);
  let descriptor: number;
  try {
    descriptor = openSync(lockPath, "wx", 0o600);
  } catch (error) {
    if (isNodeError(error) && error.code === "EEXIST") {
      throw new Error("Another Vital Agent Sync setup is already running. Wait for it to finish, then run setup --resume.");
    }
    throw error;
  }
  try {
    writeFileSync(descriptor, `${process.pid}\n`, "utf8");
    return await callback();
  } finally {
    closeSync(descriptor);
    rmSync(lockPath, { force: true });
  }
}

export function sanitizeAgentOutput<T>(value: T): T {
  return sanitizeValue(value, new WeakSet()) as T;
}

export function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return sensitiveValuePattern.test(message) ? "Vital Agent Sync setup failed while handling sensitive local state. Run vitalmcp doctor for a redacted diagnosis." : message;
}

export function classifyBootstrapError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/another vital-agent-sync setup/i.test(message)) return "setup_locked";
  if (/consent|--yes/i.test(message)) return "consent_required";
  if (/relay.*url|https/i.test(message)) return "relay_url_invalid";
  if (/service.*ready|not reachable|connection/i.test(message)) return "service_unreachable";
  if (/agent|mcp|config/i.test(message)) return "agent_configuration_failed";
  return "setup_failed";
}

function sanitizeValue(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === "string") {
    return sensitiveValuePattern.test(value) ? "[REDACTED]" : value;
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (seen.has(value)) {
    return "[CIRCULAR]";
  }
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeValue(entry, seen));
  }
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    result[key] = sensitiveKeyPattern.test(key) ? "[REDACTED]" : sanitizeValue(entry, seen);
  }
  return result;
}

function mkdirPrivate(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  chmodIfPossible(path, 0o700);
}

function chmodIfPossible(path: string, mode: number): void {
  try {
    chmodSync(path, mode);
  } catch {
    // Windows and some filesystems do not expose POSIX modes.
  }
}

function clearStaleLock(lockPath: string): void {
  if (!existsSync(lockPath)) return;
  try {
    if (Date.now() - statSync(lockPath).mtimeMs > 10 * 60 * 1000) {
      rmSync(lockPath, { force: true });
    }
  } catch {
    // Let the exclusive open report an actionable lock error.
  }
}

function expandHome(path: string, home: string): string {
  if (path === "~") return home;
  if (path.startsWith("~/")) return join(home, path.slice(2));
  return resolve(path);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
