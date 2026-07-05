import BackgroundTasks
import Foundation

enum BackgroundSyncManager {
    static let appRefreshTaskIdentifier = "app.healthlink.ios.autosync"

    @MainActor
    static func scheduleAppRefresh(settings: GatewaySettings) {
        guard settings.autoSyncEnabled, settings.isPaired else {
            BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: appRefreshTaskIdentifier)
            return
        }

        let request = BGAppRefreshTaskRequest(identifier: appRefreshTaskIdentifier)
        request.earliestBeginDate = settings.nextEligibleAutoSyncAt ?? Date().addingTimeInterval(settings.autoSyncMinimumInterval)

        do {
            try BGTaskScheduler.shared.submit(request)
        } catch {
            settings.recordBackgroundScheduleError(error.localizedDescription)
        }
    }
}
