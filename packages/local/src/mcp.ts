import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { openHealthLinkDatabase } from "./database.js";
import {
  getAgentHealthStatus,
  getCalendarAvailability,
  getDailyHealthSummary,
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
      description: "Get HealthLink local sync status, paired device count, sync count, and latest sync time."
    },
    async () => jsonResult(getAgentHealthStatus(database))
  );

  server.registerTool(
    "get_daily_health_summary",
    {
      title: "Get Daily Health Summary",
      description: "Get a daily Apple Health summary. If date is omitted, returns the latest synced date.",
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
      description: "Get redacted daily calendar availability. If date is omitted, returns the latest synced date.",
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
      description: "Get sleep and recovery-related daily metrics for the latest synced days.",
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
      description: "Get workout minutes, active energy, heart-rate load signals, and recent workout records.",
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
      description: "Get sleep, resting heart rate, activity, and workout-minute signals for recovery analysis.",
      inputSchema: z.object({
        days: daysSchema.describe("Number of latest synced days to return. Defaults to 7, max 90.")
      })
    },
    async ({ days }) => jsonResult(getRecoverySignals(database, { days }))
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
