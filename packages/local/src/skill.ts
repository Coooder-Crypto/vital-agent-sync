import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const HEALTHLINK_SKILL_NAME = "healthlink-personal-context";
export const HEALTHLINK_SKILL_VERSION = "0.3.0";

export type SkillInstallOptions = {
  hermesHome?: string;
  skillPath?: string;
};

export type SkillInstallResult = {
  skillPath: string;
  backupPath?: string;
};

export type SkillPackageOptions = HealthLinkSkillOptions & {
  outputDir: string;
};

export type SkillPackageResult = {
  packageDir: string;
  skillPath: string;
  readmePath: string;
};

export type HealthLinkSkillOptions = {
  agent?: "generic" | "hermes" | "openclaw" | "workbuddy";
};

export function buildHealthLinkSkillMarkdown(options: HealthLinkSkillOptions = {}): string {
  const agent = options.agent ?? "generic";
  const targetAgent = agent !== "generic" ? `\nTarget agent: ${agentDisplayName(agent)}.\n` : "";
  const agentSubject = agent === "generic" ? "the user's MCP-compatible Agent" : agentDisplayName(agent);
  const triggerSource = agent === "generic" ? "agent" : agent;
  return `---
name: ${HEALTHLINK_SKILL_NAME}
description: Use HealthLink MCP for personal health, recovery, and activity context.
version: ${HEALTHLINK_SKILL_VERSION}
metadata:
  openclaw:
    requires:
      bins:
        - healthlink-local
    install:
      - kind: node
        package: healthlink-local@${HEALTHLINK_SKILL_VERSION}
        bins:
          - healthlink-local
    os:
      - macos
      - linux
      - windows
  hermes:
    tags: [healthlink, mcp, personal-context, health]
---

# HealthLink Personal Context

## Overview

Use this skill when the user asks about their personal status, energy, recovery, sleep, workout readiness, or recent activity. HealthLink is a user-controlled data gateway, not a medical provider.
${targetAgent}

HealthLink data comes from MCP tools. Do not invent health, sleep, workout, or recovery facts that are not present in tool output.

## After Skill Installation

Proactively offer to initialize HealthLink. Do not wait for the user to discover setup commands.

1. Explain that HealthLink will create private local state, configure one shared MCP server, install a receiver or relay-pull user service, and create one iOS onboarding action.
2. Ask whether the user wants to review the setup plan.
3. Run the machine-readable setup command without \`--yes\`. Summarize only the returned redacted \`plan\` entries.
4. After explicit approval, resume with \`--yes\`.
5. Present only the safe local onboarding URL in \`next_action.url\`. Never decode the credential payload.
6. After the first iOS sync, resume setup and verify freshness through \`healthlink_status\`.
7. When setup is complete, call \`get_personal_context\` and offer the first useful health answer.

The Skill is an orchestration layer. Removing or upgrading it must not remove \`~/.healthlink\`, rotate runtime identity, delete local history, or break generic MCP.

## When to Use

- The user asks "How am I today?", "Should I exercise?", "Am I recovered?", or similar.
- The user asks for analysis that may benefit from sleep, activity, heart-rate, HRV, VO2 max, blood oxygen, respiratory rate, body temperature, body composition, or workout context.
- The user asks whether recent sync data is available.
- The user asks to revoke, inspect, or troubleshoot connected HealthLink source devices.

Do not use this skill for diagnosis, prescriptions, emergency advice, or unsupported medical claims.

## Tool Strategy

1. Call \`get_personal_context\` first for broad questions about today, recovery, energy, or activity.
2. Use lower-level tools only for follow-up detail:
   - \`get_daily_health_summary\` for a specific date's health metrics, including activity, sleep, heart, respiratory, temperature, and body-composition summaries when available.
   - \`get_sleep_trend\` for sleep continuity.
   - \`get_workout_load\` for workout and activity load.
   - \`get_recovery_signals\` for sleep, heart-rate, HRV, oxygen, respiratory, temperature, activity, and workout-minutes context.
   - \`get_weekly_summary\` for compact 7-day health, activity, and recovery summaries.
   - \`healthlink_status\`, \`list_source_devices\`, and \`revoke_source_device\` for setup and troubleshooting.
   - \`list_devices\` and \`revoke_device\` only as legacy aliases when an older agent flow expects those names.
   - \`record_feedback\` only when the user explicitly gives feedback, a correction, or a preference that should improve future HealthLink analysis.
3. Mention data freshness before analysis when the answer depends on recency.
4. If the latest sync is stale or missing, say that plainly and suggest syncing HealthLink.
5. In relay mode, call or suggest \`healthlink-local pull\` before freshness-sensitive analysis when \`healthlink_status.relay.suggested_next_action\` indicates a pull is needed.

## Agent Relay Setup Flow

When the user asks ${agentSubject} to install or connect HealthLink, keep the core logic in \`healthlink-local\`. Do not implement crypto, parse private keys, or store health data inside the skill.

Preferred hosted relay path:

1. Check whether a compatible relay-capable local runtime is installed:
   \`\`\`bash
   healthlink-local --version
   \`\`\`
   If the command is missing or outside the compatible 0.3.x range, use the pinned package fallback for this Skill version:
   \`\`\`bash
   npx -y healthlink-local@0.3.0 --version
   \`\`\`
   Select one runtime command for the whole flow: use \`healthlink-local\` when the installed version is compatible; otherwise prefix every local CLI invocation below with \`npx -y healthlink-local@0.3.0\`. Do not switch runners midway through setup, and do not use an unpinned \`npx\` package.
   Do not use \`sudo npm install -g\`.
2. Resolve the hosted relay URL from installed product configuration or the user's relay operator. It must use HTTPS. Never invent a relay domain. Request a redacted setup plan:
   \`\`\`bash
   healthlink-local setup --transport relay --relay-url https://HOSTED-RELAY --agent ${agent} --output json
   \`\`\`
3. Explain the returned plan and obtain explicit approval. Then resume the shared bootstrap:
   \`\`\`bash
   healthlink-local setup --resume --yes --output json
   \`\`\`
4. Open or present only the local URL in \`next_action.url\`. Do not quote, transcribe, summarize, attach, or store the underlying onboarding code in Agent messages. If the user needs it again, run:
   \`\`\`bash
   healthlink-local print-onboarding --transport relay --format qr --output json
   \`\`\`
5. Ask the user to scan the onboarding payload in HealthLink iOS or a compatible mobile app, grant Apple Health access, and run Sync.
6. Pull encrypted relay envelopes into the shared local MCP database:
   \`\`\`bash
   healthlink-local pull
   \`\`\`
7. Resume setup to observe the first ingest, then use \`healthlink_status\` and \`get_personal_context\`:
   \`\`\`bash
   healthlink-local setup --resume --yes --output json
   \`\`\`

Recurring pull:

- Relay setup installs the platform's \`relay-pull\` background service when launchd or systemd is available. Check it with \`healthlink-local service status --mode relay-pull\`.
- Suggest an Agent CronJob or external scheduler only when the user asks for scheduled reports or the platform service is unavailable. The scheduled command should run \`healthlink-local pull --once\`; health analysis must still use MCP tools after the pull.

Self-hosted relay path:

1. Generate and start the relay Compose file when the user wants a self-owned relay:
   \`\`\`bash
   healthlink-local print-relay-docker-compose > docker-compose.relay.yml
   docker compose -f docker-compose.relay.yml up -d
   \`\`\`
2. Initialize the local runtime with the iPhone-reachable relay URL:
   \`\`\`bash
   healthlink-local setup --transport self-hosted-relay --relay-url http://HOST:8790 --agent ${agent} --output json
   \`\`\`
3. Explain the plan, obtain consent, and run \`healthlink-local setup --resume --yes --output json\`.
4. After the user syncs from iOS, run \`healthlink-local pull\`, resume setup, then query MCP.

Direct local gateway path:

- If the user prefers LAN/Tailscale/public HTTPS direct sync instead of relay, request a plan with \`healthlink-local setup --agent ${agent} --transport lan --output json\`, explain it, obtain consent, and resume with \`healthlink-local setup --resume --yes --output json\`. Do not mix direct pairing QR codes with relay onboarding payloads.

## Relay And Privacy Guardrails

- Never print, request, summarize, or copy files under \`~/.healthlink/secrets\`.
- Do not ask the user to paste private keys into an Agent chat.
- Treat the complete onboarding QR, deep link, and text code as credentials. They contain \`upload_auth_secret\`, \`relay_access_token\`, and sometimes \`relay_api_token\`; show them only to the user for transfer to the intended HealthLink source device, and never paste them into Agent chat, logs, memory, tool arguments, issue trackers, or support messages.
- Hosted and self-hosted relays should contain encrypted envelopes plus minimal hashed tenant/revocation metadata; relay operators should not be able to decrypt health payloads.
- Treat \`~/.healthlink/config.json\`, \`~/.healthlink/healthlink.sqlite\`, generated reports, and exported summaries as sensitive local state.
- Do not dump raw health tables or long metric histories unless the user explicitly asks for that detail.
- If \`healthlink_status\` shows stale or missing data, suggest \`healthlink-local pull\` for relay mode or ask the user to sync from iOS. When mobile deep-link support is available, suggest \`healthlink://sync?source=${triggerSource}&request_id=...\`; do not put health plaintext in callback URLs.
- If \`healthlink-local pull\` reports a failed envelope, tell the user the envelope was not acknowledged and point them to \`healthlink-local relay status\` or \`healthlink-local doctor --agent ${agent}\`.

## Unlink, Rotation, And Reset

Run lifecycle commands only after the user explicitly confirms the action:

- \`healthlink-local relay unlink --yes\` blocks the current source device at the relay and purges its queued envelopes. Reconnecting requires credential rotation and fresh iOS onboarding.
- \`healthlink-local relay rotate --yes\` preserves the relay user and source IDs, purges envelopes encrypted with the old key, replaces local encryption/authentication credentials, and requires fresh iOS onboarding.
- \`healthlink-local relay reset --yes\` revokes and purges the old relay user, creates new user/device IDs and credentials, resets the local cursor, and requires fresh iOS onboarding.
- \`healthlink-local relay migrate --yes --transport self-hosted-relay --relay-url <target>\` revokes the old identity, preserves local SQLite health history, creates fresh credentials for the target relay, and requires fresh iOS onboarding.

Do not run these commands as an automatic troubleshooting step. Explain that queued-but-unpulled envelopes are deleted and stop the workflow if the user does not confirm.

## Report Templates

Use these templates when the user asks for a concise daily or weekly health report. Keep the report grounded in MCP output and omit sections when supporting data is missing.

Daily report:

1. Freshness: latest source generated time, latest local sync or relay pull time, and missing metrics.
2. Today snapshot: sleep, steps, active energy, workouts, and any available heart or recovery signals.
3. Interpretation: separate observed data from inference; note confidence when metrics are sparse.
4. Suggested plan: practical activity, recovery, and work pacing suggestions within non-medical boundaries.
5. Next sync action: relay pull, iOS sync deep link, or direct gateway pairing action only when needed.

Weekly report:

1. Freshness and coverage: number of covered days, source devices, missing metrics, and stale-data warning if relevant.
2. Sleep pattern: total/average sleep and notable low or high days.
3. Activity load: total steps, active energy, exercise/workout minutes, and trend direction.
4. Recovery signals: resting heart rate, HRV, oxygen, respiratory, temperature, and workout load only when present.
5. User-facing conclusion: one concise summary, practical next actions, and uncertainty boundaries.

Do not save reports to files unless the user explicitly asks. Treat generated reports as sensitive local health summaries.

## Response Boundaries

- Give practical planning and wellness framing, not medical diagnosis.
- Use cautious language when data is incomplete.
- Separate observed data from inference.
- Match the user's language.
- If the user asks for exact reasons behind a health signal that HealthLink does not contain, say the data cannot prove that.

## Verification Checklist

- [ ] HealthLink MCP tool output was used for health claims.
- [ ] Data freshness or missing data was surfaced.
- [ ] Relay mode used \`healthlink-local pull\` before MCP analysis when fresh data was needed.
- [ ] Private keys and raw local state were not exposed.
- [ ] Onboarding credentials were not copied into Agent messages, logs, memory, or tool arguments.
- [ ] Medical-safety boundaries were respected.
`;
}

export function exportHealthLinkSkillPackage(options: SkillPackageOptions): SkillPackageResult {
  const packageDir = resolveHomePath(options.outputDir);
  const agent = options.agent ?? "openclaw";
  const skillPath = join(packageDir, "SKILL.md");
  const readmePath = join(packageDir, "README.md");
  mkdirSync(packageDir, { recursive: true });
  rmSync(join(packageDir, "clawhub.json"), { force: true });
  writeFileSync(skillPath, buildHealthLinkSkillMarkdown({ agent }), "utf8");
  writeFileSync(readmePath, buildSkillPackageReadme(agent), "utf8");
  return {
    packageDir,
    skillPath,
    readmePath
  };
}

export function installHermesHealthLinkSkill(options: SkillInstallOptions = {}): SkillInstallResult {
  const skillPath = getHermesSkillPath(options);
  mkdirSync(dirname(skillPath), { recursive: true });

  const backupPath = existsSync(skillPath) ? uniqueBackupPath(skillPath) : undefined;
  if (backupPath) {
    copyFileSync(skillPath, backupPath);
  }

  writeFileSync(skillPath, buildHealthLinkSkillMarkdown({ agent: "hermes" }), "utf8");

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

function buildSkillPackageReadme(agent: NonNullable<HealthLinkSkillOptions["agent"]>): string {
  return `# HealthLink Personal Context Skill

Target agent: ${agentDisplayName(agent)}.

This package contains a HealthLink skill for agent-guided setup, E2EE relay onboarding, freshness checks, and MCP-based personal health context. The skill delegates all local runtime, crypto, storage, and MCP behavior to \`healthlink-local\`.

Package contents:

- \`SKILL.md\`: the skill prompt, ClawHub metadata, runtime requirements, and operating rules.
- \`README.md\`: this file.

Before publishing, verify:

- \`healthlink-local print-skill --agent openclaw\` matches \`SKILL.md\`.
- Private files under \`~/.healthlink/secrets\` are never copied into the package.
- The package contains no health data, SQLite files, relay envelopes, tokens, or local user IDs.
- The skill still points agents to MCP tools instead of embedding health data or crypto.

ClawHub publishes skills under MIT-0. Do not add a conflicting per-skill license.

Validate the package before publication:

\`\`\`bash
npm i -g clawhub
clawhub login
clawhub whoami
clawhub skill publish . \\
  --slug ${HEALTHLINK_SKILL_NAME} \\
  --name "HealthLink Personal Context" \\
  --version ${HEALTHLINK_SKILL_VERSION} \\
  --changelog "Initial E2EE relay release" \\
  --dry-run
\`\`\`

After publication, install the final owner/slug from a clean OpenClaw environment:

\`\`\`bash
openclaw skills install <owner-or-final-slug>
\`\`\`
`;
}

function agentDisplayName(agent: NonNullable<HealthLinkSkillOptions["agent"]>): string {
  switch (agent) {
  case "hermes":
    return "Hermes";
  case "openclaw":
    return "OpenClaw";
  case "workbuddy":
    return "WorkBuddy";
  case "generic":
    return "Generic MCP Agent";
  }
}
