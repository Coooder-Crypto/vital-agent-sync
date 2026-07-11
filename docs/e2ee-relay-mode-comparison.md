# Direct Gateway Vs E2EE Relay

HealthLink supports two transport families over the same normalized data and MCP query layer.

## Summary

| Mode | Best For | Main Tradeoff |
| --- | --- | --- |
| Direct gateway | Users who can keep the agent machine reachable from iOS over LAN, Tailscale, or user-managed HTTPS. | Simpler data path, but network reachability is the user's problem. |
| Hosted E2EE relay | Users who want outbound-only iOS sync with minimal setup. | Relay operator sees metadata and must operate infrastructure responsibly. |
| Self-hosted E2EE relay | Users who want outbound-only sync but own the relay infrastructure. | More operational work, but no HealthLink-hosted relay dependency. |

## Direct Gateway

Path:

```text
iOS
  -> direct HTTP /health/sync
  -> healthlink-local receiver
  -> SQLite
  -> MCP
```

Use direct gateway when:

- iOS and the agent machine are on the same LAN.
- Tailscale or another private network is already available.
- The user can manage public HTTPS, DNS, TLS, and firewall rules.
- The user wants the smallest moving-parts count.

Properties:

- Health plaintext reaches `healthlink-local` directly.
- No relay queue exists.
- No separate pull loop is needed.
- The local receiver must be reachable when iOS syncs.

Common commands:

```bash
healthlink-local setup --transport lan
healthlink-local setup --transport tailscale
healthlink-local setup --transport public_https --server-url https://agent.example.com/healthlink
healthlink-local pair
healthlink-local status
```

## Hosted E2EE Relay

Path:

```text
iOS
  -> encrypted envelope
  -> hosted relay
  -> healthlink-local pull/decrypt/ingest
  -> SQLite
  -> MCP
```

Use hosted relay when:

- The user should not expose local ports.
- The simplest mobile setup matters more than self-hosting.
- The agent machine can periodically run `healthlink-local pull`.

Properties:

- Relay stores ciphertext envelopes plus minimal hashed tenant/revocation metadata, never health plaintext or local private keys.
- Health plaintext is decrypted only by local `healthlink-local`.
- Relay operator can see metadata: user ID, sequence, timing, source IP, approximate envelope size, and retention events.
- Freshness depends on pull cadence.

Common commands:

```bash
healthlink-local setup --transport relay --relay-url https://relay.example.com --agent hermes
healthlink-local pull --once
healthlink-local service status --mode relay-pull
healthlink-local status
```

## Self-Hosted E2EE Relay

Path:

```text
iOS
  -> encrypted envelope
  -> user-owned relay
  -> healthlink-local pull/decrypt/ingest
  -> SQLite
  -> MCP
```

Use self-hosted relay when:

- The user wants outbound-only iOS sync.
- The user does not want HealthLink-operated relay infrastructure.
- The user can operate Docker, persistence, TLS, logs, backups, and monitoring.

Properties:

- Same E2EE protocol as hosted relay.
- Same local pull and MCP behavior as hosted relay.
- User owns relay metadata and operational risk.
- Private keys must stay off the relay host.

Common commands:

```bash
healthlink-local print-relay-docker-compose > docker-compose.relay.yml
docker compose -f docker-compose.relay.yml up -d
healthlink-local setup --transport self-hosted-relay --relay-url http://192.168.31.53:8790 --agent hermes
healthlink-local pull --once
```

## Decision Guide

Choose direct gateway if the iPhone can reliably reach the agent machine and the user wants the simplest trust model.

Choose hosted relay if onboarding should work for normal mobile users without network setup.

Choose self-hosted relay if the user wants relay ergonomics but owns infrastructure and accepts operational responsibility.

## Agent UX

Agents should not ask users to pick based on implementation details. A practical prompt is:

```text
Can your iPhone reach this computer on the same network or Tailscale?
```

If yes, recommend direct gateway. If no, recommend hosted relay. If the user explicitly wants to own all infrastructure, recommend self-hosted relay.

Regardless of mode, agents read health data through MCP. They should mention freshness and call `healthlink-local pull` in relay mode before freshness-sensitive analysis.
