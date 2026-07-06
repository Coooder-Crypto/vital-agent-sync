import Foundation

enum AppTheme: String, CaseIterable, Identifiable {
    case system
    case light
    case dark

    var id: String { rawValue }

    var title: String {
        switch self {
        case .system:
            return "System"
        case .light:
            return "Light"
        case .dark:
            return "Dark"
        }
    }
}

enum AppLanguage: String, CaseIterable, Identifiable {
    case system
    case english
    case simplifiedChinese

    var id: String { rawValue }

    var title: String {
        switch self {
        case .system:
            return "System"
        case .english:
            return "English"
        case .simplifiedChinese:
            return "简体中文"
        }
    }
}

@MainActor
final class GatewaySettings: ObservableObject {
    @Published var serverURLText: String
    @Published var apiTokenText: String
    @Published var pairingURLText: String = ""
    @Published private(set) var pairedDeviceID: String?
    @Published private(set) var pairedAgentName: String?
    @Published private(set) var acceptedScopes: [String]
    @Published private(set) var isPairing = false
    @Published var pendingPairing: PairingPreview?
    @Published var pairingMessage: String?
    @Published var uploadHealthEnabled: Bool
    @Published var autoSyncEnabled: Bool
    @Published var autoSyncMinimumIntervalMinutes: Int
    @Published private(set) var lastAutoSyncAt: Date?
    @Published private(set) var lastManualSyncAt: Date?
    @Published private(set) var lastSyncAttemptAt: Date?
    @Published private(set) var lastSyncError: String?
    @Published private(set) var lastBackgroundScheduleError: String?
    @Published var appTheme: AppTheme
    @Published var appLanguage: AppLanguage
    @Published var lastSavedMessage: String?

    private let defaults = UserDefaults.standard
    private let keychain = KeychainStore.shared

    private enum Keys {
        static let serverURL = "gateway.serverURL"
        static let uploadHealthEnabled = "gateway.uploadHealthEnabled"
        static let apiToken = "gateway.apiToken"
        static let pairedDeviceID = "gateway.pairedDeviceID"
        static let pairedAgentName = "gateway.pairedAgentName"
        static let acceptedScopes = "gateway.acceptedScopes"
        static let autoSyncEnabled = "gateway.autoSyncEnabled"
        static let autoSyncMinimumIntervalMinutes = "gateway.autoSyncMinimumIntervalMinutes"
        static let lastAutoSyncAt = "gateway.lastAutoSyncAt"
        static let lastManualSyncAt = "gateway.lastManualSyncAt"
        static let lastSyncAttemptAt = "gateway.lastSyncAttemptAt"
        static let lastSyncError = "gateway.lastSyncError"
        static let lastBackgroundScheduleError = "gateway.lastBackgroundScheduleError"
        static let appTheme = "gateway.appTheme"
        static let appLanguage = "gateway.appLanguage"
    }

    static let defaultAcceptedScopes = [
        "health.daily_summary.write"
    ]

    init() {
        self.serverURLText = defaults.string(forKey: Keys.serverURL) ?? ""
        self.apiTokenText = (try? keychain.get(account: Keys.apiToken)) ?? ""
        self.pairedDeviceID = defaults.string(forKey: Keys.pairedDeviceID)
        self.pairedAgentName = defaults.string(forKey: Keys.pairedAgentName)
        self.acceptedScopes = defaults.stringArray(forKey: Keys.acceptedScopes) ?? Self.defaultAcceptedScopes
        self.uploadHealthEnabled = defaults.object(forKey: Keys.uploadHealthEnabled) as? Bool ?? true
        self.autoSyncEnabled = defaults.object(forKey: Keys.autoSyncEnabled) as? Bool ?? true
        let savedInterval = defaults.integer(forKey: Keys.autoSyncMinimumIntervalMinutes)
        self.autoSyncMinimumIntervalMinutes = savedInterval > 0 ? savedInterval : 30
        self.lastAutoSyncAt = defaults.object(forKey: Keys.lastAutoSyncAt) as? Date
        self.lastManualSyncAt = defaults.object(forKey: Keys.lastManualSyncAt) as? Date
        self.lastSyncAttemptAt = defaults.object(forKey: Keys.lastSyncAttemptAt) as? Date
        self.lastSyncError = defaults.string(forKey: Keys.lastSyncError)
        self.lastBackgroundScheduleError = defaults.string(forKey: Keys.lastBackgroundScheduleError)
        self.appTheme = AppTheme(rawValue: defaults.string(forKey: Keys.appTheme) ?? "") ?? .system
        self.appLanguage = AppLanguage(rawValue: defaults.string(forKey: Keys.appLanguage) ?? "") ?? .system
    }

    var serverURL: URL? {
        let trimmed = serverURLText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            return nil
        }
        return URL(string: trimmed)
    }

    var isPaired: Bool {
        pairedDeviceID != nil && !apiTokenText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var autoSyncMinimumInterval: TimeInterval {
        TimeInterval(clampedAutoSyncMinimumIntervalMinutes * 60)
    }

    var nextEligibleAutoSyncAt: Date? {
        guard let lastSyncAttemptAt else {
            return nil
        }
        return lastSyncAttemptAt.addingTimeInterval(autoSyncMinimumInterval)
    }

    func preparePairingFromText() async {
        await preparePairing(rawValue: pairingURLText)
    }

    func preparePairing(rawValue: String) async {
        isPairing = true
        pairingMessage = nil
        defer { isPairing = false }

        do {
            let link = try PairingLink(rawValue: rawValue)
            let status = try await GatewayAPIClient.getPairingStatus(link: link)
            guard status.status == "pending" else {
                throw GatewayError.invalidPairingURL
            }
            pendingPairing = PairingPreview(link: link, status: status)
        } catch {
            pairingMessage = error.localizedDescription
        }
    }

    func confirmPairing(_ preview: PairingPreview) async -> Bool {
        isPairing = true
        pairingMessage = nil
        defer { isPairing = false }

        do {
            let response = try await GatewayAPIClient.confirmPairing(
                link: preview.link,
                deviceName: "HealthLink iOS",
                acceptedScopes: preview.status.requested_scopes
            )

            savePairing(
                serverURL: preview.link.serverURL,
                agentName: preview.status.agent_name,
                deviceID: response.device_id,
                deviceToken: response.device_token,
                acceptedScopes: preview.status.requested_scopes
            )
            pairingURLText = ""
            pendingPairing = nil
            pairingMessage = "Paired"
            return true
        } catch {
            pairingMessage = error.localizedDescription
            return false
        }
    }

    func cancelPendingPairing() {
        pendingPairing = nil
    }

    func disconnect(revokeRemote: Bool = true) async {
        isPairing = true
        pairingMessage = nil
        defer { isPairing = false }

        let deviceID = pairedDeviceID
        let serverURL = self.serverURL
        let token = apiTokenText.trimmingCharacters(in: .whitespacesAndNewlines)

        var revokeError: Error?
        if revokeRemote,
           let deviceID,
           let serverURL,
           !token.isEmpty {
            do {
                let client = GatewayAPIClient(serverURL: serverURL, apiToken: token)
                _ = try await client.revokeDevice(deviceID: deviceID)
            } catch {
                revokeError = error
            }
        }

        do {
            try clearPairing()
            if let revokeError {
                pairingMessage = "Removed locally. Receiver revoke failed: \(revokeError.localizedDescription)"
            } else {
                pairingMessage = "Agent removed"
            }
        } catch {
            pairingMessage = error.localizedDescription
        }
    }

    func save() {
        defaults.set(serverURLText.trimmingCharacters(in: .whitespacesAndNewlines), forKey: Keys.serverURL)
        defaults.set(uploadHealthEnabled, forKey: Keys.uploadHealthEnabled)
        saveAutoSyncSettings()

        do {
            try keychain.set(apiTokenText.trimmingCharacters(in: .whitespacesAndNewlines), for: Keys.apiToken)
            lastSavedMessage = "Saved"
        } catch {
            lastSavedMessage = error.localizedDescription
        }
    }

    func saveUploadSettings() {
        defaults.set(uploadHealthEnabled, forKey: Keys.uploadHealthEnabled)
    }

    func saveAutoSyncSettings() {
        let clampedInterval = clampedAutoSyncMinimumIntervalMinutes
        if autoSyncMinimumIntervalMinutes != clampedInterval {
            autoSyncMinimumIntervalMinutes = clampedInterval
        }
        defaults.set(autoSyncEnabled, forKey: Keys.autoSyncEnabled)
        defaults.set(clampedInterval, forKey: Keys.autoSyncMinimumIntervalMinutes)
    }

    func saveAppearanceSettings() {
        defaults.set(appTheme.rawValue, forKey: Keys.appTheme)
        defaults.set(appLanguage.rawValue, forKey: Keys.appLanguage)
    }

    func canAttemptAutoSync(now: Date = Date()) -> Bool {
        guard autoSyncEnabled, isPaired else {
            return false
        }
        guard let lastSyncAttemptAt else {
            return true
        }
        return now.timeIntervalSince(lastSyncAttemptAt) >= autoSyncMinimumInterval
    }

    func recordSyncAttempt() {
        let now = Date()
        lastSyncAttemptAt = now
        defaults.set(now, forKey: Keys.lastSyncAttemptAt)
    }

    func recordBackgroundScheduleError(_ error: String) {
        lastBackgroundScheduleError = error
        defaults.set(error, forKey: Keys.lastBackgroundScheduleError)
    }

    func clearBackgroundScheduleError() {
        lastBackgroundScheduleError = nil
        defaults.removeObject(forKey: Keys.lastBackgroundScheduleError)
    }

    func recordAutoSyncResult(success: Bool, error: String?) {
        if success {
            let now = Date()
            lastAutoSyncAt = now
            lastSyncError = nil
            clearBackgroundScheduleError()
            defaults.set(now, forKey: Keys.lastAutoSyncAt)
            defaults.removeObject(forKey: Keys.lastSyncError)
        } else {
            lastSyncError = error
            defaults.set(error, forKey: Keys.lastSyncError)
        }
    }

    func recordManualSyncResult(success: Bool, error: String?) {
        if success {
            let now = Date()
            lastManualSyncAt = now
            lastSyncError = nil
            clearBackgroundScheduleError()
            defaults.set(now, forKey: Keys.lastManualSyncAt)
            defaults.removeObject(forKey: Keys.lastSyncError)
        } else {
            lastSyncError = error
            defaults.set(error, forKey: Keys.lastSyncError)
        }
    }

    private func savePairing(serverURL: URL, agentName: String, deviceID: String, deviceToken: String, acceptedScopes: [String]) {
        serverURLText = serverURL.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        apiTokenText = deviceToken
        pairedDeviceID = deviceID
        pairedAgentName = agentName
        self.acceptedScopes = acceptedScopes

        defaults.set(serverURLText, forKey: Keys.serverURL)
        defaults.set(deviceID, forKey: Keys.pairedDeviceID)
        defaults.set(agentName, forKey: Keys.pairedAgentName)
        defaults.set(acceptedScopes, forKey: Keys.acceptedScopes)

        do {
            try keychain.set(deviceToken, for: Keys.apiToken)
            lastSavedMessage = "Paired"
        } catch {
            pairingMessage = error.localizedDescription
        }
    }

    private var clampedAutoSyncMinimumIntervalMinutes: Int {
        max(5, min(autoSyncMinimumIntervalMinutes, 240))
    }

    private func clearPairing() throws {
        apiTokenText = ""
        pairedDeviceID = nil
        pairedAgentName = nil
        acceptedScopes = Self.defaultAcceptedScopes
        defaults.removeObject(forKey: Keys.pairedDeviceID)
        defaults.removeObject(forKey: Keys.pairedAgentName)
        defaults.removeObject(forKey: Keys.acceptedScopes)
        try keychain.delete(account: Keys.apiToken)
    }
}
