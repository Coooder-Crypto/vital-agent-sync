export const healthlinkScopes = [
  "health.daily_summary.write",
  "calendar.daily_summary.write"
] as const;

export type HealthLinkScope = typeof healthlinkScopes[number];
