import SwiftUI

@main
struct HealthLinkApp: App {
    @StateObject private var settings = GatewaySettings()
    @StateObject private var syncCoordinator = SyncCoordinator()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(settings)
                .environmentObject(syncCoordinator)
        }
    }
}
