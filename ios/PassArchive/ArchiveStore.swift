import Foundation
import Combine
import SwiftData

@MainActor final class ArchiveStore: ObservableObject {
    @Published private(set) var catalog: Catalog?
    @Published private(set) var owned: Set<String> = []
    @Published var status = ""
    let baseURL = URL(string: "https://arknights.yukkuri.win")!
    private let context: ModelContext
    private let record: LocalArchive

    init(container: ModelContainer) {
        context = container.mainContext
        let existing = try? context.fetch(FetchDescriptor<LocalArchive>())
        record = existing?.first ?? LocalArchive()
        if existing?.isEmpty != false { context.insert(record) }
        owned = (try? JSONDecoder().decode(Set<String>.self, from: record.ownedData)) ?? []
        let bundled = Bundle.main.url(forResource: "catalog", withExtension: "json").flatMap { try? Data(contentsOf: $0) }
        catalog = decode(record.catalogData) ?? bundled.flatMap(decode)
    }

    private func decode(_ data: Data) -> Catalog? {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return try? decoder.decode(Catalog.self, from: data)
    }

    func refresh() async {
        do {
            var request = URLRequest(url: baseURL.appendingPathComponent("api/v1/catalog/"))
            request.timeoutInterval = 8
            let (data, response) = try await URLSession.shared.data(for: request)
            guard (response as? HTTPURLResponse)?.statusCode == 200, let updated = decode(data) else {
                throw URLError(.cannotParseResponse)
            }
            record.catalogData = data
            try context.save()
            catalog = updated
            status = "目录已更新"
        } catch {
            status = catalog == nil ? "目录暂不可用" : "正在使用本机目录"
        }
    }

    func setOwned(_ id: String, _ value: Bool) {
        var next = owned
        if value { next.insert(id) } else { next.remove(id) }
        do {
            record.ownedData = try JSONEncoder().encode(next)
            try context.save()
            owned = next
        } catch { status = "收藏保存失败，请重试" }
    }

    func imageURL(_ path: String?) -> URL? {
        guard let path else { return nil }
        return URL(string: path, relativeTo: baseURL)?.absoluteURL
    }
}
