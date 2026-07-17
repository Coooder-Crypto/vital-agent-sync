# Changelog

All notable user-visible changes to Vital Agent Sync are documented here.

The project uses a shared preview version for the iOS app, `vitalmcp` runtime, and public Skill release while the product is pre-1.0.

## [Unreleased]

### Added

- Open-source license, security policy, contribution guide, support policy, and repository templates.
- Full-repository and Git-history secret scanning for the public release gate.

### Changed

- Public documentation now leads with the WorkBuddy, LAN, and Tailscale onboarding paths.
- Product version metadata is aligned with the `0.5.0` npm and SkillHub release.

## [0.5.0] - 2026-07-16

### Added

- WorkBuddy MCP adapter and SkillHub onboarding flow.
- One guided local setup path with QR pairing and first-sync verification.
- Local-first LAN transport and optional Tailscale Serve HTTPS support.
- User-owned SQLite storage and MCP tools for health context.
- Self-hosted and experimental end-to-end encrypted relay implementation.

### Security

- Receiver-pinned direct transport encryption for LAN and Tailscale pairing and sync.
- Redacted Agent-facing setup output and private local onboarding artifacts.
- Automated package, dependency, container, iOS interoperability, and release secret checks.
