import Foundation

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
            return "Make sure the Agent receiver is running and this iPhone can reach the saved server URL."
        case .tokenRevoked:
            return "Pair this iPhone with the Agent again to receive a fresh device token."
        case .healthPermissionMissing:
            return "Open iOS Settings and allow HealthLink to read the selected Health data."
        case .networkUnavailable:
            return "Check Wi-Fi or cellular connectivity, then retry sync."
        case .requestTimedOut:
            return "Keep the Agent receiver online and retry when the network is stable."
        case .serverError:
            return "Check the Agent receiver logs, then retry sync."
        case .configuration:
            return "Scan a pairing QR or complete the saved server and token settings."
        case .unknown:
            return "Retry sync. If it keeps failing, check the Agent receiver status."
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

struct PairingLink {
    let serverURL: URL
    let pairingCode: String

    init(rawValue: String) throws {
        let trimmed = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let components = URLComponents(string: trimmed),
              components.scheme == "healthlink",
              components.host == "pair" else {
            throw GatewayError.invalidPairingURL
        }

        let queryItems = components.queryItems ?? []
        let serverValue = queryItems.first { $0.name == "server" }?.value
        let codeValue = queryItems.first { $0.name == "code" }?.value

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

        self.serverURL = serverURL
        self.pairingCode = codeValue.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
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

struct HealthSyncPayload: Codable {
    let device_id: String
    let sync_id: String
    let generated_at: String
    let timezone: String
    let health_daily_summaries: [DailyHealthSummary]
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
            return "Health permission is missing or denied. Open iOS Settings and allow HealthLink to read selected Health data."
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
            return "Receiver is not reachable. Make sure HealthLink Local is running and this iPhone can reach the server URL."
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

extension ISO8601DateFormatter {
    static let gatewayDateTime: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withColonSeparatorInTimeZone]
        return formatter
    }()
}
