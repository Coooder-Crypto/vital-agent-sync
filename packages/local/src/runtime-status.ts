import type { VitalAgentDatabase } from "./database.js";
import { getDatabaseId } from "./database.js";
import { getHealthStatus } from "./health-ingest.js";

export const VITAL_AGENT_PRODUCT = "vital-agent-sync" as const;
export const VITALMCP_SERVICE = "vitalmcp" as const;
export const VITALMCP_RUNTIME_VERSION = "0.5.3" as const;
export const RECEIVER_STATUS_PROTOCOL_VERSION = 1 as const;

export type ReceiverRuntimeStatus = {
  ok: true;
  product: typeof VITAL_AGENT_PRODUCT;
  service: typeof VITALMCP_SERVICE;
  runtime_version: typeof VITALMCP_RUNTIME_VERSION;
  status_protocol_version: typeof RECEIVER_STATUS_PROTOCOL_VERSION;
  database_id: string;
  status: "running";
  device_count: number;
  sync_count: number;
  last_sync_at: string | null;
};

export function getReceiverRuntimeStatus(database: VitalAgentDatabase): ReceiverRuntimeStatus {
  const health = getHealthStatus(database);
  return {
    ok: true,
    product: VITAL_AGENT_PRODUCT,
    service: VITALMCP_SERVICE,
    runtime_version: VITALMCP_RUNTIME_VERSION,
    status_protocol_version: RECEIVER_STATUS_PROTOCOL_VERSION,
    database_id: getDatabaseId(database),
    status: health.status,
    device_count: health.device_count,
    sync_count: health.sync_count,
    last_sync_at: health.last_sync_at
  };
}

export function parseCompatibleReceiverRuntimeStatus(
  value: unknown,
  options: { expectedDatabaseId?: string } = {}
): ReceiverRuntimeStatus | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const status = value as Partial<Record<keyof ReceiverRuntimeStatus, unknown>>;
  if (
    status.ok !== true ||
    status.product !== VITAL_AGENT_PRODUCT ||
    status.service !== VITALMCP_SERVICE ||
    status.runtime_version !== VITALMCP_RUNTIME_VERSION ||
    status.status_protocol_version !== RECEIVER_STATUS_PROTOCOL_VERSION ||
    status.status !== "running" ||
    typeof status.database_id !== "string" ||
    status.database_id.length === 0 ||
    typeof status.device_count !== "number" ||
    !Number.isInteger(status.device_count) ||
    status.device_count < 0 ||
    typeof status.sync_count !== "number" ||
    !Number.isInteger(status.sync_count) ||
    status.sync_count < 0 ||
    !(status.last_sync_at === null || typeof status.last_sync_at === "string")
  ) {
    return undefined;
  }
  if (options.expectedDatabaseId && status.database_id !== options.expectedDatabaseId) {
    return undefined;
  }
  return status as ReceiverRuntimeStatus;
}
