# healthlink-local

Local Agent-side runtime for HealthLink.

This package provides:

- LAN pairing page with QR code.
- Device pairing endpoints.
- Health sync ingest.
- SQLite local storage.
- MCP tools for agents.

## Development

From the repository root:

```bash
npm install
npm run dev:local
```

The default local server will use port `8787`.

## Install

For the published package, the intended user path is one command:

```bash
npx -y healthlink-local setup --agent hermes --service
```

This installs the macOS background receiver, writes the Agent MCP config, installs the HealthLink Hermes skill for Hermes users, starts the receiver, and prints a 10-minute iPhone pairing QR. After the first successful pair and sync, the terminal can close.

For a global install:

```bash
npm install -g healthlink-local
healthlink-local setup --agent hermes --service
```

Run this before publishing a tarball or release:

```bash
npm run typecheck
npm test
npm run pack:check
```

## Commands

Current package commands:

```bash
npx -y healthlink-local
npx -y healthlink-local setup --agent hermes --service
npx -y healthlink-local setup --agent openclaw --service
npx -y healthlink-local init
npx -y healthlink-local init --agent hermes
npx -y healthlink-local init --hermes
npx -y healthlink-local daemon
npx -y healthlink-local pair
npx -y healthlink-local service install
npx -y healthlink-local service start
npx -y healthlink-local service status
npx -y healthlink-local logs
npx -y healthlink-local logs --lines 200
npx -y healthlink-local service stop
npx -y healthlink-local service uninstall
npx -y healthlink-local init --transport lan
npx -y healthlink-local init --transport tailscale --tailscale-name my-mac.tailnet.ts.net
npx -y healthlink-local --port 8787
npx -y healthlink-local --db ~/.healthlink/healthlink.sqlite
npx -y healthlink-local mcp
npx -y healthlink-local print-mcp-config
npx -y healthlink-local print-agent-config --agent generic
npx -y healthlink-local print-agent-config --agent openclaw
npx -y healthlink-local print-skill
npx -y healthlink-local install-hermes
npx -y healthlink-local install-hermes-skill
npx -y healthlink-local status
npx -y healthlink-local doctor --agent hermes --transport lan
```

Recommended background pairing command:

```bash
npx -y healthlink-local setup --agent hermes --service
```

This writes the Agent MCP config, installs the HealthLink Hermes skill when `--agent hermes` is selected, installs and starts the macOS launchd receiver, waits for it to become reachable, and prints a 10-minute pairing QR. After pairing, the terminal can close while the background receiver keeps accepting iOS syncs.

If the QR expires, do not reinstall the service. Print a fresh pairing code:

```bash
npx -y healthlink-local pair
```

If setup reports that port `8787` is already in use, check the process and stop the old foreground receiver if needed:

```bash
lsof -nP -iTCP:8787 -sTCP:LISTEN
```

The CLI also tries to identify the listener automatically. If the listener is an old foreground `healthlink-local init` process, stop that terminal with `Ctrl-C`. If the background receiver is already running, do not run setup again; print a fresh QR instead:

```bash
npx -y healthlink-local pair
```

Foreground compatibility command:

```bash
npx -y healthlink-local init --hermes
```

`init` starts the receiver, creates a pairing session, prints a terminal QR code, shows the QR page URL, and prints MCP config hints for agents. It runs in the foreground and remains useful for debugging. Add `--agent hermes` or the compatible `--hermes` alias to also back up and write `~/.hermes/config.yaml` before the receiver starts, so Hermes uses the same default database after restart or `/reload-mcp`.

## Pairing And Sync

Run the local receiver in the foreground:

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

For the background receiver, use:

```bash
npx -y healthlink-local service status
npx -y healthlink-local logs
npx -y healthlink-local pair
```

`service status` prints the launchd plist, database path, receiver reachability, stdout log, stderr log, and last sync timestamp. `logs` tails the daemon stdout and stderr logs without requiring the user to remember the log paths. Use `logs --lines 200` when debugging longer startup or sync sessions. The daemon logs live under:

```text
~/.healthlink/logs/daemon.out.log
~/.healthlink/logs/daemon.err.log
```

The iPhone must use the LAN, Tailscale, tunnel, or public HTTPS address. `127.0.0.1` only works from the same machine as the receiver.

If launchd says the service is running but `Receiver` is not reachable, use:

```bash
npx -y healthlink-local logs
npx -y healthlink-local doctor --agent hermes
lsof -nP -iTCP:8787 -sTCP:LISTEN
```

This usually means the daemon failed during startup, Node.js is not available from the launchd environment, or another process owns the configured port.

Pairing is persistent. After the first setup, the iOS app keeps the server URL, device ID, and device token, while `healthlink-local` stores synced summaries in the same SQLite database used by MCP. The Agent does not need to reload MCP after every sync; it reads the latest database rows the next time a tool is called.

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
      "args": ["-y", "healthlink-local", "mcp"]
    }
  }
}
```

Available MCP tools:

- `healthlink_status`
- `get_personal_context`
- `get_daily_health_summary`
- `get_sleep_trend`
- `get_workout_load`
- `get_recovery_signals`
- `get_weekly_summary`
- `list_source_devices`
- `revoke_source_device`
- `list_devices`
- `revoke_device`
- `record_feedback`

Use `get_personal_context` as the default high-level entry for natural language questions like "How am I today?", "Should I exercise?", or "Am I recovered?". It returns sync status, latest health, sleep trend, workout load, recovery signals, freshness metadata, and source coverage together.

MCP reads are recorded in `agent_audit_log` with the local Agent client, tool name, scopes used, and read timestamp. This keeps Agent access auditable without changing the current stdio MCP setup.

Agents can call `record_feedback` when the user explicitly gives a correction, preference, or usefulness rating. Feedback is stored locally in `feedback_events` and can be used by future product loops without exposing raw health samples.

Agents only need `/reload-mcp` or a restart when the MCP config, database path, or tool implementation changes. New iOS syncs do not require reload.

## Skill Layer

MCP is the stable integration surface. Skills are optional instructions for agents that support them.

A HealthLink skill should tell the agent to:

- use `get_personal_context` first for broad health, recovery, exercise, or activity questions
- use lower-level tools for specific follow-up questions
- mention data freshness before giving advice
- avoid medical diagnosis or prescriptions

Hermes can install such a skill as an experience enhancement, but generic MCP-compatible agents should still work with the MCP config alone.

## Adapter Helpers

```bash
npx -y healthlink-local print-mcp-config
npx -y healthlink-local print-agent-config --agent generic
npx -y healthlink-local print-agent-config --agent hermes
npx -y healthlink-local print-skill
npx -y healthlink-local install-hermes
npx -y healthlink-local install-hermes-skill
npx -y healthlink-local init --agent hermes
npx -y healthlink-local init --agent openclaw
npx -y healthlink-local init --hermes --install-skill
npx -y healthlink-local doctor --agent hermes
npx -y healthlink-local doctor --agent openclaw
npx -y healthlink-local doctor --transport lan
```

`print-mcp-config` and `print-agent-config --agent generic` print standard `mcpServers.healthlink` JSON. `print-agent-config --agent hermes` prints a Hermes-style `mcp_servers.healthlink` YAML snippet. `print-agent-config --agent openclaw` prints an OpenClaw-style `mcp.servers.healthlink` JSON snippet. `install-hermes` backs up `~/.hermes/config.yaml`, writes `mcp_servers.healthlink`, and uses the same local database and tool surface as `healthlink-local mcp`. `init --agent hermes` and `init --hermes` perform the same Hermes install step as part of the foreground pairing flow. `init --agent openclaw` backs up and writes `~/.openclaw/openclaw.json` when it is valid JSON; use `--openclaw-config <path>` for a custom file.

`print-skill` prints the portable HealthLink skill Markdown. `install-hermes-skill` writes it to `~/.hermes/skills/health/healthlink-personal-context/SKILL.md` with a timestamped backup when replacing an existing file. `setup --agent hermes --service` installs the Hermes MCP config and the Hermes skill by default. Use `init --hermes --install-skill` when you want the same skill install behavior in the foreground compatibility flow.

Use `status` to inspect the local database and paired source devices. Use `doctor` to check Node.js, the SQLite database, MCP command generation, the selected Agent adapter, the selected transport provider, the macOS service, and local receiver reachability.

Transport providers are selected with `--transport`. `lan` is the default provider. `tailscale` can advertise the local 100.64.0.0/10 IPv4 address when Tailscale is active. Future transports such as `cloudflare`, `ngrok`, and `public_https` can be selected for diagnostics and can advertise an explicit endpoint with `--server-url` until their native provider implementations land.

For Tailscale MagicDNS, pass `--tailscale-name <host.tailnet.ts.net>` or set `HEALTHLINK_TAILSCALE_NAME`. If neither is provided, HealthLink attempts to read `tailscale status --json` and falls back to the local Tailscale IPv4 address.

The source-device API is available at `/source-devices` and `/source-devices/:source_device_id/revoke`. The older `/devices` endpoints and MCP tools remain for compatibility with the current iOS app and older agent configs.

## Background Service And Deployment Methods

HealthLink deployment is about where the receiver, SQLite database, and MCP process run. The Agent type is configured separately through `--agent` or `print-agent-config`.

### Mac local mode

On macOS, `service install` writes `~/Library/LaunchAgents/com.healthlink.local.plist` and runs:

```bash
healthlink-local daemon --host 0.0.0.0 --port 8787 --db ~/.healthlink/healthlink.sqlite --transport lan
```

Use `healthlink-local logs` to inspect the service logs. The raw files are `~/.healthlink/logs/daemon.out.log` and `~/.healthlink/logs/daemon.err.log`.

### Home server / NAS / N100 mode

For an always-on home server, run `daemon` under the server's own process manager, such as systemd, Docker Compose, PM2, or the NAS vendor's service manager:

```bash
healthlink-local daemon \
  --host 0.0.0.0 \
  --port 8787 \
  --db ~/.healthlink/healthlink.sqlite \
  --transport lan
```

If the iPhone reaches the server through Tailscale, advertise the Tailscale name or address:

```bash
healthlink-local daemon \
  --host 0.0.0.0 \
  --port 8787 \
  --db ~/.healthlink/healthlink.sqlite \
  --transport tailscale \
  --tailscale-name healthlink.tailnet.ts.net
```

### User-owned VPS / public HTTPS mode

For a VPS, run the receiver behind user-managed HTTPS and pass the public URL:

```bash
healthlink-local daemon \
  --host 0.0.0.0 \
  --port 8787 \
  --transport public_https \
  --server-url https://agent.example.com/healthlink
```

This mode requires the user to manage DNS, TLS, reverse proxying, persistence, and server security. Health summaries leave the home network, but remain on the user's own infrastructure.

The `pair` command still talks to the receiver through `http://127.0.0.1:<port>/pair/start`; for server deployments, run `pair` on the receiver host or generate the pairing URL through the receiver's trusted admin surface.

See `docs/deployment-methods.md` in the repository for the full matrix.
