import SwiftUI
import UIKit

struct ContentView: View {
    var body: some View {
        TabView {
            DashboardView()
                .tabItem {
                    Label("Sync", systemImage: "arrow.triangle.2.circlepath")
                }

            SettingsView()
                .tabItem {
                    Label("Settings", systemImage: "gearshape")
                }
        }
        .tint(GatewayStyle.primary)
    }
}

struct DashboardView: View {
    @EnvironmentObject private var settings: GatewaySettings
    @EnvironmentObject private var sync: SyncCoordinator

    var body: some View {
        NavigationStack {
            ZStack {
                GatewayStyle.background.ignoresSafeArea()

                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        HeaderPanel(
                            isConfigured: isConfigured,
                            isSyncing: sync.isSyncing,
                            lastError: sync.status.lastError
                        )

                        PermissionPanel(sync: sync)

                        SyncPanel(settings: settings, sync: sync)

                        if sync.latestHealthSummary != nil || sync.latestCalendarSummary != nil {
                            SummaryPanel(
                                health: sync.latestHealthSummary,
                                calendar: sync.latestCalendarSummary
                            )
                        } else {
                            EmptySummaryPanel()
                        }
                    }
                    .padding(.horizontal, 18)
                    .padding(.top, 14)
                    .padding(.bottom, 28)
                }
            }
            .navigationTitle("HealthLink")
            .navigationBarTitleDisplayMode(.inline)
        }
    }

    private var isConfigured: Bool {
        settings.serverURL != nil && !settings.apiTokenText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
}

struct HeaderPanel: View {
    let isConfigured: Bool
    let isSyncing: Bool
    let lastError: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Gateway")
                        .font(.system(size: 34, weight: .bold, design: .rounded))
                        .foregroundStyle(GatewayStyle.text)

                    Text(statusText)
                        .font(.callout)
                        .foregroundStyle(GatewayStyle.mutedText)
                        .lineLimit(2)
                }

                Spacer()

                StatusBadge(
                    title: badgeTitle,
                    systemImage: badgeIcon,
                    tone: badgeTone
                )
            }

            if let lastError {
                ErrorBanner(message: lastError)
            }
        }
        .padding(18)
        .background(GatewayStyle.surface)
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .stroke(GatewayStyle.border, lineWidth: 1)
        )
    }

    private var statusText: String {
        if isSyncing {
            return "Sync in progress"
        }
        if lastError != nil {
            return "Last operation needs attention"
        }
        if isConfigured {
            return "Ready to publish daily context"
        }
        return "Server settings required"
    }

    private var badgeTitle: String {
        if isSyncing { return "Syncing" }
        if lastError != nil { return "Check" }
        return isConfigured ? "Ready" : "Setup"
    }

    private var badgeIcon: String {
        if isSyncing { return "arrow.triangle.2.circlepath" }
        if lastError != nil { return "exclamationmark.triangle" }
        return isConfigured ? "checkmark.seal" : "slider.horizontal.3"
    }

    private var badgeTone: StatusTone {
        if isSyncing { return .neutral }
        if lastError != nil { return .warning }
        return isConfigured ? .success : .neutral
    }
}

struct PermissionPanel: View {
    @Environment(\.openURL) private var openURL
    @EnvironmentObject private var settings: GatewaySettings

    @ObservedObject var sync: SyncCoordinator

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionTitle("Permissions")

            HStack(spacing: 12) {
                PermissionButton(
                    title: "Health",
                    systemImage: "heart.text.square",
                    disabled: sync.isSyncing
                ) {
                    Task { await sync.requestHealthAuthorization(settings: settings) }
                }

                PermissionButton(
                    title: "Calendar",
                    systemImage: "calendar.badge.clock",
                    disabled: sync.isSyncing
                ) {
                    Task { await sync.requestCalendarAuthorization(settings: settings) }
                }
            }

            Button {
                openURL(URL(string: UIApplication.openSettingsURLString)!)
            } label: {
                Label("Open iOS Settings", systemImage: "gearshape")
                    .font(.footnote.weight(.semibold))
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
            .tint(GatewayStyle.primary)
            .disabled(sync.isSyncing)
        }
    }
}

struct SyncPanel: View {
    @ObservedObject var settings: GatewaySettings
    @ObservedObject var sync: SyncCoordinator

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionTitle("Sync")

            VStack(spacing: 14) {
                if settings.isPaired {
                    HStack(spacing: 10) {
                        Image(systemName: "link.badge.plus")
                            .foregroundStyle(GatewayStyle.primary)
                            .frame(width: 22)

                        VStack(alignment: .leading, spacing: 2) {
                            Text(settings.serverURLText.isEmpty ? "No server" : settings.serverURLText)
                                .font(.footnote.weight(.semibold))
                                .foregroundStyle(GatewayStyle.text)
                                .lineLimit(1)
                                .truncationMode(.middle)

                            Text(settings.pairedDeviceID.map(shortDeviceID) ?? "No device")
                                .font(.caption)
                                .foregroundStyle(GatewayStyle.mutedText)
                        }

                        Spacer(minLength: 0)
                    }
                }

                Button {
                    Task { await sync.sync(settings: settings, trigger: .manual) }
                } label: {
                    HStack(spacing: 12) {
                        ZStack {
                            Circle()
                                .fill(GatewayStyle.primary.opacity(0.12))
                                .frame(width: 38, height: 38)

                            if sync.isSyncing {
                                ProgressView()
                                    .controlSize(.small)
                            } else {
                                Image(systemName: "icloud.and.arrow.up")
                                    .font(.system(size: 17, weight: .bold))
                                    .foregroundStyle(GatewayStyle.primary)
                            }
                        }

                        VStack(alignment: .leading, spacing: 3) {
                            Text("Sync Yesterday and Today")
                                .font(.headline)
                                .foregroundStyle(GatewayStyle.text)

                            Text(sync.isSyncing ? "Uploading summaries" : "Health and calendar summaries")
                                .font(.caption)
                                .foregroundStyle(GatewayStyle.mutedText)
                        }

                        Spacer()

                        Image(systemName: "chevron.right")
                            .font(.caption.weight(.bold))
                            .foregroundStyle(GatewayStyle.mutedText)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(sync.isSyncing)

                Divider()

                HStack(spacing: 12) {
                    LastSyncTile(
                        title: "Health",
                        systemImage: "heart",
                        date: sync.status.lastHealthSyncAt
                    )

                    LastSyncTile(
                        title: "Calendar",
                        systemImage: "calendar",
                        date: sync.status.lastCalendarSyncAt
                    )
                }

                if settings.autoSyncEnabled {
                    AutoSyncStatusRow(settings: settings)
                }

                if let message = sync.status.lastSuccessMessage {
                    StatusMessage(
                        message: message,
                        systemImage: "checkmark.circle",
                        color: GatewayStyle.success
                    )
                }

                if let message = sync.status.lastError {
                    StatusMessage(
                        message: message,
                        systemImage: "exclamationmark.triangle",
                        color: GatewayStyle.warning
                    )
                }
            }
            .padding(14)
            .background(GatewayStyle.surface)
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .stroke(GatewayStyle.border, lineWidth: 1)
            )
        }
    }

    private func shortDeviceID(_ deviceID: String) -> String {
        guard deviceID.count > 14 else {
            return deviceID
        }
        return "\(deviceID.prefix(8))...\(deviceID.suffix(6))"
    }
}

struct StatusMessage: View {
    let message: String
    let systemImage: String
    let color: Color

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: systemImage)
                .font(.caption.weight(.bold))
                .foregroundStyle(color)
                .frame(width: 16)

            Text(message)
                .font(.footnote)
                .foregroundStyle(GatewayStyle.mutedText)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct AutoSyncStatusRow: View {
    @ObservedObject var settings: GatewaySettings

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "timer")
                .font(.caption.weight(.bold))
                .foregroundStyle(GatewayStyle.primary)
                .frame(width: 16)

            VStack(alignment: .leading, spacing: 2) {
                Text("Auto Sync")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(GatewayStyle.text)

                Text(detail)
                    .font(.caption)
                    .foregroundStyle(GatewayStyle.mutedText)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var detail: String {
        if let lastAutoSyncAt = settings.lastAutoSyncAt {
            return "Last \(lastAutoSyncAt.formatted(date: .omitted, time: .shortened))"
        }
        if let nextEligibleAutoSyncAt = settings.nextEligibleAutoSyncAt {
            return "Next eligible \(nextEligibleAutoSyncAt.formatted(date: .omitted, time: .shortened))"
        }
        return "Ready when the app is active"
    }
}

struct SummaryPanel: View {
    let health: DailyHealthSummary?
    let calendar: DailyCalendarSummary?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionTitle("Latest Summary")

            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                MetricTile(
                    title: "Steps",
                    value: health?.steps.map(String.init) ?? "-",
                    systemImage: "figure.walk"
                )

                MetricTile(
                    title: "Sleep",
                    value: minutes(health?.sleep_minutes),
                    systemImage: "bed.double"
                )

                MetricTile(
                    title: "Resting HR",
                    value: bpm(health?.resting_heart_rate_bpm),
                    systemImage: "heart"
                )

                MetricTile(
                    title: "Workout",
                    value: minutes(health?.workout_minutes),
                    systemImage: "figure.strengthtraining.traditional"
                )

                MetricTile(
                    title: "Busy",
                    value: minutes(calendar?.busy_minutes),
                    systemImage: "calendar"
                )

                MetricTile(
                    title: "Free",
                    value: calendar.map { "\($0.free_windows.count)" } ?? "-",
                    systemImage: "clock.badge.checkmark"
                )
            }
        }
    }

    private func minutes(_ value: Int?) -> String {
        guard let value else { return "-" }
        if value >= 60 {
            let hours = value / 60
            let minutes = value % 60
            return minutes == 0 ? "\(hours)h" : "\(hours)h \(minutes)m"
        }
        return "\(value)m"
    }

    private func bpm(_ value: Double?) -> String {
        guard let value else { return "-" }
        return "\(Int(value.rounded()))"
    }
}

struct EmptySummaryPanel: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionTitle("Latest Summary")

            VStack(alignment: .leading, spacing: 10) {
                Image(systemName: "tray")
                    .font(.title2)
                    .foregroundStyle(GatewayStyle.mutedText)

                Text("No summaries yet")
                    .font(.headline)
                    .foregroundStyle(GatewayStyle.text)

                Text("Awaiting first daily context")
                    .font(.footnote)
                    .foregroundStyle(GatewayStyle.mutedText)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(16)
            .background(GatewayStyle.surface)
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .stroke(GatewayStyle.border, lineWidth: 1)
            )
        }
    }
}

struct SettingsView: View {
    @EnvironmentObject private var settings: GatewaySettings
    @EnvironmentObject private var sync: SyncCoordinator
    @State private var isShowingScanner = false

    var body: some View {
        NavigationStack {
            Form {
                Section("Pairing") {
                    Button {
                        isShowingScanner = true
                    } label: {
                        Label("Scan Pairing QR", systemImage: "qrcode.viewfinder")
                    }
                    .disabled(settings.isPairing)

                    TextField("healthlink://pair?server=...&code=...", text: $settings.pairingURLText)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)

                    Button {
                        Task { await settings.preparePairingFromText() }
                    } label: {
                        if settings.isPairing {
                            Label("Checking Pairing", systemImage: "arrow.triangle.2.circlepath")
                        } else {
                            Label("Use Pairing URL", systemImage: "link")
                        }
                    }
                    .disabled(settings.isPairing || settings.pairingURLText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

                    HStack {
                        Label(pairingStatus, systemImage: pairingIcon)
                            .foregroundStyle(pairingColor)
                        Spacer()
                    }
                    .font(.footnote)

                    if let deviceID = settings.pairedDeviceID {
                        Text(deviceID)
                            .font(.footnote.monospaced())
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                            .truncationMode(.middle)
                    }

                    if settings.isPaired {
                        VStack(alignment: .leading, spacing: 6) {
                            LabeledContent("Server", value: settings.serverURLText.isEmpty ? "-" : settings.serverURLText)
                            LabeledContent("Scopes", value: settings.acceptedScopes.joined(separator: ", "))
                        }
                        .font(.footnote)

                        Button(role: .destructive) {
                            Task { await settings.disconnect() }
                        } label: {
                            Label("Disconnect Device", systemImage: "iphone.slash")
                        }
                        .disabled(settings.isPairing)
                    }

                    if let message = settings.pairingMessage {
                        Text(message)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                }

                Section("Server") {
                    TextField("Server URL", text: $settings.serverURLText)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)

                    SecureField("API token", text: $settings.apiTokenText)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()

                    HStack {
                        Label(tokenStatus, systemImage: tokenIcon)
                            .foregroundStyle(tokenColor)
                        Spacer()
                    }
                    .font(.footnote)
                }

                Section("Data") {
                    Toggle(isOn: $settings.uploadHealthEnabled) {
                        Label("Health summaries", systemImage: "heart.text.square")
                    }

                    Toggle(isOn: $settings.uploadCalendarEnabled) {
                        Label("Calendar summaries", systemImage: "calendar.badge.clock")
                    }
                }

                Section("Auto Sync") {
                    Toggle(isOn: $settings.autoSyncEnabled) {
                        Label("Auto Sync", systemImage: "arrow.triangle.2.circlepath")
                    }
                    .onChange(of: settings.autoSyncEnabled) { _, _ in
                        settings.saveAutoSyncSettings()
                    }

                    Stepper(value: $settings.autoSyncMinimumIntervalMinutes, in: 5...240, step: 5) {
                        Label("Minimum \(settings.autoSyncMinimumIntervalMinutes)m", systemImage: "timer")
                    }
                    .disabled(!settings.autoSyncEnabled)
                    .onChange(of: settings.autoSyncMinimumIntervalMinutes) { _, _ in
                        settings.saveAutoSyncSettings()
                    }

                    if let lastAutoSyncAt = settings.lastAutoSyncAt {
                        LabeledContent("Last auto sync", value: lastAutoSyncAt.formatted(date: .omitted, time: .shortened))
                    }

                    if let nextEligibleAutoSyncAt = settings.nextEligibleAutoSyncAt {
                        LabeledContent("Next eligible", value: nextEligibleAutoSyncAt.formatted(date: .omitted, time: .shortened))
                    }
                }

                Section {
                    Button {
                        settings.save()
                    } label: {
                        Label("Save Settings", systemImage: "checkmark.circle")
                    }

                    if let message = settings.lastSavedMessage {
                        Text(message)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                }

                Section("Privacy") {
                    Label("Calendar titles are redacted", systemImage: "calendar.badge.exclamationmark")
                    Label("Health samples are summarized", systemImage: "chart.bar.doc.horizontal")
                }
                .font(.footnote)
                .foregroundStyle(.secondary)
            }
            .navigationTitle("Settings")
            .sheet(isPresented: $isShowingScanner) {
                PairingScannerView { value in
                    isShowingScanner = false
                    Task { await settings.preparePairing(rawValue: value) }
                }
            }
            .sheet(item: $settings.pendingPairing) { preview in
                PairingConfirmationView(
                    preview: preview,
                    isPairing: settings.isPairing,
                    onCancel: {
                        settings.cancelPendingPairing()
                    },
                    onConfirm: {
                        Task {
                            let paired = await settings.confirmPairing(preview)
                            if paired {
                                await sync.attemptAutoSync(settings: settings, reason: "pairing")
                            }
                        }
                    }
                )
            }
        }
    }

    private var tokenStatus: String {
        settings.apiTokenText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "Token not set" : "Token set"
    }

    private var tokenIcon: String {
        settings.apiTokenText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "key.slash" : "key"
    }

    private var tokenColor: Color {
        settings.apiTokenText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? GatewayStyle.warning : GatewayStyle.success
    }

    private var pairingStatus: String {
        settings.isPaired ? "Device paired" : "No paired device"
    }

    private var pairingIcon: String {
        settings.isPaired ? "iphone.gen3" : "iphone.slash"
    }

    private var pairingColor: Color {
        settings.isPaired ? GatewayStyle.success : GatewayStyle.warning
    }
}

struct PairingConfirmationView: View {
    let preview: PairingPreview
    let isPairing: Bool
    let onCancel: () -> Void
    let onConfirm: () -> Void

    var body: some View {
        NavigationStack {
            Form {
                Section("Agent") {
                    LabeledContent("Name", value: preview.status.agent_name)
                    LabeledContent("Server", value: preview.status.server_url)
                    if let transport = preview.status.transport {
                        LabeledContent("Transport", value: transport)
                    }
                    LabeledContent("Code", value: preview.status.pairing_code)
                    LabeledContent("Expires", value: preview.status.expires_at)
                }

                Section("Scopes") {
                    ForEach(preview.status.requested_scopes, id: \.self) { scope in
                        Label(scope, systemImage: "checkmark.circle")
                    }
                }
            }
            .navigationTitle("Confirm Pairing")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", action: onCancel)
                        .disabled(isPairing)
                }

                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        onConfirm()
                    } label: {
                        if isPairing {
                            Text("Pairing")
                        } else {
                            Text("Pair")
                        }
                    }
                    .disabled(isPairing)
                }
            }
        }
    }
}

struct PermissionButton: View {
    let title: String
    let systemImage: String
    let disabled: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 12) {
                Image(systemName: systemImage)
                    .font(.system(size: 20, weight: .bold))
                    .foregroundStyle(GatewayStyle.primary)

                HStack {
                    Text(title)
                        .font(.headline)
                        .foregroundStyle(GatewayStyle.text)

                    Spacer()

                    Image(systemName: "chevron.right")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(GatewayStyle.mutedText)
                }
            }
            .frame(maxWidth: .infinity, minHeight: 94, alignment: .leading)
            .padding(14)
            .background(GatewayStyle.surface)
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .stroke(GatewayStyle.border, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
        .disabled(disabled)
    }
}

struct LastSyncTile: View {
    let title: String
    let systemImage: String
    let date: Date?

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: systemImage)
                .font(.system(size: 16, weight: .bold))
                .foregroundStyle(GatewayStyle.primary)
                .frame(width: 24)

            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.caption)
                    .foregroundStyle(GatewayStyle.mutedText)

                Text(date.map(Self.format) ?? "Never")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(GatewayStyle.text)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private static func format(_ date: Date) -> String {
        date.formatted(date: .omitted, time: .shortened)
    }
}

struct MetricTile: View {
    let title: String
    let value: String
    let systemImage: String

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Image(systemName: systemImage)
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(GatewayStyle.primary)

                Spacer()
            }

            VStack(alignment: .leading, spacing: 3) {
                Text(value)
                    .font(.system(size: 25, weight: .bold, design: .rounded))
                    .foregroundStyle(GatewayStyle.text)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)

                Text(title)
                    .font(.caption)
                    .foregroundStyle(GatewayStyle.mutedText)
                    .lineLimit(1)
            }
        }
        .frame(maxWidth: .infinity, minHeight: 104, alignment: .leading)
        .padding(14)
        .background(GatewayStyle.surface)
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .stroke(GatewayStyle.border, lineWidth: 1)
        )
    }
}

struct StatusBadge: View {
    let title: String
    let systemImage: String
    let tone: StatusTone

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: systemImage)
                .font(.caption.weight(.bold))
            Text(title)
                .font(.caption.weight(.bold))
        }
        .foregroundStyle(tone.foreground)
        .padding(.horizontal, 10)
        .padding(.vertical, 7)
        .background(tone.background)
        .clipShape(Capsule())
    }
}

struct ErrorBanner: View {
    let message: String

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(GatewayStyle.warning)

            Text(message)
                .font(.footnote)
                .foregroundStyle(GatewayStyle.text)
                .fixedSize(horizontal: false, vertical: true)

            Spacer(minLength: 0)
        }
        .padding(12)
        .background(GatewayStyle.warning.opacity(0.12))
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
    }
}

struct SectionTitle: View {
    let title: String

    init(_ title: String) {
        self.title = title
    }

    var body: some View {
        Text(title)
            .font(.caption.weight(.bold))
            .textCase(.uppercase)
            .foregroundStyle(GatewayStyle.mutedText)
            .tracking(0.8)
            .padding(.horizontal, 2)
    }
}

enum StatusTone {
    case success
    case warning
    case neutral

    var foreground: Color {
        switch self {
        case .success:
            return GatewayStyle.success
        case .warning:
            return GatewayStyle.warning
        case .neutral:
            return GatewayStyle.primary
        }
    }

    var background: Color {
        foreground.opacity(0.12)
    }
}

enum GatewayStyle {
    static let background = Color(.systemGroupedBackground)
    static let surface = Color(.systemBackground)
    static let border = Color(.separator).opacity(0.35)
    static let primary = Color(red: 0.12, green: 0.25, blue: 0.69)
    static let text = Color(.label)
    static let mutedText = Color(.secondaryLabel)
    static let success = Color(red: 0.05, green: 0.48, blue: 0.34)
    static let warning = Color(red: 0.78, green: 0.39, blue: 0.03)
}
