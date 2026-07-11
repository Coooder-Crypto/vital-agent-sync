import { encryptHealthSyncPayload, type HealthLinkEncryptedEnvelope } from "./relay-crypto.js";
import type { RelayRuntimeConfig } from "./relay-runtime.js";
import type { HealthSyncPayload } from "./schemas.js";

export type RelayFixtureOptions = {
  date?: string;
  steps?: number;
  sleepMinutes?: number;
  activeEnergyKcal?: number;
  sequence?: number;
  syncId?: string;
  generatedAt?: string;
  createdAt?: string;
  timezone?: string;
};

export function buildRelayFixturePayload(
  config: Pick<RelayRuntimeConfig, "source_device_id">,
  options: RelayFixtureOptions = {}
): HealthSyncPayload {
  const date = options.date ?? new Date().toISOString().slice(0, 10);
  const sequence = options.sequence ?? Date.now();
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  return {
    device_id: config.source_device_id,
    sync_id: options.syncId ?? `sync_fixture_${date.replaceAll("-", "")}_${sequence}`,
    generated_at: generatedAt,
    timezone: options.timezone ?? resolveLocalTimezone(),
    health_daily_summaries: [
      {
        date,
        provider: "apple_health",
        steps: options.steps ?? 7777,
        sleep_minutes: options.sleepMinutes ?? 420,
        active_energy_kcal: options.activeEnergyKcal ?? 520,
        workouts: []
      }
    ]
  };
}

export function buildRelayFixtureEnvelope(input: {
  config: RelayRuntimeConfig;
  options?: RelayFixtureOptions;
}): HealthLinkEncryptedEnvelope {
  const sequence = input.options?.sequence ?? Date.now();
  return encryptHealthSyncPayload({
    config: input.config,
    sequence,
    createdAt: input.options?.createdAt ?? new Date().toISOString(),
    payload: buildRelayFixturePayload(input.config, {
      ...input.options,
      sequence
    })
  });
}

function resolveLocalTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}
