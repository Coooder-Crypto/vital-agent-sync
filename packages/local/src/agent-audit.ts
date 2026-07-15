import { randomUUID } from "node:crypto";
import type { VitalAgentDatabase } from "./database.js";

export type AgentRuntime = "generic_mcp" | "hermes" | "openclaw" | "workbuddy";

export type AgentClient = {
  id: string;
  name: string;
  runtime: AgentRuntime;
  scopes: string[];
  created_at: string;
  revoked_at: string | null;
};

export type AuditLogEntry = {
  id: string;
  agent_client_id: string;
  tool_name: string;
  scopes_used: string[];
  read_at: string;
};

export const DEFAULT_MCP_AGENT_CLIENT_ID = "agent_local_mcp";

export function ensureDefaultMcpAgentClient(database: VitalAgentDatabase): AgentClient {
  const now = new Date().toISOString();
  database.sqlite.prepare(`
    insert into agent_clients (
      id,
      name,
      runtime,
      scopes_json,
      created_at,
      revoked_at
    ) values (
      @id,
      @name,
      @runtime,
      @scopesJson,
      @createdAt,
      null
    )
    on conflict(id) do update set
      name = excluded.name,
      runtime = excluded.runtime,
      scopes_json = excluded.scopes_json
  `).run({
    id: DEFAULT_MCP_AGENT_CLIENT_ID,
    name: "Local MCP Agent",
    runtime: "generic_mcp",
    scopesJson: JSON.stringify(defaultMcpScopes()),
    createdAt: now
  });

  return getAgentClient(database, DEFAULT_MCP_AGENT_CLIENT_ID)!;
}

export function recordAgentRead(database: VitalAgentDatabase, input: {
  agentClientId?: string;
  toolName: string;
  scopesUsed?: string[];
}): AuditLogEntry {
  const agentClientId = input.agentClientId ?? DEFAULT_MCP_AGENT_CLIENT_ID;
  if (!getAgentClient(database, agentClientId)) {
    ensureDefaultMcpAgentClient(database);
  }

  const entry: AuditLogEntry = {
    id: `audit_${randomUUID().replaceAll("-", "")}`,
    agent_client_id: agentClientId,
    tool_name: input.toolName,
    scopes_used: input.scopesUsed ?? inferToolScopes(input.toolName),
    read_at: new Date().toISOString()
  };

  database.sqlite.prepare(`
    insert into agent_audit_log (
      id,
      agent_client_id,
      tool_name,
      scopes_used_json,
      read_at
    ) values (
      @id,
      @agentClientId,
      @toolName,
      @scopesUsedJson,
      @readAt
    )
  `).run({
    id: entry.id,
    agentClientId: entry.agent_client_id,
    toolName: entry.tool_name,
    scopesUsedJson: JSON.stringify(entry.scopes_used),
    readAt: entry.read_at
  });

  return entry;
}

export function listAgentAuditLog(database: VitalAgentDatabase, limit = 50): AuditLogEntry[] {
  const rows = database.sqlite.prepare(`
    select
      id,
      agent_client_id as agentClientId,
      tool_name as toolName,
      scopes_used_json as scopesUsedJson,
      read_at as readAt
    from agent_audit_log
    order by read_at desc, id desc
    limit ?
  `).all(Math.max(1, Math.min(limit, 200))) as Array<{
    id: string;
    agentClientId: string;
    toolName: string;
    scopesUsedJson: string;
    readAt: string;
  }>;

  return rows.map((row) => ({
    id: row.id,
    agent_client_id: row.agentClientId,
    tool_name: row.toolName,
    scopes_used: parseScopes(row.scopesUsedJson),
    read_at: row.readAt
  }));
}

function getAgentClient(database: VitalAgentDatabase, id: string): AgentClient | undefined {
  const row = database.sqlite.prepare(`
    select
      id,
      name,
      runtime,
      scopes_json as scopesJson,
      created_at as createdAt,
      revoked_at as revokedAt
    from agent_clients
    where id = ?
  `).get(id) as {
    id: string;
    name: string;
    runtime: AgentRuntime;
    scopesJson: string;
    createdAt: string;
    revokedAt: string | null;
  } | undefined;

  return row
    ? {
        id: row.id,
        name: row.name,
        runtime: row.runtime,
        scopes: parseScopes(row.scopesJson),
        created_at: row.createdAt,
        revoked_at: row.revokedAt
      }
    : undefined;
}

function defaultMcpScopes(): string[] {
  return [
    "health.daily_summary.read",
    "source_devices.read",
    "feedback.events.write",
    "agent_audit.write"
  ];
}

function inferToolScopes(toolName: string): string[] {
  if (toolName.includes("feedback")) {
    return ["feedback.events.write"];
  }
  if (toolName.includes("device")) {
    return ["source_devices.read"];
  }
  if (toolName.includes("status")) {
    return ["source_devices.read", "health.daily_summary.read"];
  }
  return ["health.daily_summary.read"];
}

function parseScopes(value: string): string[] {
  const parsed = JSON.parse(value) as unknown;
  return Array.isArray(parsed) ? parsed.filter((scope): scope is string => typeof scope === "string") : [];
}
