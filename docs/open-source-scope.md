# Open-source scope

Vital Agent Sync is open-source software for a user-owned Apple Health to MCP data path. The public repository contains the complete code needed to inspect, build, run, test, and self-host the supported product paths.

## Public source

- the iOS HealthKit app and focused tests;
- the `vitalmcp` local runtime, SQLite storage, MCP tools, and Agent adapters;
- LAN and Tailscale transports;
- Docker and self-hosted relay deployment code;
- the experimental hosted-relay protocol implementation;
- build scripts, CI workflows, security models, and user documentation;
- the website source and public installation script.

The WorkBuddy distribution package is also maintained in the separate public [`vital-agent-sync-skill`](https://github.com/Coooder-Crypto/vital-agent-sync-skill) repository so SkillHub can consume a small, auditable package.

## Never committed

- Apple signing certificates, private keys, provisioning profiles, or App Store Connect credentials;
- production `.env` files, DNS credentials, relay operator tokens, or server access keys;
- pairing QR codes, onboarding links, runtime secrets, or local state under `~/.vital-agent-sync`;
- real Apple Health exports, user databases, support attachments, logs, or backups;
- private analytics, customer records, or incident material.

Example configuration may be committed only when every credential value is an obvious placeholder.

## Product status

LAN is the supported Local Preview default. Tailscale is the supported optional private remote path. Docker and self-hosted relay are advanced user-operated paths. The hosted relay remains experimental and is not required for onboarding.

## Public-release checklist

Before changing repository visibility or publishing a release:

1. merge all intended product changes into `main`;
2. run `npm run audit:oss` from a full clone with complete Git history;
3. run the typecheck, test, package, dependency, container, and iOS interoperability gates;
4. review every remote branch, issue, pull request, Actions log, attachment, release artifact, and package for sensitive data;
5. decide whether historical author email addresses are acceptable to expose;
6. verify the app icon, screenshots, fonts, and other media have documented provenance and redistribution rights;
7. confirm GitHub private vulnerability reporting is enabled;
8. clone the future public repository into a clean directory and complete the documented setup flow;
9. create the matching signed tag and GitHub release only after the public tree passes all checks.
