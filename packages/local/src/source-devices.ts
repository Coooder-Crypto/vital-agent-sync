import { listDevices, revokeDevice, type DeviceSummary } from "./devices.js";
import type { VitalAgentDatabase } from "./database.js";

export const SOURCE_PLATFORMS = [
  "ios",
  "android",
  "xiaomi",
  "manual_import"
] as const;

export type SourcePlatform = typeof SOURCE_PLATFORMS[number];

export type SourceCapability = {
  metrics: string[];
  syncCadence: "manual" | "foreground" | "background_best_effort" | "connector_defined";
  freshness: "near_realtime" | "periodic" | "manual";
  missingDataBehavior: string;
};

export type SourceDeviceSummary = {
  source_device_id: string;
  name: string;
  platform: SourcePlatform | string;
  accepted_scopes: string[];
  created_at: string;
  revoked_at: string | null;
  last_sync_at: string | null;
  sync_count: number;
  legacy_device_id: string;
};

export const SOURCE_PLATFORM_CAPABILITIES: Record<SourcePlatform, SourceCapability> = {
  ios: {
    metrics: ["health.daily_summary"],
    syncCadence: "background_best_effort",
    freshness: "periodic",
    missingDataBehavior: "Missing HealthKit permissions are represented as null or empty summaries."
  },
  android: {
    metrics: ["health.daily_summary"],
    syncCadence: "background_best_effort",
    freshness: "periodic",
    missingDataBehavior: "Health Connect availability and granted permissions determine which metrics are present."
  },
  xiaomi: {
    metrics: ["health.daily_summary", "sleep.daily_summary", "activity.daily_summary"],
    syncCadence: "connector_defined",
    freshness: "periodic",
    missingDataBehavior: "Connector gaps are reported as missing metrics with source freshness metadata."
  },
  manual_import: {
    metrics: ["health.daily_summary", "feedback.events"],
    syncCadence: "manual",
    freshness: "manual",
    missingDataBehavior: "Imported files only contribute fields present in the import payload."
  }
};

export function isSourcePlatform(value: string): value is SourcePlatform {
  return SOURCE_PLATFORMS.includes(value as SourcePlatform);
}

export function listSourceDevices(database: VitalAgentDatabase): SourceDeviceSummary[] {
  return listDevices(database).map(toSourceDeviceSummary);
}

export function revokeSourceDevice(database: VitalAgentDatabase, sourceDeviceId: string): SourceDeviceSummary | undefined {
  const device = revokeDevice(database, sourceDeviceId);
  return device ? toSourceDeviceSummary(device) : undefined;
}

function toSourceDeviceSummary(device: DeviceSummary): SourceDeviceSummary {
  return {
    source_device_id: device.device_id,
    name: device.device_name,
    platform: device.device_platform,
    accepted_scopes: device.accepted_scopes,
    created_at: device.created_at,
    revoked_at: device.revoked_at,
    last_sync_at: device.last_sync_at,
    sync_count: device.sync_count,
    legacy_device_id: device.device_id
  };
}
