import Foundation

@MainActor
final class GatewaySettings: ObservableObject {
    @Published var serverURLText: String
    @Published var apiTokenText: String
    @Published var pairingURLText: String = ""
    @Published private(set) var pairedDeviceID: String?
    @Published private(set) var acceptedScopes: [String]
    @Published private(set) var isPairing = false
    @Published var pairingMessage: String?
    @Published var uploadHealthEnabled: Bool
    @Published var uploadCalendarEnabled: Bool
    @Published var lastSavedMessage: String?

    private let defaults = UserDefaults.standard
    private let keychain = KeychainStore.shared

    private enum Keys {
        static let serverURL = "gateway.serverURL"
        static let uploadHealthEnabled = "gateway.uploadHealthEnabled"
        static let uploadCalendarEnabled = "gateway.uploadCalendarEnabled"
        static let apiToken = "gateway.apiToken"
        static let pairedDeviceID = "gateway.pairedDeviceID"
        static let acceptedScopes = "gateway.acceptedScopes"
    }

    static let defaultAcceptedScopes = [
        "health.daily_summary.write",
        "calendar.daily_summary.write"
    ]

    init() {
        self.serverURLText = defaults.string(forKey: Keys.serverURL) ?? ""
        self.apiTokenText = (try? keychain.get(account: Keys.apiToken)) ?? ""
        self.pairedDeviceID = defaults.string(forKey: Keys.pairedDeviceID)
        self.acceptedScopes = defaults.stringArray(forKey: Keys.acceptedScopes) ?? Self.defaultAcceptedScopes
        self.uploadHealthEnabled = defaults.object(forKey: Keys.uploadHealthEnabled) as? Bool ?? true
        self.uploadCalendarEnabled = defaults.object(forKey: Keys.uploadCalendarEnabled) as? Bool ?? true
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

    func confirmPairing() async {
        let rawPairingURL = pairingURLText
        isPairing = true
        pairingMessage = nil
        defer { isPairing = false }

        do {
            let link = try PairingLink(rawValue: rawPairingURL)
            let response = try await GatewayAPIClient.confirmPairing(
                link: link,
                deviceName: "HealthLink iOS",
                acceptedScopes: Self.defaultAcceptedScopes
            )

            savePairing(
                serverURL: link.serverURL,
                deviceID: response.device_id,
                deviceToken: response.device_token,
                acceptedScopes: Self.defaultAcceptedScopes
            )
            pairingURLText = ""
            pairingMessage = "Paired"
        } catch {
            pairingMessage = error.localizedDescription
        }
    }

    func save() {
        defaults.set(serverURLText.trimmingCharacters(in: .whitespacesAndNewlines), forKey: Keys.serverURL)
        defaults.set(uploadHealthEnabled, forKey: Keys.uploadHealthEnabled)
        defaults.set(uploadCalendarEnabled, forKey: Keys.uploadCalendarEnabled)

        do {
            try keychain.set(apiTokenText.trimmingCharacters(in: .whitespacesAndNewlines), for: Keys.apiToken)
            lastSavedMessage = "Saved"
        } catch {
            lastSavedMessage = error.localizedDescription
        }
    }

    private func savePairing(serverURL: URL, deviceID: String, deviceToken: String, acceptedScopes: [String]) {
        serverURLText = serverURL.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        apiTokenText = deviceToken
        pairedDeviceID = deviceID
        self.acceptedScopes = acceptedScopes

        defaults.set(serverURLText, forKey: Keys.serverURL)
        defaults.set(deviceID, forKey: Keys.pairedDeviceID)
        defaults.set(acceptedScopes, forKey: Keys.acceptedScopes)

        do {
            try keychain.set(deviceToken, for: Keys.apiToken)
            lastSavedMessage = "Paired"
        } catch {
            pairingMessage = error.localizedDescription
        }
    }
}
