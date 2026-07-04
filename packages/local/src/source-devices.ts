export const SOURCE_PLATFORMS = [
  "ios",
  "android",
  "xiaomi",
  "calendar_connector",
  "manual_import"
] as const;

export type SourcePlatform = typeof SOURCE_PLATFORMS[number];

export type SourceCapability = {
  metrics: string[];
  syncCadence: "manual" | "foreground" | "background_best_effort" | "connector_defined";
  freshness: "near_realtime" | "periodic" | "manual";
  missingDataBehavior: string;
};

export const SOURCE_PLATFORM_CAPABILITIES: Record<SourcePlatform, SourceCapability> = {
  ios: {
    metrics: ["health.daily_summary", "calendar.daily_summary"],
    syncCadence: "background_best_effort",
    freshness: "periodic",
    missingDataBehavior: "Missing HealthKit or Calendar permissions are represented as null or empty summaries."
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
  calendar_connector: {
    metrics: ["calendar.daily_summary"],
    syncCadence: "connector_defined",
    freshness: "periodic",
    missingDataBehavior: "Calendar event titles remain redacted; unavailable calendars produce empty availability windows."
  },
  manual_import: {
    metrics: ["health.daily_summary", "calendar.daily_summary", "feedback.events"],
    syncCadence: "manual",
    freshness: "manual",
    missingDataBehavior: "Imported files only contribute fields present in the import payload."
  }
};

export function isSourcePlatform(value: string): value is SourcePlatform {
  return SOURCE_PLATFORMS.includes(value as SourcePlatform);
}
