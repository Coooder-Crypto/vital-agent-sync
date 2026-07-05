import Foundation

@MainActor
final class SyncCoordinator: ObservableObject {
    @Published private(set) var isSyncing = false
    @Published private(set) var status: SyncStatus = .empty
    @Published private(set) var latestHealthSummary: DailyHealthSummary?
    @Published private(set) var latestCalendarSummary: DailyCalendarSummary?

    private let healthService = HealthKitService()
    private let calendarService = CalendarService()

    enum SyncTrigger {
        case manual
        case automatic(reason: String)
    }

    func requestHealthAuthorization(settings: GatewaySettings? = nil) async {
        let succeeded = await run {
            do {
                try await self.healthService.requestAuthorization()
            } catch GatewayError.healthKitUnavailable {
                throw GatewayError.healthKitUnavailable
            } catch {
                throw GatewayError.healthPermissionRequired
            }
            self.status.lastSuccessMessage = "Health permission request completed"
        }
        if succeeded, let settings {
            await attemptAutoSync(settings: settings, reason: "health_permission")
        }
    }

    func requestCalendarAuthorization(settings: GatewaySettings? = nil) async {
        let succeeded = await run {
            do {
                try await self.calendarService.requestAuthorization()
            } catch {
                throw GatewayError.calendarPermissionRequired
            }
            self.status.lastSuccessMessage = "Calendar permission granted"
        }
        if succeeded, let settings {
            await attemptAutoSync(settings: settings, reason: "calendar_permission")
        }
    }

    @discardableResult
    func sync(settings: GatewaySettings, daysBack: Int = 1, trigger: SyncTrigger = .manual) async -> Bool {
        settings.recordSyncAttempt()
        let succeeded = await run {
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
                    let healthSummary: DailyHealthSummary
                    do {
                        healthSummary = try await self.healthService.buildDailySummary(for: date)
                    } catch GatewayError.healthKitUnavailable {
                        throw GatewayError.healthKitUnavailable
                    } catch {
                        throw GatewayError.healthPermissionRequired
                    }
                    self.latestHealthSummary = healthSummary
                    healthSummaries.append(healthSummary)
                }

                if settings.uploadCalendarEnabled {
                    let calendarSummary: DailyCalendarSummary
                    do {
                        calendarSummary = try self.calendarService.buildDailySummary(for: date)
                    } catch {
                        throw GatewayError.calendarPermissionRequired
                    }
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

            let response = try await client.uploadHealthSync(payload)
            let syncedAt = Date()
            if !healthSummaries.isEmpty {
                self.status.lastHealthSyncAt = syncedAt
            }
            if !calendarSummaries.isEmpty {
                self.status.lastCalendarSyncAt = syncedAt
            }
            self.status.lastSuccessMessage = self.successMessage(
                response: response,
                trigger: trigger
            )
        }

        switch trigger {
        case .manual:
            settings.recordManualSyncResult(success: succeeded, error: status.lastError)
        case .automatic:
            settings.recordAutoSyncResult(success: succeeded, error: status.lastError)
        }

        return succeeded
    }

    func attemptAutoSync(settings: GatewaySettings, reason: String) async {
        guard settings.canAttemptAutoSync(), !isSyncing else {
            return
        }

        await sync(settings: settings, trigger: .automatic(reason: reason))
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

    private func successMessage(response: HealthSyncResponse, trigger: SyncTrigger) -> String {
        let prefix: String
        switch trigger {
        case .manual:
            prefix = "Uploaded"
        case .automatic(let reason):
            prefix = "Auto sync (\(reason)) uploaded"
        }
        return "\(prefix) \(response.health_daily_count) health / \(response.calendar_daily_count) calendar"
    }

    @discardableResult
    private func run(_ operation: @escaping () async throws -> Void) async -> Bool {
        isSyncing = true
        status.lastError = nil
        status.lastSuccessMessage = nil
        defer { isSyncing = false }

        do {
            try await operation()
            return true
        } catch {
            status.lastError = error.localizedDescription
            return false
        }
    }
}
