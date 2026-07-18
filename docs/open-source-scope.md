# Open-source scope

Vital Agent Sync is open-source software for a user-owned Apple Health to MCP data path. The public repository contains the complete code needed to inspect, build, run, and test the active product path.

## Public source

- the iOS HealthKit app and focused tests;
- the `vitalmcp` local runtime, SQLite storage, MCP tools, and Agent adapters;
- LAN and Tailscale transports;
- historical Docker, self-hosted relay, and hosted-relay research that is not part of the active roadmap;
- build scripts, CI workflows, security models, and user documentation;
- legacy website and portable-installation source retained for audit, without a product-support commitment.

The WorkBuddy distribution package is also maintained in the separate public [`vital-agent-sync-skill`](https://github.com/Coooder-Crypto/vital-agent-sync-skill) repository so SkillHub can consume a small, auditable package.

## Never committed

- Apple signing certificates, private keys, provisioning profiles, or App Store Connect credentials;
- production `.env` files, DNS credentials, relay operator tokens, or server access keys;
- pairing QR codes, onboarding links, runtime secrets, or local state under `~/.vital-agent-sync`;
- real Apple Health exports, user databases, support attachments, logs, or backups;
- private analytics, customer records, or incident material.

Example configuration may be committed only when every credential value is an obvious placeholder.

## Supported product scope

The roadmap is intentionally limited to:

1. WorkBuddy and `vitalmcp` on one Mac over trusted LAN;
2. Hermes and other Agents using the same local runtime and MCP implementation;
3. an Agent and `vitalmcp` on a user-owned server, with the iPhone reaching the receiver through Tailscale Serve HTTPS.

Hosted relay, accounts, billing, App Store launch, public VPS, public MCP, and marketing are not supported product paths. Experimental source may remain public for audit and historical reference without implying maintenance or availability.

## Public-release checklist

Before publishing each release:

1. merge all intended product changes into `main`;
2. run `npm run audit:oss` from a full clone with complete Git history;
3. run the typecheck, test, package, dependency, container, and iOS interoperability gates;
4. review every remote branch, issue, pull request, Actions log, attachment, release artifact, and package for sensitive data;
5. decide whether historical author email addresses are acceptable to expose;
6. verify the app icon, screenshots, fonts, and other media have documented provenance and redistribution rights;
7. confirm GitHub private vulnerability reporting is enabled;
8. clone the public repository into a clean directory and complete the active phase's documented setup flow;
9. create the matching signed tag and GitHub release only after the public tree passes all checks.
