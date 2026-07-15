import { existsSync, readFileSync } from "node:fs";
import {
  getDefaultStateDir,
  getRelayConfigPath,
  getRelayCursorPath,
  readRelayRuntimeConfig,
  type RelayRuntimeConfig
} from "./relay-runtime.js";

export type RelayLocalStatus = {
  transport_mode: "direct" | "hosted_relay" | "self_hosted_relay";
  initialized: boolean;
  state_dir: string;
  relay_url: string | null;
  user_id: string | null;
  source_device_id: string | null;
  source_device_unlinked_at: string | null;
  latest_sequence: number | null;
  last_successful_pull_at: string | null;
  last_failed_envelope_id: string | null;
  last_failed_at: string | null;
  last_error: string | null;
  suggested_next_action: string;
};

type RelayCursor = {
  latest_sequence: number;
  last_successful_pull_at?: string;
  last_failed_envelope_id?: string;
  last_failed_at?: string;
  last_error?: string;
};

export function getRelayLocalStatus(options: {
  stateDir?: string;
  now?: Date;
} = {}): RelayLocalStatus {
  const stateDir = options.stateDir ?? process.env.VITALMCP_STATE_DIR ?? getDefaultStateDir();
  if (!existsSync(getRelayConfigPath(stateDir))) {
    return {
      transport_mode: "direct",
      initialized: false,
      state_dir: stateDir,
      relay_url: null,
      user_id: null,
      source_device_id: null,
      source_device_unlinked_at: null,
      latest_sequence: null,
      last_successful_pull_at: null,
      last_failed_envelope_id: null,
      last_failed_at: null,
      last_error: null,
      suggested_next_action: "Direct gateway mode: sync from iOS to the local receiver."
    };
  }

  let config: RelayRuntimeConfig;
  try {
    config = readRelayRuntimeConfig({ stateDir });
  } catch (error) {
    return {
      transport_mode: "direct",
      initialized: false,
      state_dir: stateDir,
      relay_url: null,
      user_id: null,
      source_device_id: null,
      source_device_unlinked_at: null,
      latest_sequence: null,
      last_successful_pull_at: null,
      last_failed_envelope_id: null,
      last_failed_at: null,
      last_error: error instanceof Error ? error.message : String(error),
      suggested_next_action: "Relay runtime config is invalid. Re-run vitalmcp setup --transport relay."
    };
  }

  const cursor = readRelayCursor(stateDir);
  const failedAfterSuccess = Boolean(cursor.last_failed_at && (!cursor.last_successful_pull_at || cursor.last_failed_at > cursor.last_successful_pull_at));
  return {
    transport_mode: config.relay_mode,
    initialized: true,
    state_dir: stateDir,
    relay_url: config.relay_url,
    user_id: config.user_id,
    source_device_id: config.source_device_id,
    source_device_unlinked_at: config.source_device_unlinked_at ?? null,
    latest_sequence: cursor.latest_sequence,
    last_successful_pull_at: cursor.last_successful_pull_at ?? null,
    last_failed_envelope_id: cursor.last_failed_envelope_id ?? null,
    last_failed_at: cursor.last_failed_at ?? null,
    last_error: cursor.last_error ?? null,
    suggested_next_action: config.source_device_unlinked_at
      ? "The relay source device is unlinked. Run vitalmcp relay rotate --yes, print new onboarding, and reconnect iOS."
      : relayNextAction(cursor, failedAfterSuccess)
  };
}

function readRelayCursor(stateDir: string): RelayCursor {
  const cursorPath = getRelayCursorPath(stateDir);
  if (!existsSync(cursorPath)) {
    return {
      latest_sequence: 0
    };
  }
  try {
    const parsed = JSON.parse(readFileSync(cursorPath, "utf8")) as Partial<RelayCursor>;
    const latestSequence = parsed.latest_sequence;
    return {
      latest_sequence: typeof latestSequence === "number" && Number.isInteger(latestSequence) && latestSequence >= 0 ? latestSequence : 0,
      last_successful_pull_at: typeof parsed.last_successful_pull_at === "string" ? parsed.last_successful_pull_at : undefined,
      last_failed_envelope_id: typeof parsed.last_failed_envelope_id === "string" ? parsed.last_failed_envelope_id : undefined,
      last_failed_at: typeof parsed.last_failed_at === "string" ? parsed.last_failed_at : undefined,
      last_error: typeof parsed.last_error === "string" ? parsed.last_error : undefined
    };
  } catch (error) {
    return {
      latest_sequence: 0,
      last_error: error instanceof Error ? error.message : String(error)
    };
  }
}

function relayNextAction(cursor: RelayCursor, failedAfterSuccess: boolean): string {
  if (failedAfterSuccess) {
    return "Run vitalmcp pull after resolving the failed relay envelope; failed envelopes are not acknowledged.";
  }
  if (!cursor.last_successful_pull_at) {
    return "Run vitalmcp pull after syncing from iOS to decrypt relay envelopes into the local MCP database.";
  }
  return "Relay pull is configured. Run vitalmcp pull when the user needs fresher iOS data.";
}
