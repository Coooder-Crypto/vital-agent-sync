# vitalmcp

Local Agent-side runtime for Vital Agent Sync.

This package provides:

- LAN pairing page with QR code.
- Device pairing endpoints.
- Health sync ingest.
- SQLite local storage.
- MCP tools for agents.

The stable integration is Agent-neutral MCP. Hermes, OpenClaw, and future runtimes are replaceable configuration/skill adapters over the same `vitalmcp mcp`, SQLite database, relay protocol, and 12-tool surface.

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
npx -y vitalmcp setup
```

For supported Agents, the preferred product experience is Skill-first. The Skill requests a versioned redacted plan and invokes the same resumable runtime bootstrap:

```bash
vitalmcp setup --agent openclaw --transport lan --output json
vitalmcp setup --resume --yes --output json
vitalmcp status --output json
```

LAN is the Local Preview default and needs only a reachable trusted network shared by the iPhone and receiver. It does not ask for a relay URL, VPS, domain, Vital Agent Sync account, or payment method. Without `--yes`, non-interactive setup stops at `awaiting_consent` and does not write Agent config or install/start services. Existing compatible `~/.vital-agent-sync` runtime state and history are reused across Skill upgrades.

Tailscale is an optional private remote path for users who install and sign in to Tailscale on both devices and authorize them on the same tailnet:

```bash
vitalmcp setup --agent openclaw --transport tailscale --tailscale-name <host.tailnet.ts.net> --output json
```

Hosted Relay is future/experimental during Local Preview, not a default or recommended setup path. Credential-bearing experimental relay onboarding is written to a private local page; JSON returns only its local URL.

Portable installation without a writable system npm prefix:

```bash
curl -fsSL https://<vital-agent-sync-domain>/install.sh | sh
vitalmcp setup
```

The installer writes to `~/.vitalmcp/npm-global`, manages one marked shell PATH block, never uses sudo, and preserves local Vital Agent Sync data under `~/.vital-agent-sync` on `install.sh --uninstall`.

This auto-selects the current platform's service manager, auto-detects a supported Agent config when possible, installs the background receiver, starts it, and prints a 10-minute iPhone pairing QR. If Hermes is detected, it writes the Hermes MCP config and installs the Vital Agent Sync Hermes skill. After the first successful pair and sync, the terminal can close.

For a global install:

```bash
npm install -g vitalmcp
vitalmcp setup
```

Run this before publishing a tarball or release:

```bash
npm run typecheck
npm test
npm run pack:check
```

For the relay release gate, run this from the repository root:

```bash
npm run audit:relay-local
npm run audit:relay-container
npm run audit:relay-package
npm run audit:agent-adapters
npm run audit:dependencies
npm run audit:secrets
```

The container gate requires a running Docker daemon. It builds the relay image, validates the production Caddyfile, runs the active audit against a hardened temporary container, checks logs and relay cleanup, and removes its uniquely named temporary resources.

The package gate creates the publishable tarball, installs it into a temporary global prefix with a private npm cache, then uses only that installed binary for relay fixture upload/pull, SQLite status, active audit, and OpenClaw Skill export. The cold install prints a 15-second heartbeat and has a five-minute timeout with bounded npm fetch retries. It removes the temporary install, secrets, databases, cache, and child processes on completion, failure, or interruption.

The Agent adapter gate requires a local Hermes CLI. It uses a temporary HOME, calls `vital_agent_status` through a generic MCP client, installs isolated Hermes config and skill files, and verifies that Hermes connects and discovers all 12 Vital Agent Sync tools. It does not modify the user's normal Hermes configuration.

The secret gate scans tracked and unignored non-website release files for private keys, common provider tokens, literal Vital Agent Sync credentials, real `.env` files, local SQLite/Keychain artifacts, and runtime secret paths. It runs a built-in rule self-test first and reports only rule IDs plus locations, never suspected values. `release:npm-preflight` runs this gate automatically.

Before deploying a real hosted relay, set `VITALMCP_RELAY_DOMAIN`, separate API/metrics tokens, and a pinned image, then run `npm run preflight:relay-production`. It parses the final Compose model without starting services or printing token values. After deployment, set `VITALMCP_HOSTED_RELAY_URL` and run `npm run audit:relay-hosted -- --yes`; the wrapper keeps tokens out of command arguments and runs both passive and disposable-tenant active audits. Before publishing npm, use `npm run release:npm-preflight`; it checks the worktree, artifact, npm identity, and registry version but never publishes.

## Commands

Current package commands:

```bash
npx -y vitalmcp
npx -y vitalmcp setup
npx -y vitalmcp setup --agent hermes
npx -y vitalmcp setup --agent openclaw
npx -y vitalmcp setup --agent auto
npx -y vitalmcp ensure
npx -y vitalmcp init
npx -y vitalmcp init --agent hermes
npx -y vitalmcp init --hermes
npx -y vitalmcp daemon
npx -y vitalmcp pair
npx -y vitalmcp service install
npx -y vitalmcp service install --manager systemd
npx -y vitalmcp service start
npx -y vitalmcp service status
npx -y vitalmcp service status --mode relay-pull
npx -y vitalmcp logs
npx -y vitalmcp logs --mode relay-pull
npx -y vitalmcp logs --lines 200
npx -y vitalmcp service stop
npx -y vitalmcp service uninstall
npx -y vitalmcp init --transport lan
npx -y vitalmcp init --transport tailscale --tailscale-name my-mac.tailnet.ts.net
npx -y vitalmcp --port 8787
npx -y vitalmcp --db ~/.vital-agent-sync/vital-agent.sqlite
npx -y vitalmcp mcp
npx -y vitalmcp print-mcp-config
npx -y vitalmcp print-agent-config --agent generic
npx -y vitalmcp print-agent-config --agent openclaw
npx -y vitalmcp setup --agent workbuddy --workbuddy-project ~/VitalAgentSync
npx -y vitalmcp print-docker-compose --server-url http://192.168.31.53:8787
# Future/experimental relay operator commands (not the Local Preview onboarding path)
npx -y vitalmcp print-relay-docker-compose
npx -y vitalmcp setup --transport relay --relay-url https://relay.example.com --agent hermes
npx -y vitalmcp setup --transport relay --relay-url https://relay.example.com --agent generic
npx -y vitalmcp setup --transport self-hosted-relay --relay-url http://192.168.31.53:8790
npx -y vitalmcp print-onboarding --transport self-hosted-relay --relay-url http://192.168.31.53:8790
npx -y vitalmcp relay serve
npx -y vitalmcp relay serve --retention-days 30 --max-envelope-bytes 524288 --max-uploads-per-minute 120 --max-queued-envelopes-per-user 1000 --max-devices-per-user 5
npx -y vitalmcp relay serve --relay-api-token ios-and-local-runtime-token
npx -y vitalmcp relay serve --metrics-token operator-metrics-token
npx -y vitalmcp relay status
npx -y vitalmcp relay audit --relay-url https://relay.example.com
npx -y vitalmcp relay audit --relay-url https://relay.example.com --metrics-token operator-metrics-token
npx -y vitalmcp relay audit --relay-url https://relay.example.com --metrics-token operator-metrics-token --relay-api-token deployment-api-token --active --yes
npx -y vitalmcp relay unlink --yes
npx -y vitalmcp relay rotate --yes
npx -y vitalmcp relay reset --yes
npx -y vitalmcp relay migrate --yes --transport self-hosted-relay --relay-url https://relay.example.com
npx -y vitalmcp relay fixture --date 2026-07-08 --steps 7777
npx -y vitalmcp pull
npx -y vitalmcp pull --once
npx -y vitalmcp pull --watch --interval-seconds 300
npx -y vitalmcp print-skill
npx -y vitalmcp print-skill --agent hermes
npx -y vitalmcp print-skill --agent openclaw
npx -y vitalmcp export-skill --agent openclaw --output-dir ./vitalmcp-openclaw-skill
npx -y vitalmcp install-hermes
npx -y vitalmcp install-hermes-skill
npx -y vitalmcp status
npx -y vitalmcp doctor --agent hermes --transport lan
```

Recommended background pairing command:

```bash
npx -y vitalmcp setup
```

This installs and starts the receiver with the current platform's service manager, waits for it to become reachable, and prints a 10-minute pairing QR. macOS uses `launchd`; Linux uses a user-level `systemd` unit. `setup` auto-detects Hermes/OpenClaw when their config exists; pass `--agent hermes`, `--agent openclaw`, or `--agent generic` to force a specific adapter. After pairing, the terminal can close while the background receiver keeps accepting iOS syncs.

For Agent startup hooks, use the idempotent receiver check:

```bash
npx -y vitalmcp ensure
```

`ensure` installs the platform service if missing, starts it if stopped, waits for `/health/status`, and then prints service status. It does not rewrite Agent config, install skills, or print a pairing QR. Use it when an Agent wants to make sure Vital Agent Sync is available before loading MCP tools.

If the QR expires, do not reinstall the service. Print a fresh pairing code:

```bash
npx -y vitalmcp pair
```

By default, `setup` and `ensure` start at port `8787`. If that port is already occupied and no Vital Agent Sync receiver is reachable there, the CLI automatically picks the next available port, writes that port into the background service, and prints a QR using the selected port. Pass `--port` when you need a fixed port:

```bash
npx -y vitalmcp setup --port 8788
```

If the background receiver is already running, do not run setup again; print a fresh QR instead:

```bash
npx -y vitalmcp pair
```

For explicit `--server-url` deployments, keep the port and URL aligned yourself. The CLI will not rewrite a user-provided public, Tailscale, or reverse-proxy URL.

Foreground compatibility command:

```bash
npx -y vitalmcp init --hermes
```

`init` starts the receiver, creates a pairing session, prints a terminal QR code, shows the QR page URL, and prints MCP config hints for agents. It runs in the foreground and remains useful for debugging. Add `--agent hermes` or the compatible `--hermes` alias to also back up and write `~/.hermes/config.yaml` before the receiver starts, so Hermes uses the same default database after restart or `/reload-mcp`.

## Pairing And Sync

Run the local receiver in the foreground:

```bash
npm run dev:local
```

Expected output:

```text
Vital Agent Sync running

Pairing page: http://127.0.0.1:8787/pair
LAN address:  http://192.168.x.x:8787
Local API:    http://127.0.0.1:8787
Database:     ~/.vital-agent-sync/vital-agent.sqlite
```

Open the pairing page or scan the terminal QR code with the Vital Agent app, approve the pairing, then sync from the iOS app.

For the background receiver, use:

```bash
npx -y vitalmcp service status
npx -y vitalmcp logs
npx -y vitalmcp pair
```

`service status` prints the selected service manager, config path, database path, receiver reachability, logs, and last sync timestamp. `logs` tails launchd log files on macOS and `journalctl --user -u vitalmcp.service` on systemd hosts. Use `logs --lines 200` when debugging longer startup or sync sessions. macOS daemon logs live under:

```text
~/.vital-agent-sync/logs/daemon.out.log
~/.vital-agent-sync/logs/daemon.err.log
```

The iPhone must use the LAN, Tailscale, tunnel, or public HTTPS address. `127.0.0.1` only works from the same machine as the receiver.

If the service manager says the service is running but `Receiver` is not reachable, use:

```bash
npx -y vitalmcp logs
npx -y vitalmcp doctor --agent hermes
lsof -nP -iTCP:8787 -sTCP:LISTEN
```

This usually means the daemon failed during startup, Node.js is not available from the service environment, or another process owns the configured port.

Pairing is persistent. After the first setup, the iOS app keeps the server URL, device ID, and device token, while `vitalmcp` stores synced summaries in the same SQLite database used by MCP. The Agent does not need to reload MCP after every sync; it reads the latest database rows the next time a tool is called.

The v0.1 delivery promise is manual Sync Now plus catch-up when the iOS app is active or returns to the foreground. iOS background opportunities are best-effort. Vital Agent Sync does not promise a daily or weekly delivery schedule, an exact interval, or a guaranteed background time.

## Agent Integration

Use MCP mode for Hermes or any MCP-compatible agent:

```bash
npm run build:local
node packages/local/dist/cli.js mcp
node packages/local/dist/cli.js mcp --db ~/.vital-agent-sync/vital-agent.sqlite
```

Local development MCP config:

```json
{
  "mcpServers": {
    "vital-agent-sync": {
      "command": "node",
      "args": [
        "/Users/coooder/Code/Agent/personal-gateway-ios/packages/local/dist/cli.js",
        "mcp",
        "--db",
        "/Users/coooder/.vital-agent-sync/vital-agent.sqlite"
      ]
    }
  }
}
```

Published package MCP config:

```json
{
  "mcpServers": {
    "vital-agent-sync": {
      "command": "npx",
      "args": ["-y", "vitalmcp", "mcp"]
    }
  }
}
```

Available MCP tools:

- `vital_agent_status`
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

A Vital Agent Sync Skill should tell the agent to:

- use `get_personal_context` first for broad health, recovery, exercise, or activity questions
- use lower-level tools for specific follow-up questions
- mention data freshness before giving advice
- avoid medical diagnosis or prescriptions

Hermes can install such a skill as an experience enhancement, but generic MCP-compatible agents should still work with the MCP config alone.

## Adapter Helpers

```bash
npx -y vitalmcp print-mcp-config
npx -y vitalmcp print-agent-config --agent generic
npx -y vitalmcp print-agent-config --agent hermes
npx -y vitalmcp print-skill
npx -y vitalmcp install-hermes
npx -y vitalmcp install-hermes-skill
npx -y vitalmcp init --agent hermes
npx -y vitalmcp init --agent openclaw
npx -y vitalmcp init --agent workbuddy --workbuddy-project ~/VitalAgentSync
npx -y vitalmcp init --hermes --install-skill
npx -y vitalmcp doctor --agent hermes
npx -y vitalmcp doctor --agent openclaw
npx -y vitalmcp doctor --agent workbuddy --workbuddy-project ~/VitalAgentSync
npx -y vitalmcp doctor --transport lan
```

`print-mcp-config`, `print-agent-config --agent generic`, and `print-agent-config --agent workbuddy` print standard `mcpServers.vital-agent-sync` JSON. WorkBuddy setup defaults to user scope and merges `~/.workbuddy/mcp.json`; pass `--workbuddy-project <dir>` to merge `<dir>/.workbuddy/mcp.json`, or `--workbuddy-config <path>` for an explicit file. Existing JSON fields and other MCP servers are preserved, invalid JSON is rejected, and an existing file receives a timestamped backup. Confirm `vital-agent-sync` is green in WorkBuddy MCP settings and restart WorkBuddy if its tools do not appear. `print-agent-config --agent hermes` prints a Hermes-style `mcp_servers.vital-agent-sync` YAML snippet. `print-agent-config --agent openclaw` prints an OpenClaw-style `mcp.servers.vital-agent-sync` JSON snippet. `install-hermes` backs up `~/.hermes/config.yaml`, writes `mcp_servers.vital-agent-sync`, and uses the same local database and tool surface as `vitalmcp mcp`. `init --agent hermes` and `init --hermes` perform the same Hermes install step as part of the foreground pairing flow. `init --agent openclaw` backs up and writes `~/.openclaw/openclaw.json` when it is valid JSON; use `--openclaw-config <path>` for a custom file.

Current WorkBuddy documentation defines user-level `~/.workbuddy/mcp.json` and project-level `<project>/.workbuddy/mcp.json`, both with the standard `mcpServers` shape. Vital Agent Sync deliberately does not write model-provider configuration. See the [WorkBuddy MCP guide](https://www.codebuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/MCP-Guide).

`print-skill` prints Vital Agent Sync Skill Markdown parameterized for `generic`, `hermes`, `openclaw`, or `workbuddy`; setup commands and mobile trigger sources follow the selected adapter. `install-hermes-skill` writes the Hermes-targeted form to `~/.hermes/skills/health/vitalmcp-personal-context/SKILL.md` with a timestamped backup when replacing an existing file. `setup` auto-detects Hermes and installs the Hermes MCP config and Skill by default when Hermes config is present. Use `setup --agent hermes` to force Hermes, or `init --hermes --install-skill` when you want the same Skill install behavior in the foreground flow. `export-skill --agent openclaw` writes a ClawHub package with `SKILL.md` and `README.md`; `export-skill --agent workbuddy` writes a minimal SkillHub-compatible package containing only `SKILL.md`. The committed WorkBuddy package lives at `skills/vital-agent-sync` so SkillHub can import it directly from GitHub.

Use `status` to inspect the local database and paired source devices. Use `doctor` to check Node.js, the SQLite database, MCP command generation, the selected Agent adapter, the selected transport provider, the platform service manager, and local receiver reachability.

Transport providers are selected with `--transport`. `lan` is the Local Preview default. `tailscale` is the optional user-managed private remote path and can advertise the local 100.64.0.0/10 IPv4 address when Tailscale is active. `relay` and `self-hosted-relay` are future/experimental Local Preview paths that initialize the E2EE relay runtime instead of the direct receiver; use `pull` to decrypt relay envelopes into the local MCP database. Future direct transports such as `cloudflare`, `ngrok`, and `public_https` can be selected for diagnostics and can advertise an explicit endpoint with `--server-url` until their native provider implementations land.

For Tailscale MagicDNS, pass `--tailscale-name <host.tailnet.ts.net>` or set `VITALMCP_TAILSCALE_NAME`. The user must install and sign in to Tailscale on the iPhone and receiver, and both devices must belong to the same authorized tailnet. If no name is provided, Vital Agent Sync attempts to read `tailscale status --json` and falls back to the local Tailscale IPv4 address.

The source-device API is available at `/source-devices` and `/source-devices/:source_device_id/revoke`. The older `/devices` endpoints and MCP tools remain for compatibility with the current iOS app and older agent configs.

`print-docker-compose` prints a Docker Compose file for direct receiver deployments. Always pass an iPhone-reachable `--server-url`, such as the host LAN IP, Tailscale URL, or public HTTPS URL. Do not use `127.0.0.1`, `localhost`, a container hostname, or a WSL-only address for iPhone pairing.

`print-relay-docker-compose` prints a Docker Compose file for a self-hosted E2EE relay. The relay stores opaque encrypted envelopes plus hashed tenant/revocation metadata in `/data/relay.sqlite`; it does not decrypt health payloads. Pair the local runtime against that relay with `setup --transport self-hosted-relay --relay-url <relay-url>`. Relay setup installs a separate `relay-pull` background service on launchd/systemd platforms. `pull --once` is the explicit one-shot form; `pull --watch --interval-seconds 300` keeps polling from a foreground process or external supervisor.

Future/experimental hosted relay deployments must set `VITALMCP_HOSTED_RELAY_URL` or pass `--relay-url` before running `setup --transport relay`; the URL must use HTTPS. `VITALMCP_RELAY_URL` is a generic configured fallback, and `--relay-url` always takes precedence. Vital Agent Sync intentionally fails before writing setup state when a hosted URL is absent or insecure. Self-hosted relay mode may use HTTP on a user-controlled network and defaults to `http://127.0.0.1:8790` for local development.

Relay server deployments can also set `VITALMCP_RELAY_HOST`, `VITALMCP_RELAY_PORT`, `VITALMCP_RELAY_DB`, `VITALMCP_RELAY_RETENTION_DAYS`, `VITALMCP_RELAY_MAX_ENVELOPE_BYTES`, `VITALMCP_RELAY_MAX_UPLOADS_PER_MINUTE`, `VITALMCP_RELAY_MAX_QUEUED_ENVELOPES_PER_USER`, `VITALMCP_RELAY_MAX_DEVICES_PER_USER`, `VITALMCP_RELAY_TRUST_PROXY`, `VITALMCP_RELAY_API_TOKEN`, and `VITALMCP_RELAY_METRICS_TOKEN`; explicit CLI flags override these environment values. Enable trust-proxy mode only when port 8790 is private behind a trusted proxy that rebuilds `X-Forwarded-For`. Data/lifecycle endpoints always require the generated per-runtime `relay_access_token` as `Authorization: Bearer <token>` and store only its SHA-256 hash. When a deployment API token is set, clients additionally send it through `X-Vital-Agent-Relay-API-Key`. When a metrics token is set, `/v1/metrics` requires its separate `Authorization: Bearer <token>`.

The onboarding QR, `vitalmcp://onboard` link, and `vital-agent-e2ee-v1:` text code contain `upload_auth_secret`, `relay_access_token`, and sometimes `relay_api_token`. Transfer them only to the intended Vital Agent Sync source device; do not paste them into Agent chat, logs, memory, issue trackers, or support messages.

## Background Service And Deployment Methods

Vital Agent Sync deployment is about where the receiver, SQLite database, and MCP process run. The Agent type is configured separately through `--agent` or `print-agent-config`.

`setup`, `ensure`, and `service` choose a manager automatically:

- macOS: `launchd`
- Linux: user-level `systemd`
- Windows and other platforms: `manual` guidance for now

Override the manager when needed:

```bash
vitalmcp setup --agent hermes --manager systemd
vitalmcp service status --manager systemd
```

### Mac local mode

On macOS, `service install` writes `~/Library/LaunchAgents/com.vitalmcp.local.plist` and runs:

```bash
vitalmcp daemon --host 0.0.0.0 --port 8787 --db ~/.vital-agent-sync/vital-agent.sqlite --transport lan
```

Use `vitalmcp logs` to inspect the service logs. The raw files are `~/.vital-agent-sync/logs/daemon.out.log` and `~/.vital-agent-sync/logs/daemon.err.log`.

### Home server / NAS / N100 mode

For an always-on Linux home server, `setup --manager systemd` writes `~/.config/systemd/user/vitalmcp.service`, enables it, starts it, waits for the receiver, and prints a QR:

```bash
vitalmcp setup --agent generic --manager systemd
```

For SSH-based LAN installs, Vital Agent Sync tries to advertise the server address automatically. It checks the SSH session's local address first, then the default route source address, then non-virtual LAN interfaces. For example, `ssh jarvis@192.168.31.53` should usually produce a pairing URL using `http://192.168.31.53:8787`.

If the printed pairing URL uses an address the iPhone cannot reach, pass the URL explicitly:

```bash
vitalmcp setup --agent generic --manager systemd --server-url http://192.168.31.53:8787
```

The systemd unit runs:

```bash
vitalmcp daemon \
  --host 0.0.0.0 \
  --port 8787 \
  --db ~/.vital-agent-sync/vital-agent.sqlite \
  --transport lan
```

For boot-time startup when the user is not logged in, the host may also need user lingering enabled by an administrator:

```bash
loginctl enable-linger "$USER"
```

If the iPhone reaches the server through Tailscale, advertise the Tailscale name or address:

```bash
vitalmcp setup --agent generic --transport tailscale --tailscale-name vital-agent-sync.tailnet.ts.net
```

Windows hosts are detected as `manual` in the first implementation. Run `vitalmcp daemon` manually, or use Docker/PM2 until Task Scheduler or Windows Service support lands.

### LAN / Tailscale recovery

- Run `vitalmcp service status`, `vitalmcp logs`, and `vitalmcp doctor --transport lan` for a local connection.
- Reject pairing URLs that use `127.0.0.1`, `localhost`, a container hostname, or an address the iPhone cannot reach.
- For Tailscale, confirm both devices are online in the same authorized tailnet, then run `vitalmcp doctor --transport tailscale --tailscale-name <host.tailnet.ts.net>`.
- Run `vitalmcp pair` when a QR expires. To revoke a phone, call MCP `revoke_source_device`, remove the saved connection in iOS, and pair again. Revocation does not delete local SQLite history.

### WSL mode

WSL is treated as a Linux deployment variant. If systemd is enabled inside WSL, this command can use the same user-level systemd path as Linux:

```bash
vitalmcp setup --agent generic
```

The hard part is networking. The iPhone must reach the receiver through a Windows host LAN IP, Tailscale address, or public HTTPS URL. `127.0.0.1`, `localhost`, container names, and WSL-only IPs are not valid iPhone pairing URLs. If LAN access to WSL is unreliable, prefer Docker Desktop with explicit port publishing or Tailscale.

### Docker Compose mode

Docker is a separate deployment method. It works on Linux, NAS/N100 machines, WSL, and Windows Docker Desktop when the host publishes port `8787` and stores SQLite in a mounted volume.

Generate a standalone compose file that runs the published npm package in `node:22-bookworm-slim`:

```bash
vitalmcp print-docker-compose --server-url http://192.168.31.53:8787 > docker-compose.yml
```

Or use the source-build template in `deploy/docker/docker-compose.yml` from this repository:

```bash
export VITALMCP_SERVER_URL=http://192.168.31.53:8787
docker compose -f deploy/docker/docker-compose.yml up --build
```

The container stores data at `/data/vital-agent.sqlite`, backed by `./vital-agent-sync-data` on the Docker host. If the Agent runs outside the container, point MCP at the host copy of that SQLite file or mount the same volume into the Agent runtime.

For self-hosted relay mode, generate a relay-only compose file:

```bash
vitalmcp print-relay-docker-compose > docker-compose.relay.yml
docker compose -f docker-compose.relay.yml up -d
```

Then initialize the local runtime with the relay URL that iOS can reach:

```bash
vitalmcp setup --transport self-hosted-relay --relay-url http://192.168.31.53:8790 --agent hermes
vitalmcp pull
```

The relay data volume contains encrypted envelopes plus hashed tenant credentials and revocation metadata. It contains no health plaintext or raw tenant token; private decryption keys stay under `~/.vital-agent-sync/secrets` on the local runtime machine.

For local relay development, generate a mobile-equivalent encrypted fixture envelope from the current relay runtime:

```bash
vitalmcp relay fixture --date 2026-07-08 --steps 7777 > envelope.json
```

From this repository, run the full self-host smoke flow without an iOS device:

```bash
npm --workspace vitalmcp run relay:fixture-flow
```

That script starts a temporary relay, creates local runtime keys, posts an encrypted fixture, pulls/decrypts it into SQLite, and prints the MCP-readable daily summary.

`vitalmcp status`, `vitalmcp doctor`, and MCP `vital_agent_status` include relay runtime freshness when relay mode is initialized: transport mode, relay URL, latest pulled sequence, last successful pull time, failed envelope details, and the next suggested action.

Relay mode uses its own service mode so it can coexist with any direct receiver service:

```bash
vitalmcp service status --mode relay-pull
vitalmcp logs --mode relay-pull
vitalmcp service stop --mode relay-pull
```

Hosted relay beta operators should run `relay serve` with explicit limits, a deployment API key, and a metrics token. The relay exposes `/v1/status` and `/v1/metrics` with aggregate counts and configured limits only; these endpoints do not return envelope bodies. Tenant Bearer authorization is always enforced. Set `VITALMCP_RELAY_API_TOKEN` or pass `--relay-api-token` to add the `X-Vital-Agent-Relay-API-Key` closed-beta gate. Set `VITALMCP_RELAY_METRICS_TOKEN` or pass `--metrics-token` so `/v1/metrics` is operator-only.

Lifecycle commands are destructive and require `--yes`: `relay unlink` revokes the current device, `relay rotate` replaces keys/credentials while preserving IDs, and `relay reset` revokes the old identity and creates new IDs. All purge affected queued envelopes and require fresh iOS onboarding.
After deployment, run `vitalmcp relay audit --relay-url <relay-url> --metrics-token <operator-token>` to verify status, metrics, aggregate status page, configured limits, and absence of known sensitive field names in public responses. Then run the explicit `--relay-api-token <deployment-token> --active --yes` mode to create two disposable identities and verify cross-tenant isolation, purge, unlink, rotation, revocation, old-token rejection, and cleanup using random opaque envelopes. Active mode never uploads health plaintext or prints its generated credentials.

For the full hosted beta gate, including local evidence, generic MCP/Hermes compatibility, iOS device checks, HTTPS, backups, logs, retention verification, and the separate optional OpenClaw publishing gate, see `docs/e2ee-relay-release-audit.md` from the repository root.

Source-built relay containers are available in the repository:

```bash
docker compose -f deploy/relay/docker-compose.yml up --build -d
```

For migration and mode selection details, see:

- [Hosted Relay To Self-Hosted Relay Migration](../../docs/e2ee-relay-hosted-to-self-hosted-migration.md)
- [Direct Gateway Vs E2EE Relay](../../docs/e2ee-relay-mode-comparison.md)
- [E2EE Relay Protocol v1](../../docs/e2ee-relay-protocol-v1.md)

### User-owned VPS / public HTTPS mode

For a VPS, run the receiver behind user-managed HTTPS and pass the public URL:

```bash
vitalmcp daemon \
  --host 0.0.0.0 \
  --port 8787 \
  --transport public_https \
  --server-url https://agent.example.com/vital-agent-sync
```

This mode requires the user to manage DNS, TLS, reverse proxying, persistence, and server security. Health summaries leave the home network, but remain on the user's own infrastructure.

The `pair` command still talks to the receiver through `http://127.0.0.1:<port>/pair/start`; for server deployments, run `pair` on the receiver host or generate the pairing URL through the receiver's trusted admin surface.

See `docs/deployment-methods.md` in the repository for the full matrix.
