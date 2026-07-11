import Foundation
import XCTest
@testable import HealthLink

final class GatewaySettingsTests: XCTestCase {
    private var suiteName = ""
    private var defaults: UserDefaults!
    private var keychain: InMemoryKeychainStore!

    override func setUpWithError() throws {
        suiteName = "app.healthlink.tests.\(UUID().uuidString)"
        defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        defaults.removePersistentDomain(forName: suiteName)
        keychain = InMemoryKeychainStore()
    }

    override func tearDownWithError() throws {
        defaults.removePersistentDomain(forName: suiteName)
        defaults = nil
        keychain = nil
    }

    @MainActor
    func testSyncHistoryPersistsAndKeepsNewestTwentyEntries() {
        let settings = GatewaySettings(defaults: defaults, keychain: keychain)
        for index in 0..<22 {
            settings.recordSyncDetail(TestFixtures.syncDetail(index: index))
        }

        let restored = GatewaySettings(defaults: defaults, keychain: keychain)

        XCTAssertEqual(restored.syncHistory.count, 20)
        XCTAssertEqual(restored.latestSyncDetail?.acceptedSyncID, "sync_test_21")
        XCTAssertEqual(restored.latestSuccessfulSyncDetail?.deliveryState?.rawValue, SyncDeliveryState.receiverAccepted.rawValue)
    }

    @MainActor
    func testSuccessfulSyncTimestampPersists() {
        let settings = GatewaySettings(defaults: defaults, keychain: keychain)
        settings.recordManualSyncResult(success: true, error: nil)

        let restored = GatewaySettings(defaults: defaults, keychain: keychain)

        XCTAssertNotNil(restored.lastManualSyncAt)
        XCTAssertNil(restored.lastSyncError)
    }

    @MainActor
    func testDisconnectClearsPairingAndSyncTracking() async throws {
        defaults.set("http://127.0.0.1:8787", forKey: "gateway.serverURL")
        defaults.set("dev_test", forKey: "gateway.pairedDeviceID")
        defaults.set("Test Agent", forKey: "gateway.pairedAgentName")
        try keychain.set("test-device-token", for: "gateway.apiToken")
        let settings = GatewaySettings(defaults: defaults, keychain: keychain)
        settings.recordSyncDetail(TestFixtures.syncDetail())
        settings.recordManualSyncResult(success: true, error: nil)

        await settings.disconnect(revokeRemote: false)

        XCTAssertFalse(settings.isPaired)
        XCTAssertTrue(settings.syncHistory.isEmpty)
        XCTAssertNil(settings.lastManualSyncAt)
        let restored = GatewaySettings(defaults: defaults, keychain: keychain)
        XCTAssertFalse(restored.isPaired)
        XCTAssertTrue(restored.syncHistory.isEmpty)
        XCTAssertNil(restored.lastManualSyncAt)
    }
}

private final class InMemoryKeychainStore: KeychainStoring {
    private var values: [String: String] = [:]

    func set(_ value: String, for account: String) throws {
        values[account] = value
    }

    func get(account: String) throws -> String? {
        values[account]
    }

    func delete(account: String) throws {
        values.removeValue(forKey: account)
    }
}
