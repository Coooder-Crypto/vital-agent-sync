import Foundation

@MainActor
final class SyncCoordinator: ObservableObject {
    @Published private var state = SyncCoordinatorState()

    var isSyncing: Bool { state.isSyncing }
    var status: SyncStatus { state.status }
    var latestHealthSummary: DailyHealthSummary? { state.latestHealthSummary }

    private let healthService = HealthKitService()
    private var contextGeneration = UUID()

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
        let attemptedAt = Date()
        var attemptedContext: SyncRequestContext?
        let operationGeneration = contextGeneration

        do {
            let context = try SyncRequestContext(settings: settings, daysBack: daysBack)
            attemptedContext = context
            beginOperation()

            let healthSummaries = try await buildHealthSummaries(context: context)
            guard operationGeneration == contextGeneration else {
                return false
            }
            let request = try makeHealthSyncRequest(healthSummaries, context: context, settings: settings)
            let uploadResult = try await uploadHealthSyncRequest(request)
            guard operationGeneration == contextGeneration else {
                return false
            }
            let response = uploadResult.response
            let latestSummary = healthSummaries.last
            let syncedAt = Date()
            let detail = LastSyncDetail(
                attemptedAt: attemptedAt,
                completedAt: syncedAt,
                trigger: trigger.displayName,
                serverURL: context.displayServerURL,
                agentName: context.agentName,
                requestedDateRange: context.dateRangeDescription,
                uploadedDayCount: response.health_daily_count,
                acceptedSyncID: response.accepted_sync_id,
                isIdempotent: response.idempotent,
                deliveryState: uploadResult.deliveryState,
                failureCategory: nil,
                failureMessage: nil
            )

            finishOperation { state in
                if let latestSummary {
                    state.latestHealthSummary = latestSummary
                    state.status.lastHealthSyncAt = syncedAt
                }
                state.status.lastSuccessMessage = self.successMessage(
                    response: response,
                    trigger: trigger,
                    deliveryState: uploadResult.deliveryState
                )
                state.status.lastSyncDetail = detail
            }
            settings.recordSyncDetail(detail)
            syncError = nil
        } catch {
            guard operationGeneration == contextGeneration else {
                return false
            }
            let category = Self.failureCategory(for: error)
            let message = error.localizedDescription
            let detail = LastSyncDetail(
                attemptedAt: attemptedAt,
                completedAt: nil,
                trigger: trigger.displayName,
                serverURL: attemptedContext?.displayServerURL ?? settings.serverURL?.absoluteString,
                agentName: attemptedContext?.agentName ?? settings.pairedAgentName,
                requestedDateRange: attemptedContext?.dateRangeDescription,
                uploadedDayCount: 0,
                acceptedSyncID: nil,
                isIdempotent: nil,
                deliveryState: nil,
                failureCategory: category,
                failureMessage: message
            )
            finishOperation { state in
                state.status.lastError = message
                state.status.lastSyncDetail = detail
            }
            settings.recordSyncDetail(detail)
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

    func reset() {
        contextGeneration = UUID()
        state = SyncCoordinatorState()
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

    private func makeHealthSyncRequest(
        _ healthSummaries: [DailyHealthSummary],
        context: SyncRequestContext,
        settings: GatewaySettings
    ) throws -> HealthSyncRequest {
        let payload = HealthSyncPayload(
            device_id: context.deviceID,
            sync_id: makeSyncID(),
            generated_at: ISO8601DateFormatter.gatewayDateTime.string(from: Date()),
            timezone: TimeZone.current.identifier,
            health_daily_summaries: healthSummaries
        )
        if let relayOnboarding = context.relayOnboarding {
            guard let relayURL = URL(string: relayOnboarding.relay_url) else {
                throw GatewayError.missingServerURL
            }
            let envelope = try RelayCrypto.encrypt(
                payload: payload,
                onboarding: relayOnboarding,
                sequence: settings.nextRelayEnvelopeSequence()
            )
            return .relay(
                relayURL: relayURL,
                relayAccessToken: relayOnboarding.relay_access_token,
                relayAPIToken: relayOnboarding.relay_api_token,
                envelope: envelope,
                localResponse: HealthSyncResponse(
                ok: true,
                accepted_sync_id: payload.sync_id,
                health_daily_count: payload.health_daily_summaries.count,
                idempotent: false
                )
            )
        }
        guard let serverURL = context.serverURL,
              let apiToken = context.apiToken else {
            throw GatewayError.missingServerURL
        }
        return .direct(client: GatewayAPIClient(serverURL: serverURL, apiToken: apiToken), payload: payload)
    }

    private func uploadHealthSyncRequest(_ request: HealthSyncRequest) async throws -> SyncUploadResult {
        switch request {
        case .direct(let client, let payload):
            return SyncUploadResult(
                response: try await client.uploadHealthSync(payload),
                deliveryState: .receiverAccepted
            )
        case .relay(let relayURL, let relayAccessToken, let relayAPIToken, let envelope, let localResponse):
            _ = try await GatewayAPIClient.uploadRelayEnvelope(
                envelope,
                relayURL: relayURL,
                relayAccessToken: relayAccessToken,
                relayAPIToken: relayAPIToken
            )
            return SyncUploadResult(response: localResponse, deliveryState: .relayQueued)
        }
    }

    private func successMessage(
        response: HealthSyncResponse,
        trigger: SyncTrigger,
        deliveryState: SyncDeliveryState
    ) -> String {
        let count = response.health_daily_count
        switch (trigger, deliveryState) {
        case (.manual, .receiverAccepted):
            return String.localizedStringWithFormat(
                NSLocalizedString("Receiver accepted %lld Health summaries", comment: ""),
                count
            )
        case (.manual, .relayQueued):
            return String.localizedStringWithFormat(
                NSLocalizedString("Relay queued %lld encrypted Health summaries", comment: ""),
                count
            )
        case (.automatic(let reason), .receiverAccepted):
            return String.localizedStringWithFormat(
                NSLocalizedString("Auto sync (%@): receiver accepted %lld Health summaries", comment: ""),
                reason,
                count
            )
        case (.automatic(let reason), .relayQueued):
            return String.localizedStringWithFormat(
                NSLocalizedString("Auto sync (%@): relay queued %lld encrypted Health summaries", comment: ""),
                reason,
                count
            )
        }
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

    private static func failureCategory(for error: Error) -> SyncFailureCategory {
        if let gatewayError = error as? GatewayError {
            return gatewayError.syncFailureCategory
        }
        return .unknown
    }

    private struct SyncCoordinatorState {
        var isSyncing = false
        var status: SyncStatus = .empty
        var latestHealthSummary: DailyHealthSummary?
    }

    private struct SyncRequestContext {
        let serverURL: URL?
        let apiToken: String?
        let deviceID: String
        let agentName: String?
        let uploadHealthEnabled: Bool
        let dates: [Date]
        let relayOnboarding: RelayOnboardingPayload?

        @MainActor
        init(settings: GatewaySettings, daysBack: Int) throws {
            if let relayOnboarding = settings.relayOnboarding {
                self.serverURL = URL(string: relayOnboarding.relay_url)
                self.apiToken = nil
                self.deviceID = relayOnboarding.source_device_id
                self.agentName = relayOnboarding.agent_name
                self.uploadHealthEnabled = settings.uploadHealthEnabled
                self.dates = Self.datesToSync(daysBack: daysBack)
                self.relayOnboarding = relayOnboarding
                return
            }

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
            self.agentName = settings.pairedAgentName
            self.uploadHealthEnabled = settings.uploadHealthEnabled
            self.dates = Self.datesToSync(daysBack: daysBack)
            self.relayOnboarding = nil
        }

        var dateRangeDescription: String? {
            guard let first = dates.first,
                  let last = dates.last else {
                return nil
            }
            let start = DateFormatter.gatewayDate.string(from: first)
            let end = DateFormatter.gatewayDate.string(from: last)
            return start == end ? start : "\(start) - \(end)"
        }

        var displayServerURL: String? {
            serverURL?.absoluteString ?? relayOnboarding?.relay_url
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

    private enum HealthSyncRequest {
        case direct(client: GatewayAPIClient, payload: HealthSyncPayload)
        case relay(
            relayURL: URL,
            relayAccessToken: String,
            relayAPIToken: String?,
            envelope: RelayEncryptedEnvelope,
            localResponse: HealthSyncResponse
        )
    }

    private struct SyncUploadResult {
        let response: HealthSyncResponse
        let deliveryState: SyncDeliveryState
    }
}

private extension SyncCoordinator.SyncTrigger {
    var displayName: String {
        switch self {
        case .manual:
            return "Manual"
        case .automatic(let reason):
            return "Auto: \(reason)"
        }
    }
}
