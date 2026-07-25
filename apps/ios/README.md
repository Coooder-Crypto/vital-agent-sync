# Vital Agent Sync iOS App

This directory contains the SwiftUI app that reads user-authorized Apple Health data and syncs it to the user's Vital Agent Sync runtime.

## Requirements

- macOS with Xcode;
- XcodeGen;
- an iOS 17 or newer simulator for unit tests;
- a physical iPhone for HealthKit and QR-pairing validation.

## Generate and open the project

Run from this directory:

```bash
xcodegen generate
open VitalAgentSync.xcodeproj
```

For a physical-device build, select your Apple Developer Team, use a unique bundle identifier, and keep the HealthKit capability enabled. Signing certificates, provisioning profiles, and App Store Connect credentials must never be committed.

If Xcode reports that launching is taking longer than expected because LLDB is
reading device memory to resolve symbols, stop that run and select the
`VitalAgentSync-NoDebugger` scheme. It builds and installs the same Debug app
without attaching LLDB. Switch back to `VitalAgentSync` when breakpoints are
needed.

## Test

Run the simulator suite from the repository root:

```bash
npm run test:ios
```

HealthKit authorization, QR scanning, LAN/Tailscale reachability, and first sync still require a physical-device smoke test.

## Sync behavior

- Manual sync defaults to 30 days and offers 2, 7, 14, 30, 90 days, or all available history.
- All-history sync discovers the earliest readable HealthKit sample, builds daily summaries, and uploads them in 14-day batches.
- All-history sync runs only as an explicit foreground action. The Home screen shows progress and allows cancellation.
- Manual syncs, first pairing/authorization syncs, and Agent-triggered deep links use the selected range, which defaults to 30 days.
- Automatic app lifecycle and background syncs refresh today and yesterday.
- Retrying a partial history sync is safe because the receiver upserts stable daily-summary records.

## Layout

| Path | Purpose |
| --- | --- |
| `App/` | SwiftUI source, entitlements, and Info.plist |
| `Resources/` | Asset catalog and localizations |
| `Tests/` | Focused iOS unit tests |
| `project.yml` | XcodeGen project definition |
| `VitalAgentSync.xcodeproj/` | Generated shared Xcode project |
