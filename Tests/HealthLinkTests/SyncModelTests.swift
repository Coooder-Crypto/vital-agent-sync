import Foundation
import XCTest
@testable import HealthLink

final class SyncModelTests: XCTestCase {
    private struct LegacyLastSyncDetail: Codable {
        let attemptedAt: Date
        let completedAt: Date?
        let trigger: String
        let serverURL: String?
        let agentName: String?
        let requestedDateRange: String?
        let uploadedDayCount: Int
        let acceptedSyncID: String?
        let isIdempotent: Bool?
        let failureCategory: SyncFailureCategory?
        let failureMessage: String?
    }

    func testLegacySyncDetailDecodesWithoutDeliveryState() throws {
        let current = TestFixtures.syncDetail()
        let legacy = LegacyLastSyncDetail(
            attemptedAt: current.attemptedAt,
            completedAt: current.completedAt,
            trigger: current.trigger,
            serverURL: current.serverURL,
            agentName: current.agentName,
            requestedDateRange: current.requestedDateRange,
            uploadedDayCount: current.uploadedDayCount,
            acceptedSyncID: current.acceptedSyncID,
            isIdempotent: current.isIdempotent,
            failureCategory: current.failureCategory,
            failureMessage: current.failureMessage
        )

        let decoded = try JSONDecoder().decode(
            LastSyncDetail.self,
            from: JSONEncoder().encode(legacy)
        )

        XCTAssertNil(decoded.deliveryState)
        XCTAssertTrue(decoded.succeeded)
    }

    func testDeliveryStateRoundTrips() throws {
        let detail = TestFixtures.syncDetail(deliveryState: .relayQueued)
        let decoded = try JSONDecoder().decode(
            LastSyncDetail.self,
            from: JSONEncoder().encode(detail)
        )

        XCTAssertEqual(decoded.deliveryState?.rawValue, SyncDeliveryState.relayQueued.rawValue)
        XCTAssertEqual(decoded.acceptedSyncID, detail.acceptedSyncID)
    }

    func testFailureDetailIsNotSuccessful() {
        let detail = TestFixtures.syncDetail(failureCategory: .networkUnavailable)

        XCTAssertFalse(detail.succeeded)
        XCTAssertNil(detail.acceptedSyncID)
        XCTAssertEqual(detail.failureCategory?.rawValue, SyncFailureCategory.networkUnavailable.rawValue)
    }
}
