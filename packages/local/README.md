# vitalmcp

`vitalmcp` is the user-owned runtime behind Vital Agent Sync. It receives user-authorized Apple Health summaries, stores them in SQLite, and exposes scoped context to personal AI Agents through local stdio MCP.

It is not an Agent, hosted health service, medical device, or source of medical advice.

## Supported product order

The runtime is being productized in this order:

1. WorkBuddy and `vitalmcp` on one Mac, with the iPhone syncing over trusted LAN.
2. Hermes, generic MCP, and other Agents reusing the same local runtime.
3. An Agent and `vitalmcp` on one user-owned server, with the iPhone reaching the receiver through Tailscale Serve HTTPS.

Operator-hosted relay, accounts, billing, public VPS/public MCP deployment, App Store distribution, and Agent marketplace publication are not part of the active roadmap. Relay and public-transport code may remain in the package for auditable historical research; it is unsupported and should not be used as an onboarding path.

See the repository [product plan](../../docs/product-plan.md) and [deployment guide](../../docs/deployment-methods.md) for the canonical scope.

## Requirements

- Node.js 22 or newer;
- macOS for WorkBuddy Local;
- macOS or Linux for the local runtime;
- a physical iPhone with the source-built Vital Agent Sync app for HealthKit validation;
- trusted LAN for phases 1 and 2;
- Tailscale, MagicDNS, and tailnet HTTPS for phase 3.

The runtime keeps state under `~/.vital-agent-sync`. Do not paste that directory, its database, pairing artifacts, tokens, or unredacted logs into an Agent conversation or issue.

## WorkBuddy Local

The preferred entry is the reviewed [Vital Agent Sync SkillHub package](https://skillhub.cn/skills/vital-agent-sync). The Skill installs a pinned runtime into a user-owned npm prefix, explains persistent changes, requests explicit consent, configures WorkBuddy MCP, and opens the credential-bearing QR only in the local browser.

Manual fallback:

```bash
npx -y vitalmcp@0.5.1 setup --agent workbuddy --transport lan
```

For a machine-readable consent flow:

```bash
vitalmcp setup --agent workbuddy --transport lan --output json
vitalmcp setup --resume --yes --output json
```

Without execution consent, non-interactive setup stops at `awaiting_consent`. It must not install a service, rewrite Agent configuration, or create pairing credentials before approval.

WorkBuddy user configuration lives at `~/.workbuddy/mcp.json`. Use `--workbuddy-project <dir>` for `<dir>/.workbuddy/mcp.json`, or `--workbuddy-config <path>` for an explicit file. Existing fields and unrelated MCP servers are preserved, and a modified file receives a timestamped backup.

After installation, restart WorkBuddy if required and confirm `vital-agent-sync` is healthy in MCP settings. Pair a physical iPhone, perform a manual sync, then verify:

```bash
vitalmcp status --output json
vitalmcp doctor --agent workbuddy --transport lan
```

Before the Agent reads any health context, it must disclose that the selected model provider may receive the minimum MCP result and wait for user confirmation.

## Local Hermes and other Agents

Every adapter uses the same receiver, SQLite database, setup state, and `vitalmcp mcp` implementation:

```bash
npx -y vitalmcp@0.5.1 setup --agent hermes --transport lan
npx -y vitalmcp@0.5.1 setup --agent generic --transport lan
npx -y vitalmcp@0.5.1 setup --agent openclaw --transport lan
```

Hermes is the next first-class adapter. Generic stdio MCP is the portability baseline. Marketplace publication is not required.

Adapter helpers:

```bash
vitalmcp print-mcp-config
vitalmcp print-agent-config --agent generic
vitalmcp print-agent-config --agent hermes
vitalmcp print-agent-config --agent openclaw
vitalmcp install-hermes
vitalmcp install-hermes-skill
```

An adapter must:

- preserve unrelated configuration and back up a file before mutation;
- point to the shared `vitalmcp mcp` command and database;
- document detection, config path, reload guidance, and removal behavior;
- never implement a separate health query, storage, or crypto path;
- remain removable without deleting runtime state or breaking another Agent.

## User-owned server over Tailscale

Phase 3 keeps the Agent, runtime, SQLite, and stdio MCP on the same user-owned macOS or Linux server. Tailscale exposes only the iPhone receiver:

```bash
npx -y vitalmcp@0.5.1 setup \
  --agent hermes \
  --manager systemd \
  --transport tailscale \
  --tailscale-name receiver.example-tailnet.ts.net
```

Linux uses a user-level `systemd` unit; macOS uses `launchd`. The runtime verifies the local Tailscale identity and private Serve configuration. It refuses Funnel, plain HTTP `.ts.net` onboarding, raw `100.x` certificate names, mismatched MagicDNS names, and conflicting root handlers.

When the private route is missing, the required shape is:

```bash
tailscale serve --bg --yes --https=443 http://127.0.0.1:8787
```

Both the iPhone and server must be authorized members of the same tailnet. MCP remains local stdio on the server; it is not exposed over the network.

Diagnostics:

```bash
tailscale status --json
tailscale serve status --json
vitalmcp service status --manager systemd
vitalmcp logs --manager systemd --lines 100
vitalmcp doctor --transport tailscale \
  --tailscale-name receiver.example-tailnet.ts.net
```

See [Tailscale iOS onboarding](../../docs/tailscale-ios-onboarding.md) for the full private-server acceptance flow.

## Pairing and sync

`setup` installs and starts one receiver with the supported platform service manager, waits for it to answer, and creates a short-lived pairing session. If a QR expires, create a new session without reinstalling:

```bash
vitalmcp pair
```

The iPhone stores the receiver URL and source-device identity, and keeps its token in Keychain. The receiver stores token hashes and health summaries in `~/.vital-agent-sync/vital-agent.sqlite`.

Supported delivery is manual Sync Now plus foreground catch-up. iOS background execution is best effort; no exact interval is promised.

To revoke a phone, use the `revoke_source_device` MCP tool, remove the saved connection in iOS, and pair again. Revocation does not delete existing local history. Destructive reset and data deletion require separate explicit user actions.

## Service lifecycle

```bash
vitalmcp ensure
vitalmcp service install
vitalmcp service start
vitalmcp service status
vitalmcp logs --lines 100
vitalmcp service stop
vitalmcp service uninstall
```

`ensure` is an idempotent startup check: it installs the supported service if missing, starts it if stopped, waits for receiver health, and reports status. It does not rewrite Agent configuration, install Skills, or print a QR.

On macOS, service files and logs are:

```text
~/Library/LaunchAgents/com.vitalmcp.local.plist
~/.vital-agent-sync/logs/daemon.out.log
~/.vital-agent-sync/logs/daemon.err.log
```

On Linux, the user service is:

```text
~/.config/systemd/user/vitalmcp.service
```

Always use `vitalmcp service` for lifecycle operations. Do not invent another daemon, stop an unknown process, modify shell profiles, or migrate an unidentified database as part of normal recovery.

## MCP boundary

Start the Agent-neutral stdio server with:

```bash
vitalmcp mcp
```

Use `vital_agent_status` before health reads to check pairing, freshness, selected transport, and suggested recovery. Request the narrowest relevant context rather than broad raw history. Agent output and normal logs must not contain pairing URLs, QR payloads, keys, tokens, raw databases, raw HealthKit samples, or unrelated health categories.

## Diagnostics

```bash
vitalmcp status --output json
vitalmcp service status
vitalmcp logs --lines 100
vitalmcp doctor --agent workbuddy --transport lan
```

Diagnostics may report versions, state-machine stage, paths, service reachability, sync count, freshness, and redacted failure codes. They must not print sensitive values or health plaintext.

If setup reports an unknown receiver, database, service, or transport identity, stop and follow the official recovery guidance. These conflicts fail closed by design.

## Development

From the repository root:

```bash
npm ci
npm run typecheck
npm run test:local
npm run audit:secrets
npm run audit:oss
```

Use synthetic fixtures only. Before publishing the npm artifact:

```bash
npm run pack:check
npm run release:npm-preflight
```

The release preflight checks the package artifact, secret scan, publisher identity, and registry version. It never publishes automatically.

## Experimental source

The package still contains earlier relay, Docker, direct-public-transport, and migration experiments so their protocol and security decisions remain auditable. They are not part of the supported product ladder, release acceptance, or onboarding documentation. Do not infer a hosted service, availability promise, compatibility guarantee, or maintenance commitment from the presence of those commands.
