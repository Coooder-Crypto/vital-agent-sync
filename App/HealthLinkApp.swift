import SwiftUI

@main
struct HealthLinkApp: App {
    @Environment(\.scenePhase) private var scenePhase

    @StateObject private var settings = GatewaySettings()
    @StateObject private var syncCoordinator = SyncCoordinator()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(settings)
                .environmentObject(syncCoordinator)
                .task {
                    await syncCoordinator.attemptAutoSync(settings: settings, reason: "app_launch")
                    BackgroundSyncManager.scheduleAppRefresh(settings: settings)
                }
                .onChange(of: scenePhase) { _, phase in
                    switch phase {
                    case .active:
                        Task {
                            await syncCoordinator.attemptAutoSync(settings: settings, reason: "foreground")
                            BackgroundSyncManager.scheduleAppRefresh(settings: settings)
                        }
                    case .background:
                        Task {
                            await syncCoordinator.attemptAutoSync(settings: settings, reason: "background")
                            BackgroundSyncManager.scheduleAppRefresh(settings: settings)
                        }
                    case .inactive:
                        BackgroundSyncManager.scheduleAppRefresh(settings: settings)
                    @unknown default:
                        BackgroundSyncManager.scheduleAppRefresh(settings: settings)
                    }
                }
        }
        .backgroundTask(.appRefresh(BackgroundSyncManager.appRefreshTaskIdentifier)) {
            await BackgroundSyncManager.scheduleAppRefresh(settings: settings)
            await syncCoordinator.attemptAutoSync(settings: settings, reason: "bg_app_refresh")
            await BackgroundSyncManager.scheduleAppRefresh(settings: settings)
        }
    }
}
