import Foundation

@MainActor
final class SyncCoordinator: ObservableObject {
    @Published private var state = SyncCoordinatorState()

    var isSyncing: Bool { state.isSyncing }
    var status: SyncStatus { state.status }
    var latestHealthSummary: DailyHealthSummary? { state.latestHealthSummary }
    var progress: SyncProgress? { state.progress }

    private let healthService = HealthKitService()
    private var contextGeneration = UUID()

    enum SyncTrigger {
        case manual
        case automatic(reason: String)
    }

    private enum SyncScope {
        case recent(dayCount: Int)
        case allHistory

        var initialProgress: SyncProgress {
            switch self {
            case .recent(let dayCount):
                return SyncProgress(
                    completedDays: 0,
                    totalDays: max(1, dayCount),
                    currentDateRange: nil
                )
            case .allHistory:
                return SyncProgress(completedDays: 0, totalDays: nil, currentDateRange: nil)
            }
        }
    }

    func requestHealthAuthorization(settings: GatewaySettings? = nil) async {
        beginOperation()
        let succeeded: Bool
        do {
            do {
                try await healthService.requestAuthorization()
            } catch GatewayError.healthKitUnavailable {
                throw GatewayError.healthKitUnavailable
            } catch {
                throw GatewayError.healthPermissionRequired
            }
            finishOperation { state in
                state.status.lastSuccessMessage = String(localized: "Health permission request completed")
            }
            succeeded = true
        } catch {
            finishOperation { state in
                state.status.lastError = error.localizedDescription
            }
            succeeded = false
        }

        if succeeded, let settings {
            await syncConfiguredHistory(settings: settings, reason: "health_permission")
        }
    }

    @discardableResult
    func sync(
        settings: GatewaySettings,
        daysBack: Int = 1,
        trigger: SyncTrigger = .manual
    ) async -> Bool {
        await performSync(
            settings: settings,
            scope: .recent(dayCount: max(1, daysBack + 1)),
            trigger: trigger
        )
    }

    @discardableResult
    func syncHistory(
        settings: GatewaySettings,
        range: SyncHistoryRange,
        trigger: SyncTrigger = .manual
    ) async -> Bool {
        let scope = range.dayCount.map(SyncScope.recent(dayCount:)) ?? .allHistory
        return await performSync(settings: settings, scope: scope, trigger: trigger)
    }

    @discardableResult
    func syncConfiguredHistory(settings: GatewaySettings, reason: String) async -> Bool {
        await syncHistory(
            settings: settings,
            range: settings.syncHistoryRange,
            trigger: .automatic(reason: reason)
        )
    }

    func cancelCurrentSync() {
        guard isSyncing else {
            return
        }
        contextGeneration = UUID()
        var next = state
        next.isSyncing = false
        next.progress = nil
        next.status.lastError = nil
        next.status.lastSuccessMessage = String(localized: "Sync cancelled")
        state = next
    }

    func reset() {
        contextGeneration = UUID()
        state = SyncCoordinatorState()
    }

    func attemptAutoSync(settings: GatewaySettings, reason: String) async {
        guard settings.canAttemptAutoSync(), !isSyncing else {
            return
        }

        await sync(
            settings: settings,
            daysBack: 1,
            trigger: .automatic(reason: reason)
        )
    }

    private func performSync(
        settings: GatewaySettings,
        scope: SyncScope,
        trigger: SyncTrigger
    ) async -> Bool {
        guard !isSyncing else {
            return false
        }

        settings.recordSyncAttempt()
        let attemptedAt = Date()
        let operationGeneration = UUID()
        contextGeneration = operationGeneration
        beginOperation(progress: scope.initialProgress)

        var attemptedContext: SyncRequestContext?
        var requestedDateRange: String?
        var uploadedDayCount = 0
        var latestAcceptedSyncID: String?
        var combinedIdempotent: Bool?
        var latestDeliveryState: SyncDeliveryState?

        do {
            let context = try SyncRequestContext(settings: settings)
            attemptedContext = context
            let dates = try await resolveDates(
                scope: scope,
                uploadHealthEnabled: context.uploadHealthEnabled
            )
            guard isCurrent(operationGeneration) else {
                return false
            }

            requestedDateRange = SyncDatePlanner.dateRangeDescription(dates)
            let totalDays = context.uploadHealthEnabled ? dates.count : 0
            updateProgress(
                SyncProgress(
                    completedDays: 0,
                    totalDays: totalDays,
                    currentDateRange: nil
                )
            )

            let dateBatches: [[Date]] = context.uploadHealthEnabled
                ? SyncDatePlanner.batches(dates)
                : [[]]
            var latestSummary: DailyHealthSummary?
            var processedDayCount = 0

            for dateBatch in dateBatches {
                let healthSummaries = try await buildHealthSummaries(
                    dates: dateBatch,
                    uploadHealthEnabled: context.uploadHealthEnabled
                )
                guard isCurrent(operationGeneration) else {
                    return false
                }

                updateProgress(
                    SyncProgress(
                        completedDays: processedDayCount,
                        totalDays: totalDays,
                        currentDateRange: SyncDatePlanner.dateRangeDescription(dateBatch)
                    )
                )

                let request = try makeHealthSyncRequest(
                    healthSummaries,
                    context: context,
                    settings: settings
                )
                let uploadResult = try await uploadHealthSyncRequest(request)
                guard isCurrent(operationGeneration) else {
                    return false
                }

                uploadedDayCount += uploadResult.response.health_daily_count
                latestAcceptedSyncID = uploadResult.response.accepted_sync_id
                latestDeliveryState = uploadResult.deliveryState
                if let currentIdempotent = combinedIdempotent {
                    combinedIdempotent = currentIdempotent && uploadResult.response.idempotent
                } else {
                    combinedIdempotent = uploadResult.response.idempotent
                }
                latestSummary = healthSummaries.last ?? latestSummary
                processedDayCount += dateBatch.count

                updateProgress(
                    SyncProgress(
                        completedDays: processedDayCount,
                        totalDays: totalDays,
                        currentDateRange: SyncDatePlanner.dateRangeDescription(dateBatch)
                    )
                )
            }

            guard let acceptedSyncID = latestAcceptedSyncID,
                  let deliveryState = latestDeliveryState else {
                throw SyncCoordinatorError.missingUploadResponse
            }

            let syncedAt = Date()
            let detail = LastSyncDetail(
                attemptedAt: attemptedAt,
                completedAt: syncedAt,
                trigger: trigger.displayName,
                serverURL: context.displayServerURL,
                agentName: context.agentName,
                requestedDateRange: requestedDateRange,
                uploadedDayCount: uploadedDayCount,
                acceptedSyncID: acceptedSyncID,
                isIdempotent: combinedIdempotent,
                deliveryState: deliveryState,
                failureCategory: nil,
                failureMessage: nil
            )

            finishOperation { state in
                if let latestSummary {
                    state.latestHealthSummary = latestSummary
                    state.status.lastHealthSyncAt = syncedAt
                }
                state.status.lastSuccessMessage = self.successMessage(
                    count: uploadedDayCount,
                    trigger: trigger,
                    deliveryState: deliveryState
                )
                state.status.lastSyncDetail = detail
            }
            settings.recordSyncDetail(detail)
            recordResult(settings: settings, trigger: trigger, success: true, error: nil)
            return true
        } catch {
            guard isCurrent(operationGeneration) else {
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
                requestedDateRange: requestedDateRange,
                uploadedDayCount: uploadedDayCount,
                acceptedSyncID: nil,
                isIdempotent: nil,
                deliveryState: latestDeliveryState,
                failureCategory: category,
                failureMessage: message
            )
            finishOperation { state in
                state.status.lastError = message
                state.status.lastSyncDetail = detail
            }
            settings.recordSyncDetail(detail)
            recordResult(settings: settings, trigger: trigger, success: false, error: message)
            return false
        }
    }

    private func resolveDates(
        scope: SyncScope,
        uploadHealthEnabled: Bool
    ) async throws -> [Date] {
        switch scope {
        case .recent(let dayCount):
            return SyncDatePlanner.recentDates(dayCount: dayCount)
        case .allHistory:
            guard uploadHealthEnabled else {
                return SyncDatePlanner.recentDates(dayCount: 1)
            }
            do {
                let earliestDate = try await healthService.earliestAvailableSampleDate() ?? Date()
                return SyncDatePlanner.allDates(startingAt: earliestDate)
            } catch GatewayError.healthKitUnavailable {
                throw GatewayError.healthKitUnavailable
            } catch {
                throw GatewayError.healthPermissionRequired
            }
        }
    }

    private func buildHealthSummaries(
        dates: [Date],
        uploadHealthEnabled: Bool
    ) async throws -> [DailyHealthSummary] {
        guard uploadHealthEnabled else {
            return []
        }

        do {
            return try await healthService.buildDailySummaries(for: dates)
        } catch GatewayError.healthKitUnavailable {
            throw GatewayError.healthKitUnavailable
        } catch {
            throw GatewayError.healthPermissionRequired
        }
    }

    private func makeSyncID() -> String {
        "sync_\(UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased())"
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
              let apiToken = context.apiToken,
              let directTransportPublicKey = context.directTransportPublicKey else {
            throw GatewayError.missingServerURL
        }
        return .direct(
            client: GatewayAPIClient(
                serverURL: serverURL,
                apiToken: apiToken,
                directTransportPublicKey: directTransportPublicKey
            ),
            payload: payload
        )
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
        count: Int,
        trigger: SyncTrigger,
        deliveryState: SyncDeliveryState
    ) -> String {
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

    private func recordResult(
        settings: GatewaySettings,
        trigger: SyncTrigger,
        success: Bool,
        error: String?
    ) {
        switch trigger {
        case .manual:
            settings.recordManualSyncResult(success: success, error: error)
        case .automatic:
            settings.recordAutoSyncResult(success: success, error: error)
        }
    }

    private func isCurrent(_ generation: UUID) -> Bool {
        generation == contextGeneration && !Task.isCancelled
    }

    private func beginOperation(progress: SyncProgress? = nil) {
        var next = state
        next.isSyncing = true
        next.progress = progress
        next.status.lastError = nil
        next.status.lastSuccessMessage = nil
        state = next
    }

    private func updateProgress(_ progress: SyncProgress) {
        var next = state
        next.progress = progress
        state = next
    }

    private func finishOperation(_ update: (inout SyncCoordinatorState) -> Void) {
        var next = state
        next.isSyncing = false
        next.progress = nil
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
        var progress: SyncProgress?
    }

    private struct SyncRequestContext {
        let serverURL: URL?
        let apiToken: String?
        let directTransportPublicKey: String?
        let deviceID: String
        let agentName: String?
        let uploadHealthEnabled: Bool
        let relayOnboarding: RelayOnboardingPayload?

        @MainActor
        init(settings: GatewaySettings) throws {
            if let relayOnboarding = settings.relayOnboarding {
                self.serverURL = URL(string: relayOnboarding.relay_url)
                self.apiToken = nil
                self.directTransportPublicKey = nil
                self.deviceID = relayOnboarding.source_device_id
                self.agentName = relayOnboarding.agent_name
                self.uploadHealthEnabled = settings.uploadHealthEnabled
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
            guard let directTransportPublicKey = settings.directTransportPublicKey else {
                throw GatewayError.invalidPairingURL
            }
            self.serverURL = serverURL
            self.apiToken = token
            self.directTransportPublicKey = directTransportPublicKey
            self.deviceID = deviceID
            self.agentName = settings.pairedAgentName
            self.uploadHealthEnabled = settings.uploadHealthEnabled
            self.relayOnboarding = nil
        }

        var displayServerURL: String? {
            serverURL?.absoluteString ?? relayOnboarding?.relay_url
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

    private enum SyncCoordinatorError: LocalizedError {
        case missingUploadResponse

        var errorDescription: String? {
            String(localized: "Sync completed without an upload response.")
        }
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
