import Foundation
import XCTest
@testable import VitalAgentSync

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

    func testRecentDatePlanningIncludesTodayAndYesterdayAcrossDST() throws {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = try XCTUnwrap(TimeZone(identifier: "America/Los_Angeles"))
        let now = try XCTUnwrap(
            calendar.date(from: DateComponents(year: 2026, month: 3, day: 9, hour: 12))
        )

        let dates = SyncDatePlanner.recentDates(dayCount: 2, now: now, calendar: calendar)

        XCTAssertEqual(dates.count, 2)
        XCTAssertEqual(calendar.component(.day, from: dates[0]), 8)
        XCTAssertEqual(calendar.component(.day, from: dates[1]), 9)
        XCTAssertEqual(dates.map { calendar.component(.hour, from: $0) }, [0, 0])
    }

    func testAllHistoryDatePlanningIncludesBothEndpoints() throws {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = try XCTUnwrap(TimeZone(identifier: "Asia/Shanghai"))
        let earliest = try XCTUnwrap(
            calendar.date(from: DateComponents(year: 2026, month: 7, day: 1, hour: 18))
        )
        let now = try XCTUnwrap(
            calendar.date(from: DateComponents(year: 2026, month: 7, day: 4, hour: 9))
        )

        let dates = SyncDatePlanner.allDates(
            startingAt: earliest,
            through: now,
            calendar: calendar
        )

        XCTAssertEqual(dates.count, 4)
        XCTAssertEqual(calendar.component(.day, from: dates.first!), 1)
        XCTAssertEqual(calendar.component(.day, from: dates.last!), 4)
    }

    func testUploadBatchesStayWithinFourteenDays() {
        let batches = SyncDatePlanner.batches(Array(0..<31))

        XCTAssertEqual(batches.map(\.count), [14, 14, 3])
        XCTAssertEqual(batches.flatMap { $0 }, Array(0..<31))
    }

    func testSyncProgressFractionIsClamped() {
        XCTAssertEqual(
            SyncProgress(completedDays: 7, totalDays: 14, currentDateRange: nil).fractionCompleted,
            0.5
        )
        XCTAssertEqual(
            SyncProgress(completedDays: 20, totalDays: 14, currentDateRange: nil).fractionCompleted,
            1
        )
        XCTAssertNil(
            SyncProgress(completedDays: 0, totalDays: nil, currentDateRange: nil).fractionCompleted
        )
    }
}
