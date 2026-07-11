# HealthLink Website Media Plan

The homepage exposes stable `data-media-slot` hooks so production captures can replace the current code-native placeholders without changing layout.

## Placement

| Slot | Location | Final asset | Recommended content | Target |
| --- | --- | --- | --- | --- |
| `hero-route-motion` | Hero footer | Micro animation | iPhone encrypts, blind relay forwards, local agent decrypts | 6-8 second seamless loop |
| `onboarding-demo-loop` | Four-step product workbench | UI animation or short capture | Install Skill, scan QR, encrypted sync, first answer | 12-18 seconds, synchronized with the four tabs |
| `privacy-route-motion` | Dark privacy band | Micro animation | Plaintext becomes ciphertext before the relay and opens only locally | 6-8 second loop, low contrast |
| `agent-context-screenshot` | Main product frame | Desktop screenshot | Real OpenClaw answer with freshness, evidence, and scoped health facts | 16:10, 1600x1000 source |
| `ios-sync-screenshot` | Phone frame | iPhone screenshot | Real pairing or successful encrypted sync state | 1290x2796 source |
| `product-demo-video` | Dark film strip | Product video | Complete first run from install to answer | 25-40 seconds with poster image |

## Capture Order

1. Capture the iPhone pairing and sync states first. They establish the product as real.
2. Capture the OpenClaw answer with the exact same sample account and timestamps.
3. Record the onboarding loop from those two captures.
4. Produce the longer product video only after the onboarding flow is stable.

## Delivery

- Screenshots: keep PNG masters; ship AVIF with WebP fallback.
- UI loops: prefer muted WebM with MP4 fallback and a still poster.
- Interactive vector motion: use Rive only when pointer or state input changes the animation; keep CSS/Motion for simple route pulses.
- Respect `prefers-reduced-motion` and always show the final useful frame when motion is disabled.
- Keep the hero loop below 350 KB and the onboarding loop below 1.2 MB on initial load.
- Lazy-load every asset below the onboarding workbench.

## Replacement Contract

The placeholders already own their final aspect ratios. Replace the content inside the matching `data-media-slot` element; do not change the surrounding grid, section height, or responsive breakpoints.
