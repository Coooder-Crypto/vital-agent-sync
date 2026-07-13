import Foundation
import CryptoKit

struct WorkoutSummary: Codable, Identifiable {
    let id: String
    let type: String
    let started_at: String
    let duration_minutes: Int
    let active_energy_kcal: Double?
    let avg_heart_rate_bpm: Double?
}

struct DailyHealthSummary: Codable, Identifiable {
    var id: String { date }

    let date: String
    let timezone: String
    let provider: String
    let steps: Int?
    let sleep_minutes: Int?
    let resting_heart_rate_bpm: Double?
    let avg_heart_rate_bpm: Double?
    let max_heart_rate_bpm: Double?
    let active_energy_kcal: Double?
    let basal_energy_kcal: Double?
    let distance_walking_running_m: Double?
    let distance_cycling_m: Double?
    let flights_climbed: Int?
    let exercise_minutes: Int?
    let stand_minutes: Int?
    let heart_rate_variability_ms: Double?
    let walking_heart_rate_average_bpm: Double?
    let vo2_max_ml_kg_min: Double?
    let oxygen_saturation_percent: Double?
    let respiratory_rate_bpm: Double?
    let body_temperature_c: Double?
    let body_mass_kg: Double?
    let body_fat_percentage: Double?
    let lean_body_mass_kg: Double?
    let body_mass_index: Double?
    let workout_minutes: Int?
    let workouts: [WorkoutSummary]
}

struct SyncStatus: Codable {
    var lastHealthSyncAt: Date?
    var lastError: String?
    var lastSuccessMessage: String?
    var lastSyncDetail: LastSyncDetail?

    static let empty = SyncStatus(
        lastHealthSyncAt: nil,
        lastError: nil,
        lastSuccessMessage: nil,
        lastSyncDetail: nil
    )
}

enum SyncFailureCategory: String, Codable {
    case receiverUnreachable
    case tokenRevoked
    case healthPermissionMissing
    case networkUnavailable
    case requestTimedOut
    case serverError
    case configuration
    case unknown

    var title: String {
        switch self {
        case .receiverUnreachable:
            return "Receiver unreachable"
        case .tokenRevoked:
            return "Token revoked"
        case .healthPermissionMissing:
            return "Health permission missing"
        case .networkUnavailable:
            return "Network unavailable"
        case .requestTimedOut:
            return "Request timed out"
        case .serverError:
            return "Server error"
        case .configuration:
            return "Setup incomplete"
        case .unknown:
            return "Sync failed"
        }
    }

    var recoveryHint: String {
        switch self {
        case .receiverUnreachable:
            return String(localized: "Make sure the Agent receiver is running and this iPhone can reach the saved server URL.")
        case .tokenRevoked:
            return String(localized: "Pair this iPhone with the Agent again to receive a fresh device token.")
        case .healthPermissionMissing:
            return String(localized: "Open iOS Settings and allow VitalMCP to read the selected Health data.")
        case .networkUnavailable:
            return String(localized: "Check Wi-Fi or cellular connectivity, then retry sync.")
        case .requestTimedOut:
            return String(localized: "Keep the Agent receiver online and retry when the network is stable.")
        case .serverError:
            return String(localized: "Check the Agent receiver logs, then retry sync.")
        case .configuration:
            return String(localized: "Scan a pairing QR or complete the saved server and token settings.")
        case .unknown:
            return String(localized: "Retry sync. If it keeps failing, check the Agent receiver status.")
        }
    }
}

enum SyncDeliveryState: String, Codable {
    case receiverAccepted
    case relayQueued

    var title: String {
        switch self {
        case .receiverAccepted:
            return String(localized: "Receiver accepted sync")
        case .relayQueued:
            return String(localized: "Encrypted sync queued")
        }
    }

    var detail: String {
        switch self {
        case .receiverAccepted:
            return String(localized: "The paired receiver stored this sync for Agent tools.")
        case .relayQueued:
            return String(localized: "The relay accepted the encrypted envelope. Your Agent can read it after the local runtime pulls it.")
        }
    }
}

struct LastSyncDetail: Codable, Identifiable {
    let attemptedAt: Date
    let completedAt: Date?
    let trigger: String
    let serverURL: String?
    let agentName: String?
    let requestedDateRange: String?
    let uploadedDayCount: Int
    let acceptedSyncID: String?
    let isIdempotent: Bool?
    let deliveryState: SyncDeliveryState?
    let failureCategory: SyncFailureCategory?
    let failureMessage: String?

    var succeeded: Bool {
        acceptedSyncID != nil && failureCategory == nil
    }

    var id: String {
        let stablePart = acceptedSyncID ?? failureMessage ?? requestedDateRange ?? trigger
        return "\(attemptedAt.timeIntervalSince1970)-\(stablePart)"
    }
}

enum AppDeepLinkScheme {
    static let primary = "vitalmcp"
    static let legacy = "healthlink"

    static func isSupported(_ scheme: String?) -> Bool {
        guard let scheme = scheme?.lowercased() else {
            return false
        }
        return scheme == primary || scheme == legacy
    }
}

struct PairingLink {
    let serverURL: URL
    let pairingCode: String
    let directTransportPublicKey: String

    init(rawValue: String) throws {
        let trimmed = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let components = URLComponents(string: trimmed),
              AppDeepLinkScheme.isSupported(components.scheme),
              components.host?.lowercased() == "pair" else {
            throw GatewayError.invalidPairingURL
        }

        let queryItems = components.queryItems ?? []
        let serverValue = queryItems.first { $0.name == "server" }?.value
        let codeValue = queryItems.first { $0.name == "code" }?.value
        let keyValue = queryItems.first { $0.name == "key" }?.value

        guard let serverValue,
              let serverURL = URL(string: serverValue),
              let scheme = serverURL.scheme,
              ["http", "https"].contains(scheme) else {
            throw GatewayError.invalidPairingURL
        }

        guard let codeValue,
              !codeValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw GatewayError.invalidPairingURL
        }

        guard let keyValue,
              let publicKey = try? Data(base64URLEncoded: keyValue),
              publicKey.count == 32 else {
            throw GatewayError.invalidPairingURL
        }

        self.serverURL = serverURL
        self.pairingCode = codeValue.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        self.directTransportPublicKey = publicKey.base64URLEncodedString()
    }
}

struct PairConfirmRequest: Codable {
    let pairing_code: String
    let device_name: String
    let device_platform: String
    let accepted_scopes: [String]
}

struct PairConfirmResponse: Codable {
    let device_id: String
    let device_token: String
    let server_time: String
}

struct PairingStatusResponse: Codable {
    let pairing_code: String
    let server_url: String
    let agent_name: String
    let transport: String?
    let requested_scopes: [String]
    let status: String
    let expires_at: String
    let consumed_at: String?
}

struct PairingPreview: Identifiable {
    var id: String { link.pairingCode }

    let link: PairingLink
    let status: PairingStatusResponse
}

enum DirectTransportPurpose: String, Codable {
    case pairingStatus = "pair.status"
    case pairingConfirm = "pair.confirm"
    case healthSync = "health.sync"
    case deviceRevoke = "device.revoke"
}

struct DirectEncryptedEnvelope: Codable {
    let protocolVersion: String
    let request_id: String
    let created_at: String
    let purpose: DirectTransportPurpose
    let crypto: DirectEnvelopeCrypto

    enum CodingKeys: String, CodingKey {
        case protocolVersion = "protocol"
        case request_id
        case created_at
        case purpose
        case crypto
    }
}

struct DirectEnvelopeCrypto: Codable {
    let alg: String
    let sender_public_key_x25519: String
    let nonce: String
    let tag: String
    let ciphertext: String
}

struct DirectTransportExchange {
    let envelope: DirectEncryptedEnvelope
    fileprivate let ephemeralPrivateKey: Curve25519.KeyAgreement.PrivateKey
    fileprivate let receiverPublicKey: Data
}

enum DirectTransportCrypto {
    static let protocolVersion = "vitalmcp-direct-v1"
    static let algorithm = "x25519-hkdf-sha256-chacha20poly1305"

    static func makeRequest<T: Encodable>(
        purpose: DirectTransportPurpose,
        payload: T,
        receiverPublicKey: String,
        requestID: String = "req_\(UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased())",
        createdAt: Date = Date(),
        ephemeralPrivateKey: Curve25519.KeyAgreement.PrivateKey = .init(),
        nonceData: Data? = nil
    ) throws -> DirectTransportExchange {
        let receiverKeyData = try Data(base64URLEncoded: receiverPublicKey)
        guard receiverKeyData.count == 32 else {
            throw GatewayError.invalidPairingURL
        }
        let receiverKey = try Curve25519.KeyAgreement.PublicKey(rawRepresentation: receiverKeyData)
        let sharedSecret = try ephemeralPrivateKey.sharedSecretFromKeyAgreement(with: receiverKey)
        let requestKey = deriveKey(sharedSecret, direction: "request")
        let nonceData = nonceData ?? Data((0..<12).map { _ in UInt8.random(in: 0...255) })
        let nonce = try ChaChaPoly.Nonce(data: nonceData)
        let senderPublicKey = ephemeralPrivateKey.publicKey.rawRepresentation.base64URLEncodedString()
        let createdAtValue = ISO8601DateFormatter.gatewayDateTimeWithFractionalSeconds.string(from: createdAt)
        let aad = try authenticatedData(
            requestID: requestID,
            createdAt: createdAtValue,
            purpose: purpose,
            senderPublicKey: senderPublicKey
        )
        let sealed = try ChaChaPoly.seal(
            canonicalJSONData(payload),
            using: requestKey,
            nonce: nonce,
            authenticating: aad
        )
        return DirectTransportExchange(
            envelope: DirectEncryptedEnvelope(
                protocolVersion: protocolVersion,
                request_id: requestID,
                created_at: createdAtValue,
                purpose: purpose,
                crypto: DirectEnvelopeCrypto(
                    alg: algorithm,
                    sender_public_key_x25519: senderPublicKey,
                    nonce: nonceData.base64URLEncodedString(),
                    tag: sealed.tag.base64URLEncodedString(),
                    ciphertext: sealed.ciphertext.base64URLEncodedString()
                )
            ),
            ephemeralPrivateKey: ephemeralPrivateKey,
            receiverPublicKey: receiverKeyData
        )
    }

    static func decryptResponse<T: Decodable>(
        _ envelope: DirectEncryptedEnvelope,
        exchange: DirectTransportExchange,
        as type: T.Type
    ) throws -> T {
        guard envelope.protocolVersion == protocolVersion,
              envelope.crypto.alg == algorithm,
              envelope.request_id == exchange.envelope.request_id,
              envelope.purpose == exchange.envelope.purpose,
              let senderKey = try? Data(base64URLEncoded: envelope.crypto.sender_public_key_x25519),
              senderKey == exchange.receiverPublicKey else {
            throw GatewayError.invalidServerResponse(-1)
        }
        let receiverKey = try Curve25519.KeyAgreement.PublicKey(rawRepresentation: senderKey)
        let sharedSecret = try exchange.ephemeralPrivateKey.sharedSecretFromKeyAgreement(with: receiverKey)
        let responseKey = deriveKey(sharedSecret, direction: "response")
        let nonceData = try Data(base64URLEncoded: envelope.crypto.nonce)
        let nonce = try ChaChaPoly.Nonce(data: nonceData)
        let sealed = try ChaChaPoly.SealedBox(
            nonce: nonce,
            ciphertext: Data(base64URLEncoded: envelope.crypto.ciphertext),
            tag: Data(base64URLEncoded: envelope.crypto.tag)
        )
        let aad = try authenticatedData(
            requestID: envelope.request_id,
            createdAt: envelope.created_at,
            purpose: envelope.purpose,
            senderPublicKey: envelope.crypto.sender_public_key_x25519
        )
        let plaintext = try ChaChaPoly.open(sealed, using: responseKey, authenticating: aad)
        return try JSONDecoder().decode(type, from: plaintext)
    }

    private static func deriveKey(_ sharedSecret: SharedSecret, direction: String) -> SymmetricKey {
        sharedSecret.hkdfDerivedSymmetricKey(
            using: SHA256.self,
            salt: Data(),
            sharedInfo: Data("\(protocolVersion) \(direction)".utf8),
            outputByteCount: 32
        )
    }

    private static func authenticatedData(
        requestID: String,
        createdAt: String,
        purpose: DirectTransportPurpose,
        senderPublicKey: String
    ) throws -> Data {
        struct AAD: Encodable {
            let protocolVersion: String
            let request_id: String
            let created_at: String
            let purpose: DirectTransportPurpose
            let alg: String
            let sender_public_key_x25519: String

            enum CodingKeys: String, CodingKey {
                case protocolVersion = "protocol"
                case request_id
                case created_at
                case purpose
                case alg
                case sender_public_key_x25519
            }
        }
        return try canonicalJSONData(AAD(
            protocolVersion: protocolVersion,
            request_id: requestID,
            created_at: createdAt,
            purpose: purpose,
            alg: algorithm,
            sender_public_key_x25519: senderPublicKey
        ))
    }
}

struct RelayOnboardingPayload: Codable, Identifiable {
    let protocolVersion: String
    let mode: String
    let relay_url: String
    let user_id: String
    let source_device_id: String
    let agent_name: String
    let encryption_public_key: String?
    let encryption_public_key_x25519: String
    let signing_public_key: String?
    let upload_auth_secret: String
    let relay_access_token: String
    let relay_api_token: String?
    let fingerprint: String
    let requested_scopes: [String]
    let created_at: String

    var id: String { source_device_id }

    enum CodingKeys: String, CodingKey {
        case protocolVersion = "protocol"
        case mode
        case relay_url
        case user_id
        case source_device_id
        case agent_name
        case encryption_public_key
        case encryption_public_key_x25519
        case signing_public_key
        case upload_auth_secret
        case relay_access_token
        case relay_api_token
        case fingerprint
        case requested_scopes
        case created_at
    }

    init(
        protocolVersion: String,
        mode: String,
        relay_url: String,
        user_id: String,
        source_device_id: String,
        agent_name: String,
        encryption_public_key: String?,
        encryption_public_key_x25519: String,
        signing_public_key: String?,
        upload_auth_secret: String,
        relay_access_token: String,
        relay_api_token: String?,
        fingerprint: String,
        requested_scopes: [String],
        created_at: String
    ) {
        self.protocolVersion = protocolVersion
        self.mode = mode
        self.relay_url = relay_url
        self.user_id = user_id
        self.source_device_id = source_device_id
        self.agent_name = agent_name
        self.encryption_public_key = encryption_public_key
        self.encryption_public_key_x25519 = encryption_public_key_x25519
        self.signing_public_key = signing_public_key
        self.upload_auth_secret = upload_auth_secret
        self.relay_access_token = relay_access_token
        self.relay_api_token = relay_api_token
        self.fingerprint = fingerprint
        self.requested_scopes = requested_scopes
        self.created_at = created_at
    }

    init(rawValue: String) throws {
        let trimmed = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
        let encodedValue: String
        if let components = URLComponents(string: trimmed),
           AppDeepLinkScheme.isSupported(components.scheme),
           components.host?.lowercased() == "onboard",
           let payload = components.queryItems?.first(where: { $0.name == "payload" })?.value {
            encodedValue = payload
        } else {
            encodedValue = trimmed
        }

        let data: Data
        if encodedValue.first == "{" {
            guard let rawData = encodedValue.data(using: .utf8) else {
                throw GatewayError.invalidPairingURL
            }
            data = rawData
        } else {
            let prefix = "healthlink-e2ee-v1:"
            let base64URL = encodedValue.hasPrefix(prefix)
                ? String(encodedValue.dropFirst(prefix.count))
                : encodedValue
            data = try Data(base64URLEncoded: base64URL)
        }
        let decoded = try JSONDecoder().decode(RelayOnboardingPayload.self, from: data)
        let encryptionKey = try? Data(base64URLEncoded: decoded.encryption_public_key_x25519)
        let uploadSecret = try? Data(base64URLEncoded: decoded.upload_auth_secret)
        let relayAccessToken = try? Data(base64URLEncoded: decoded.relay_access_token)
        guard let relayComponents = URLComponents(string: decoded.relay_url),
              let relayScheme = relayComponents.scheme?.lowercased(),
              relayComponents.host != nil,
              relayComponents.user == nil,
              relayComponents.password == nil,
              relayComponents.query == nil,
              relayComponents.fragment == nil,
              ["hosted_relay", "self_hosted_relay"].contains(decoded.mode),
              (decoded.mode == "hosted_relay" ? relayScheme == "https" : ["http", "https"].contains(relayScheme)) else {
            throw GatewayError.invalidPairingURL
        }
        guard decoded.protocolVersion == "healthlink-e2ee-v1",
              decoded.relay_url.count <= 2_048,
              Self.isIdentifier(decoded.user_id),
              Self.isIdentifier(decoded.source_device_id),
              !decoded.agent_name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              decoded.agent_name.count <= 256,
              encryptionKey?.count == 32,
              uploadSecret?.count == 32,
              relayAccessToken?.count == 32,
              !decoded.requested_scopes.isEmpty,
              decoded.requested_scopes.count <= 32,
              decoded.requested_scopes.allSatisfy(Self.isScope),
              Self.isISO8601Timestamp(decoded.created_at) else {
            throw GatewayError.invalidPairingURL
        }
        self = decoded
    }

    private static func isIdentifier(_ value: String) -> Bool {
        !value.isEmpty &&
            value.count <= 256 &&
            value.range(of: "^[A-Za-z0-9._-]+$", options: .regularExpression) != nil
    }

    private static func isScope(_ value: String) -> Bool {
        !value.isEmpty &&
            value.count <= 128 &&
            value.range(of: "^[A-Za-z0-9._:-]+$", options: .regularExpression) != nil
    }

    private static func isISO8601Timestamp(_ value: String) -> Bool {
        ISO8601DateFormatter.gatewayDateTime.date(from: value) != nil ||
            ISO8601DateFormatter.gatewayDateTimeWithFractionalSeconds.date(from: value) != nil
    }
}

struct RelayOnboardingPreview: Identifiable {
    var id: String { payload.source_device_id }

    let payload: RelayOnboardingPayload
}

struct HealthSyncPayload: Codable {
    let device_id: String
    let sync_id: String
    let generated_at: String
    let timezone: String
    let health_daily_summaries: [DailyHealthSummary]
}

struct RelayEncryptedEnvelope: Codable {
    let protocolVersion: String
    let user_id: String
    let device_id: String
    let envelope_id: String
    let sequence: Int
    let payload_type: String
    let created_at: String
    let content_encoding: String
    let crypto: RelayEnvelopeCrypto

    enum CodingKeys: String, CodingKey {
        case protocolVersion = "protocol"
        case user_id
        case device_id
        case envelope_id
        case sequence
        case payload_type
        case created_at
        case content_encoding
        case crypto
    }
}

struct RelayEnvelopeCrypto: Codable {
    let alg: String
    let sender_public_key_x25519: String
    let nonce: String
    let tag: String
    let ciphertext: String
    let signature: String
}

struct RelayEnvelopePostResponse: Codable {
    let ok: Bool
    let envelope_id: String
}

enum HealthLinkCallbackPolicy {
    static func safeCallbackURL(rawCallbackURL: String?, requestID: String?, status: String) -> URL? {
        guard allowedStatuses.contains(status),
              let rawCallbackURL,
              let callbackURL = URL(string: rawCallbackURL),
              let scheme = callbackURL.scheme?.lowercased(),
              allowedSchemes.contains(scheme),
              var components = URLComponents(url: callbackURL, resolvingAgainstBaseURL: false),
              components.user == nil,
              components.password == nil else {
            return nil
        }

        var queryItems: [URLQueryItem] = []
        if let requestID = sanitizedRequestID(requestID) {
            queryItems.append(URLQueryItem(name: "request_id", value: requestID))
        }
        queryItems.append(URLQueryItem(name: "status", value: status))
        queryItems.append(URLQueryItem(name: "source", value: "healthlink"))
        components.queryItems = queryItems
        components.fragment = nil
        return components.url
    }

    private static func sanitizedRequestID(_ value: String?) -> String? {
        guard let value else {
            return nil
        }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty,
              trimmed.count <= 128,
              trimmed.range(of: "^[A-Za-z0-9._-]+$", options: .regularExpression) != nil else {
            return nil
        }
        return trimmed
    }

    private static let allowedSchemes: Set<String> = ["openclaw"]
    private static let allowedStatuses: Set<String> = ["ok", "failed", "paired", "unpaired"]
}

enum RelayCrypto {
    static func encrypt(
        payload: HealthSyncPayload,
        onboarding: RelayOnboardingPayload,
        sequence: Int? = nil
    ) throws -> RelayEncryptedEnvelope {
        let recipientRawKey = try Data(base64URLEncoded: onboarding.encryption_public_key_x25519)
        let recipientPublicKey = try Curve25519.KeyAgreement.PublicKey(rawRepresentation: recipientRawKey)
        let ephemeralPrivateKey = Curve25519.KeyAgreement.PrivateKey()
        let sharedSecret = try ephemeralPrivateKey.sharedSecretFromKeyAgreement(with: recipientPublicKey)
        let symmetricKey = deriveSymmetricKey(sharedSecret)
        let nonceData = Data((0..<12).map { _ in UInt8.random(in: 0...255) })
        let nonce = try ChaChaPoly.Nonce(data: nonceData)
        let plaintext = try canonicalJSONData(payload)
        let sealedBox = try ChaChaPoly.seal(plaintext, using: symmetricKey, nonce: nonce)
        let sequence = sequence ?? Int(Date().timeIntervalSince1970 * 1_000)
        let createdAt = ISO8601DateFormatter.gatewayDateTime.string(from: Date())
        let unsigned = RelayEncryptedEnvelope(
            protocolVersion: "healthlink-e2ee-v1",
            user_id: onboarding.user_id,
            device_id: payload.device_id,
            envelope_id: "env_\(UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased())",
            sequence: sequence,
            payload_type: "health.sync",
            created_at: createdAt,
            content_encoding: "canonical-json",
            crypto: RelayEnvelopeCrypto(
                alg: "x25519-hkdf-sha256-chacha20poly1305-hmac-sha256",
                sender_public_key_x25519: ephemeralPrivateKey.publicKey.rawRepresentation.base64URLEncodedString(),
                nonce: nonceData.base64URLEncodedString(),
                tag: sealedBox.tag.base64URLEncodedString(),
                ciphertext: sealedBox.ciphertext.base64URLEncodedString(),
                signature: ""
            )
        )
        let signature = try sign(unsignedEnvelope: unsigned, uploadAuthSecret: onboarding.upload_auth_secret)
        return RelayEncryptedEnvelope(
            protocolVersion: unsigned.protocolVersion,
            user_id: unsigned.user_id,
            device_id: unsigned.device_id,
            envelope_id: unsigned.envelope_id,
            sequence: unsigned.sequence,
            payload_type: unsigned.payload_type,
            created_at: unsigned.created_at,
            content_encoding: unsigned.content_encoding,
            crypto: RelayEnvelopeCrypto(
                alg: unsigned.crypto.alg,
                sender_public_key_x25519: unsigned.crypto.sender_public_key_x25519,
                nonce: unsigned.crypto.nonce,
                tag: unsigned.crypto.tag,
                ciphertext: unsigned.crypto.ciphertext,
                signature: signature
            )
        )
    }

    private static func deriveSymmetricKey(_ sharedSecret: SharedSecret) -> SymmetricKey {
        sharedSecret.hkdfDerivedSymmetricKey(
            using: SHA256.self,
            salt: Data(),
            sharedInfo: Data("healthlink-e2ee-v1 envelope".utf8),
            outputByteCount: 32
        )
    }

    private static func sign(unsignedEnvelope: RelayEncryptedEnvelope, uploadAuthSecret: String) throws -> String {
        let keyData = try Data(base64URLEncoded: uploadAuthSecret)
        let key = SymmetricKey(data: keyData)
        let data = try canonicalJSONData(unsignedEnvelope)
        let mac = HMAC<SHA256>.authenticationCode(for: data, using: key)
        return Data(mac).base64URLEncodedString()
    }
}

struct HealthSyncResponse: Codable {
    let ok: Bool
    let accepted_sync_id: String
    let health_daily_count: Int
    let idempotent: Bool
}

struct ReceiverHealthStatus: Codable {
    let status: String
    let device_count: Int
    let sync_count: Int
    let last_sync_at: String?
}

struct DeviceSummaryResponse: Codable {
    let device_id: String
    let device_name: String
    let device_platform: String
    let accepted_scopes: [String]
    let created_at: String
    let revoked_at: String?
    let last_sync_at: String?
    let sync_count: Int
}

struct DeviceRevokeResponse: Codable {
    let ok: Bool
    let device: DeviceSummaryResponse
}

enum GatewayError: LocalizedError {
    case healthKitUnavailable
    case healthPermissionRequired
    case missingServerURL
    case missingAPIToken
    case missingPairedDevice
    case invalidPairingURL
    case invalidServerResponse(Int)
    case receiverUnreachable
    case networkUnavailable
    case requestTimedOut

    var errorDescription: String? {
        switch self {
        case .healthKitUnavailable:
            return "HealthKit is not available on this device."
        case .healthPermissionRequired:
            return "Health permission is missing or denied. Open iOS Settings and allow VitalMCP to read selected Health data."
        case .missingServerURL:
            return "Server URL is not configured."
        case .missingAPIToken:
            return "API token is not configured."
        case .missingPairedDevice:
            return "Device is not paired."
        case .invalidPairingURL:
            return "Pairing URL is invalid."
        case .invalidServerResponse(let statusCode):
            if statusCode == 401 {
                return "Receiver rejected this device token. The token may be revoked; pair again."
            }
            if statusCode == 403 {
                return "Server rejected this request. Check device pairing and scopes."
            }
            return "Server returned HTTP \(statusCode)."
        case .receiverUnreachable:
            return "Receiver is not reachable. Make sure vitalmcp is running and this iPhone can reach the server URL."
        case .networkUnavailable:
            return "Network is unavailable. Check Wi-Fi or cellular connectivity."
        case .requestTimedOut:
            return "Sync timed out. Check that the receiver is online and reachable from this iPhone."
        }
    }

    static func fromURL(_ error: URLError) -> GatewayError {
        switch error.code {
        case .notConnectedToInternet, .networkConnectionLost, .dataNotAllowed, .internationalRoamingOff, .callIsActive:
            return .networkUnavailable
        case .cannotConnectToHost, .cannotFindHost, .dnsLookupFailed, .badServerResponse, .secureConnectionFailed, .appTransportSecurityRequiresSecureConnection:
            return .receiverUnreachable
        case .timedOut:
            return .requestTimedOut
        default:
            return .receiverUnreachable
        }
    }

    var syncFailureCategory: SyncFailureCategory {
        switch self {
        case .healthKitUnavailable, .healthPermissionRequired:
            return .healthPermissionMissing
        case .missingServerURL, .missingAPIToken, .missingPairedDevice, .invalidPairingURL:
            return .configuration
        case .invalidServerResponse(let statusCode):
            if statusCode == 401 {
                return .tokenRevoked
            }
            return .serverError
        case .receiverUnreachable:
            return .receiverUnreachable
        case .networkUnavailable:
            return .networkUnavailable
        case .requestTimedOut:
            return .requestTimedOut
        }
    }
}

extension DateFormatter {
    static let gatewayDate: DateFormatter = {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()
}

func canonicalJSONData<T: Encodable>(_ value: T) throws -> Data {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    return try encoder.encode(value)
}

extension Data {
    init(base64URLEncoded value: String) throws {
        guard !value.isEmpty,
              value.range(of: "^[A-Za-z0-9_-]+$", options: .regularExpression) != nil else {
            throw GatewayError.invalidPairingURL
        }
        var base64 = value
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        let padding = base64.count % 4
        if padding > 0 {
            base64 += String(repeating: "=", count: 4 - padding)
        }
        guard let data = Data(base64Encoded: base64) else {
            throw GatewayError.invalidPairingURL
        }
        self = data
    }

    func base64URLEncodedString() -> String {
        base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}

extension ISO8601DateFormatter {
    static let gatewayDateTime: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withColonSeparatorInTimeZone]
        return formatter
    }()

    static let gatewayDateTimeWithFractionalSeconds: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withColonSeparatorInTimeZone, .withFractionalSeconds]
        return formatter
    }()
}
