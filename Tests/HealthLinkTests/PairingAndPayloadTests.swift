import XCTest
import CryptoKit
@testable import HealthLink

final class PairingAndPayloadTests: XCTestCase {
    private let directPublicKey = Data(repeating: 7, count: 32).base64URLEncodedString()

    func testPairingLinkAcceptsVitalAgentSyncAndLegacySchemesWithPinnedTransportKey() throws {
        for scheme in [AppDeepLinkScheme.primary, AppDeepLinkScheme.legacy] {
            let link = try PairingLink(
                rawValue: "\(scheme)://pair?server=http://192.168.1.25:8787&code=ab12-cd34&key=\(directPublicKey)"
            )

            XCTAssertEqual(link.serverURL.absoluteString, "http://192.168.1.25:8787")
            XCTAssertEqual(link.pairingCode, "AB12-CD34")
            XCTAssertEqual(link.directTransportPublicKey, directPublicKey)
        }
    }

    func testPairingLinkRejectsInvalidSchemeAndMissingCode() {
        XCTAssertThrowsError(try PairingLink(rawValue: "https://pair?server=http://127.0.0.1:8787&code=ABCD"))
        XCTAssertThrowsError(try PairingLink(rawValue: "healthlink://pair?server=http://127.0.0.1:8787"))
        XCTAssertThrowsError(try PairingLink(rawValue: "healthlink://pair?server=file:///tmp/health&code=ABCD"))
        XCTAssertThrowsError(try PairingLink(rawValue: "healthlink://pair?server=http://127.0.0.1:8787&code=ABCD"))
        XCTAssertThrowsError(try PairingLink(rawValue: "healthlink://pair?server=http://127.0.0.1:8787&code=ABCD&key=short"))
    }

    func testDirectEnvelopeDoesNotExposePairingCodeTokenOrHealthValues() throws {
        struct SensitivePayload: Encodable {
            let pairing_code: String
            let device_token: String
            let steps: Int
        }
        struct InteropResponse: Decodable {
            let ok: Bool
            let accepted_sync_id: String
        }
        let receiverPrivateKey = try Curve25519.KeyAgreement.PrivateKey(rawRepresentation: Data(repeating: 9, count: 32))
        let exchange = try DirectTransportCrypto.makeRequest(
            purpose: .healthSync,
            payload: SensitivePayload(
                pairing_code: "PAIR-SECRET",
                device_token: "hl_dev_reusable-secret",
                steps: 12_345
            ),
            receiverPublicKey: receiverPrivateKey.publicKey.rawRepresentation.base64URLEncodedString(),
            requestID: "req_interop_001",
            createdAt: try XCTUnwrap(ISO8601DateFormatter.gatewayDateTime.date(from: "2026-07-13T10:00:00+08:00")),
            ephemeralPrivateKey: try Curve25519.KeyAgreement.PrivateKey(rawRepresentation: Data(repeating: 5, count: 32)),
            nonceData: Data((0..<12).map(UInt8.init))
        )
        let wire = try XCTUnwrap(String(data: canonicalJSONData(exchange.envelope), encoding: .utf8))

        XCTAssertFalse(wire.contains("PAIR-SECRET"))
        XCTAssertFalse(wire.contains("hl_dev_reusable-secret"))
        XCTAssertFalse(wire.contains("12345"))
        XCTAssertEqual(exchange.envelope.created_at, "2026-07-13T02:00:00.000Z")
        XCTAssertEqual(exchange.envelope.crypto.sender_public_key_x25519, "UKYUCbHd0DJemxa3AOcZ6XcsBwALG9d4bpB8ZT0gSV0")
        XCTAssertEqual(exchange.envelope.crypto.nonce, "AAECAwQFBgcICQoL")
        XCTAssertEqual(exchange.envelope.crypto.tag, "SYFS19IOXi4cYHLLcHDS3A")
        XCTAssertEqual(
            exchange.envelope.crypto.ciphertext,
            "ARIf2UK1z9Y3A_ukK44V2kqjaqeApuSylJm3W80YxyUG0XLoYMIu1QTvXPN-zlElKP6whxwk_U17z2JrcxDJcr9zsfBCi5EuOV3afHokWul8K81l"
        )

        let nodeResponse = DirectEncryptedEnvelope(
            protocolVersion: DirectTransportCrypto.protocolVersion,
            request_id: "req_interop_001",
            created_at: "2026-07-13T02:00:31.000Z",
            purpose: .healthSync,
            crypto: DirectEnvelopeCrypto(
                alg: DirectTransportCrypto.algorithm,
                sender_public_key_x25519: "V9tLNZ8jrl4Ubk4lEgVnBHIlBjSMFQwUdT0Mkz0E1CE",
                nonce: "CwoJCAcGBQQDAgEA",
                tag: "Tu64dfWyN8tooxGV0fcWsw",
                ciphertext: "GjiG0EncUCuZbOMl22Qt_g6Sd1yw4GKseLIAuu0bSi_R48IfnTPvul9VesrnJ0VJJA"
            )
        )
        let decrypted = try DirectTransportCrypto.decryptResponse(nodeResponse, exchange: exchange, as: InteropResponse.self)
        XCTAssertTrue(decrypted.ok)
        XCTAssertEqual(decrypted.accepted_sync_id, "sync_interop_001")
    }

    func testRelayOnboardingParsesTextAndDeepLinkForms() throws {
        let payload = TestFixtures.relayOnboarding()
        let data = try JSONEncoder().encode(payload)
        let encoded = "healthlink-e2ee-v1:\(data.base64URLEncodedString())"

        let textDecoded = try RelayOnboardingPayload(rawValue: encoded)
        XCTAssertEqual(textDecoded.source_device_id, payload.source_device_id)
        XCTAssertEqual(textDecoded.relay_url, payload.relay_url)

        for scheme in [AppDeepLinkScheme.primary, AppDeepLinkScheme.legacy] {
            var components = URLComponents()
            components.scheme = scheme
            components.host = "onboard"
            components.queryItems = [URLQueryItem(name: "payload", value: encoded)]
            let deepLinkDecoded = try RelayOnboardingPayload(rawValue: try XCTUnwrap(components.url).absoluteString)
            XCTAssertEqual(deepLinkDecoded.user_id, payload.user_id)
        }
    }

    func testRelayOnboardingRejectsHostedHTTPURL() throws {
        let valid = TestFixtures.relayOnboarding()
        let invalid = RelayOnboardingPayload(
            protocolVersion: valid.protocolVersion,
            mode: valid.mode,
            relay_url: "http://relay.example.com",
            user_id: valid.user_id,
            source_device_id: valid.source_device_id,
            agent_name: valid.agent_name,
            encryption_public_key: valid.encryption_public_key,
            encryption_public_key_x25519: valid.encryption_public_key_x25519,
            signing_public_key: valid.signing_public_key,
            upload_auth_secret: valid.upload_auth_secret,
            relay_access_token: valid.relay_access_token,
            relay_api_token: valid.relay_api_token,
            fingerprint: valid.fingerprint,
            requested_scopes: valid.requested_scopes,
            created_at: valid.created_at
        )
        let encoded = try JSONEncoder().encode(invalid).base64URLEncodedString()

        XCTAssertThrowsError(try RelayOnboardingPayload(rawValue: "healthlink-e2ee-v1:\(encoded)"))
    }

    func testCallbackKeepsLegacySourceAndDropsUntrustedMetadata() throws {
        let callback = try XCTUnwrap(HealthLinkCallbackPolicy.safeCallbackURL(
            rawCallbackURL: "openclaw://healthlink-result?secret=drop-me#drop-me-too",
            requestID: "issue55-001",
            status: "ok"
        ))
        let components = try XCTUnwrap(URLComponents(url: callback, resolvingAgainstBaseURL: false))
        let query = Dictionary(uniqueKeysWithValues: (components.queryItems ?? []).map { ($0.name, $0.value ?? "") })

        XCTAssertEqual(components.scheme, "openclaw")
        XCTAssertNil(components.fragment)
        XCTAssertEqual(query.count, 3)
        XCTAssertEqual(query["request_id"], "issue55-001")
        XCTAssertEqual(query["status"], "ok")
        XCTAssertEqual(query["source"], "healthlink")
        XCTAssertNil(query["secret"])
    }

    func testHealthSyncPayloadEncodesExpectedContract() throws {
        let payload = HealthSyncPayload(
            device_id: "dev_test",
            sync_id: "sync_test",
            generated_at: "2026-07-11T10:00:00+08:00",
            timezone: "Asia/Shanghai",
            health_daily_summaries: [TestFixtures.dailySummary()]
        )

        let data = try JSONEncoder().encode(payload)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let summaries = try XCTUnwrap(object["health_daily_summaries"] as? [[String: Any]])

        XCTAssertEqual(object["device_id"] as? String, "dev_test")
        XCTAssertEqual(object["sync_id"] as? String, "sync_test")
        XCTAssertEqual(summaries.first?["steps"] as? Int, 8_123)
        XCTAssertEqual(summaries.first?["provider"] as? String, "apple_health")
    }
}
