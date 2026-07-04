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

            let client = GatewayAPIClient(serverURL: serverURL, apiToken: token)
            let dates = self.datesToSync(daysBack: daysBack)

            for date in dates {
                if settings.uploadHealthEnabled {
                    let healthSummary = try await self.healthService.buildDailySummary(for: date)
                    self.latestHealthSummary = healthSummary
                    try await client.uploadHealthSummary(healthSummary)
                    self.status.lastHealthSyncAt = Date()
                }

                if settings.uploadCalendarEnabled {
                    let calendarSummary = self.calendarService.buildDailySummary(for: date)
                    self.latestCalendarSummary = calendarSummary
                    try await client.uploadCalendarSummary(calendarSummary)
                    self.status.lastCalendarSyncAt = Date()
                }
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
