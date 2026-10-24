import SwiftUI
import SwiftData

@MainActor final class AppLaunch: ObservableObject {
    let container: ModelContainer?
    let store: ArchiveStore?
    let failure: String?
    init() {
        do {
            #if DEBUG
            let testing = ProcessInfo.processInfo.environment["PASSARCHIVE_UI_TESTING"] == "1"
            #else
            let testing = false
            #endif
            let container = try ModelContainer(for: LocalArchive.self, configurations: ModelConfiguration(isStoredInMemoryOnly: testing))
            var url = AccountAPI.productionURL
            #if DEBUG
            if let value = ProcessInfo.processInfo.environment["PASSARCHIVE_API_BASE_URL"], let custom = URL(string: value),
               custom.scheme == "https" || (custom.scheme == "http" && ["localhost", "127.0.0.1", "::1"].contains(custom.host ?? "")) {
                url = custom
            }
            #endif
            self.store = try ArchiveStore(container: container,
                api: AccountAPI(baseURL: url, transport: testing ? URLSession(configuration: .ephemeral) : nil))
            self.container = container
            self.failure = nil
        } catch {
            container = nil
            store = nil
            failure = error.localizedDescription
        }
    }
}

@main struct PassArchiveApp: App {
    @StateObject private var launch = AppLaunch()
    var body: some Scene {
        WindowGroup {
            if let store = launch.store, let container = launch.container {
                ContentView().environmentObject(store).modelContainer(container)
            } else {
                ContentUnavailableView("无法打开本地收藏", systemImage: "externaldrive.badge.exclamationmark",
                    description: Text("请检查设备存储空间后重新打开应用。若仍无法打开，请保留应用数据，以便恢复收藏。"))
            }
        }
    }
}
