import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { openHealthLinkDatabase } from "./database.js";
import { listDevices, revokeDevice } from "./devices.js";
import {
  getAgentHealthStatus,
  getCalendarAvailability,
  getDailyHealthSummary,
  getPersonalContext,
  getRecoverySignals,
  getSleepTrend,
  getWorkoutLoad
} from "./health-query.js";

export type McpServerOptions = {
  databasePath?: string;
};

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional();
const daysSchema = z.number().int().min(1).max(90).optional();

export async function startMcpServer(options: McpServerOptions = {}): Promise<void> {
  const database = openHealthLinkDatabase({ path: options.databasePath });
  const server = new McpServer({
    name: "healthlink-local",
    version: "0.1.0"
  });

  server.registerTool(
    "healthlink_status",
    {
      title: "HealthLink Status",
      description: "Check whether HealthLink is connected and fresh. Use when the user asks if HealthLink is working, whether iPhone data has synced, how many devices are paired, or when the last sync happened."
    },
    async () => jsonResult(getAgentHealthStatus(database))
  );

  server.registerTool(
    "get_personal_context",
    {
      title: "Get Personal Context",
      description: "Best first tool for broad personal questions such as: how am I today, what is my energy level, should I work hard or rest, should I exercise, how should I plan today, how is my recovery, am I overloaded, or summarize my current state. It returns latest health, calendar availability, sleep trend, workout load, recovery signals, and sync status in one structured response.",
      inputSchema: z.object({
        date: dateSchema.describe("Optional focus date in YYYY-MM-DD format. Omit for the latest synced day."),
        days: daysSchema.describe("Number of latest synced days for trend context. Defaults to 7, max 90.")
      })
    },
    async ({ date, days }) => jsonResult(getPersonalContext(database, { date, days }))
  );

  server.registerTool(
    "get_daily_health_summary",
    {
      title: "Get Daily Health Summary",
      description: "Get Apple Health daily summary data for questions about steps, sleep minutes, heart rate, active energy, workouts, physical activity, tiredness, body state, or today's health. If date is omitted, returns the latest synced date.",
      inputSchema: z.object({
        date: dateSchema.describe("Optional date in YYYY-MM-DD format.")
      })
    },
    async ({ date }) => jsonResult(getDailyHealthSummary(database, { date }))
  );

  server.registerTool(
    "get_calendar_availability",
    {
      title: "Get Calendar Availability",
      description: "Get redacted daily calendar availability for questions about schedule pressure, busy minutes, free windows, next event timing, whether there is time to exercise or focus, or how to plan the day. If date is omitted, returns the latest synced date.",
      inputSchema: z.object({
        date: dateSchema.describe("Optional date in YYYY-MM-DD format.")
      })
    },
    async ({ date }) => jsonResult(getCalendarAvailability(database, { date }))
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
    async ({ days }) => jsonResult(getSleepTrend(database, { days }))
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
    async ({ days }) => jsonResult(getWorkoutLoad(database, { days }))
  );

  server.registerTool(
    "get_recovery_signals",
    {
      title: "Get Recovery Signals",
      description: "Get recovery signals from sleep, resting heart rate, average heart rate, active energy, and workout minutes. Use for questions about readiness, overtraining, fatigue, rest needs, or whether the user should prioritize recovery.",
      inputSchema: z.object({
        days: daysSchema.describe("Number of latest synced days to return. Defaults to 7, max 90.")
      })
    },
    async ({ days }) => jsonResult(getRecoverySignals(database, { days }))
  );

  server.registerTool(
    "list_devices",
    {
      title: "List HealthLink Devices",
      description: "List paired HealthLink devices, revocation state, sync count, and latest sync time."
    },
    async () => jsonResult({
      devices: listDevices(database)
    })
  );

  server.registerTool(
    "revoke_device",
    {
      title: "Revoke HealthLink Device",
      description: "Revoke a paired HealthLink device so its token can no longer sync.",
      inputSchema: z.object({
        device_id: z.string().min(1).describe("Device ID to revoke.")
      })
    },
    async ({ device_id }) => {
      const device = revokeDevice(database, device_id);
      return jsonResult({
        ok: Boolean(device),
        device: device ?? null
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
  console.error(`HealthLink MCP running with database ${database.path}`);
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
