import Foundation

@MainActor
final class GatewaySettings: ObservableObject {
    @Published var serverURLText: String
    @Published var apiTokenText: String
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
    }

    init() {
        self.serverURLText = defaults.string(forKey: Keys.serverURL) ?? ""
        self.apiTokenText = (try? keychain.get(account: Keys.apiToken)) ?? ""
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
}
