import SwiftUI

@main
struct HealthLinkApp: App {
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.openURL) private var openURL

    @StateObject private var settings = GatewaySettings()
    @StateObject private var syncCoordinator = SyncCoordinator()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(settings)
                .environmentObject(syncCoordinator)
                .preferredColorScheme(settings.appTheme.colorScheme)
                .environment(\.locale, settings.appLanguage.locale)
                .onOpenURL { url in
                    Task {
                        if url.scheme == "healthlink", url.host == "sync" {
                            let link = Self.syncDeepLink(from: url)
                            let succeeded = await syncCoordinator.sync(settings: settings, trigger: .automatic(reason: "deep_link"))
                            openSafeCallback(link.callbackURL, requestID: link.requestID, status: succeeded ? "ok" : "failed")
                            return
                        }
                        if url.scheme == "healthlink", url.host == "status" {
                            let link = Self.syncDeepLink(from: url)
                            openSafeCallback(link.callbackURL, requestID: link.requestID, status: settings.isPaired ? "paired" : "unpaired")
                            return
                        }
                        await settings.preparePairing(rawValue: Self.pairingValue(from: url))
                    }
                }
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

    private static func pairingValue(from url: URL) -> String {
        guard url.scheme == "healthlink",
              url.host == "onboard",
              let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let payload = components.queryItems?.first(where: { $0.name == "payload" })?.value,
              !payload.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return url.absoluteString
        }
        return payload
    }

    private static func syncDeepLink(from url: URL) -> SyncDeepLink {
        let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        return SyncDeepLink(
            requestID: components?.queryItems?.first(where: { $0.name == "request_id" })?.value,
            callbackURL: components?.queryItems?.first(where: { $0.name == "callback" })?.value
        )
    }

    @MainActor
    private func openSafeCallback(_ rawCallbackURL: String?, requestID: String?, status: String) {
        guard let callbackURL = HealthLinkCallbackPolicy.safeCallbackURL(
            rawCallbackURL: rawCallbackURL,
            requestID: requestID,
            status: status
        ) else {
            return
        }
        openURL(callbackURL)
    }

    private struct SyncDeepLink {
        let requestID: String?
        let callbackURL: String?
    }
}

private extension AppTheme {
    var colorScheme: ColorScheme? {
        switch self {
        case .system:
            return nil
        case .light:
            return .light
        case .dark:
            return .dark
        }
    }
}

private extension AppLanguage {
    var locale: Locale {
        switch self {
        case .system:
            return .current
        case .english:
            return Locale(identifier: "en")
        case .simplifiedChinese:
            return Locale(identifier: "zh-Hans")
        }
    }
}
