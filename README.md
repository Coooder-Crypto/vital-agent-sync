# Vital Agent Sync

[简体中文](README.zh-CN.md)

[![CI](https://github.com/Coooder-Crypto/vital-agent-sync/actions/workflows/ci.yml/badge.svg)](https://github.com/Coooder-Crypto/vital-agent-sync/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/vitalmcp)](https://www.npmjs.com/package/vitalmcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Vital Agent Sync is an open-source, local-first Apple Health bridge for personal AI Agents. It reads user-authorized HealthKit summaries on an iPhone, sends them to a receiver the user controls, stores them in local SQLite, and exposes scoped context through MCP.

It is a data connector, not an Agent, hosted health cloud, medical device, or source of medical advice.

## Current roadmap

Version `0.5.3` is a source-distributed Local Preview. Work proceeds in this order:

| Phase | Experience | Status |
| --- | --- | --- |
| 1 | WorkBuddy + `vitalmcp` on one Mac, iPhone sync over trusted LAN | Current priority |
| 2 | Hermes, generic MCP, and other Agents using the same local runtime | Next |
| 3 | Agent + `vitalmcp` on a user-owned server, iPhone sync over Tailscale | Later |

The roadmap does not include a hosted relay service, accounts, billing, subscriptions, App Store launch, public VPS deployment, or marketing work. See the [product plan](docs/product-plan.md).

## WorkBuddy quick start

Install [Vital Agent Sync from SkillHub](https://skillhub.cn/skills/vital-agent-sync), then tell WorkBuddy:

> 启动 Vital Agent Sync，通过局域网连接我的 iPhone。

The Skill:

- installs a pinned `vitalmcp` version into a user-owned prefix without `sudo`;
- requests one installation confirmation covering the pinned runtime, private state, WorkBuddy MCP entry, trusted-LAN listener, and local pairing page;
- records the setup Node runtime and native-module ABI so the CLI, receiver, and MCP use one compatible runtime;
- starts a WorkBuddy-managed Local Preview receiver without requiring Terminal or `sudo`; this preview process may stop when WorkBuddy exits;
- opens the private local QR before MCP approval, while still requiring explicit WorkBuddy MCP approval before any health-data read;
- opens the credential-bearing QR only in the user's local browser;
- requires a privacy disclosure before any health-data read.

Manual fallback:

```bash
npx -y vitalmcp@0.5.3 setup --agent workbuddy --transport lan
```

After the first iPhone sync:

```bash
vitalmcp status --output json
vitalmcp doctor --agent workbuddy --transport lan
```

## Local Hermes and other Agents

These paths reuse the same receiver, database, setup state, and MCP tools:

```bash
npx -y vitalmcp@0.5.3 setup --agent hermes --transport lan
npx -y vitalmcp@0.5.3 setup --agent generic --transport lan
npx -y vitalmcp@0.5.3 setup --agent openclaw --transport lan
```

Hermes is the next first-class local adapter. Generic stdio MCP remains the portability baseline. Marketplace publication is not required.

## User-owned server over Tailscale

The planned server mode keeps the selected Agent, `vitalmcp`, SQLite, and MCP on the same user-owned host. Tailscale is used only for the iPhone-to-receiver HTTPS path:

```bash
npx -y vitalmcp@0.5.3 setup \
  --agent hermes \
  --manager systemd \
  --transport tailscale \
  --tailscale-name receiver.example-tailnet.ts.net
```

The first server release does not expose MCP over the network. It does not use Funnel, public DNS, a hosted relay, or a Vital Agent Sync account. See [deployment methods](docs/deployment-methods.md) and [Tailscale onboarding](docs/tailscale-ios-onboarding.md).

## Build the iPhone app

HealthKit validation requires a physical iPhone. The app is currently distributed as source:

```bash
cd apps/ios
xcodegen generate
open VitalAgentSync.xcodeproj
```

In Xcode, select your own Apple Development Team and a unique bundle identifier, keep the HealthKit capability enabled, and run the app on your iPhone. Scan the local QR, review the receiver and requested scopes, grant only the data you want to share, and perform a manual sync.

The repository never includes signing certificates, provisioning profiles, App Store Connect credentials, real Apple Health exports, or user databases.

## Data and privacy boundary

```text
iPhone HealthKit
  -> trusted LAN or the user's Tailscale network
  -> user-owned vitalmcp receiver
  -> local SQLite
  -> scoped MCP tools
  -> the user's Agent and selected model provider
```

Local storage does not imply local model inference. An Agent or model provider may receive the minimum health context returned by MCP. Never paste pairing QR codes, onboarding links, keys, tokens, databases, health exports, or unredacted logs into Agent chats or public issues.

Vital Agent Sync supports manual sync and foreground catch-up. iOS background execution is best effort; no exact schedule is promised.

## Repository layout

| Path | Purpose |
| --- | --- |
| `apps/ios/` | SwiftUI HealthKit app, XcodeGen project, resources, and focused tests |
| `packages/local/` | `vitalmcp`, receiver, SQLite, MCP, Agent adapters, and transports |
| `skills/vital-agent-sync/` | reviewed source Skill used for packaging and audits |
| `deploy/` | experimental user-operated deployment templates |
| `docs/` | current architecture, setup, privacy, protocol, and historical research |
| `apps/www/` | website source; not part of the active roadmap |

The independently published WorkBuddy package lives at [`Coooder-Crypto/vital-agent-sync-skill`](https://github.com/Coooder-Crypto/vital-agent-sync-skill).

## Development

Requirements: Node.js 22 or newer, npm, and Xcode/XcodeGen for iOS work.

```bash
npm ci
npm run typecheck
npm run test:local
npm run test:ios
npm run audit:oss
```

Use synthetic fixtures only. For component details, release checks, and diagnostics, see the [documentation index](docs/README.md) and [`packages/local/README.md`](packages/local/README.md).

## Contributing and support

- Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a PR.
- Use [GitHub Discussions](https://github.com/Coooder-Crypto/vital-agent-sync/discussions) for setup questions.
- Use the issue templates for reproducible bugs and proposals.
- Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).
- Review the public/private boundary in [Open-source scope](docs/open-source-scope.md).

Vital Agent Sync is licensed under the [MIT License](LICENSE).
