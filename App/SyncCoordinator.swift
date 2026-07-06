import Foundation

@MainActor
final class SyncCoordinator: ObservableObject {
    @Published private var state = SyncCoordinatorState()

    var isSyncing: Bool { state.isSyncing }
    var status: SyncStatus { state.status }
    var latestHealthSummary: DailyHealthSummary? { state.latestHealthSummary }

    private let healthService = HealthKitService()

    enum SyncTrigger {
        case manual
        case automatic(reason: String)
    }

    func requestHealthAuthorization(settings: GatewaySettings? = nil) async {
        beginOperation()
        let succeeded: Bool
        do {
            do {
                try await self.healthService.requestAuthorization()
            } catch GatewayError.healthKitUnavailable {
                throw GatewayError.healthKitUnavailable
            } catch {
                throw GatewayError.healthPermissionRequired
            }
            finishOperation { state in
                state.status.lastSuccessMessage = "Health permission request completed"
            }
            succeeded = true
        } catch {
            finishOperation { state in
                state.status.lastError = error.localizedDescription
            }
            succeeded = false
        }

        if succeeded, let settings {
            await attemptAutoSync(settings: settings, reason: "health_permission")
        }
    }

    @discardableResult
    func sync(settings: GatewaySettings, daysBack: Int = 1, trigger: SyncTrigger = .manual) async -> Bool {
        settings.recordSyncAttempt()
        let syncError: String?

        do {
            let context = try SyncRequestContext(settings: settings, daysBack: daysBack)
            beginOperation()

            let healthSummaries = try await buildHealthSummaries(context: context)
            let response = try await uploadHealthSummaries(healthSummaries, context: context)
            let latestSummary = healthSummaries.last
            let syncedAt = Date()

            finishOperation { state in
                if let latestSummary {
                    state.latestHealthSummary = latestSummary
                    state.status.lastHealthSyncAt = syncedAt
                }
                state.status.lastSuccessMessage = self.successMessage(response: response, trigger: trigger)
            }
            syncError = nil
        } catch {
            finishOperation { state in
                state.status.lastError = error.localizedDescription
            }
            syncError = self.status.lastError
        }

        switch trigger {
        case .manual:
            settings.recordManualSyncResult(success: syncError == nil, error: syncError)
        case .automatic:
            settings.recordAutoSyncResult(success: syncError == nil, error: syncError)
        }

        return syncError == nil
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

    private func buildHealthSummaries(context: SyncRequestContext) async throws -> [DailyHealthSummary] {
        guard context.uploadHealthEnabled else {
            return []
        }

        var healthSummaries: [DailyHealthSummary] = []
        healthSummaries.reserveCapacity(context.dates.count)

        for date in context.dates {
            do {
                healthSummaries.append(try await healthService.buildDailySummary(for: date))
            } catch GatewayError.healthKitUnavailable {
                throw GatewayError.healthKitUnavailable
            } catch {
                throw GatewayError.healthPermissionRequired
            }
        }

        return healthSummaries
    }

    private func uploadHealthSummaries(_ healthSummaries: [DailyHealthSummary], context: SyncRequestContext) async throws -> HealthSyncResponse {
        let client = GatewayAPIClient(serverURL: context.serverURL, apiToken: context.apiToken)
        let payload = HealthSyncPayload(
            device_id: context.deviceID,
            sync_id: makeSyncID(),
            generated_at: ISO8601DateFormatter.gatewayDateTime.string(from: Date()),
            timezone: TimeZone.current.identifier,
            health_daily_summaries: healthSummaries
        )
        return try await client.uploadHealthSync(payload)
    }

    private func successMessage(response: HealthSyncResponse, trigger: SyncTrigger) -> String {
        let prefix: String
        switch trigger {
        case .manual:
            prefix = "Uploaded"
        case .automatic(let reason):
            prefix = "Auto sync (\(reason)) uploaded"
        }
        return "\(prefix) \(response.health_daily_count) health"
    }

    private func beginOperation() {
        var next = state
        next.isSyncing = true
        next.status.lastError = nil
        next.status.lastSuccessMessage = nil
        state = next
    }

    private func finishOperation(_ update: (inout SyncCoordinatorState) -> Void) {
        var next = state
        next.isSyncing = false
        update(&next)
        state = next
    }

    private struct SyncCoordinatorState {
        var isSyncing = false
        var status: SyncStatus = .empty
        var latestHealthSummary: DailyHealthSummary?
    }

    private struct SyncRequestContext {
        let serverURL: URL
        let apiToken: String
        let deviceID: String
        let uploadHealthEnabled: Bool
        let dates: [Date]

        @MainActor
        init(settings: GatewaySettings, daysBack: Int) throws {
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

            self.serverURL = serverURL
            self.apiToken = token
            self.deviceID = deviceID
            self.uploadHealthEnabled = settings.uploadHealthEnabled
            self.dates = Self.datesToSync(daysBack: daysBack)
        }

        private static func datesToSync(daysBack: Int) -> [Date] {
            let calendar = Calendar.current
            let today = calendar.startOfDay(for: Date())
            let clamped = max(0, min(daysBack, 14))
            return stride(from: clamped, through: 0, by: -1).compactMap {
                calendar.date(byAdding: .day, value: -$0, to: today)
            }
        }
    }
}
