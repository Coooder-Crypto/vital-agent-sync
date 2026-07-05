import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const HEALTHLINK_SKILL_NAME = "healthlink-personal-context";

export type SkillInstallOptions = {
  hermesHome?: string;
  skillPath?: string;
};

export type SkillInstallResult = {
  skillPath: string;
  backupPath?: string;
};

export function buildHealthLinkSkillMarkdown(): string {
  return `---
name: ${HEALTHLINK_SKILL_NAME}
description: Use HealthLink MCP for personal health, recovery, schedule, and day-planning context.
version: 0.1.0
author: HealthLink
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [healthlink, mcp, personal-context, health, calendar]
---

# HealthLink Personal Context

## Overview

Use this skill when the user asks about their personal status, energy, recovery, sleep, workout readiness, schedule pressure, or how to plan the day. HealthLink is a user-controlled data gateway, not a medical provider.

HealthLink data comes from MCP tools. Do not invent health, calendar, sleep, workout, or recovery facts that are not present in tool output.

## When to Use

- The user asks "How am I today?", "How should I plan today?", "Should I exercise?", "Am I recovered?", or similar.
- The user asks for analysis that may benefit from sleep, activity, heart-rate, workout, or calendar availability context.
- The user asks whether recent sync data is available.
- The user asks to revoke, inspect, or troubleshoot connected HealthLink devices.

Do not use this skill for diagnosis, prescriptions, emergency advice, or unsupported medical claims.

## Tool Strategy

1. Call \`get_personal_context\` first for broad questions about today, recovery, energy, schedule pressure, or planning.
2. Use lower-level tools only for follow-up detail:
   - \`get_daily_health_summary\` for a specific date's health metrics.
   - \`get_calendar_availability\` for busy/free time.
   - \`get_sleep_trend\` for sleep continuity.
   - \`get_workout_load\` for workout and activity load.
   - \`get_recovery_signals\` for sleep, heart-rate, activity, and workout-minutes context.
   - \`get_weekly_summary\` for compact 7-day health, activity, recovery, and calendar pressure summaries.
   - \`healthlink_status\`, \`list_devices\`, and \`revoke_device\` for setup and troubleshooting.
   - \`record_feedback\` only when the user explicitly gives feedback, a correction, or a preference that should improve future HealthLink analysis.
3. Mention data freshness before analysis when the answer depends on recency.
4. If the latest sync is stale or missing, say that plainly and suggest syncing HealthLink.
5. Keep calendar titles redacted. Use availability, timing, and pressure signals only.

## Response Boundaries

- Give practical planning and wellness framing, not medical diagnosis.
- Use cautious language when data is incomplete.
- Separate observed data from inference.
- Match the user's language.
- If the user asks for exact reasons behind a health signal that HealthLink does not contain, say the data cannot prove that.

## Verification Checklist

- [ ] HealthLink MCP tool output was used for health/calendar claims.
- [ ] Data freshness or missing data was surfaced.
- [ ] Calendar titles remained redacted.
- [ ] Medical-safety boundaries were respected.
`;
}

export function installHermesHealthLinkSkill(options: SkillInstallOptions = {}): SkillInstallResult {
  const skillPath = getHermesSkillPath(options);
  mkdirSync(dirname(skillPath), { recursive: true });

  const backupPath = existsSync(skillPath) ? uniqueBackupPath(skillPath) : undefined;
  if (backupPath) {
    copyFileSync(skillPath, backupPath);
  }

  writeFileSync(skillPath, buildHealthLinkSkillMarkdown(), "utf8");

  return {
    skillPath,
    backupPath
  };
}

export function getHermesSkillPath(options: SkillInstallOptions = {}): string {
  return resolveHomePath(options.skillPath ?? join(options.hermesHome ?? process.env.HERMES_HOME ?? "~/.hermes", "skills", "health", HEALTHLINK_SKILL_NAME, "SKILL.md"));
}

function resolveHomePath(path: string): string {
  if (path === "~") {
    return homedir();
  }
  if (path.startsWith("~/")) {
    return join(homedir(), path.slice(2));
  }
  return path;
}

function timestampForFilename(): string {
  const iso = new Date().toISOString();
  return iso
    .replaceAll("-", "")
    .replace("T", "-")
    .replaceAll(":", "")
    .replace(".", "")
    .replace("Z", "");
}

function uniqueBackupPath(skillPath: string): string {
  const base = `${skillPath}.healthlink-backup-${timestampForFilename()}`;
  if (!existsSync(base)) {
    return base;
  }

  for (let index = 1; index < 1000; index += 1) {
    const candidate = `${base}-${index}`;
    if (!existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error("Could not allocate a unique HealthLink skill backup path.");
}

export function readInstalledHermesSkill(options: SkillInstallOptions = {}): string | undefined {
  const skillPath = getHermesSkillPath(options);
  return existsSync(skillPath) ? readFileSync(skillPath, "utf8") : undefined;
}
