# HealthLink Common Deployment Methods

This document describes the common ways to run HealthLink. It is organized by deployment method, not by Agent runtime. Hermes, OpenClaw, WorkBuddy, Claude, Codex, and other MCP-compatible Agents are consumers of the same HealthLink MCP surface.

The three deployment methods to support first are:

1. Mac local mode
2. Home server / NAS / N100 mode
3. User-owned VPS / public HTTPS mode

## Comparison

| Method | Receiver | Database | MCP | iPhone path | Support |
| --- | --- | --- | --- | --- | --- |
| Mac local | User's Mac | `~/.healthlink/healthlink.sqlite` on Mac | Same Mac | LAN QR URL | Supported, default path |
| Home server / NAS / N100 | Always-on home server | Server-local SQLite | Same server or LAN host | LAN or Tailscale URL | Supported by `daemon`; process manager is user-managed |
| User-owned VPS / HTTPS | User's VPS | VPS-local SQLite | Same VPS or adjacent host | HTTPS URL | Power-user path; requires user-managed HTTPS |

## 1. Mac Local Mode

Best for first-time setup, local testing, and users whose Agent runs on the same Mac.

```text
iPhone
  -> same Wi-Fi / LAN
  -> macOS HealthLink receiver
  -> ~/.healthlink/healthlink.sqlite
  -> local MCP stdio
  -> MCP-compatible Agent
```

Recommended command:

```bash
npx -y healthlink-local setup --agent hermes --service
```

What it does:

- Writes Agent MCP config for the selected Agent.
- Installs the macOS `launchd` receiver.
- Starts the receiver on `0.0.0.0:8787`.
- Prints a 10-minute iPhone pairing QR.
- Stores synced summaries in `~/.healthlink/healthlink.sqlite`.

If the QR expires:

```bash
npx -y healthlink-local pair
```

Diagnostics:

```bash
npx -y healthlink-local service status
npx -y healthlink-local logs
npx -y healthlink-local doctor --transport lan
lsof -nP -iTCP:8787 -sTCP:LISTEN
```

Privacy boundary: data stays on the user's Mac unless the connected Agent sends MCP output to a cloud model.

## 2. Home Server / NAS / N100 Mode

Best for users who have an always-on machine at home and want the receiver to keep running when the laptop is closed.

```text
iPhone
  -> LAN or Tailscale
  -> home Linux/NAS/N100 receiver
  -> server-local SQLite
  -> MCP stdio on the same server or another LAN host
  -> MCP-compatible Agent
```

Recommended receiver command:

```bash
healthlink-local daemon \
  --host 0.0.0.0 \
  --port 8787 \
  --db ~/.healthlink/healthlink.sqlite \
  --transport lan
```

For Tailscale:

```bash
healthlink-local daemon \
  --host 0.0.0.0 \
  --port 8787 \
  --db ~/.healthlink/healthlink.sqlite \
  --transport tailscale \
  --tailscale-name healthlink.tailnet.ts.net
```

Run the command under the server's process manager, such as systemd, PM2, Docker Compose, or the NAS vendor's service manager. HealthLink does not install those managers in the first version.

Pairing:

- Run `healthlink-local pair` on the server when the receiver is reachable from the server loopback.
- If pairing is generated through another admin surface, the `server` value must be the LAN or Tailscale URL that the iPhone can reach.

Diagnostics:

```bash
healthlink-local status --db ~/.healthlink/healthlink.sqlite
healthlink-local doctor --transport lan
healthlink-local doctor --transport tailscale --tailscale-name healthlink.tailnet.ts.net
```

Privacy boundary: data stays on the user's home server or private mesh network. Tailscale keeps the receiver off the public internet.

## 3. User-Owned VPS / Public HTTPS Mode

Best for users whose Agent already runs on a VPS or who want sync to work outside the home network without Tailscale.

```text
iPhone
  -> HTTPS
  -> user-owned VPS receiver
  -> VPS-local SQLite
  -> MCP stdio on the VPS
  -> MCP-compatible Agent
```

Recommended receiver command behind a user-managed reverse proxy:

```bash
healthlink-local daemon \
  --host 0.0.0.0 \
  --port 8787 \
  --db ~/.healthlink/healthlink.sqlite \
  --transport public_https \
  --server-url https://healthlink.example.com
```

The reverse proxy must terminate HTTPS and forward to the receiver. HealthLink does not currently install TLS certificates, configure Nginx/Caddy, or manage DNS.

Pairing:

- The iPhone pairing URL must use the public HTTPS `server_url`.
- Run `healthlink-local pair` on the VPS, or generate the same `/pair/start` response through a trusted admin path.

Diagnostics:

```bash
healthlink-local doctor \
  --transport public_https \
  --server-url https://healthlink.example.com

healthlink-local logs
```

Privacy boundary: health summaries leave the phone and home network, but are still stored on infrastructure controlled by the user. This mode should not be described as "local-only".

## Out Of Scope For The First Deployment Pass

- HealthLink-hosted cloud relay.
- Automatic Cloudflare Tunnel, ngrok, or FRP process management.
- SSH-based remote installation.
- Official Docker image publishing.
- Remote MCP over HTTPS.
- Agent-specific install logic; see the Agent Adapter work instead.
