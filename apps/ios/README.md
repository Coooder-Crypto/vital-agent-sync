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

## Test

Run the simulator suite from the repository root:

```bash
npm run test:ios
```

HealthKit authorization, QR scanning, LAN/Tailscale reachability, and first sync still require a physical-device smoke test.

## Layout

| Path | Purpose |
| --- | --- |
| `App/` | SwiftUI source, entitlements, and Info.plist |
| `Resources/` | Asset catalog and localizations |
| `Tests/` | Focused iOS unit tests |
| `project.yml` | XcodeGen project definition |
| `VitalAgentSync.xcodeproj/` | Generated shared Xcode project |
