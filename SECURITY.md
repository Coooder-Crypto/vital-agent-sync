# Security Policy

Vital Agent Sync handles sensitive health summaries and pairing credentials. Please do not publish vulnerabilities, credentials, onboarding links, QR codes, databases, logs containing private data, or proof-of-concept payloads in a public issue.

## Supported versions

Security fixes are provided for the latest released `vitalmcp` version and the current `main` branch. Older previews may not receive patches.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting flow for this repository. Include:

- the affected version or commit;
- the affected transport (`lan`, `tailscale`, hosted relay, or self-hosted relay);
- reproduction steps using synthetic data;
- the expected and observed security boundary;
- a suggested fix, if available.

Do not include real Apple Health exports, live pairing artifacts, private keys, access tokens, or a user's SQLite database. If a report cannot be reproduced without sensitive material, first describe the minimum metadata required and wait for a private response.

## Security boundaries

- LAN and Tailscale terminate at the user-owned Vital Agent Sync receiver.
- Health summaries are stored in the user's local SQLite database by default.
- Pairing and relay credentials remain local and must not be pasted into Agent chats, logs, issues, or support messages.
- An Agent or model provider may receive the scoped health context returned through MCP. Local storage does not imply local model inference.
- Vital Agent Sync is not a medical device and must not be used for diagnosis, treatment, or emergency decisions.

## Static-site build boundary

`apps/www` and `apps/pitch` are exported as static artifacts. Next.js, React, PostCSS, Sharp, and the other site framework packages are development-only build tools; they are not installed or executed in the deployed static-site runtime. Builds consume repository-controlled source and media only and must not process untrusted stylesheets, source maps, images, or other inputs.

The root development dependency tree may temporarily report upstream Next.js build-tool advisories even when `audit:www-dependencies` and `audit:pitch-dependencies` report zero production vulnerabilities. This is a narrowly documented exception, not a blanket audit waiver. Maintainers must review those advisories for each release and update to a stable patched framework release when one is available.

See [the direct LAN security model](docs/direct-lan-security.md), [the relay threat model](docs/e2ee-relay-threat-model.md), and [the privacy boundary](docs/e2ee-relay-privacy-boundary.md) for details.
