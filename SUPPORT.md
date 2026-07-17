# Support

## Installation and usage

Use GitHub Discussions for setup questions and GitHub Issues for reproducible bugs. Before posting, run:

```bash
vitalmcp status --output json
vitalmcp doctor --transport lan
```

For Tailscale, use:

```bash
vitalmcp doctor --transport tailscale --tailscale-name <host.tailnet.ts.net>
```

Share only redacted output. Never post onboarding URLs, pairing QR codes, tokens, private keys, Apple Health exports, SQLite databases, or logs containing health data.

## Security reports

Follow [SECURITY.md](SECURITY.md) and use GitHub private vulnerability reporting instead of a public issue.

## Medical boundary

Vital Agent Sync transports user-authorized health summaries. It does not provide diagnosis, treatment, emergency monitoring, or medical advice. Contact a qualified health professional for medical decisions and local emergency services for urgent concerns.
