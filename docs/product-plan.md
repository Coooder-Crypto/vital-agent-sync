# Product plan

This document is the canonical product roadmap for Vital Agent Sync.

## Product definition

Vital Agent Sync is an open-source, user-owned Apple Health bridge for personal AI Agents.

It connects an iPhone to an Agent without a Vital Agent Sync account or operator-hosted health service:

```text
iPhone HealthKit
  -> trusted LAN or the user's Tailscale network
  -> user-owned vitalmcp runtime and SQLite database
  -> local MCP
  -> WorkBuddy, Hermes, or another MCP-compatible Agent
```

The product is the installation and data bridge, not a health-analysis Agent. It does not provide medical diagnosis, treatment, emergency monitoring, or guaranteed background delivery.

## Product promise

A supported user should be able to:

1. ask an Agent to install Vital Agent Sync;
2. review the persistent filesystem, service, network, and Agent-config changes;
3. approve a single shared `vitalmcp` setup flow;
4. open a credential-bearing QR only in a local browser;
5. scan it with the source-built iOS app and select HealthKit scopes;
6. complete a manual first sync;
7. verify freshness through Agent-neutral MCP tools.

The Agent Skill or adapter orchestrates this flow. It never owns cryptography, HealthKit mapping, SQLite, or a separate health query path.

## Roadmap

### Phase 1: WorkBuddy Local

This is the only current release priority.

Target environment:

- WorkBuddy and `vitalmcp` run on the same Mac;
- the receiver, SQLite database, and MCP process stay on that Mac;
- the iPhone reaches the receiver over a trusted LAN;
- the WorkBuddy Skill is installed from SkillHub and pins a reviewed npm version.

Definition of done:

- one conversation starts installation without `curl | bash`, `sudo`, or an unpinned package;
- WorkBuddy shows a redacted setup plan before persistent changes;
- setup preserves unrelated WorkBuddy MCP entries and creates a backup before modification;
- the official service manager starts exactly one verified receiver;
- the QR opens only on loopback and is never copied into the model conversation;
- a physical iPhone pairs, syncs, and increases the local sync count;
- WorkBuddy loads the native MCP tools, calls `vital_agent_status`, and reads only the minimum context needed;
- the privacy disclosure appears before the first health-data read;
- reinstall, upgrade, conflict, restart, and removal behavior are documented and tested.

### Phase 2: Local Hermes And Other Agents

Start only after Phase 1 passes on a clean WorkBuddy profile and a physical iPhone.

Priority order:

1. Hermes local installation;
2. generic MCP configuration;
3. local OpenClaw and other Agent adapters where their documented config contract is stable.

All adapters must reuse the same local runtime, database, receiver, setup state, and MCP tools. Marketplace publication is not required. Removing an adapter must not remove local data or break another Agent.

Definition of done:

- each supported Agent has a deterministic install/config/reload path;
- the adapter contract declares detection, config location, mutation policy, and reload guidance;
- existing Agent configuration is preserved and backed up;
- the same physical-iPhone fixture produces equivalent MCP status and context across Agents;
- generic MCP remains the portability baseline.

### Phase 3: User-Owned Server Over Tailscale

Start only after local Agent installation is stable.

Target environment:

- `vitalmcp`, SQLite, MCP, and the selected Agent run under the same user on a user-owned Linux or macOS server;
- a user-level `systemd` or `launchd` service keeps the receiver alive;
- Tailscale Serve exposes trusted HTTPS only inside the user's tailnet;
- the iPhone and server are authorized members of that tailnet;
- the pairing QR advertises the verified `.ts.net` HTTPS name.

The first server release does not expose MCP over the network. The Agent consumes local stdio MCP on the same server. WorkBuddy remains a local-desktop path unless WorkBuddy publishes a supported remote MCP contract.

Definition of done:

- one documented command installs and plans the server service without root;
- setup detects or accepts the exact `.ts.net` device name and refuses HTTP, raw `100.x`, Funnel, or conflicting Serve handlers;
- an iPhone sync succeeds while on a different physical network from the server;
- service and Tailscale restarts recover without re-pairing;
- disconnecting Tailscale fails safely;
- diagnostics explain service, Serve, certificate, ACL, pairing, and freshness failures without exposing secrets or health values.

## Distribution

- `vitalmcp` is published on npm and is the only runtime implementation.
- SkillHub is the WorkBuddy distribution surface.
- Hermes and other Agents use local adapters or generated configuration; their marketplaces are optional and out of scope.
- The iOS app remains source-distributed for the current roadmap. Users build it with Xcode and select their own Apple Development Team and bundle identifier.

## Non-goals

The current product roadmap does not include:

- an operator-hosted relay or health-data service;
- accounts, billing, subscriptions, plans, quotas, or entitlements;
- App Store, TestFlight, mainland-China filing, or overseas storefront launch work;
- public VPS, public DNS, public MCP, or Tailscale Funnel deployment;
- cloud-chat delivery of credential-bearing onboarding artifacts;
- guaranteed daily, weekly, or interval-based iOS background sync;
- Agent-specific databases, query implementations, or health interpretations;
- marketing website, analytics funnel, launch campaign, or marketplace expansion work.

Existing experimental relay code and protocol research may remain available for audit and historical reference. They are unsupported and receive no roadmap priority.

## Product rules

- Local-first means user-owned storage and transport; it does not imply local model inference.
- Every health read goes through the documented MCP boundary after privacy disclosure.
- Every persistent mutation is planned, explained, and confirmed.
- Unknown receiver identity, database identity, service-manager behavior, or transport state fails closed.
- Pairing artifacts, keys, tokens, databases, and health values never enter Agent prompts, public issues, or normal logs.
- Data ownership, revocation, reset, and diagnostics remain user-controlled operations, not paid features.

## Prioritization rule

When proposed work does not directly improve the active phase's install, pair, sync, MCP, privacy, recovery, or diagnostics path, defer it. Do not begin the next phase until the previous phase has recorded physical-device evidence.
