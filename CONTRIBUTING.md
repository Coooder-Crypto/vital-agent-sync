# Contributing to Vital Agent Sync

Thank you for helping improve a local-first Apple Health connector for user-owned Agents.

## Before opening a change

- Use GitHub Issues for bugs, proposals, and compatibility requests.
- Never attach real health data, pairing QR codes, onboarding links, tokens, private keys, SQLite databases, or unredacted logs.
- Keep the generic MCP contract working even when adding an Agent-specific adapter or Skill.
- Treat LAN as the default path and Tailscale as the optional private remote path. Hosted relay behavior is experimental unless a release explicitly says otherwise.
- Do not add medical diagnosis, prescriptions, or unsupported health claims.

## Local setup

Requirements:

- Node.js 22 or newer;
- npm;
- Xcode and XcodeGen for iOS work;
- a physical iPhone for meaningful HealthKit validation.

```bash
npm ci
npm run typecheck
npm run test:local
npm run build:local
npm run audit:oss
```

For iOS changes:

```bash
cd apps/ios
xcodegen generate
cd ../..
npm run test:ios
```

Additional signing and device notes live in [`apps/ios/README.md`](apps/ios/README.md).

Use synthetic fixtures in automated tests. Never copy personal Apple Health values into the repository.

## Pull requests

- Keep each PR focused and explain the user-visible impact.
- Add or update tests for behavior changes.
- Document privacy, security, migration, and rollback implications.
- Preserve existing Agent configuration entries and back up files before changing them.
- Update `CHANGELOG.md` for user-visible changes.

By contributing, you agree that your contribution is licensed under the repository's MIT License.
