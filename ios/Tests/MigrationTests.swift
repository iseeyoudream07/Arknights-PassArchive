import XCTest
import SwiftData
@testable import PassArchiveCore

// 生成确实没有 stateData 列的旧数据库，验证 SwiftData 自动升级。
private enum OldArchiveSchema: VersionedSchema {
    static var versionIdentifier = Schema.Version(0, 1, 0)
    static var models: [any PersistentModel.Type] { [LocalArchive.self] }
    @Model final class LocalArchive {
        var key: String
        var ownedData: Data
        var catalogData: Data
        init(ownedData: Data, catalogData: Data) {
            key = "main"; self.ownedData = ownedData; self.catalogData = catalogData
        }
    }
}

final class MigrationTests: XCTestCase {
    @MainActor func testActualOldDatabaseAddsStateWithoutLosingOwnership() throws {
        let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        let data = try Data(contentsOf: root.appendingPathComponent("data/catalog.json"))
        let catalog = try ArchiveCoding.decoder().decode(Catalog.self, from: data)
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("passarchive-migration-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: folder) }
        let url = folder.appendingPathComponent("archive.store")
        let id = catalog.series[0].passes[0].id
        try autoreleasepool {
            let schema = Schema(versionedSchema: OldArchiveSchema.self)
            let old = try ModelContainer(for: schema, configurations: [ModelConfiguration(url: url)])
            let context = ModelContext(old)
            context.insert(OldArchiveSchema.LocalArchive(ownedData: try JSONEncoder().encode([id]), catalogData: data))
            try context.save()
        }
        let upgraded = try ModelContainer(for: LocalArchive.self, configurations: ModelConfiguration(url: url))
        let api = try StubAPI(catalog: catalog)
        let store = try ArchiveStore(container: upgraded, api: api, bundledCatalog: data)
        XCTAssertEqual(store.owned, [id])
        XCTAssertNil(store.user)
        let rows = try upgraded.mainContext.fetch(FetchDescriptor<LocalArchive>())
        XCTAssertEqual(rows.count, 1)
        XCTAssertFalse(rows[0].stateData.isEmpty)
        XCTAssertEqual(try JSONDecoder().decode([String].self, from: rows[0].ownedData), [id])
    }
}
