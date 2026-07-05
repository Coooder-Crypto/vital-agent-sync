import SwiftUI
import UIKit

struct ContentView: View {
    @EnvironmentObject private var settings: GatewaySettings
    @EnvironmentObject private var sync: SyncCoordinator
    @State private var isShowingScanner = false

    var body: some View {
        TabView {
            HomeView(isShowingScanner: $isShowingScanner)
                .tabItem {
                    Label("Home", systemImage: "house")
                }

            SourcesView()
                .tabItem {
                    Label("Sources", systemImage: "heart.text.square")
                }

            ConnectionView(isShowingScanner: $isShowingScanner)
                .tabItem {
                    Label("Connection", systemImage: "link")
                }
        }
        .tint(GatewayStyle.primary)
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

struct HomeView: View {
    @EnvironmentObject private var settings: GatewaySettings
    @EnvironmentObject private var sync: SyncCoordinator
    @Binding var isShowingScanner: Bool

    var body: some View {
        NavigationStack {
            ZStack {
                GatewayStyle.background.ignoresSafeArea()

                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        HomeHeroPanel(
                            settings: settings,
                            sync: sync,
                            onScan: { isShowingScanner = true },
                            onSync: {
                                Task { await sync.sync(settings: settings, trigger: .manual) }
                            }
                        )

                        if settings.isPaired {
                            if sync.latestHealthSummary != nil {
                                SummaryPanel(
                                    health: sync.latestHealthSummary
                                )
                            } else {
                                EmptySummaryPanel()
                            }

                            AgentPromptPanel(agentName: agentName)
                            HomeSyncDetails(settings: settings, sync: sync)
                        } else {
                            PairingCommandPanel(onScan: { isShowingScanner = true })
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

    private var agentName: String {
        settings.pairedAgentName?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
            ? settings.pairedAgentName!
            : "your agent"
    }
}

struct SourcesView: View {
    @Environment(\.openURL) private var openURL
    @EnvironmentObject private var settings: GatewaySettings
    @EnvironmentObject private var sync: SyncCoordinator

    var body: some View {
        NavigationStack {
            Form {
                Section("Data Sources") {
                    Button {
                        Task { await sync.requestHealthAuthorization(settings: settings) }
                    } label: {
                        Label("Allow Health Access", systemImage: "heart.text.square")
                    }
                    .disabled(sync.isSyncing)

                    Button {
                        openURL(URL(string: UIApplication.openSettingsURLString)!)
                    } label: {
                        Label("Open iOS Settings", systemImage: "gearshape")
                    }
                    .disabled(sync.isSyncing)
                }

                Section("Data Sent To Agent") {
                    Toggle(isOn: $settings.uploadHealthEnabled) {
                        Label("Health summaries", systemImage: "heart")
                    }
                    .onChange(of: settings.uploadHealthEnabled) { _, _ in
                        settings.save()
                    }
                }

                Section("Auto Sync") {
                    Toggle(isOn: $settings.autoSyncEnabled) {
                        Label("Auto Sync", systemImage: "arrow.triangle.2.circlepath")
                    }
                    .onChange(of: settings.autoSyncEnabled) { _, _ in
                        settings.saveAutoSyncSettings()
                        BackgroundSyncManager.scheduleAppRefresh(settings: settings)
                    }

                    Stepper(value: $settings.autoSyncMinimumIntervalMinutes, in: 5...240, step: 5) {
                        Label("Minimum \(settings.autoSyncMinimumIntervalMinutes)m", systemImage: "timer")
                    }
                    .disabled(!settings.autoSyncEnabled)
                    .onChange(of: settings.autoSyncMinimumIntervalMinutes) { _, _ in
                        settings.saveAutoSyncSettings()
                        BackgroundSyncManager.scheduleAppRefresh(settings: settings)
                    }

                    if let lastAutoSyncAt = settings.lastAutoSyncAt {
                        LabeledContent("Last auto sync", value: lastAutoSyncAt.formatted(date: .omitted, time: .shortened))
                    }

                    if let lastSyncAttemptAt = settings.lastSyncAttemptAt {
                        LabeledContent("Last attempt", value: lastSyncAttemptAt.formatted(date: .omitted, time: .shortened))
                    }

                    if let nextEligibleAutoSyncAt = settings.nextEligibleAutoSyncAt {
                        LabeledContent("Next eligible", value: nextEligibleAutoSyncAt.formatted(date: .omitted, time: .shortened))
                    }
                }

                Section("Sync History") {
                    LabeledContent("Health", value: sync.status.lastHealthSyncAt.map(Self.formatDate) ?? "Never")

                    if let lastSyncError = settings.lastSyncError ?? sync.status.lastError {
                        Label(lastSyncError, systemImage: "exclamationmark.triangle")
                            .foregroundStyle(GatewayStyle.warning)
                    }

                    if let lastBackgroundScheduleError = settings.lastBackgroundScheduleError {
                        Label(lastBackgroundScheduleError, systemImage: "arrow.triangle.2.circlepath.circle")
                            .foregroundStyle(GatewayStyle.warning)
                    }
                }

                Section("Privacy") {
                    Label("Health samples are summarized", systemImage: "chart.bar.doc.horizontal")
                }
                .font(.footnote)
                .foregroundStyle(.secondary)
            }
            .navigationTitle("Sources")
        }
    }

    private static func formatDate(_ date: Date) -> String {
        date.formatted(date: .abbreviated, time: .shortened)
    }
}

struct ConnectionView: View {
    @EnvironmentObject private var settings: GatewaySettings
    @EnvironmentObject private var sync: SyncCoordinator
    @Binding var isShowingScanner: Bool

    @State private var receiverStatus: ReceiverCheckState = .idle
    @State private var isAdvancedExpanded = false

    var body: some View {
        NavigationStack {
            ZStack {
                GatewayStyle.background.ignoresSafeArea()

                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        ConnectionStatusPanel(
                            settings: settings,
                            receiverStatus: receiverStatus,
                            onCheck: {
                                Task { await checkReceiver() }
                            }
                        )

                        PairingPanel(
                            settings: settings,
                            isShowingScanner: $isShowingScanner
                        )

                        AdvancedConnectionPanel(
                            settings: settings,
                            isExpanded: $isAdvancedExpanded
                        )

                        if settings.isPaired {
                            Button(role: .destructive) {
                                Task { await settings.disconnect() }
                            } label: {
                                Label("Disconnect Agent", systemImage: "iphone.slash")
                                    .frame(maxWidth: .infinity)
                            }
                            .buttonStyle(.bordered)
                            .disabled(settings.isPairing)
                        }

                        if let message = settings.pairingMessage {
                            StatusMessage(
                                message: message,
                                systemImage: settings.isPaired ? "checkmark.circle" : "exclamationmark.triangle",
                                color: settings.isPaired ? GatewayStyle.success : GatewayStyle.warning
                            )
                            .padding(.horizontal, 2)
                        }
                    }
                    .padding(.horizontal, 18)
                    .padding(.top, 14)
                    .padding(.bottom, 28)
                }
            }
            .navigationTitle("Connection")
            .navigationBarTitleDisplayMode(.inline)
            .task(id: settings.serverURLText) {
                if settings.isPaired {
                    await checkReceiver()
                }
            }
        }
    }

    private func checkReceiver() async {
        guard let serverURL = settings.serverURL else {
            receiverStatus = .offline("No server URL")
            return
        }

        receiverStatus = .checking
        do {
            let status = try await GatewayAPIClient.checkReceiver(serverURL: serverURL)
            receiverStatus = .online(status)
        } catch {
            receiverStatus = .offline(error.localizedDescription)
        }
    }
}

struct HomeHeroPanel: View {
    @ObservedObject var settings: GatewaySettings
    @ObservedObject var sync: SyncCoordinator
    let onScan: () -> Void
    let onSync: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(title)
                        .font(.system(size: 30, weight: .bold, design: .rounded))
                        .foregroundStyle(GatewayStyle.text)

                    Text(subtitle)
                        .font(.callout)
                        .foregroundStyle(GatewayStyle.mutedText)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Spacer(minLength: 12)

                StatusBadge(
                    title: badgeTitle,
                    systemImage: badgeIcon,
                    tone: badgeTone
                )
            }

            if let lastError = sync.status.lastError ?? settings.lastSyncError {
                ErrorBanner(message: lastError)
            }

            Button(action: primaryAction) {
                HStack {
                    Image(systemName: primaryIcon)
                        .font(.headline.weight(.semibold))

                    Text(primaryTitle)
                        .font(.headline.weight(.semibold))

                    Spacer()

                    if sync.isSyncing || settings.isPairing {
                        ProgressView()
                    } else {
                        Image(systemName: "chevron.right")
                            .font(.caption.weight(.bold))
                    }
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 14)
                .padding(.horizontal, 16)
            }
            .buttonStyle(.plain)
            .foregroundStyle(.white)
            .background(GatewayStyle.primary)
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            .disabled(sync.isSyncing || settings.isPairing)
        }
        .padding(18)
        .background(GatewayStyle.surface)
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .stroke(GatewayStyle.border, lineWidth: 1)
        )
    }

    private var title: String {
        if !settings.isPaired {
            return "Connect your agent"
        }
        if sync.status.lastError != nil || settings.lastSyncError != nil {
            return "Sync needs attention"
        }
        return "Ready for \(agentName)"
    }

    private var subtitle: String {
        if !settings.isPaired {
            return "Pair HealthLink with your local Agent receiver."
        }
        if sync.isSyncing {
            return "Uploading your latest daily summaries."
        }
        if let latestSyncDate {
            return "Last sync \(latestSyncDate.formatted(date: .omitted, time: .shortened))."
        }
        return "Connected. Run the first sync when you are ready."
    }

    private var primaryTitle: String {
        if !settings.isPaired {
            return "Scan QR Code"
        }
        if sync.isSyncing {
            return "Syncing"
        }
        if sync.status.lastError != nil || settings.lastSyncError != nil {
            return "Retry Sync"
        }
        return "Sync Now"
    }

    private var primaryIcon: String {
        settings.isPaired ? "icloud.and.arrow.up" : "qrcode.viewfinder"
    }

    private var badgeTitle: String {
        if sync.isSyncing { return "Syncing" }
        if !settings.isPaired { return "Setup" }
        if sync.status.lastError != nil || settings.lastSyncError != nil { return "Check" }
        return "Connected"
    }

    private var badgeIcon: String {
        if sync.isSyncing { return "arrow.triangle.2.circlepath" }
        if !settings.isPaired { return "link.badge.plus" }
        if sync.status.lastError != nil || settings.lastSyncError != nil { return "exclamationmark.triangle" }
        return "checkmark.seal"
    }

    private var badgeTone: StatusTone {
        if sync.isSyncing { return .neutral }
        if !settings.isPaired { return .neutral }
        if sync.status.lastError != nil || settings.lastSyncError != nil { return .warning }
        return .success
    }

    private var agentName: String {
        settings.pairedAgentName?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
            ? settings.pairedAgentName!
            : "your agent"
    }

    private var latestSyncDate: Date? {
        [sync.status.lastHealthSyncAt, settings.lastManualSyncAt, settings.lastAutoSyncAt]
            .compactMap { $0 }
            .max()
    }

    private func primaryAction() {
        if settings.isPaired {
            onSync()
        } else {
            onScan()
        }
    }
}

struct PairingCommandPanel: View {
    let onScan: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionTitle("Agent Setup")

            VStack(alignment: .leading, spacing: 12) {
                Text("Run this on your Mac")
                    .font(.headline)
                    .foregroundStyle(GatewayStyle.text)

                Text("npx -y healthlink-local setup --agent hermes --service")
                    .font(.footnote.monospaced())
                    .foregroundStyle(GatewayStyle.text)
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color(.secondarySystemGroupedBackground))
                    .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))

                Button(action: onScan) {
                    Label("Scan QR Code", systemImage: "qrcode.viewfinder")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(GatewayStyle.primary)
            }
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

struct AgentPromptPanel: View {
    let agentName: String

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionTitle("Ask \(agentName)")

            VStack(alignment: .leading, spacing: 10) {
                PromptRow(text: "How is my day looking?")
                PromptRow(text: "Review my sleep and recovery.")
                PromptRow(text: "Should I work out or recover today?")
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
}

struct PromptRow: View {
    let text: String

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "quote.opening")
                .font(.caption.weight(.bold))
                .foregroundStyle(GatewayStyle.primary)
                .frame(width: 18)

            Text(text)
                .font(.footnote.weight(.semibold))
                .foregroundStyle(GatewayStyle.text)
                .fixedSize(horizontal: false, vertical: true)

            Spacer(minLength: 0)
        }
    }
}

struct HomeSyncDetails: View {
    @ObservedObject var settings: GatewaySettings
    @ObservedObject var sync: SyncCoordinator

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionTitle("Sync Status")

            VStack(spacing: 12) {
                HStack(spacing: 12) {
                    LastSyncTile(
                        title: "Health",
                        systemImage: "heart",
                        date: sync.status.lastHealthSyncAt
                    )

                }

                AutoSyncStatusRow(settings: settings)

                if let message = sync.status.lastSuccessMessage {
                    StatusMessage(
                        message: message,
                        systemImage: "checkmark.circle",
                        color: GatewayStyle.success
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
}

struct ConnectionStatusPanel: View {
    @ObservedObject var settings: GatewaySettings
    let receiverStatus: ReceiverCheckState
    let onCheck: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(settings.isPaired ? agentName : "No agent connected")
                        .font(.title2.weight(.bold))
                        .foregroundStyle(GatewayStyle.text)

                    Text(detail)
                        .font(.callout)
                        .foregroundStyle(GatewayStyle.mutedText)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Spacer(minLength: 12)

                StatusBadge(
                    title: badgeTitle,
                    systemImage: badgeIcon,
                    tone: badgeTone
                )
            }

            if settings.isPaired {
                Divider()

                HStack(alignment: .top, spacing: 10) {
                    Image(systemName: receiverStatus.systemImage)
                        .font(.caption.weight(.bold))
                        .foregroundStyle(receiverStatus.tone.foreground)
                        .frame(width: 18)

                    VStack(alignment: .leading, spacing: 2) {
                        Text(receiverStatus.title)
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(GatewayStyle.text)

                        Text(receiverStatus.detail)
                            .font(.caption)
                            .foregroundStyle(GatewayStyle.mutedText)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    Spacer(minLength: 0)
                }

                Button(action: onCheck) {
                    Label("Check Receiver", systemImage: "network")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .disabled(receiverStatus.isChecking)
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

    private var agentName: String {
        settings.pairedAgentName?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
            ? settings.pairedAgentName!
            : "Local Agent"
    }

    private var detail: String {
        if settings.isPaired {
            return settings.serverURLText.isEmpty ? "Connected" : settings.serverURLText
        }
        return "Scan a HealthLink pairing QR to connect this iPhone."
    }

    private var badgeTitle: String {
        settings.isPaired ? "Paired" : "Setup"
    }

    private var badgeIcon: String {
        settings.isPaired ? "link" : "link.badge.plus"
    }

    private var badgeTone: StatusTone {
        settings.isPaired ? .success : .neutral
    }
}

struct PairingPanel: View {
    @ObservedObject var settings: GatewaySettings
    @Binding var isShowingScanner: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionTitle("Pairing")

            VStack(alignment: .leading, spacing: 12) {
                Button {
                    isShowingScanner = true
                } label: {
                    Label(settings.isPaired ? "Scan New QR Code" : "Scan QR Code", systemImage: "qrcode.viewfinder")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(GatewayStyle.primary)
                .disabled(settings.isPairing)

                TextField("healthlink://pair?server=...&code=...", text: $settings.pairingURLText)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.URL)
                    .textFieldStyle(.roundedBorder)

                Button {
                    Task { await settings.preparePairingFromText() }
                } label: {
                    if settings.isPairing {
                        Label("Checking Pairing", systemImage: "arrow.triangle.2.circlepath")
                    } else {
                        Label("Use Pairing Link", systemImage: "link")
                    }
                }
                .disabled(settings.isPairing || settings.pairingURLText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

                if settings.isPaired {
                    LabeledContent("Device", value: settings.pairedDeviceID.map(shortDeviceID) ?? "-")
                        .font(.footnote)
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

struct AdvancedConnectionPanel: View {
    @ObservedObject var settings: GatewaySettings
    @Binding var isExpanded: Bool

    var body: some View {
        DisclosureGroup(isExpanded: $isExpanded) {
            VStack(alignment: .leading, spacing: 12) {
                TextField("Server URL", text: $settings.serverURLText)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.URL)
                    .textFieldStyle(.roundedBorder)

                SecureField("API token", text: $settings.apiTokenText)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .textFieldStyle(.roundedBorder)

                if settings.isPaired {
                    Divider()

                    LabeledContent("Agent", value: settings.pairedAgentName ?? "Local Agent")
                    LabeledContent("Device", value: settings.pairedDeviceID ?? "-")
                    LabeledContent("Scopes", value: settings.acceptedScopes.joined(separator: ", "))
                }

                Button {
                    settings.save()
                } label: {
                    Label("Save Advanced Settings", systemImage: "checkmark.circle")
                }

                if let message = settings.lastSavedMessage {
                    Text(message)
                        .font(.footnote)
                        .foregroundStyle(GatewayStyle.mutedText)
                }
            }
            .padding(.top, 10)
        } label: {
            Label("Advanced", systemImage: "slider.horizontal.3")
                .font(.headline)
                .foregroundStyle(GatewayStyle.text)
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

                Section("Data Access") {
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
        if !settings.autoSyncEnabled {
            return "Off"
        }
        if let lastBackgroundScheduleError = settings.lastBackgroundScheduleError {
            return "Background scheduling issue: \(lastBackgroundScheduleError)"
        }
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

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionTitle("Today")

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
            SectionTitle("Today")

            VStack(alignment: .leading, spacing: 10) {
                Image(systemName: "tray")
                    .font(.title2)
                    .foregroundStyle(GatewayStyle.mutedText)

                Text("No summaries yet")
                    .font(.headline)
                    .foregroundStyle(GatewayStyle.text)

                Text("Run your first sync to send daily context to your agent.")
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

enum ReceiverCheckState {
    case idle
    case checking
    case online(ReceiverHealthStatus)
    case offline(String)

    var title: String {
        switch self {
        case .idle:
            return "Receiver not checked"
        case .checking:
            return "Checking receiver"
        case .online:
            return "Receiver online"
        case .offline:
            return "Receiver offline"
        }
    }

    var detail: String {
        switch self {
        case .idle:
            return "Check whether this iPhone can reach the Agent receiver."
        case .checking:
            return "Contacting the saved server URL."
        case .online(let status):
            return "\(status.device_count) devices, \(status.sync_count) syncs, last sync \(status.last_sync_at ?? "never")."
        case .offline(let message):
            return message
        }
    }

    var systemImage: String {
        switch self {
        case .idle:
            return "network"
        case .checking:
            return "arrow.triangle.2.circlepath"
        case .online:
            return "checkmark.circle"
        case .offline:
            return "exclamationmark.triangle"
        }
    }

    var tone: StatusTone {
        switch self {
        case .online:
            return .success
        case .offline:
            return .warning
        case .idle, .checking:
            return .neutral
        }
    }

    var isChecking: Bool {
        if case .checking = self {
            return true
        }
        return false
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
