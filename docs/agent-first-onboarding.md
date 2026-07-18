# Agent-first onboarding

This document defines the shared installation and first-sync contract. The preferred entry point is an existing Agent conversation, but every Agent delegates to the same `vitalmcp` runtime.

## Priority order

1. WorkBuddy Local on macOS over trusted LAN.
2. Hermes and other Agents using the same local runtime.
3. Agent and runtime on a user-owned server, with iPhone sync over Tailscale.

No Agent-specific path may skip an earlier product phase by creating a second installer, service, database, or health query implementation.

## Target experience

```text
Ask an Agent to install Vital Agent Sync
  -> install a pinned vitalmcp package without sudo
  -> explain the planned persistent changes
  -> wait for explicit consent
  -> configure the Agent's local MCP entry
  -> start one verified receiver service
  -> open a short-lived QR in the user's local browser
  -> pair and sync a physical iPhone
  -> verify status and freshness through native MCP tools
```

The QR, onboarding link, pairing secret, and device token never enter the Agent conversation.

## Layer ownership

### Distribution surface

SkillHub or a local adapter may:

- select a reviewed, pinned `vitalmcp` version;
- install it in a user-writable prefix;
- explain prerequisites;
- invoke the shared setup/status/doctor commands.

It must not use `curl | bash`, `sudo`, an unpinned `npx`, repository source, or an unrecognized installer.

### `vitalmcp setup`

The runtime owns:

- environment and service-manager detection;
- receiver and database identity verification;
- user-only state and keys;
- Agent config backup and mutation;
- one `launchd` or `systemd --user` receiver;
- LAN or Tailscale transport configuration;
- short-lived pairing state;
- first-sync observation and MCP freshness status.

It returns a redacted plan before consent and resumes from persisted non-secret setup state after interruption.

### Agent Skill or adapter

The Agent layer owns conversation orchestration only:

- describe changes and request confirmation;
- invoke the supported CLI contract;
- open the local onboarding action without reading it;
- tell the user when an Agent restart or MCP reload is required;
- call native MCP tools for status and health context;
- disclose that returned MCP context may be processed by the selected model provider.

It must not read SQLite, call internal HTTP APIs, hand-write JSON-RPC, parse HealthKit payloads, manage keys, or create unofficial persistence.

## Setup state machine

```text
detect
  -> plan
  -> consent
  -> initialize user-owned state
  -> configure Agent MCP
  -> install and start verified service
  -> create loopback onboarding page
  -> wait for physical-iPhone sync
  -> verify native MCP and freshness
  -> ready
```

Re-running setup continues from the first incomplete stage. It does not silently reset, migrate, revoke, delete, or select another port.

## Machine-readable contract

Agent integrations use:

```bash
vitalmcp setup --agent <agent> --transport <lan|tailscale> --output json
vitalmcp setup --resume --yes --output json
vitalmcp status --output json
vitalmcp doctor --agent <agent> --transport <lan|tailscale>
```

Safe output may include product version, setup stage, service state, receiver identity, database identity, non-secret address, sync count, last-sync time, and stable error codes. It never includes keys, tokens, QR contents, onboarding URLs, health values, raw database rows, or full Agent configuration.

## WorkBuddy Local contract

The WorkBuddy Skill is the reference product experience:

- install the pinned package under `~/.vitalmcp/npm-global`;
- use the same absolute CLI path throughout installation;
- preserve and back up `~/.workbuddy/mcp.json`;
- stop on `receiver_identity_conflict` or `service_manager_failed`;
- open the loopback pairing page on the Mac;
- wait for WorkBuddy native MCP tools to load;
- call `vital_agent_status` before any health context;
- show the model privacy disclosure and wait for confirmation before the first health read.

## Local Agent adapter contract

Hermes, generic MCP, OpenClaw, and future adapters must declare:

- adapter ID and display name;
- supported platform and Agent version;
- detection method;
- config and Skill locations;
- whether config can be modified or only printed;
- backup and rollback behavior;
- reload/restart guidance;
- uninstall isolation behavior.

Every adapter points to the same local `vitalmcp mcp` implementation and database.

## Tailscale server contract

The first server phase supports only a co-located Agent and runtime. `vitalmcp` and MCP stay local to the server; Tailscale exposes only the iPhone receiver through Serve HTTPS. Public MCP, remote desktop-Agent MCP, Funnel, hosted relay, and public reverse proxies are out of scope.

## Privacy and safety

Before the first operation that reads health data, the Agent must say that:

- the database and runtime stay on the user's machine or server;
- the minimum returned MCP context may be sent to the selected model provider;
- local storage does not guarantee local inference;
- Vital Agent Sync is not a medical provider.

The Agent waits for confirmation and then requests only the data needed for the current question. Missing or stale data is reported directly and never fabricated.
