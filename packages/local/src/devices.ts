import type { VitalAgentDatabase } from "./database.js";

export type DeviceSummary = {
  device_id: string;
  device_name: string;
  device_platform: string;
  accepted_scopes: string[];
  created_at: string;
  revoked_at: string | null;
  last_sync_at: string | null;
  sync_count: number;
};

type DeviceRow = {
  deviceId: string;
  deviceName: string;
  devicePlatform: string;
  scopesJson: string;
  createdAt: string;
  revokedAt: string | null;
  lastSyncAt: string | null;
  syncCount: number;
};

export function listDevices(database: VitalAgentDatabase): DeviceSummary[] {
  const rows = database.sqlite.prepare(`
    select
      devices.id as deviceId,
      devices.name as deviceName,
      devices.platform as devicePlatform,
      devices.scopes_json as scopesJson,
      devices.created_at as createdAt,
      devices.revoked_at as revokedAt,
      max(sync_batches.received_at) as lastSyncAt,
      count(sync_batches.sync_id) as syncCount
    from devices
    left join sync_batches on sync_batches.device_id = devices.id
    group by devices.id
    order by devices.created_at desc
  `).all() as DeviceRow[];

  return rows.map((row) => ({
    device_id: row.deviceId,
    device_name: row.deviceName,
    device_platform: row.devicePlatform,
    accepted_scopes: parseScopes(row.scopesJson),
    created_at: row.createdAt,
    revoked_at: row.revokedAt,
    last_sync_at: row.lastSyncAt,
    sync_count: row.syncCount
  }));
}

export function revokeDevice(database: VitalAgentDatabase, deviceId: string): DeviceSummary | undefined {
  const now = new Date().toISOString();
  database.sqlite.prepare(`
    update devices
    set revoked_at = coalesce(revoked_at, ?)
    where id = ?
  `).run(now, deviceId);

  return getDevice(database, deviceId);
}

export function getDevice(database: VitalAgentDatabase, deviceId: string): DeviceSummary | undefined {
  return listDevices(database).find((device) => device.device_id === deviceId);
}

function parseScopes(value: string): string[] {
  const parsed = JSON.parse(value) as unknown;
  return Array.isArray(parsed) ? parsed.filter((scope): scope is string => typeof scope === "string") : [];
}
