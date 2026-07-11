import Foundation
import XCTest
@testable import HealthLink

final class GatewayErrorTests: XCTestCase {
    func testURLErrorMappingSeparatesConnectivityAndTimeouts() {
        XCTAssertEqual(
            GatewayError.fromURL(URLError(.notConnectedToInternet)).syncFailureCategory.rawValue,
            SyncFailureCategory.networkUnavailable.rawValue
        )
        XCTAssertEqual(
            GatewayError.fromURL(URLError(.cannotConnectToHost)).syncFailureCategory.rawValue,
            SyncFailureCategory.receiverUnreachable.rawValue
        )
        XCTAssertEqual(
            GatewayError.fromURL(URLError(.timedOut)).syncFailureCategory.rawValue,
            SyncFailureCategory.requestTimedOut.rawValue
        )
    }

    func testHTTPErrorMappingSeparatesRevokedTokenAndServerFailure() {
        XCTAssertEqual(
            GatewayError.invalidServerResponse(401).syncFailureCategory.rawValue,
            SyncFailureCategory.tokenRevoked.rawValue
        )
        XCTAssertEqual(
            GatewayError.invalidServerResponse(500).syncFailureCategory.rawValue,
            SyncFailureCategory.serverError.rawValue
        )
        XCTAssertTrue(GatewayError.invalidServerResponse(401).localizedDescription.contains("pair again"))
    }

    func testConfigurationAndHealthErrorsHaveActionableCategories() {
        XCTAssertEqual(
            GatewayError.missingServerURL.syncFailureCategory.rawValue,
            SyncFailureCategory.configuration.rawValue
        )
        XCTAssertEqual(
            GatewayError.healthPermissionRequired.syncFailureCategory.rawValue,
            SyncFailureCategory.healthPermissionMissing.rawValue
        )
    }
}
