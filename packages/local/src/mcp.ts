import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { ensureDefaultMcpAgentClient, recordAgentRead } from "./agent-audit.js";
import { openHealthLinkDatabase } from "./database.js";
import { listDevices, revokeDevice } from "./devices.js";
import { listSourceDevices, revokeSourceDevice } from "./source-devices.js";
import {
  getAgentHealthStatus,
  getDailyHealthSummary,
  getPersonalContext,
  getRecoverySignals,
  getSleepTrend,
  getWeeklySummary,
  getWorkoutLoad
} from "./health-query.js";
import { recordFeedback } from "./feedback.js";

export type McpServerOptions = {
  databasePath?: string;
};

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional();
const daysSchema = z.number().int().min(1).max(90).optional();

export async function startMcpServer(options: McpServerOptions = {}): Promise<void> {
  const database = openHealthLinkDatabase({ path: options.databasePath });
  const agentClient = ensureDefaultMcpAgentClient(database);
  const server = new McpServer({
    name: "vitalmcp",
    version: "0.1.0"
  });

  server.registerTool(
    "healthlink_status",
    {
      title: "Vital Agent Sync Status",
      description: "Check whether Vital Agent Sync is connected and fresh. Use when the user asks if Vital Agent Sync is working, whether iPhone data has synced, how many devices are paired, or when the last sync happened."
    },
    async () => auditedJsonResult(database, agentClient.id, "healthlink_status", getAgentHealthStatus(database))
  );

  server.registerTool(
    "get_personal_context",
    {
      title: "Get Personal Context",
      description: "Best first tool for broad personal questions such as: how am I today, what is my energy level, should I work hard or rest, should I exercise, how is my recovery, am I overloaded, or summarize my current state. It returns latest health, sleep trend, workout load, recovery signals, and sync status in one structured response.",
      inputSchema: z.object({
        date: dateSchema.describe("Optional focus date in YYYY-MM-DD format. Omit for the latest synced day."),
        days: daysSchema.describe("Number of latest synced days for trend context. Defaults to 7, max 90.")
      })
    },
    async ({ date, days }) => auditedJsonResult(database, agentClient.id, "get_personal_context", getPersonalContext(database, { date, days }))
  );

  server.registerTool(
    "get_daily_health_summary",
    {
      title: "Get Daily Health Summary",
      description: "Get Apple Health daily summary data for questions about steps, sleep, heart rate, HRV, VO2 max, blood oxygen, respiratory rate, body temperature, body composition, active/basal energy, distance, exercise minutes, stand minutes, workouts, physical activity, tiredness, body state, or today's health. If date is omitted, returns the latest synced date.",
      inputSchema: z.object({
        date: dateSchema.describe("Optional date in YYYY-MM-DD format.")
      })
    },
    async ({ date }) => auditedJsonResult(database, agentClient.id, "get_daily_health_summary", getDailyHealthSummary(database, { date }))
  );

  server.registerTool(
    "get_sleep_trend",
    {
      title: "Get Sleep Trend",
      description: "Get recent sleep trend and recovery-adjacent metrics. Use for questions about sleep debt, whether sleep is improving or worsening, fatigue, recovery patterns, or recent energy trends.",
      inputSchema: z.object({
        days: daysSchema.describe("Number of latest synced days to return. Defaults to 7, max 90.")
      })
    },
    async ({ days }) => auditedJsonResult(database, agentClient.id, "get_sleep_trend", getSleepTrend(database, { days }))
  );

  server.registerTool(
    "get_workout_load",
    {
      title: "Get Workout Load",
      description: "Get recent workout and activity load. Use for questions about training load, whether to exercise today, whether recent activity is too low or too high, and how hard a workout should be.",
      inputSchema: z.object({
        days: daysSchema.describe("Number of latest synced days to return. Defaults to 7, max 90.")
      })
    },
    async ({ days }) => auditedJsonResult(database, agentClient.id, "get_workout_load", getWorkoutLoad(database, { days }))
  );

  server.registerTool(
    "get_recovery_signals",
    {
      title: "Get Recovery Signals",
      description: "Get recovery signals from sleep, resting heart rate, HRV, VO2 max, blood oxygen, respiratory rate, body temperature, active/basal energy, and workout minutes. Use for questions about readiness, overtraining, fatigue, rest needs, or whether the user should prioritize recovery.",
      inputSchema: z.object({
        days: daysSchema.describe("Number of latest synced days to return. Defaults to 7, max 90.")
      })
    },
    async ({ days }) => auditedJsonResult(database, agentClient.id, "get_recovery_signals", getRecoverySignals(database, { days }))
  );

  server.registerTool(
    "get_weekly_summary",
    {
      title: "Get Weekly Vital Agent Sync Summary",
      description: "Get a compact 7-day provider-neutral summary with freshness, source coverage, sleep, activity, workout, and recovery signals.",
      inputSchema: z.object({
        days: z.number().int().min(1).max(14).optional().describe("Number of latest synced days to summarize. Defaults to 7, max 14.")
      })
    },
    async ({ days }) => auditedJsonResult(database, agentClient.id, "get_weekly_summary", getWeeklySummary(database, { days }))
  );

  server.registerTool(
    "list_source_devices",
    {
      title: "List Vital Agent Sync Source Devices",
      description: "List paired Vital Agent Sync source devices, platform, accepted scopes, revocation state, sync count, and latest sync time."
    },
    async () => auditedJsonResult(database, agentClient.id, "list_source_devices", {
      source_devices: listSourceDevices(database)
    })
  );

  server.registerTool(
    "revoke_source_device",
    {
      title: "Revoke Vital Agent Sync Source Device",
      description: "Revoke a paired Vital Agent Sync source device so its token can no longer sync.",
      inputSchema: z.object({
        source_device_id: z.string().min(1).describe("Source device ID to revoke.")
      })
    },
    async ({ source_device_id }) => {
      const sourceDevice = revokeSourceDevice(database, source_device_id);
      return auditedJsonResult(database, agentClient.id, "revoke_source_device", {
        ok: Boolean(sourceDevice),
        source_device: sourceDevice ?? null
      });
    }
  );

  server.registerTool(
    "list_devices",
    {
      title: "List Vital Agent Sync Devices",
      description: "Legacy alias for listing paired Vital Agent Sync source devices. Prefer list_source_devices in new integrations."
    },
    async () => auditedJsonResult(database, agentClient.id, "list_devices", {
      devices: listDevices(database)
    })
  );

  server.registerTool(
    "revoke_device",
    {
      title: "Revoke Vital Agent Sync Device",
      description: "Legacy alias for revoking a paired Vital Agent Sync source device. Prefer revoke_source_device in new integrations.",
      inputSchema: z.object({
        device_id: z.string().min(1).describe("Device ID to revoke.")
      })
    },
    async ({ device_id }) => {
      const device = revokeDevice(database, device_id);
      return auditedJsonResult(database, agentClient.id, "revoke_device", {
        ok: Boolean(device),
        device: device ?? null
      });
    }
  );

  server.registerTool(
    "record_feedback",
    {
      title: "Record Vital Agent Sync Feedback",
      description: "Record user feedback about a Vital Agent Sync analysis, recommendation, sync issue, missing metric, or correction. Use after the user explicitly gives feedback such as 'that was wrong', 'remember this was helpful', or 'next time account for my sleep debt'.",
      inputSchema: z.object({
        category: z.string().min(1).max(80).describe("Short feedback category, such as analysis_quality, missing_data, preference, or correction."),
        rating: z.number().int().min(1).max(5).optional().describe("Optional 1-5 usefulness or satisfaction rating."),
        note: z.string().max(1000).optional().describe("Optional concise user feedback note."),
        occurred_at: z.string().optional().describe("Optional ISO timestamp for when the feedback occurred. Defaults to now.")
      })
    },
    async ({ category, rating, note, occurred_at }) => {
      const feedback = recordFeedback(database, {
        source: "agent",
        category,
        rating,
        note,
        occurred_at
      });
      return auditedJsonResult(database, agentClient.id, "record_feedback", {
        ok: true,
        feedback
      });
    }
  );

  process.once("SIGINT", () => {
    database.close();
    process.exit(0);
  });
  process.once("SIGTERM", () => {
    database.close();
    process.exit(0);
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`Vital Agent Sync MCP running with database ${database.path}`);
}

function jsonResult(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(value, null, 2)
      }
    ]
  };
}

function auditedJsonResult(database: ReturnType<typeof openHealthLinkDatabase>, agentClientId: string, toolName: string, value: unknown) {
  recordAgentRead(database, {
    agentClientId,
    toolName
  });
  return jsonResult(value);
}
