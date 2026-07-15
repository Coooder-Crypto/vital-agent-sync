# Vital Agent Sync Brand Identity

## Current Decision

- Product brand: `Vital Agent Sync`
- App Store working name: `Vital Agent Sync`
- App Store working subtitle: `Private Apple Health Bridge`
- iOS home-screen name: `Vital Agent`
- Production Bundle ID: `com.vitalmcp.ios`
- Primary iOS deep-link scheme: `vitalmcp://`
- npm package and CLI: `vitalmcp`
- Positioning: a private, local-first Apple Health bridge for AI agents
- App icon: retain the current symbol for the first beta because it contains no legacy wordmark

The final public release still requires formal brand clearance plus decisions for the domain, support email, copyright notice, and trademark policy.

## Runtime Identity

The project uses a single pre-release identity. No compatibility package, legacy binary, state migration, MCP alias, or old deep-link handler is maintained because the product has no production users yet.

The current technical identifiers are:

- npm package and CLI: `vitalmcp`
- iOS deep links: `vitalmcp://`
- local state path: `~/.vital-agent-sync`
- local database: `~/.vital-agent-sync/vital-agent.sqlite`
- MCP server key: `vital-agent-sync`
- MCP status tool: `vital_agent_status`
- E2EE protocol and HKDF context: `vital-agent-e2ee-v1`
- direct protocol: `vital-agent-direct-v1`
- relay header: `X-Vital-Agent-Relay-API-Key`
- callback metadata source: `vital-agent-sync`
- runtime environment variable prefix: `VITALMCP_`

## Pre-Release Migration Note

The current Bundle ID remains `com.vitalmcp.ios` until Apple Developer enrollment. Changing a Bundle ID later creates a separate app identity and changes the default Keychain access group, so the final identifier should be chosen before external TestFlight distribution. If a development install predates this cutover, remove it, install the current Vital Agent build, and pair again. Publish and document `vitalmcp` as the only current CLI.
