# Changelog

All notable user-visible changes to Vital Agent Sync are documented here.

The project coordinates preview releases across the iOS app, `vitalmcp` runtime, and public Skill; patch releases may update the runtime and Skill without requiring an iOS binary change.

## [Unreleased]

### Added

- Open-source license, security policy, contribution guide, support policy, and repository templates.
- Full-repository and Git-history secret scanning for the public release gate.

### Changed

- Public documentation now leads with the WorkBuddy, LAN, and Tailscale onboarding paths.
- Public documentation leads with the current pinned npm and SkillHub release.

## [0.5.1] - 2026-07-18

### Fixed

- Reject legacy or unknown receivers before setup writes by verifying a loopback-only runtime, protocol, and database identity.
- Surface macOS `launchctl` failures instead of silently falling back to an unverified background process.
- Prevent the WorkBuddy Skill from migrating legacy databases, modifying shell profiles, bypassing MCP, or reading health data before privacy consent.

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
