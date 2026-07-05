# @healthlink/local

Local Agent-side runtime for HealthLink.

This package provides:

- LAN pairing page with QR code.
- Device pairing endpoints.
- Health and calendar sync ingest.
- SQLite local storage.
- MCP tools for agents.

## Development

From the repository root:

```bash
npm install
npm run dev:local
```

The default local server will use port `8787`.

## Commands

Current package commands:

```bash
npx -y @healthlink/local
npx -y @healthlink/local init
npx -y @healthlink/local init --agent hermes
npx -y @healthlink/local init --hermes
npx -y @healthlink/local init --transport lan
npx -y @healthlink/local --port 8787
npx -y @healthlink/local --db ~/.healthlink/healthlink.sqlite
npx -y @healthlink/local mcp
npx -y @healthlink/local print-mcp-config
npx -y @healthlink/local print-agent-config --agent generic
npx -y @healthlink/local print-skill
npx -y @healthlink/local install-hermes
npx -y @healthlink/local install-hermes-skill
npx -y @healthlink/local status
npx -y @healthlink/local doctor --agent hermes --transport lan
```

Foolproof local pairing command:

```bash
npx -y @healthlink/local init --hermes
```

`init` starts the receiver, creates a pairing session, prints a terminal QR code, shows the QR page URL, and prints MCP config hints for agents. It runs in the foreground. Add `--agent hermes` or the compatible `--hermes` alias to also back up and write `~/.hermes/config.yaml` before the receiver starts, so Hermes uses the same default database after restart or `/reload-mcp`.

## Pairing And Sync

Run the local receiver:

```bash
npm run dev:local
```

Expected output:

```text
HealthLink Local running

Pairing page: http://127.0.0.1:8787/pair
LAN address:  http://192.168.x.x:8787
Local API:    http://127.0.0.1:8787
Database:     ~/.healthlink/healthlink.sqlite
```

Open the pairing page or scan the terminal QR code with HealthLink iOS, approve the pairing, then sync from the iOS app.

The iPhone must use the LAN, Tailscale, tunnel, or public HTTPS address. `127.0.0.1` only works from the same machine as the receiver.

Pairing is persistent. After the first setup, the iOS app keeps the server URL, device ID, and device token, while `@healthlink/local` stores synced summaries in the same SQLite database used by MCP. The Agent does not need to reload MCP after every sync; it reads the latest database rows the next time a tool is called.

Expected product behavior is pair once, authorize once, then keep syncing automatically when the iOS app is active or iOS grants background refresh time. The current local receiver supports the server side of that flow; foreground/background auto-sync scheduling lives in the iOS app.

## Agent Integration

Use MCP mode for Hermes or any MCP-compatible agent:

```bash
npm run build:local
node packages/local/dist/cli.js mcp
node packages/local/dist/cli.js mcp --db ~/.healthlink/healthlink.sqlite
```

Local development MCP config:

```json
{
  "mcpServers": {
    "healthlink": {
      "command": "node",
      "args": [
        "/Users/coooder/Code/Agent/personal-gateway-ios/packages/local/dist/cli.js",
        "mcp",
        "--db",
        "/Users/coooder/.healthlink/healthlink.sqlite"
      ]
    }
  }
}
```

Published package MCP config:

```json
{
  "mcpServers": {
    "healthlink": {
      "command": "npx",
      "args": ["-y", "@healthlink/local", "mcp"]
    }
  }
}
```

Available MCP tools:

- `healthlink_status`
- `get_personal_context`
- `get_daily_health_summary`
- `get_calendar_availability`
- `get_sleep_trend`
- `get_workout_load`
- `get_recovery_signals`
- `get_weekly_summary`
- `list_devices`
- `revoke_device`

Use `get_personal_context` as the default high-level entry for natural language questions like "How am I today?", "How should I plan today?", "Should I exercise?", "Am I recovered?", or "Is my schedule overloaded?". It returns sync status, latest health, calendar availability, sleep trend, workout load, recovery signals, freshness metadata, and source coverage together.

MCP reads are recorded in `agent_audit_log` with the local Agent client, tool name, scopes used, and read timestamp. This keeps Agent access auditable without changing the current stdio MCP setup.

Agents only need `/reload-mcp` or a restart when the MCP config, database path, or tool implementation changes. New iOS syncs do not require reload.

## Skill Layer

MCP is the stable integration surface. Skills are optional instructions for agents that support them.

A HealthLink skill should tell the agent to:

- use `get_personal_context` first for broad health, recovery, schedule, exercise, or day-planning questions
- use lower-level tools for specific follow-up questions
- mention data freshness before giving advice
- avoid medical diagnosis or prescriptions
- keep calendar titles redacted

Hermes can install such a skill as an experience enhancement, but generic MCP-compatible agents should still work with the MCP config alone.

## Adapter Helpers

```bash
npx -y @healthlink/local print-mcp-config
npx -y @healthlink/local print-agent-config --agent generic
npx -y @healthlink/local print-agent-config --agent hermes
npx -y @healthlink/local print-skill
npx -y @healthlink/local install-hermes
npx -y @healthlink/local install-hermes-skill
npx -y @healthlink/local init --agent hermes
npx -y @healthlink/local init --hermes --install-skill
npx -y @healthlink/local doctor --agent hermes
npx -y @healthlink/local doctor --transport lan
```

`print-mcp-config` and `print-agent-config --agent generic` print standard `mcpServers.healthlink` JSON. `print-agent-config --agent hermes` prints a Hermes-style `mcp_servers.healthlink` YAML snippet. `install-hermes` backs up `~/.hermes/config.yaml`, writes `mcp_servers.healthlink`, and uses the same local database and tool surface as `@healthlink/local mcp`. `init --agent hermes` and `init --hermes` perform the same Hermes install step as part of the foreground pairing flow.

`print-skill` prints the portable HealthLink skill Markdown. `install-hermes-skill` writes it to `~/.hermes/skills/health/healthlink-personal-context/SKILL.md` with a timestamped backup when replacing an existing file. Use `init --hermes --install-skill` to install both MCP config and the Hermes skill in the same local pairing flow.

Use `status` to inspect the local database and paired devices. Use `doctor` to check Node.js, the SQLite database, MCP command generation, the selected Agent adapter, and the selected transport provider.

Transport providers are selected with `--transport`. `lan` is the default provider. `tailscale` can advertise the local 100.64.0.0/10 IPv4 address when Tailscale is active. Future transports such as `cloudflare`, `ngrok`, and `public_https` can be selected for diagnostics and can advertise an explicit endpoint with `--server-url` until their native provider implementations land.

The source-device API is available at `/source-devices` and `/source-devices/:source_device_id/revoke`. The older `/devices` endpoints remain for compatibility with the current iOS app.
