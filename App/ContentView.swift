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

            SettingsView()
                .tabItem {
                    Label("Settings", systemImage: "gearshape")
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
                    LazyVStack(alignment: .leading, spacing: 16) {
                        HomeHeroPanel(
                            isPaired: settings.isPaired,
                            agentName: agentName,
                            isSyncing: sync.isSyncing,
                            isPairing: settings.isPairing,
                            latestSyncDate: latestSyncDate,
                            lastError: sync.status.lastError ?? settings.lastSyncError,
                            onScan: { isShowingScanner = true },
                            onSync: {
                                Task { await sync.sync(settings: settings, trigger: .manual) }
                            }
                        )

                        if settings.isPaired {
                            if sync.latestHealthSummary != nil {
                                TodaySnapshotPanel(
                                    health: sync.latestHealthSummary
                                )
                            } else {
                                EmptySnapshotPanel()
                            }

                            AgentPromptPanel(agentName: agentName)
                            HomeSyncDetails(
                                lastHealthSyncAt: sync.status.lastHealthSyncAt,
                                autoSyncDetail: autoSyncDetail,
                                lastSuccessMessage: sync.status.lastSuccessMessage
                            )
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

    private var latestSyncDate: Date? {
        [sync.status.lastHealthSyncAt, settings.lastManualSyncAt, settings.lastAutoSyncAt]
            .compactMap { $0 }
            .max()
    }

    private var autoSyncDetail: LocalizedStringKey {
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
                        settings.saveUploadSettings()
                    }
                }

                Section("Today Details") {
                    if let health = sync.latestHealthSummary {
                        HealthDetailRows(health: health)
                    } else {
                        ContentUnavailableView(
                            "No Health Summary",
                            systemImage: "tray",
                            description: Text("Run a sync to load the latest source details.")
                        )
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

struct SettingsView: View {
    @EnvironmentObject private var settings: GatewaySettings

    var body: some View {
        NavigationStack {
            Form {
                Section("Appearance") {
                    Picker("Theme", selection: $settings.appTheme) {
                        ForEach(AppTheme.allCases) { theme in
                            Text(LocalizedStringKey(theme.title)).tag(theme)
                        }
                    }
                    .onChange(of: settings.appTheme) { _, _ in
                        settings.saveAppearanceSettings()
                    }

                    Picker("Language", selection: $settings.appLanguage) {
                        ForEach(AppLanguage.allCases) { language in
                            Text(LocalizedStringKey(language.title)).tag(language)
                        }
                    }
                    .onChange(of: settings.appLanguage) { _, _ in
                        settings.saveAppearanceSettings()
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

                Section("About") {
                    LabeledContent("App", value: "HealthLink")
                    LabeledContent("Version", value: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "-")
                }
            }
            .navigationTitle("Settings")
        }
    }
}

struct ConnectionView: View {
    @EnvironmentObject private var settings: GatewaySettings
    @EnvironmentObject private var sync: SyncCoordinator
    @Binding var isShowingScanner: Bool

    @State private var receiverStatus: ReceiverCheckState = .idle
    @State private var isAdvancedExpanded = false
    @State private var isConfirmingAgentRemoval = false
    @State private var receiverCheckTask: Task<Void, Never>?

    var body: some View {
        NavigationStack {
            ZStack {
                GatewayStyle.background.ignoresSafeArea()

                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 16) {
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
                                isConfirmingAgentRemoval = true
                            } label: {
                                Label("Remove Paired Agent", systemImage: "trash")
                                    .frame(maxWidth: .infinity)
                            }
                            .buttonStyle(.bordered)
                            .disabled(settings.isPairing)
                        }

                        if let message = settings.pairingMessage {
                            StatusMessage(
                                message: message,
                                systemImage: messageIcon(message),
                                color: messageColor(message)
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
            .confirmationDialog(
                "Remove paired agent?",
                isPresented: $isConfirmingAgentRemoval,
                titleVisibility: .visible
            ) {
                Button("Remove Agent", role: .destructive) {
                    Task {
                        await settings.disconnect()
                        BackgroundSyncManager.scheduleAppRefresh(settings: settings)
                    }
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("HealthLink will remove this pairing from the iPhone. If the receiver is reachable, it will also revoke the device token on the agent side.")
            }
            .onAppear {
                scheduleDeferredReceiverCheck()
            }
            .onDisappear {
                receiverCheckTask?.cancel()
                receiverCheckTask = nil
            }
        }
    }

    private func scheduleDeferredReceiverCheck() {
        guard settings.isPaired else {
            return
        }
        if receiverStatus.hasResult {
            return
        }

        receiverCheckTask?.cancel()
        receiverCheckTask = Task {
            try? await Task.sleep(nanoseconds: 450_000_000)
            guard !Task.isCancelled else {
                return
            }
            await checkReceiver()
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

    private func messageIcon(_ message: String) -> String {
        isWarningMessage(message) ? "exclamationmark.triangle" : "checkmark.circle"
    }

    private func messageColor(_ message: String) -> Color {
        isWarningMessage(message) ? GatewayStyle.warning : GatewayStyle.success
    }

    private func isWarningMessage(_ message: String) -> Bool {
        let lowercased = message.lowercased()
        return lowercased.contains("failed")
            || lowercased.contains("invalid")
            || lowercased.contains("rejected")
            || lowercased.contains("not reachable")
            || lowercased.contains("error")
    }
}

struct HomeHeroPanel: View {
    let isPaired: Bool
    let agentName: String
    let isSyncing: Bool
    let isPairing: Bool
    let latestSyncDate: Date?
    let lastError: String?
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

            if let lastError {
                ErrorBanner(message: lastError)
            }

            Button(action: primaryAction) {
                HStack {
                    Image(systemName: primaryIcon)
                        .font(.headline.weight(.semibold))

                    Text(primaryTitle)
                        .font(.headline.weight(.semibold))

                    Spacer()

                    if isSyncing || isPairing {
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
            .disabled(isSyncing || isPairing)
        }
        .padding(18)
        .background(GatewayStyle.surface)
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .stroke(GatewayStyle.border, lineWidth: 1)
        )
    }

    private var title: LocalizedStringKey {
        if !isPaired {
            return "Connect your agent"
        }
        if lastError != nil {
            return "Sync needs attention"
        }
        return "Ready for \(agentName)"
    }

    private var subtitle: LocalizedStringKey {
        if !isPaired {
            return "Pair HealthLink with your local Agent receiver."
        }
        if isSyncing {
            return "Uploading your latest daily summaries."
        }
        if let latestSyncDate {
            return "Last sync \(latestSyncDate.formatted(date: .omitted, time: .shortened))."
        }
        return "Connected. Run the first sync when you are ready."
    }

    private var primaryTitle: LocalizedStringKey {
        if !isPaired {
            return "Scan QR Code"
        }
        if isSyncing {
            return "Syncing"
        }
        if lastError != nil {
            return "Retry Sync"
        }
        return "Sync Now"
    }

    private var primaryIcon: String {
        isPaired ? "icloud.and.arrow.up" : "qrcode.viewfinder"
    }

    private var badgeTitle: LocalizedStringKey {
        if isSyncing { return "Syncing" }
        if !isPaired { return "Setup" }
        if lastError != nil { return "Check" }
        return "Connected"
    }

    private var badgeIcon: String {
        if isSyncing { return "arrow.triangle.2.circlepath" }
        if !isPaired { return "link.badge.plus" }
        if lastError != nil { return "exclamationmark.triangle" }
        return "checkmark.seal"
    }

    private var badgeTone: StatusTone {
        if isSyncing { return .neutral }
        if !isPaired { return .neutral }
        if lastError != nil { return .warning }
        return .success
    }

    private func primaryAction() {
        if isPaired {
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
    let text: LocalizedStringKey

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
    let lastHealthSyncAt: Date?
    let autoSyncDetail: LocalizedStringKey
    let lastSuccessMessage: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionTitle("Sync Status")

            VStack(spacing: 12) {
                HStack(spacing: 12) {
                    LastSyncTile(
                        title: "Health",
                        systemImage: "heart",
                        date: lastHealthSyncAt
                    )

                }

                AutoSyncStatusRow(detail: autoSyncDetail)

                if let message = lastSuccessMessage {
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
                    if settings.isPaired {
                        Text(agentName)
                            .font(.title2.weight(.bold))
                            .foregroundStyle(GatewayStyle.text)
                    } else {
                        Text("No agent connected")
                            .font(.title2.weight(.bold))
                            .foregroundStyle(GatewayStyle.text)
                    }

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

    private var badgeTitle: LocalizedStringKey {
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
                    if settings.isPaired {
                        Label("Scan New QR Code", systemImage: "qrcode.viewfinder")
                            .frame(maxWidth: .infinity)
                    } else {
                        Label("Scan QR Code", systemImage: "qrcode.viewfinder")
                            .frame(maxWidth: .infinity)
                    }
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
    let detail: LocalizedStringKey

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
}

struct TodaySnapshotPanel: View {
    let health: DailyHealthSummary?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionTitle("Today Snapshot")

            HStack(spacing: 10) {
                SnapshotMetric(
                    title: "Steps",
                    value: health?.steps.map(String.init) ?? "-",
                    systemImage: "figure.walk"
                )

                SnapshotMetric(
                    title: "Sleep",
                    value: HealthMetricFormat.minutes(health?.sleep_minutes),
                    systemImage: "bed.double"
                )

                SnapshotMetric(
                    title: "Resting HR",
                    value: HealthMetricFormat.bpm(health?.resting_heart_rate_bpm),
                    systemImage: "heart"
                )
            }
        }
    }
}

struct EmptySnapshotPanel: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionTitle("Today Snapshot")

            HStack(alignment: .top, spacing: 10) {
                Image(systemName: "tray")
                    .font(.headline)
                    .foregroundStyle(GatewayStyle.mutedText)
                    .frame(width: 22)

                VStack(alignment: .leading, spacing: 3) {
                    Text("No summary yet")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(GatewayStyle.text)

                    Text("Run a sync to refresh your latest source data.")
                        .font(.caption)
                        .foregroundStyle(GatewayStyle.mutedText)
                }

                Spacer(minLength: 0)
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

struct SnapshotMetric: View {
    let title: LocalizedStringKey
    let value: String
    let systemImage: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Image(systemName: systemImage)
                .font(.caption.weight(.bold))
                .foregroundStyle(GatewayStyle.primary)

            Text(value)
                .font(.system(size: 18, weight: .bold, design: .rounded))
                .foregroundStyle(GatewayStyle.text)
                .lineLimit(1)
                .minimumScaleFactor(0.75)

            Text(title)
                .font(.caption2)
                .foregroundStyle(GatewayStyle.mutedText)
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity, minHeight: 86, alignment: .leading)
        .padding(12)
        .background(GatewayStyle.surface)
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .stroke(GatewayStyle.border, lineWidth: 1)
        )
    }
}

struct HealthDetailRows: View {
    let health: DailyHealthSummary

    var body: some View {
        LabeledContent("Date", value: health.date)
        LabeledContent("Provider", value: health.provider)
        LabeledContent("Steps", value: health.steps.map(String.init) ?? "-")
        LabeledContent("Sleep", value: HealthMetricFormat.minutes(health.sleep_minutes))
        LabeledContent("Resting HR", value: HealthMetricFormat.bpm(health.resting_heart_rate_bpm))
        LabeledContent("Average HR", value: HealthMetricFormat.bpm(health.avg_heart_rate_bpm))
        LabeledContent("Max HR", value: HealthMetricFormat.bpm(health.max_heart_rate_bpm))
        LabeledContent("HRV", value: HealthMetricFormat.milliseconds(health.heart_rate_variability_ms))
        LabeledContent("VO2 Max", value: HealthMetricFormat.decimal(health.vo2_max_ml_kg_min))
        LabeledContent("Active Energy", value: HealthMetricFormat.kilocalories(health.active_energy_kcal))
        LabeledContent("Basal Energy", value: HealthMetricFormat.kilocalories(health.basal_energy_kcal))
        LabeledContent("Exercise", value: HealthMetricFormat.minutes(health.exercise_minutes))
        LabeledContent("Stand", value: HealthMetricFormat.minutes(health.stand_minutes))
        LabeledContent("Workout", value: HealthMetricFormat.minutes(health.workout_minutes))
        LabeledContent("Walk/Run Distance", value: HealthMetricFormat.meters(health.distance_walking_running_m))
        LabeledContent("Cycling Distance", value: HealthMetricFormat.meters(health.distance_cycling_m))
        LabeledContent("Flights Climbed", value: health.flights_climbed.map(String.init) ?? "-")
        LabeledContent("Walking HR", value: HealthMetricFormat.bpm(health.walking_heart_rate_average_bpm))
        LabeledContent("Oxygen Saturation", value: HealthMetricFormat.percent(health.oxygen_saturation_percent))
        LabeledContent("Respiratory Rate", value: HealthMetricFormat.breathsPerMinute(health.respiratory_rate_bpm))
        LabeledContent("Body Temperature", value: HealthMetricFormat.celsius(health.body_temperature_c))
        LabeledContent("Body Mass", value: HealthMetricFormat.kilograms(health.body_mass_kg))
        LabeledContent("Body Fat", value: HealthMetricFormat.percent(health.body_fat_percentage))
        LabeledContent("Lean Body Mass", value: HealthMetricFormat.kilograms(health.lean_body_mass_kg))
        LabeledContent("BMI", value: HealthMetricFormat.decimal(health.body_mass_index))

        if health.workouts.isEmpty {
            LabeledContent("Workouts", value: "None")
        } else {
            ForEach(health.workouts) { workout in
                VStack(alignment: .leading, spacing: 4) {
                    Text(workout.type)
                        .font(.subheadline.weight(.semibold))

                    Text("\(HealthMetricFormat.minutes(workout.duration_minutes)) · \(workout.started_at)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }
}

enum HealthMetricFormat {
    static func minutes(_ value: Int?) -> String {
        guard let value else { return "-" }
        return minutes(value)
    }

    static func minutes(_ value: Int) -> String {
        if value >= 60 {
            let hours = value / 60
            let minutes = value % 60
            return minutes == 0 ? "\(hours)h" : "\(hours)h \(minutes)m"
        }
        return "\(value)m"
    }

    static func bpm(_ value: Double?) -> String {
        guard let value else { return "-" }
        return "\(Int(value.rounded())) bpm"
    }

    static func meters(_ value: Double?) -> String {
        guard let value else { return "-" }
        if value >= 1000 {
            return "\(String(format: "%.1f", value / 1000)) km"
        }
        return "\(Int(value.rounded())) m"
    }

    static func milliseconds(_ value: Double?) -> String {
        guard let value else { return "-" }
        return "\(Int(value.rounded())) ms"
    }

    static func decimal(_ value: Double?) -> String {
        guard let value else { return "-" }
        return String(format: "%.1f", value)
    }

    static func kilocalories(_ value: Double?) -> String {
        guard let value else { return "-" }
        return "\(Int(value.rounded())) kcal"
    }

    static func percent(_ value: Double?) -> String {
        guard let value else { return "-" }
        return "\(String(format: "%.1f", value))%"
    }

    static func breathsPerMinute(_ value: Double?) -> String {
        guard let value else { return "-" }
        return "\(String(format: "%.1f", value)) br/min"
    }

    static func celsius(_ value: Double?) -> String {
        guard let value else { return "-" }
        return "\(String(format: "%.1f", value)) C"
    }

    static func kilograms(_ value: Double?) -> String {
        guard let value else { return "-" }
        return "\(String(format: "%.1f", value)) kg"
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

                MetricTile(
                    title: "Exercise",
                    value: minutes(health?.exercise_minutes),
                    systemImage: "figure.run"
                )

                MetricTile(
                    title: "Distance",
                    value: meters(health?.distance_walking_running_m),
                    systemImage: "map"
                )

                MetricTile(
                    title: "HRV",
                    value: milliseconds(health?.heart_rate_variability_ms),
                    systemImage: "waveform.path.ecg"
                )

                MetricTile(
                    title: "VO2 Max",
                    value: decimal(health?.vo2_max_ml_kg_min),
                    systemImage: "lungs"
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

    private func meters(_ value: Double?) -> String {
        guard let value else { return "-" }
        if value >= 1000 {
            return "\(String(format: "%.1f", value / 1000))km"
        }
        return "\(Int(value.rounded()))m"
    }

    private func milliseconds(_ value: Double?) -> String {
        guard let value else { return "-" }
        return "\(Int(value.rounded()))ms"
    }

    private func decimal(_ value: Double?) -> String {
        guard let value else { return "-" }
        return String(format: "%.1f", value)
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
    let title: LocalizedStringKey
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
    let title: LocalizedStringKey
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
    let title: LocalizedStringKey

    init(_ title: LocalizedStringKey) {
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

    var title: LocalizedStringKey {
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

    var hasResult: Bool {
        switch self {
        case .online, .offline:
            return true
        case .idle, .checking:
            return false
        }
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
