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

    static let empty = SyncStatus(lastHealthSyncAt: nil, lastCalendarSyncAt: nil, lastError: nil)
}

enum GatewayError: LocalizedError {
    case healthKitUnavailable
    case missingServerURL
    case missingAPIToken
    case invalidServerResponse(Int)

    var errorDescription: String? {
        switch self {
        case .healthKitUnavailable:
            return "HealthKit is not available on this device."
        case .missingServerURL:
            return "Server URL is not configured."
        case .missingAPIToken:
            return "API token is not configured."
        case .invalidServerResponse(let statusCode):
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
