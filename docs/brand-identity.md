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

The final public release still requires the formal brand-clearance, domain, support-email, copyright, and trademark-policy work tracked in issue #73.

## Compatibility Boundary

The npm package and CLI are renamed directly from `healthlink-local` to `vitalmcp`. No compatibility package or legacy binary is maintained because the product has no production users yet.

The following non-npm identifiers remain unchanged because they are persisted paths or interoperability contracts:

- E2EE protocol and HKDF context: `healthlink-e2ee-v1`
- legacy iOS deep links: `healthlink://`
- local state path: `~/.healthlink`
- MCP server key and tool compatibility identifiers using `healthlink`
- relay header: `X-HealthLink-Relay-API-Key`
- callback metadata source: `healthlink`
- Xcode project, target, Swift module, and unit-test target names

The Vital Agent iOS app registers and accepts both `vitalmcp://` and `healthlink://`. The current `vitalmcp` runtime generates the primary scheme; legacy links remain accepted at the protocol boundary.

## Pre-Release Migration Note

Changing the Bundle ID from `app.healthlink.ios` to `com.vitalmcp.ios` makes this a separate development install and changes its default Keychain access group. Before physical-device validation, remove the old development build if necessary, install Vital Agent, and pair the iPhone again. The previously published `healthlink-local` npm package is not a supported migration path; publish and document `vitalmcp` as the only current CLI. There are no production users to migrate at this stage.
