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
                }
                .onChange(of: scenePhase) { _, phase in
                    guard phase == .active else {
                        return
                    }
                    Task {
                        await syncCoordinator.attemptAutoSync(settings: settings, reason: "foreground")
                    }
                }
        }
    }
}
