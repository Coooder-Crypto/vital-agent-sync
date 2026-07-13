import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const HEALTHLINK_SKILL_NAME = "vitalmcp-personal-context";
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
description: Use VitalMCP MCP for personal health, recovery, and activity context.
version: ${HEALTHLINK_SKILL_VERSION}
metadata:
  openclaw:
    requires:
      bins:
        - vitalmcp
    install:
      - kind: node
        package: vitalmcp@${HEALTHLINK_SKILL_VERSION}
        bins:
          - vitalmcp
    os:
      - macos
      - linux
      - windows
  hermes:
    tags: [vitalmcp, mcp, personal-context, health]
---

# VitalMCP Personal Context

## Overview

Use this skill when the user asks about their personal status, energy, recovery, sleep, workout readiness, or recent activity. VitalMCP is a user-controlled data gateway, not a medical provider.
${targetAgent}

VitalMCP data comes from MCP tools. Do not invent health, sleep, workout, or recovery facts that are not present in tool output.

## After Skill Installation

Proactively offer to initialize VitalMCP. Do not wait for the user to discover setup commands.

1. Explain that VitalMCP will create private local state, configure one shared MCP server, install a local receiver service, and create one iOS pairing action. LAN is the Local Preview default.
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
- The user asks to revoke, inspect, or troubleshoot connected VitalMCP source devices.

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
   - \`record_feedback\` only when the user explicitly gives feedback, a correction, or a preference that should improve future VitalMCP analysis.
3. Mention data freshness before analysis when the answer depends on recency.
4. If the latest sync is stale or missing, say that plainly and suggest syncing VitalMCP.
5. In relay mode, call or suggest \`vitalmcp pull\` before freshness-sensitive analysis when \`healthlink_status.relay.suggested_next_action\` indicates a pull is needed.

## Agent Setup Flow

When the user asks ${agentSubject} to install or connect VitalMCP, keep the core logic in \`vitalmcp\`. Do not implement transport logic, parse private keys, or store health data inside the skill.

### Local Preview: LAN By Default

1. Check whether a compatible local runtime is installed:
   \`\`\`bash
   vitalmcp --version
   \`\`\`
   If the command is missing or outside the compatible 0.3.x range, use the pinned package fallback for this Skill version:
   \`\`\`bash
   npx -y vitalmcp@0.3.0 --version
   \`\`\`
   Select one runtime command for the whole flow: use \`vitalmcp\` when the installed version is compatible; otherwise prefix every local CLI invocation below with \`npx -y vitalmcp@0.3.0\`. Do not switch runners midway through setup, and do not use an unpinned \`npx\` package.
   Do not use \`sudo npm install -g\`.
2. Explain that LAN requires the iPhone and receiver to share a reachable trusted network. It does not require a relay URL, VPS, domain, VitalMCP account, or payment method. Request a redacted setup plan:
   \`\`\`bash
   vitalmcp setup --transport lan --agent ${agent} --output json
   \`\`\`
3. Explain the returned plan and obtain explicit approval. Then resume the shared bootstrap:
   \`\`\`bash
   vitalmcp setup --resume --yes --output json
   \`\`\`
4. Open or present the local pairing URL in \`next_action.url\`. Do not copy pairing credentials into Agent messages. If the pairing code expires, run:
   \`\`\`bash
   vitalmcp pair
   \`\`\`
5. Ask the user to scan the pairing QR in VitalMCP iOS, grant Apple Health access, and run Sync Now.
6. Resume setup to observe the first ingest, then use \`healthlink_status\` and \`get_personal_context\`:
   \`\`\`bash
   vitalmcp setup --resume --yes --output json
   \`\`\`

The v0.1 delivery promise is manual Sync Now plus catch-up when the iOS app is active or returns to the foreground. iOS background opportunities are best-effort. Never promise scheduled daily or weekly delivery, an exact interval, or a guaranteed background sync time.

### Optional Private Remote Path: Tailscale

Offer Tailscale when the user needs to sync away from the receiver's LAN. Before setup, explain that the user must:

- install and sign in to Tailscale on both the iPhone and receiver machine
- have a Tailscale account and an authorized tailnet that includes both devices
- keep the receiver reachable under its approved MagicDNS name or Tailscale address

Then request a separate reviewed plan:

\`\`\`bash
vitalmcp setup --transport tailscale --tailscale-name <host.tailnet.ts.net> --agent ${agent} --output json
\`\`\`

After explicit approval, resume with \`vitalmcp setup --resume --yes --output json\`. Do not silently switch an existing LAN installation to Tailscale. Tailscale is optional and user-managed; VitalMCP does not create an account, install the apps, or authorize tailnet devices.

### LAN And Tailscale Troubleshooting

1. Check runtime and receiver state with \`vitalmcp status\`, \`vitalmcp service status\`, and \`vitalmcp logs\`.
2. For LAN, run \`vitalmcp doctor --transport lan\` and confirm the pairing URL is not \`127.0.0.1\` or \`localhost\` and is reachable from the iPhone on the trusted network.
3. For Tailscale, confirm both devices are signed in to the same authorized tailnet, then run \`vitalmcp doctor --transport tailscale --tailscale-name <host.tailnet.ts.net>\`.
4. If a pairing code expires, run \`vitalmcp pair\`. To revoke a paired source, call MCP \`revoke_source_device\`, remove the saved connection in the iOS app, then pair again. Revocation stops that source without deleting local SQLite history.

### Relay: Future And Experimental

Hosted Relay is not available, recommended, or required in the Local Preview flow. Never ask a Local Preview user for a relay URL, VPS, domain, account, or payment method. Only discuss relay setup when the user explicitly asks to test an experimental deployment or operate a self-hosted relay.

For an explicit hosted-relay experiment, resolve the HTTPS relay URL from installed product configuration or the user's relay operator. Never invent a relay domain. Request a redacted setup plan:

\`\`\`bash
vitalmcp setup --transport relay --relay-url https://HOSTED-RELAY --agent ${agent} --output json
\`\`\`

After explicit approval, resume setup, present only the safe local URL in \`next_action.url\`, ask the user to sync, pull encrypted envelopes, and verify freshness:

\`\`\`bash
vitalmcp setup --resume --yes --output json
vitalmcp pull
vitalmcp setup --resume --yes --output json
\`\`\`

If the user explicitly chooses a self-hosted relay:

1. Generate and start the relay Compose file with \`vitalmcp print-relay-docker-compose > docker-compose.relay.yml\` and \`docker compose -f docker-compose.relay.yml up -d\`.
2. Request and review \`vitalmcp setup --transport self-hosted-relay --relay-url http://HOST:8790 --agent ${agent} --output json\`.
3. After consent and iOS onboarding, run \`vitalmcp pull\` and query health data through MCP.

Relay setup may install a \`relay-pull\` service. A pull schedule only moves already-uploaded encrypted envelopes; it is not an iOS sync schedule and must not be described as guaranteed daily or weekly delivery. Do not use relay lifecycle commands as an automatic troubleshooting step.

## Relay And Privacy Guardrails

- Never print, request, summarize, or copy files under \`~/.healthlink/secrets\`.
- Do not ask the user to paste private keys into an Agent chat.
- Treat the complete onboarding QR, deep link, and text code as credentials. They contain \`upload_auth_secret\`, \`relay_access_token\`, and sometimes \`relay_api_token\`; show them only to the user for transfer to the intended VitalMCP source device, and never paste them into Agent chat, logs, memory, tool arguments, issue trackers, or support messages.
- Hosted and self-hosted relays should contain encrypted envelopes plus minimal hashed tenant/revocation metadata; relay operators should not be able to decrypt health payloads.
- Treat \`~/.healthlink/config.json\`, \`~/.healthlink/healthlink.sqlite\`, generated reports, and exported summaries as sensitive local state.
- Do not dump raw health tables or long metric histories unless the user explicitly asks for that detail.
- If \`healthlink_status\` shows stale or missing data, suggest \`vitalmcp pull\` for relay mode or ask the user to sync from iOS. When mobile deep-link support is available, suggest \`vitalmcp://sync?source=${triggerSource}&request_id=...\`; do not put health plaintext in callback URLs.
- If \`vitalmcp pull\` reports a failed envelope, tell the user the envelope was not acknowledged and point them to \`vitalmcp relay status\` or \`vitalmcp doctor --agent ${agent}\`.

## Unlink, Rotation, And Reset

Run lifecycle commands only after the user explicitly confirms the action:

- \`vitalmcp relay unlink --yes\` blocks the current source device at the relay and purges its queued envelopes. Reconnecting requires credential rotation and fresh iOS onboarding.
- \`vitalmcp relay rotate --yes\` preserves the relay user and source IDs, purges envelopes encrypted with the old key, replaces local encryption/authentication credentials, and requires fresh iOS onboarding.
- \`vitalmcp relay reset --yes\` revokes and purges the old relay user, creates new user/device IDs and credentials, resets the local cursor, and requires fresh iOS onboarding.
- \`vitalmcp relay migrate --yes --transport self-hosted-relay --relay-url <target>\` revokes the old identity, preserves local SQLite health history, creates fresh credentials for the target relay, and requires fresh iOS onboarding.

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
- If the user asks for exact reasons behind a health signal that VitalMCP does not contain, say the data cannot prove that.

## Verification Checklist

- [ ] VitalMCP MCP tool output was used for health claims.
- [ ] Data freshness or missing data was surfaced.
- [ ] Relay mode used \`vitalmcp pull\` before MCP analysis when fresh data was needed.
- [ ] Private keys and raw local state were not exposed.
- [ ] Onboarding credentials were not copied into Agent messages, logs, memory, or tool arguments.
- [ ] Medical-safety boundaries were respected.
- [ ] Local Preview setup used LAN by default, or documented Tailscale prerequisites before an explicit Tailscale choice.
- [ ] Hosted Relay was described only as future/experimental, never as the default or recommended path.
- [ ] Sync timing was described as manual plus foreground catch-up, with background delivery best-effort and unscheduled.
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
  const base = `${skillPath}.vitalmcp-backup-${timestampForFilename()}`;
  if (!existsSync(base)) {
    return base;
  }

  for (let index = 1; index < 1000; index += 1) {
    const candidate = `${base}-${index}`;
    if (!existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error("Could not allocate a unique VitalMCP skill backup path.");
}

export function readInstalledHermesSkill(options: SkillInstallOptions = {}): string | undefined {
  const skillPath = getHermesSkillPath(options);
  return existsSync(skillPath) ? readFileSync(skillPath, "utf8") : undefined;
}

function buildSkillPackageReadme(agent: NonNullable<HealthLinkSkillOptions["agent"]>): string {
  return `# VitalMCP Personal Context Skill

Target agent: ${agentDisplayName(agent)}.

This package contains a VitalMCP skill for LAN-first agent-guided setup, optional user-managed Tailscale access, freshness checks, and MCP-based personal health context. Experimental relay guidance remains available for explicit tests. The skill delegates all local runtime, transport, crypto, storage, and MCP behavior to \`vitalmcp\`.

Package contents:

- \`SKILL.md\`: the skill prompt, ClawHub metadata, runtime requirements, and operating rules.
- \`README.md\`: this file.

Before publishing, verify:

- \`vitalmcp print-skill --agent openclaw\` matches \`SKILL.md\`.
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
  --name "VitalMCP Personal Context" \\
  --version ${HEALTHLINK_SKILL_VERSION} \\
  --changelog "LAN-first Local Preview" \\
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
