import Foundation

@MainActor
final class SyncCoordinator: ObservableObject {
    @Published private(set) var isSyncing = false
    @Published private(set) var status: SyncStatus = .empty
    @Published private(set) var latestHealthSummary: DailyHealthSummary?
    @Published private(set) var latestCalendarSummary: DailyCalendarSummary?

    private let healthService = HealthKitService()
    private let calendarService = CalendarService()

    func requestHealthAuthorization() async {
        await run {
            try await self.healthService.requestAuthorization()
        }
    }

    func requestCalendarAuthorization() async {
        await run {
            try await self.calendarService.requestAuthorization()
        }
    }

    func sync(settings: GatewaySettings, daysBack: Int = 1) async {
        await run {
            guard let serverURL = settings.serverURL else {
                throw GatewayError.missingServerURL
            }

            let token = settings.apiTokenText.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !token.isEmpty else {
                throw GatewayError.missingAPIToken
            }

            guard let deviceID = settings.pairedDeviceID else {
                throw GatewayError.missingPairedDevice
            }

            let client = GatewayAPIClient(serverURL: serverURL, apiToken: token)
            let dates = self.datesToSync(daysBack: daysBack)
            var healthSummaries: [DailyHealthSummary] = []
            var calendarSummaries: [DailyCalendarSummary] = []

            for date in dates {
                if settings.uploadHealthEnabled {
                    let healthSummary = try await self.healthService.buildDailySummary(for: date)
                    self.latestHealthSummary = healthSummary
                    healthSummaries.append(healthSummary)
                }

                if settings.uploadCalendarEnabled {
                    let calendarSummary = self.calendarService.buildDailySummary(for: date)
                    self.latestCalendarSummary = calendarSummary
                    calendarSummaries.append(calendarSummary)
                }
            }

            let payload = HealthSyncPayload(
                device_id: deviceID,
                sync_id: self.makeSyncID(),
                generated_at: ISO8601DateFormatter.gatewayDateTime.string(from: Date()),
                timezone: TimeZone.current.identifier,
                health_daily_summaries: healthSummaries,
                calendar_daily_summaries: calendarSummaries
            )

            _ = try await client.uploadHealthSync(payload)
            let syncedAt = Date()
            if !healthSummaries.isEmpty {
                self.status.lastHealthSyncAt = syncedAt
            }
            if !calendarSummaries.isEmpty {
                self.status.lastCalendarSyncAt = syncedAt
            }
        }
    }

    private func datesToSync(daysBack: Int) -> [Date] {
        let calendar = Calendar.current
        let today = calendar.startOfDay(for: Date())
        let clamped = max(0, min(daysBack, 14))
        return stride(from: clamped, through: 0, by: -1).compactMap {
            calendar.date(byAdding: .day, value: -$0, to: today)
        }
    }

    private func makeSyncID() -> String {
        "sync_\(UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased())"
    }

    private func run(_ operation: @escaping () async throws -> Void) async {
        isSyncing = true
        status.lastError = nil
        defer { isSyncing = false }

        do {
            try await operation()
        } catch {
            status.lastError = error.localizedDescription
        }
    }
}
