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
    let workout_minutes: Int?
    let workouts: [WorkoutSummary]
}

struct FreeWindow: Codable, Identifiable {
    var id: String { "\(start)-\(end)" }

    let start: String
    let end: String
}

struct RedactedCalendarEvent: Codable {
    let starts_at: String
    let duration_minutes: Int
    let title_redacted: Bool
}

struct DailyCalendarSummary: Codable, Identifiable {
    var id: String { date }

    let date: String
    let timezone: String
    let provider: String
    let busy_minutes: Int
    let free_windows: [FreeWindow]
    let next_event: RedactedCalendarEvent?
}

struct SyncStatus: Codable {
    var lastHealthSyncAt: Date?
    var lastCalendarSyncAt: Date?
    var lastError: String?
    var lastSuccessMessage: String?

    static let empty = SyncStatus(
        lastHealthSyncAt: nil,
        lastCalendarSyncAt: nil,
        lastError: nil,
        lastSuccessMessage: nil
    )
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
    let calendar_daily_summaries: [DailyCalendarSummary]
}

struct HealthSyncResponse: Codable {
    let ok: Bool
    let accepted_sync_id: String
    let health_daily_count: Int
    let calendar_daily_count: Int
    let idempotent: Bool
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
    case missingServerURL
    case missingAPIToken
    case missingPairedDevice
    case invalidPairingURL
    case invalidServerResponse(Int)

    var errorDescription: String? {
        switch self {
        case .healthKitUnavailable:
            return "HealthKit is not available on this device."
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
                return "Server rejected this device token. Pair again."
            }
            if statusCode == 403 {
                return "Server rejected this request. Check device pairing and scopes."
            }
            return "Server returned HTTP \(statusCode)."
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
