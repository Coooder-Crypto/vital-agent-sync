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
    @Published private(set) var directTransportPublicKey: String?
    @Published private(set) var acceptedScopes: [String]
    @Published private(set) var isPairing = false
    @Published var pendingPairing: PairingPreview?
    @Published var pendingRelayOnboarding: RelayOnboardingPreview?
    @Published var pairingMessage: String?
    @Published var uploadHealthEnabled: Bool
    @Published var autoSyncEnabled: Bool
    @Published var autoSyncMinimumIntervalMinutes: Int
    @Published private(set) var lastAutoSyncAt: Date?
    @Published private(set) var lastManualSyncAt: Date?
    @Published private(set) var lastSyncAttemptAt: Date?
    @Published private(set) var lastSyncError: String?
    @Published private(set) var lastBackgroundScheduleError: String?
    @Published private(set) var syncHistory: [LastSyncDetail]
    @Published var appTheme: AppTheme
    @Published var appLanguage: AppLanguage
    @Published var lastSavedMessage: String?
    @Published private(set) var relayOnboarding: RelayOnboardingPayload?

    private let defaults: UserDefaults
    private let keychain: KeychainStoring

    private enum Keys {
        static let serverURL = "gateway.serverURL"
        static let uploadHealthEnabled = "gateway.uploadHealthEnabled"
        static let apiToken = "gateway.apiToken"
        static let pairedDeviceID = "gateway.pairedDeviceID"
        static let pairedAgentName = "gateway.pairedAgentName"
        static let directTransportPublicKey = "gateway.directTransportPublicKey"
        static let acceptedScopes = "gateway.acceptedScopes"
        static let autoSyncEnabled = "gateway.autoSyncEnabled"
        static let autoSyncMinimumIntervalMinutes = "gateway.autoSyncMinimumIntervalMinutes"
        static let lastAutoSyncAt = "gateway.lastAutoSyncAt"
        static let lastManualSyncAt = "gateway.lastManualSyncAt"
        static let lastSyncAttemptAt = "gateway.lastSyncAttemptAt"
        static let lastSyncError = "gateway.lastSyncError"
        static let lastBackgroundScheduleError = "gateway.lastBackgroundScheduleError"
        static let syncHistory = "gateway.syncHistory"
        static let appTheme = "gateway.appTheme"
        static let appLanguage = "gateway.appLanguage"
        static let relayOnboarding = "gateway.relayOnboarding"
        static let relayUploadAuthSecret = "gateway.relayUploadAuthSecret"
        static let relayAccessToken = "gateway.relayAccessToken"
        static let relayAPIToken = "gateway.relayAPIToken"
        static let relayEnvelopeSequence = "gateway.relayEnvelopeSequence"
    }

    private static let maxSyncHistoryCount = 20

    static let defaultAcceptedScopes = [
        "health.daily_summary.write"
    ]

    init(defaults: UserDefaults = .standard, keychain: KeychainStoring = KeychainStore.shared) {
        self.defaults = defaults
        self.keychain = keychain
        self.serverURLText = defaults.string(forKey: Keys.serverURL) ?? ""
        self.apiTokenText = (try? keychain.get(account: Keys.apiToken)) ?? ""
        self.pairedDeviceID = defaults.string(forKey: Keys.pairedDeviceID)
        self.pairedAgentName = defaults.string(forKey: Keys.pairedAgentName)
        self.directTransportPublicKey = defaults.string(forKey: Keys.directTransportPublicKey)
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
        self.syncHistory = Self.loadSyncHistory(from: defaults)
        self.appTheme = AppTheme(rawValue: defaults.string(forKey: Keys.appTheme) ?? "") ?? .system
        self.appLanguage = AppLanguage(rawValue: defaults.string(forKey: Keys.appLanguage) ?? "") ?? .system
        self.relayOnboarding = Self.loadRelayOnboarding(from: defaults, keychain: keychain)
    }

    var serverURL: URL? {
        let trimmed = serverURLText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            return nil
        }
        return URL(string: trimmed)
    }

    var isPaired: Bool {
        if relayOnboarding != nil {
            return true
        }
        return pairedDeviceID != nil &&
            directTransportPublicKey != nil &&
            !apiTokenText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var usesRelayTransport: Bool {
        relayOnboarding != nil
    }

    var latestSyncDetail: LastSyncDetail? {
        syncHistory.first
    }

    var latestSuccessfulSyncDetail: LastSyncDetail? {
        syncHistory.first { $0.succeeded }
    }

    var relayUploadAuthSecret: String? {
        try? keychain.get(account: Keys.relayUploadAuthSecret)
    }

    func nextRelayEnvelopeSequence(now: Date = Date()) -> Int {
        let wallClockSequence = max(1, Int(now.timeIntervalSince1970 * 1_000))
        let previous = (defaults.object(forKey: Keys.relayEnvelopeSequence) as? NSNumber)?.intValue ?? 0
        let incremented = previous == Int.max ? Int.max : previous + 1
        let next = max(wallClockSequence, incremented)
        defaults.set(next, forKey: Keys.relayEnvelopeSequence)
        return next
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
            if let relayPayload = try? RelayOnboardingPayload(rawValue: rawValue) {
                pendingRelayOnboarding = RelayOnboardingPreview(payload: relayPayload)
                pairingMessage = nil
                return
            }
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
                deviceName: "Vital Agent iOS",
                acceptedScopes: preview.status.requested_scopes
            )

            savePairing(
                serverURL: preview.link.serverURL,
                agentName: preview.status.agent_name,
                deviceID: response.device_id,
                deviceToken: response.device_token,
                directTransportPublicKey: preview.link.directTransportPublicKey,
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

    func cancelPendingRelayOnboarding() {
        pendingRelayOnboarding = nil
    }

    func confirmRelayOnboarding(_ preview: RelayOnboardingPreview) -> Bool {
        isPairing = true
        pairingMessage = nil
        defer { isPairing = false }

        do {
            try saveRelayOnboarding(preview.payload)
            pairingURLText = ""
            pendingRelayOnboarding = nil
            pairingMessage = "Relay connected"
            return true
        } catch {
            pairingMessage = error.localizedDescription
            return false
        }
    }

    func disconnect(revokeRemote: Bool = true) async {
        isPairing = true
        pairingMessage = nil
        defer { isPairing = false }

        let deviceID = pairedDeviceID
        let serverURL = self.serverURL
        let token = apiTokenText.trimmingCharacters(in: .whitespacesAndNewlines)
        let directTransportPublicKey = self.directTransportPublicKey

        var revokeError: Error?
        if revokeRemote,
           let deviceID,
           let serverURL,
           let directTransportPublicKey,
           !token.isEmpty {
            do {
                let client = GatewayAPIClient(
                    serverURL: serverURL,
                    apiToken: token,
                    directTransportPublicKey: directTransportPublicKey
                )
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

    func recordSyncDetail(_ detail: LastSyncDetail) {
        var nextHistory = syncHistory
        nextHistory.insert(detail, at: 0)
        if nextHistory.count > Self.maxSyncHistoryCount {
            nextHistory = Array(nextHistory.prefix(Self.maxSyncHistoryCount))
        }
        syncHistory = nextHistory
        saveSyncHistory()
    }

    func clearSyncHistory() {
        syncHistory = []
        defaults.removeObject(forKey: Keys.syncHistory)
    }

    private func savePairing(
        serverURL: URL,
        agentName: String,
        deviceID: String,
        deviceToken: String,
        directTransportPublicKey: String,
        acceptedScopes: [String]
    ) {
        clearRelayOnboarding()
        serverURLText = serverURL.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        apiTokenText = deviceToken
        pairedDeviceID = deviceID
        pairedAgentName = agentName
        self.directTransportPublicKey = directTransportPublicKey
        self.acceptedScopes = acceptedScopes

        defaults.set(serverURLText, forKey: Keys.serverURL)
        defaults.set(deviceID, forKey: Keys.pairedDeviceID)
        defaults.set(agentName, forKey: Keys.pairedAgentName)
        defaults.set(directTransportPublicKey, forKey: Keys.directTransportPublicKey)
        defaults.set(acceptedScopes, forKey: Keys.acceptedScopes)

        do {
            try keychain.set(deviceToken, for: Keys.apiToken)
            resetSyncTracking()
            lastSavedMessage = "Paired"
        } catch {
            pairingMessage = error.localizedDescription
        }
    }

    private var clampedAutoSyncMinimumIntervalMinutes: Int {
        max(5, min(autoSyncMinimumIntervalMinutes, 240))
    }

    private func saveSyncHistory() {
        guard let data = try? JSONEncoder().encode(syncHistory) else {
            return
        }
        defaults.set(data, forKey: Keys.syncHistory)
    }

    private func saveRelayOnboarding(_ payload: RelayOnboardingPayload) throws {
        var sanitized = payload
        sanitized = RelayOnboardingPayload(
            protocolVersion: payload.protocolVersion,
            mode: payload.mode,
            relay_url: payload.relay_url,
            user_id: payload.user_id,
            source_device_id: payload.source_device_id,
            agent_name: payload.agent_name,
            encryption_public_key: payload.encryption_public_key,
            encryption_public_key_x25519: payload.encryption_public_key_x25519,
            signing_public_key: payload.signing_public_key,
            upload_auth_secret: "",
            relay_access_token: "",
            relay_api_token: nil,
            fingerprint: payload.fingerprint,
            requested_scopes: payload.requested_scopes,
            created_at: payload.created_at
        )
        let data = try JSONEncoder().encode(sanitized)
        defaults.set(data, forKey: Keys.relayOnboarding)
        try keychain.set(payload.upload_auth_secret, for: Keys.relayUploadAuthSecret)
        try keychain.set(payload.relay_access_token, for: Keys.relayAccessToken)
        if let relayAPIToken = payload.relay_api_token?.trimmingCharacters(in: .whitespacesAndNewlines),
           !relayAPIToken.isEmpty {
            try keychain.set(relayAPIToken, for: Keys.relayAPIToken)
        } else {
            try? keychain.delete(account: Keys.relayAPIToken)
        }
        resetSyncTracking()
        relayOnboarding = payload
        serverURLText = payload.relay_url.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        apiTokenText = ""
        pairedDeviceID = payload.source_device_id
        pairedAgentName = payload.agent_name
        directTransportPublicKey = nil
        acceptedScopes = payload.requested_scopes
        defaults.set(serverURLText, forKey: Keys.serverURL)
        defaults.set(payload.source_device_id, forKey: Keys.pairedDeviceID)
        defaults.set(payload.agent_name, forKey: Keys.pairedAgentName)
        defaults.set(payload.requested_scopes, forKey: Keys.acceptedScopes)
        defaults.removeObject(forKey: Keys.directTransportPublicKey)
        try keychain.delete(account: Keys.apiToken)
    }

    private func clearRelayOnboarding() {
        relayOnboarding = nil
        defaults.removeObject(forKey: Keys.relayOnboarding)
        try? keychain.delete(account: Keys.relayUploadAuthSecret)
        try? keychain.delete(account: Keys.relayAccessToken)
        try? keychain.delete(account: Keys.relayAPIToken)
    }

    private static func loadSyncHistory(from defaults: UserDefaults) -> [LastSyncDetail] {
        guard let data = defaults.data(forKey: Keys.syncHistory),
              let history = try? JSONDecoder().decode([LastSyncDetail].self, from: data) else {
            return []
        }
        return Array(history.prefix(maxSyncHistoryCount))
    }

    private static func loadRelayOnboarding(from defaults: UserDefaults, keychain: KeychainStoring) -> RelayOnboardingPayload? {
        guard let data = defaults.data(forKey: Keys.relayOnboarding),
              var payload = try? JSONDecoder().decode(RelayOnboardingPayload.self, from: data),
              let secret = try? keychain.get(account: Keys.relayUploadAuthSecret),
              !secret.isEmpty,
              let relayAccessToken = try? keychain.get(account: Keys.relayAccessToken),
              !relayAccessToken.isEmpty else {
            return nil
        }
        let relayAPIToken = try? keychain.get(account: Keys.relayAPIToken)
        payload = RelayOnboardingPayload(
            protocolVersion: payload.protocolVersion,
            mode: payload.mode,
            relay_url: payload.relay_url,
            user_id: payload.user_id,
            source_device_id: payload.source_device_id,
            agent_name: payload.agent_name,
            encryption_public_key: payload.encryption_public_key,
            encryption_public_key_x25519: payload.encryption_public_key_x25519,
            signing_public_key: payload.signing_public_key,
            upload_auth_secret: secret,
            relay_access_token: relayAccessToken,
            relay_api_token: relayAPIToken,
            fingerprint: payload.fingerprint,
            requested_scopes: payload.requested_scopes,
            created_at: payload.created_at
        )
        return payload
    }

    private func clearPairing() throws {
        apiTokenText = ""
        pairedDeviceID = nil
        pairedAgentName = nil
        directTransportPublicKey = nil
        acceptedScopes = Self.defaultAcceptedScopes
        clearRelayOnboarding()
        resetSyncTracking()
        defaults.removeObject(forKey: Keys.pairedDeviceID)
        defaults.removeObject(forKey: Keys.pairedAgentName)
        defaults.removeObject(forKey: Keys.directTransportPublicKey)
        defaults.removeObject(forKey: Keys.acceptedScopes)
        try keychain.delete(account: Keys.apiToken)
    }

    private func resetSyncTracking() {
        lastAutoSyncAt = nil
        lastManualSyncAt = nil
        lastSyncAttemptAt = nil
        lastSyncError = nil
        lastBackgroundScheduleError = nil
        clearSyncHistory()
        defaults.removeObject(forKey: Keys.lastAutoSyncAt)
        defaults.removeObject(forKey: Keys.lastManualSyncAt)
        defaults.removeObject(forKey: Keys.lastSyncAttemptAt)
        defaults.removeObject(forKey: Keys.lastSyncError)
        defaults.removeObject(forKey: Keys.lastBackgroundScheduleError)
    }
}
