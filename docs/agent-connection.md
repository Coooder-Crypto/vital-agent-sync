# Agent connection

This document defines how a physical iPhone remains connected to WorkBuddy, Hermes, or another supported MCP Agent through the shared `vitalmcp` runtime.

The canonical roadmap is [product-plan.md](product-plan.md). The install and consent state machine is in [agent-first-onboarding.md](agent-first-onboarding.md).

## Product order

1. WorkBuddy Local on one Mac over trusted LAN.
2. Hermes, generic MCP, and other Agents using the same local runtime.
3. A co-located Agent server reached by the iPhone through Tailscale Serve HTTPS.

Android, wearable-vendor connectors, tunnels, public HTTPS, hosted relay, and Agent marketplaces are not current commitments.

## Connection model

Vital Agent Sync does not require a live socket between the iPhone and Agent. Pairing creates persistent state owned by the user:

```text
iPhone app
  receiver URL
  source-device identity
  device token in Keychain

vitalmcp
  paired source devices
  scoped token hashes
  ~/.vital-agent-sync/vital-agent.sqlite

Agent
  local MCP config pointing to vitalmcp mcp
  optional orchestration Skill
```

Normal use is asynchronous:

```text
iPhone sync -> SQLite updated
Agent question -> local MCP reads SQLite
```

The Agent does not reload after each sync. Reload or restart is needed only when MCP configuration, runtime code, database path, or Skill files change.

## First connection

```text
ask the Agent to install
  -> review the redacted setup plan
  -> approve persistent changes
  -> configure local MCP
  -> start one verified receiver
  -> open a short-lived local QR
  -> scan with the iPhone app
  -> review receiver and HealthKit scopes
  -> grant selected permissions
  -> manual Sync Now
  -> verify freshness through vital_agent_status
```

The user never copies a token or edits SQLite. Credential-bearing QR contents and onboarding URLs must not enter the Agent conversation, logs, memory, screenshots, or issues.

## WorkBuddy Local

WorkBuddy, `vitalmcp`, SQLite, and MCP run on one Mac. The iPhone reaches the receiver over a trusted LAN.

Preferred entry: the reviewed [SkillHub package](https://skillhub.cn/skills/vital-agent-sync).

Manual fallback:

```bash
npx -y vitalmcp@0.5.2 setup --agent workbuddy --transport lan
```

WorkBuddy setup preserves unrelated entries in `~/.workbuddy/mcp.json` and creates a timestamped backup before mutation. It returns `activate_service` for the one launchd activation command that must run outside the WorkBuddy sandbox, then returns `approve_mcp` until the user approves the server, reloads WorkBuddy, and verifies `vital_agent_status`. It never edits WorkBuddy's approval store directly.

## Other local Agents

All Agent adapters reuse the same receiver, database, status model, and MCP tools:

```bash
npx -y vitalmcp@0.5.2 setup --agent hermes --transport lan
npx -y vitalmcp@0.5.2 setup --agent generic --transport lan
npx -y vitalmcp@0.5.2 setup --agent openclaw --transport lan
```

Hermes is the first Phase 2 target. Generic stdio MCP is the baseline when no first-class adapter exists.

## Tailscale server

In Phase 3, the Agent, `vitalmcp`, SQLite, and stdio MCP run under the same user on one user-owned server. Only the iPhone receiver is reachable through Tailscale:

```text
iPhone with Tailscale
  -> private .ts.net HTTPS
  -> Tailscale Serve
  -> loopback vitalmcp receiver
  -> server-local SQLite and MCP
  -> co-located Agent
```

```bash
npx -y vitalmcp@0.5.2 setup \
  --agent hermes \
  --manager systemd \
  --transport tailscale \
  --tailscale-name receiver.example-tailnet.ts.net
```

This path does not expose MCP over the network and does not use Funnel, public DNS, or an operator-hosted relay. See [tailscale-ios-onboarding.md](tailscale-ios-onboarding.md).

## Setup contract

Agent integrations use machine-readable commands:

```bash
vitalmcp setup --agent <agent> --transport <lan|tailscale> --output json
vitalmcp setup --resume --yes --output json
vitalmcp status --output json
vitalmcp doctor --agent <agent> --transport <lan|tailscale>
```

Safe output may include versions, setup stage, paths, service state, receiver identity, database identity, sync count, freshness, and stable failure codes. It never includes secrets, QR contents, onboarding URLs, health values, database rows, or complete Agent configuration.

If setup finds an unknown receiver, database, service, or transport identity, it fails closed. It does not silently stop another process, migrate a database, change ports, revoke a device, or reset state.

## Pairing and recovery

If the QR expires, create another short-lived session without reinstalling:

```bash
vitalmcp pair
```

Reconnect or re-pair only when:

- the user moves the runtime to another machine;
- the receiver address changes;
- the device token is revoked or lost;
- the app is reinstalled and Keychain state is unavailable;
- the user deliberately resets the connection.

Revocation uses `revoke_source_device`, followed by removing the saved iOS connection and pairing again. It does not delete existing local history.

Diagnostics:

```bash
vitalmcp service status
vitalmcp logs --lines 100
vitalmcp status --output json
vitalmcp doctor --agent workbuddy --transport lan
```

## MCP integration

The Agent-facing interface is local stdio MCP:

```bash
vitalmcp mcp
```

Generic configuration shape:

```json
{
  "mcpServers": {
    "vital-agent-sync": {
      "command": "vitalmcp",
      "args": ["mcp"]
    }
  }
}
```

The runtime currently exposes:

```text
vital_agent_status
get_personal_context
get_daily_health_summary
get_sleep_trend
get_workout_load
get_recovery_signals
get_weekly_summary
record_feedback
list_source_devices
revoke_source_device
list_devices
revoke_device
```

Call `vital_agent_status` before health reads. For broad questions, request `get_personal_context`; use focused tools for drill-down. Return compact summaries with timestamps, not raw samples.

## Privacy boundary

The runtime and database stay on the user's Mac or server, but the selected Agent or model provider may receive MCP results. Before the first health read, the Agent explains this boundary and waits for confirmation.

Skills and adapters may orchestrate supported CLI and MCP calls. They must not:

- read SQLite directly;
- call internal receiver HTTP APIs for health queries;
- hand-write JSON-RPC;
- parse HealthKit payloads;
- own keys or crypto;
- create another service, database, or sync path;
- provide diagnosis, treatment, or emergency advice.

## Delivery behavior

The supported contract is manual Sync Now plus foreground catch-up. iOS may receive background opportunities, but Vital Agent Sync does not promise an exact daily, weekly, or interval schedule.

Missing or stale data must be reported clearly and never fabricated.
