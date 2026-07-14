# Tailscale HTTPS Onboarding For iOS

Vital Agent Sync supports private cross-network pairing through Tailscale Serve:

```text
Vital Agent iOS app
  -> Tailscale on the iPhone
  -> https://<device>.<tailnet>.ts.net
  -> Tailscale Serve terminates trusted TLS
  -> http://127.0.0.1:8787
  -> healthlink-local receiver
```

This route stays inside the tailnet. Vital Agent Sync does not use Tailscale Funnel and refuses to replace a conflicting Serve root handler or advertise a port where Funnel is enabled.

## Requirements

- Tailscale 1.52 or newer on the receiver host.
- Tailscale installed, connected, and signed in to the same tailnet on the iPhone.
- MagicDNS and HTTPS certificates enabled for the tailnet.
- A device MagicDNS name ending in `.ts.net`, normally reported by `tailscale status --json` as `Self.DNSName`.
- Tailnet access controls that allow the iPhone identity or device to reach the receiver on TCP 443.

See [Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve) and the [Serve CLI reference](https://tailscale.com/docs/reference/tailscale-cli/serve).

## Supported Setup

Run setup on the receiver host:

```bash
healthlink-local setup --transport tailscale --agent generic
healthlink-local setup --resume --yes
```

After setup consent, Vital Agent Sync detects the host's MagicDNS name, defaults the receiver bind address to `127.0.0.1`, and configures and verifies:

```bash
tailscale serve --bg --yes --https=443 http://127.0.0.1:8787
```

If automatic hostname discovery is unavailable, provide the exact device name:

```bash
healthlink-local setup \
  --transport tailscale \
  --tailscale-name receiver.example-tailnet.ts.net \
  --agent generic
```

The QR advertises `https://receiver.example-tailnet.ts.net`, not the backend port and not a `100.x` address. An explicit override is accepted only when it is HTTPS:

```bash
healthlink-local setup \
  --transport tailscale \
  --server-url https://receiver.example-tailnet.ts.net \
  --agent generic
```

Plain `http://<device>.<tailnet>.ts.net` is not a supported iOS route. A `.ts.net` name is a qualified domain, so the app's narrow `NSAllowsLocalNetworking` ATS setting does not exempt plain HTTP. Vital Agent Sync deliberately does not add `NSAllowsArbitraryLoads` or a `.ts.net` exception. Tailscale's trusted HTTPS certificate is the supported path.

## Diagnostics

```bash
tailscale status --json
tailscale serve status --json
healthlink-local doctor \
  --transport tailscale \
  --tailscale-name receiver.example-tailnet.ts.net
```

The doctor check must report the HTTPS URL and loopback proxy target. On the iPhone, open `https://receiver.example-tailnet.ts.net/health/status` in Safari while Tailscale is connected. The expected result is a JSON health response.

Common failures:

- **No `.ts.net` name:** enable MagicDNS and HTTPS certificates, confirm Tailscale is running, then retry. A discovered `100.64.0.0/10` address is not used as a certificate name.
- **Serve requests approval:** open the Tailscale consent URL shown by the command, enable HTTPS for the tailnet, then rerun setup.
- **Existing root handler:** Vital Agent Sync will not overwrite it. Move that handler, use another node, or pass another private HTTPS `--server-url`.
- **Funnel enabled on 443:** disable Funnel before setup. Vital Agent Sync does not publish the receiver to the public internet.
- **Safari cannot connect:** confirm both devices are on the same tailnet, check ACLs/grants, then run `healthlink-local service status` and `healthlink-local logs`.
- **Certificate or ATS failure:** confirm the QR contains `https://` and the exact `.ts.net` MagicDNS name. Do not replace it with HTTP, a raw `100.x` URL, or a self-signed certificate.

## Physical-Device Validation

Simulator and unit tests cannot prove Network Extension routing, tailnet policy, certificate trust, or cellular handoff. Before release:

1. Connect the receiver and iPhone to the same tailnet and verify the HTTPS health URL in iPhone Safari.
2. Put the iPhone on a different network from the receiver, such as cellular with Wi-Fi disabled.
3. Run `healthlink-local pair`, scan the QR, and confirm the app displays the HTTPS `.ts.net` receiver.
4. Approve pairing and perform a Health sync.
5. Confirm `healthlink-local status` records the source device and sync across the two networks.
6. Disconnect Tailscale on the iPhone and confirm sync fails safely, then reconnect and confirm retry succeeds without re-pairing.
7. Reboot or restart Tailscale on the receiver and confirm the `--bg` Serve route and receiver service recover.
