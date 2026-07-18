# Technical plan

The canonical roadmap is [docs/product-plan.md](docs/product-plan.md).

Current implementation priority:

1. WorkBuddy, `vitalmcp`, SQLite, and MCP on one Mac over trusted LAN;
2. Hermes and other Agents using the same local runtime and database;
3. a user-owned Agent server receiving iPhone syncs through Tailscale Serve HTTPS.

Architecture and implementation details live in:

- [Agent-first onboarding](docs/agent-first-onboarding.md)
- [Deployment methods](docs/deployment-methods.md)
- [Agent adapter design](docs/architecture-adapter-design.md)
- [Direct LAN security](docs/direct-lan-security.md)
- [Tailscale iOS onboarding](docs/tailscale-ios-onboarding.md)
- [Open-source scope](docs/open-source-scope.md)

Hosted relay, accounts, billing, App Store launch, public VPS, and marketing work are outside the active roadmap. Historical relay research remains in `docs/` for auditability but is not a product commitment.
