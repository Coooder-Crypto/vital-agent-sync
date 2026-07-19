# Deployment methods

Vital Agent Sync supports a deliberately narrow deployment ladder. Complete each stage before moving to the next.

## Support matrix

| Mode | Receiver and database | Agent | iPhone transport | Roadmap status |
| --- | --- | --- | --- | --- |
| WorkBuddy Local | same Mac as WorkBuddy | WorkBuddy | trusted LAN | current priority |
| Local Agent | same machine as Agent | Hermes, generic MCP, then other adapters | trusted LAN | next |
| Tailscale Server | same user-owned server as Agent | Hermes or generic MCP | Tailscale Serve HTTPS | later |

Not supported by the current roadmap: operator-hosted relay, public VPS/public DNS, Tailscale Funnel, remote network MCP, accounts, billing, or a managed cloud service.

## 1. WorkBuddy Local

Use this for the first complete product experience.

```text
iPhone
  -> trusted LAN
  -> vitalmcp receiver on the Mac
  -> SQLite on the Mac
  -> stdio MCP on the Mac
  -> WorkBuddy on the Mac
```

Preferred entry: install the Vital Agent Sync Skill from SkillHub and ask WorkBuddy to install it. Manual fallback:

```bash
npx -y vitalmcp@0.5.2 setup --agent workbuddy --transport lan
```

The setup flow plans and confirms changes before it:

- creates user-only state under `~/.vital-agent-sync`;
- preserves and backs up existing WorkBuddy MCP configuration;
- records one Node runtime/ABI identity for CLI, launchd, and MCP;
- writes one `launchd` receiver definition, then pauses for a one-command macOS Terminal activation because WorkBuddy cannot bootstrap LaunchAgents from its sandbox;
- pauses again for explicit WorkBuddy MCP approval, reload, and native tool verification;
- opens the short-lived QR in a loopback-only local page;
- waits for a physical-iPhone sync and MCP freshness verification.

Diagnostics:

```bash
vitalmcp service status
vitalmcp logs --lines 100
vitalmcp status --output json
vitalmcp doctor --agent workbuddy --transport lan
```

If setup returns `activate_service`, run only its command in macOS Terminal without `sudo`. If it reports `receiver_identity_conflict` or another `service_manager_failed`, stop and follow the official diagnostic. Do not migrate an older database, stop an unknown service, clear quarantine recursively, change shell profiles, edit MCP approval files, or invent another daemon.

## 2. Local Hermes And Other Agents

Use this only after WorkBuddy Local has passed its clean-profile and physical-device acceptance test.

```text
iPhone
  -> trusted LAN
  -> one local vitalmcp receiver and SQLite database
  -> one Agent-neutral stdio MCP implementation
  -> Hermes, generic MCP, OpenClaw, or another documented adapter
```

Commands:

```bash
npx -y vitalmcp@0.5.2 setup --agent hermes --transport lan
npx -y vitalmcp@0.5.2 setup --agent generic --transport lan
npx -y vitalmcp@0.5.2 setup --agent openclaw --transport lan
```

Adapter requirements:

- preserve unrelated configuration and create a backup before modification;
- point to the same `vitalmcp mcp` command and SQLite database;
- document detection, config paths, mutation policy, reload guidance, and removal behavior;
- use MCP for every health-data read;
- remain usable without an Agent marketplace listing.

Removing or upgrading one adapter must not remove `~/.vital-agent-sync`, revoke the iPhone, or break another Agent.

## 3. User-Owned Server Over Tailscale

Use this only after local Agent adapters are stable.

```text
iPhone with Tailscale
  -> https://receiver.<tailnet>.ts.net
  -> Tailscale Serve on the user-owned server
  -> loopback vitalmcp receiver
  -> server-local SQLite and stdio MCP
  -> Agent running as the same server user
```

Requirements:

- a user-owned macOS or Linux server;
- Node.js 22 or newer;
- Tailscale installed and authorized on the server and iPhone;
- MagicDNS and tailnet HTTPS enabled;
- a selected Agent running on the same server account;
- `systemd --user` on Linux or `launchd` on macOS.

Linux/Hermes example:

```bash
npx -y vitalmcp@0.5.2 setup \
  --agent hermes \
  --manager systemd \
  --transport tailscale \
  --tailscale-name receiver.example-tailnet.ts.net
```

After consent, setup may configure only this private route:

```bash
tailscale serve --bg --yes --https=443 http://127.0.0.1:8787
```

It must refuse:

- Tailscale Funnel;
- plain HTTP `.ts.net` URLs;
- raw `100.x` addresses as the certificate name;
- conflicting Serve root handlers;
- public DNS or public reverse-proxy instructions;
- remote MCP exposure.

The Agent consumes local stdio MCP on the server. A desktop WorkBuddy instance is not connected to server MCP in this phase.

Diagnostics:

```bash
tailscale status --json
tailscale serve status --json
vitalmcp service status --manager systemd
vitalmcp logs --manager systemd --lines 100
vitalmcp status --output json
vitalmcp doctor --transport tailscale \
  --tailscale-name receiver.example-tailnet.ts.net
```

Physical-device acceptance must include cellular/Wi-Fi separation, tailnet disconnect/reconnect, receiver restart, and server reboot without exposing credentials or requiring re-pairing.

## Data ownership and removal

All supported modes keep the runtime state and SQLite database under user control. Uninstalling an Agent Skill or adapter must not delete local data. Destructive reset, device revocation, and data deletion require separate explicit user actions.

The product does not promise exact iOS background intervals. Manual Sync Now and foreground catch-up are the supported delivery contract.
