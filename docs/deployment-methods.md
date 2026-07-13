# HealthLink Common Deployment Methods

This document describes the common ways to run HealthLink. It is organized by deployment method, not by Agent runtime. Hermes, OpenClaw, WorkBuddy, Claude, Codex, and other MCP-compatible Agents are consumers of the same HealthLink MCP surface.

The common deployment methods to support first are:

1. Mac local mode over LAN (default)
2. Home server / NAS / N100 mode over LAN or optional Tailscale
3. Docker Compose mode
4. User-owned VPS / public HTTPS mode (advanced)

## Local Preview Decision

New users start on LAN with `vitalmcp setup`. The iPhone and receiver must share a reachable trusted network, but the user does not need a relay URL, VPS, domain, VitalMCP account, payment method, or Agent marketplace listing.

Tailscale is the optional private remote path for use away from the receiver's LAN. The user must install and sign in to Tailscale on the iPhone and receiver machine, and authorize both devices on the same tailnet. VitalMCP uses that tailnet but does not install the apps, create an account, or approve devices.

Hosted Relay is future/experimental during Local Preview. Relay implementation and protocol documentation remain available for engineering work, but hosted relay is not a default or recommended deployment method here.

## Comparison

| Method | Receiver | Database | MCP | iPhone path | Support |
| --- | --- | --- | --- | --- | --- |
| Mac local | User's Mac | `~/.healthlink/healthlink.sqlite` on Mac | Same Mac | LAN QR URL | Supported, default path |
| Home server / NAS / N100 | Always-on home server | Server-local SQLite | Same server or LAN host | LAN or Tailscale URL | Supported by `daemon` and Linux user-level `systemd` service |
| Docker Compose | Docker host | Mounted `/data/healthlink.sqlite` volume | Same host or shared volume | Host LAN, Tailscale, or HTTPS URL | Template and compose printer supported |
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
npx -y vitalmcp setup
```

What it does:

- Auto-detects Hermes/OpenClaw when their config exists.
- Writes Agent MCP config for the selected Agent.
- Installs the macOS `launchd` receiver.
- Starts the receiver on `0.0.0.0:8787`.
- Prints a 10-minute iPhone pairing QR.
- Stores synced summaries in `~/.healthlink/healthlink.sqlite`.

If the QR expires:

```bash
npx -y vitalmcp pair
```

If the local Agent has a startup hook, it can keep the receiver available without rerunning setup:

```bash
npx -y vitalmcp ensure
```

This is safe to run repeatedly. It ensures the background receiver service is installed and running, but does not rewrite Agent config or create a new pairing QR.

Diagnostics:

```bash
npx -y vitalmcp service status
npx -y vitalmcp logs
npx -y vitalmcp doctor --transport lan
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
vitalmcp setup --agent generic --manager systemd
```

For SSH-based LAN installs, HealthLink tries to advertise the server address automatically. It first checks the SSH session's local address, then the default route source address, then non-virtual LAN interfaces. A command such as `ssh jarvis@192.168.31.53` should usually produce a pairing URL using `http://192.168.31.53:8787` without an explicit `--server-url`.

Pass `--server-url` only when the auto-detected address is not reachable from the iPhone, or when the receiver is behind Tailscale, Docker, WSL, a reverse proxy, or public HTTPS:

```bash
vitalmcp setup --agent generic --manager systemd --server-url http://192.168.31.53:8787
```

This writes and starts a user-level systemd unit at:

```text
~/.config/systemd/user/vitalmcp.service
```

The service runs:

```bash
vitalmcp daemon \
  --host 0.0.0.0 \
  --port 8787 \
  --db ~/.healthlink/healthlink.sqlite \
  --transport lan
```

For boot-time startup when the SSH user is not logged in, the host may also need user lingering enabled by an administrator:

```bash
loginctl enable-linger "$USER"
```

If the Agent starts on the same Linux user account, add this to the Agent startup hook:

```bash
vitalmcp ensure --manager systemd
```

That command can repair a stopped receiver before the Agent loads MCP. If the host uses Docker, PM2, Task Scheduler, or a NAS vendor process manager instead of systemd, configure that process manager to run `vitalmcp daemon`; `ensure` only manages built-in launchd/systemd services.

For Tailscale, use the supported private HTTPS route (full requirements and physical-device checks: [Tailscale HTTPS Onboarding For iOS](tailscale-ios-onboarding.md)):

```bash
vitalmcp setup \
  --agent generic \
  --manager systemd \
  --transport tailscale \
  --tailscale-name receiver.example-tailnet.ts.net
```

After consent, setup configures `tailscale serve --bg --yes --https=443 http://127.0.0.1:8787`. The pairing QR advertises `https://receiver.example-tailnet.ts.net`. Plain HTTP MagicDNS and raw `100.x` endpoints are not supported for iOS onboarding.

If systemd is not available on the NAS, run the daemon under PM2, Docker Compose, or the NAS vendor's service manager.

Pairing:

- Run `vitalmcp pair` on the server when the receiver is reachable from the server loopback.
- Check the printed pairing URL before scanning; the `server` value must be the LAN, Tailscale, or HTTPS URL that the iPhone can reach.
- If auto-detection prints `127.0.0.1`, a Docker bridge, a WSL-only address, or the wrong NIC, rerun `setup` or `pair` with `--server-url`.

Diagnostics:

```bash
vitalmcp status --db ~/.healthlink/healthlink.sqlite
vitalmcp service status --manager systemd
vitalmcp logs --manager systemd
vitalmcp doctor --transport lan
vitalmcp doctor --transport tailscale --tailscale-name receiver.example-tailnet.ts.net
tailscale serve status --json
```

Privacy boundary: data stays on the user's home server or private mesh network. Tailscale keeps the receiver off the public internet.

### LAN / Tailscale Troubleshooting And Reset

- Run `vitalmcp service status`, `vitalmcp logs`, and `vitalmcp doctor --transport lan`.
- Confirm the pairing QR uses an iPhone-reachable address, never `127.0.0.1`, `localhost`, or a container-only hostname.
- For Tailscale, confirm both devices are online in the same authorized tailnet, then run `vitalmcp doctor --transport tailscale --tailscale-name <host.tailnet.ts.net>`.
- Run `vitalmcp pair` if the QR expires.
- To revoke a paired phone, call MCP `revoke_source_device`, remove the saved connection in iOS, and pair again. Revocation preserves local SQLite history.

The v0.1 delivery promise is manual Sync Now plus catch-up when the iOS app is active or returns to the foreground. Background opportunities are best-effort; none of these deployment modes promises scheduled daily/weekly delivery or an exact background interval.

Windows hosts are currently treated as `manual`: run `vitalmcp daemon` manually or use Docker/PM2 until Task Scheduler or Windows Service support is added.

### WSL Variant

WSL is treated as Linux. If systemd is enabled inside WSL, `vitalmcp setup --agent generic` can use the same systemd path.

The iPhone still needs a reachable host URL. Do not pair with `127.0.0.1`, `localhost`, a container hostname, or a WSL-only IP. Prefer a Windows host LAN IP, Tailscale URL, public HTTPS URL, or Docker Desktop with explicit port publishing.

## 3. Docker Compose Mode

Best for NAS/N100 users, Windows Docker Desktop users, WSL users, and servers where Docker is the preferred process manager.

```text
iPhone
  -> host LAN / Tailscale / HTTPS URL
  -> Docker host port 8787
  -> HealthLink receiver container
  -> /data/healthlink.sqlite mounted volume
  -> MCP-compatible Agent on the host or another container with the same volume
```

Generate a standalone compose file that runs the published npm package in `node:22-bookworm-slim`:

```bash
vitalmcp print-docker-compose --server-url http://192.168.31.53:8787 > docker-compose.yml
docker compose up --build
```

Or use the repository template when building from this source tree:

```bash
export HEALTHLINK_SERVER_URL=http://192.168.31.53:8787
docker compose -f deploy/docker/docker-compose.yml up --build
```

Both compose variants:

- publish `8787:8787`
- store SQLite in `./healthlink-data` on the Docker host
- pass `/data/healthlink.sqlite` to `vitalmcp daemon`
- require `HEALTHLINK_SERVER_URL`

The repository template additionally:

- builds from `deploy/docker/Dockerfile`

Pairing:

- Run `vitalmcp pair` inside the container, or use the receiver `/pair` page through the host URL.
- The pairing URL must use the Docker host address that the iPhone can reach, not `127.0.0.1` or a container hostname.

Diagnostics:

```bash
docker compose ps
docker compose logs healthlink
vitalmcp doctor --transport lan --server-url http://192.168.31.53:8787
```

Privacy boundary: data stays on the Docker host volume. If another Agent container reads the database, mount the same volume intentionally.

## 4. User-Owned VPS / Public HTTPS Mode

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
vitalmcp daemon \
  --host 0.0.0.0 \
  --port 8787 \
  --db ~/.healthlink/healthlink.sqlite \
  --transport public_https \
  --server-url https://healthlink.example.com
```

The reverse proxy must terminate HTTPS and forward to the receiver. HealthLink does not currently install TLS certificates, configure Nginx/Caddy, or manage DNS.

Pairing:

- The iPhone pairing URL must use the public HTTPS `server_url`.
- Run `vitalmcp pair` on the VPS, or generate the same `/pair/start` response through a trusted admin path.

Diagnostics:

```bash
vitalmcp doctor \
  --transport public_https \
  --server-url https://healthlink.example.com

vitalmcp logs
```

Privacy boundary: health summaries leave the phone and home network, but are still stored on infrastructure controlled by the user. This mode should not be described as "local-only".

## Out Of Scope For The First Deployment Pass

- HealthLink-hosted cloud relay.
- Automatic Cloudflare Tunnel, ngrok, or FRP process management.
- SSH-based remote installation.
- Official Docker image publishing.
- Remote MCP over HTTPS.
- Agent-specific install logic; see the Agent Adapter work instead.
