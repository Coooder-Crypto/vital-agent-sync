# Hosted Relay To Self-Hosted Relay Migration

This guide moves a HealthLink relay setup from the hosted relay to a user-owned relay without changing the local SQLite/MCP data model.

## What Changes

Changes:

- iOS uploads encrypted envelopes to the self-hosted relay URL.
- `vitalmcp` pulls from the self-hosted relay URL.
- Relay operator responsibility moves to the user.

Does not change:

- `HealthSyncPayload` schema.
- E2EE envelope format.
- Local SQLite database used by MCP.
- OpenClaw/Hermes MCP tool names.

Migration intentionally rotates the relay identity, encryption keys, upload secret, and tenant token. Old hosted envelopes are purged because the new identity cannot decrypt them.

## Before You Start

Keep the current hosted setup working until the self-hosted relay is verified.

Record the current local runtime status:

```bash
vitalmcp status
vitalmcp relay status
```

Back up local state before changing transport settings:

```bash
cp -R ~/.healthlink ~/.healthlink.backup.$(date +%Y%m%d%H%M%S)
```

The backup contains sensitive local data and secrets. Store it privately.

## Start The Self-Hosted Relay

Generate the relay-only Compose file:

```bash
vitalmcp print-relay-docker-compose > docker-compose.relay.yml
docker compose -f docker-compose.relay.yml up -d
```

Verify the relay is reachable from the machine running `vitalmcp`:

```bash
curl http://127.0.0.1:8790/v1/status
```

For iOS, replace `127.0.0.1` with an iPhone-reachable URL, such as a LAN IP, Tailscale host, or HTTPS reverse proxy:

```text
http://192.168.31.53:8790
https://healthlink-relay.example.com
```

## Migrate The Relay Identity

After the target relay is reachable, run the explicit migration command:

```bash
vitalmcp relay migrate --yes \
  --transport self-hosted-relay \
  --relay-url http://192.168.31.53:8790
```

If the target relay uses a deployment API key, provide it through the environment so it is not left in shell history:

```bash
export HEALTHLINK_RELAY_API_TOKEN=<target-deployment-key>
vitalmcp relay migrate --yes \
  --transport self-hosted-relay \
  --relay-url https://healthlink-relay.example.com
```

The command authenticates to the old relay using the current config, revokes and purges the old identity, creates new user/device IDs and cryptographic material, resets the relay cursor, and writes the target URL. It does not replace or delete the local health SQLite database.

## Pair iOS Again

Scan the new onboarding QR or open the generated `vitalmcp://onboard?...` deep link in VitalMCP iOS.

Confirm in iOS:

- Relay URL is the self-hosted URL.
- Fingerprint matches the local setup output.
- Requested scopes are expected.

After iOS uploads a sync, pull locally:

```bash
vitalmcp pull --once
vitalmcp status
```

The expected pull result is:

```text
Fetched:         1 or more
Ingested:        1 or more
Acked:           1 or more
Latest sequence: greater than 0
```

## Validate With MCP

Ask the agent for `healthlink_status` or run:

```bash
vitalmcp doctor --agent openclaw
```

Expected relay metadata:

- `transport_mode`: `self_hosted_relay`
- `relay_url`: your self-hosted URL
- `last_successful_pull_at`: recent timestamp
- `last_error`: empty

## Cut Over

After self-hosted sync is verified:

1. Confirm the old hosted identity is rejected and its queued envelopes were purged by the migration response.
2. Use the self-hosted onboarding in iOS going forward.
3. Keep the local backup only as long as needed.

## Rollback

If self-hosted relay fails:

1. Restart the relay container and check `/v1/status`.
2. Confirm iOS can reach the relay URL.
3. Run `vitalmcp relay status`.
4. If needed, restore the previous local state backup:

```bash
mv ~/.healthlink ~/.healthlink.failed.$(date +%Y%m%d%H%M%S)
mv ~/.healthlink.backup.<timestamp> ~/.healthlink
```

Do not delete the failed state until you have copied any logs needed for debugging.

## Security Notes

- The self-hosted relay stores encrypted envelopes plus minimal hashed tenant/revocation metadata, never health plaintext or local private keys.
- Anyone operating the relay can see metadata such as source IP, timing, user ID, sequence, and envelope size.
- Private decryption keys remain local and should not be copied to the relay host.
- Avoid logging request bodies at reverse proxies and load balancers.
