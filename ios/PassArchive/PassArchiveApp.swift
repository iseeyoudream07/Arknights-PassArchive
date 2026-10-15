import SwiftUI
import SwiftData

@main struct PassArchiveApp: App {
    private let container: ModelContainer
    @StateObject private var store: ArchiveStore
    init() {
        do {
            let modelContainer = try ModelContainer(for: LocalArchive.self)
            container = modelContainer
            _store = StateObject(wrappedValue: ArchiveStore(container: modelContainer))
        } catch {
            fatalError("Unable to open local archive: \(error)")
        }
    }
    var body: some Scene {
        WindowGroup { ContentView().environmentObject(store).modelContainer(container) }
    }
}
