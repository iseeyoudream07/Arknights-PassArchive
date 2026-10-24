import XCTest
import SwiftData
@testable import PassArchiveCore

private let repository = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
private func loadCatalog() throws -> Catalog {
    try ArchiveCoding.decoder().decode(Catalog.self, from: Data(contentsOf: repository.appendingPathComponent("data/catalog.json")))
}

final class ArchiveRulesTests: XCTestCase {
    func testBackupDepthLimitPreservesSafeUnknownJSONAndRejectsExcessiveNesting() throws {
        let catalog = try loadCatalog()
        var nested: JSONValue = .number(0)
        for _ in 0..<62 { nested = .array([nested]) }
        var backup = ArchiveBackup(catalogVersion: catalog.version)
        backup.unmapped["future"] = nested
        let accepted = try ArchiveRules.importBackup(ArchiveCoding.encoder().encode(backup), catalog: catalog).0
        XCTAssertEqual(accepted.unmapped["future"], nested)
        backup.unmapped["future"] = .array([nested])
        XCTAssertThrowsError(try ArchiveRules.importBackup(ArchiveCoding.encoder().encode(backup), catalog: catalog))
    }
    func testPasswordInputAndLegacyMixedFeedback() {
        XCTAssertEqual(AccountInput.newPassword("114514", confirmation: "114514"), "密码至少需要 10 个字符，请设置更长的密码。")
        XCTAssertEqual(AccountInput.message(detail: "密码跟 用户名 太相似了。 This password is too short. It must contain at least 10 characters. 密码只包含数字。", status: 400), "密码至少需要 10 个字符，请设置更长的密码。")
        XCTAssertTrue(AccountInput.newPassword("114514114514", confirmation: "114514114514")!.contains("不能只包含数字"))
        XCTAssertTrue(AccountInput.newPassword("Collection!7439", confirmation: "different")!.contains("不一致"))
        XCTAssertTrue(AccountInput.newPassword(String(repeating: "a", count: 129), confirmation: "")!.contains("128"))
        XCTAssertNil(AccountInput.authentication(username: "tester", password: "old", confirmation: nil))
        // Django 按 Unicode 码点计数；不能误拒绝含组合字符的有效密码。
        let combining = String(repeating: "e\u{301}", count: 5)
        XCTAssertNil(AccountInput.newPassword(combining, confirmation: combining))
    }

    func testBackupFileReadHasRealByteLimit() throws {
        let file = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".json")
        defer { try? FileManager.default.removeItem(at: file) }
        let data = Data(repeating: 32, count: ArchiveRules.maximumBackupSize)
        try data.write(to: file)
        XCTAssertEqual(try ArchiveRules.readBackupFile(file).count, data.count)
        let handle = try FileHandle(forWritingTo: file)
        try handle.seekToEnd()
        try handle.write(contentsOf: Data([32]))
        try handle.close()
        XCTAssertThrowsError(try ArchiveRules.readBackupFile(file))
        let valid = Data(#"{"schema_version":1,"collection":{}}"#.utf8)
        try valid.write(to: file)
        XCTAssertEqual(try ArchiveRules.readBackupFile(file), valid)
    }
    func testAllSharedUpstreamFixtures() throws {
        let catalog = try loadCatalog()
        let fixtures = try JSONDecoder().decode([JSONValue].self, from: Data(contentsOf: repository.appendingPathComponent("shared/upstream-fixtures.json")))
        XCTAssertEqual(fixtures.count, 24)
        for fixture in fixtures {
            let item = try XCTUnwrap(fixture.object)
            let collection = try ArchiveCoding.decoder().decode([String: CollectionRecord].self, from: ArchiveCoding.encoder().encode(item["collection"]!))
            let stats = ArchiveRules.stats(catalog: catalog, collection: collection)
            let actual = try JSONDecoder().decode(JSONValue.self, from: ArchiveCoding.encoder().encode(stats)).object!
            for (key, value) in item["expected"]!.object! {
                XCTAssertEqual(actual[key], value, "\(item["name"]!) / \(key)")
            }
        }
    }

    func testMoneyValidationAndExactTotals() throws {
        XCTAssertNil(try ArchiveRules.money(""))
        XCTAssertEqual(try ArchiveRules.money("00012.3"), "12.30")
        XCTAssertEqual(try ArchiveRules.money("3250000"), "3250000.00")
        for invalid in ["-1", "0.001", "1e2", "NaN", " 2", "3.", ".5", "3250000.01", "true"] {
            XCTAssertThrowsError(try ArchiveRules.money(invalid), invalid)
        }
        XCTAssertEqual(ArchiveRules.currency(Decimal(string: "123456789012345.67")!), "123456789012345.67")
    }

    func testQuantityAndUnpricedCostRules() throws {
        let catalog = try loadCatalog()
        let passes = catalog.series[0].passes
        let collection = [
            passes[0].id: CollectionRecord(owned: true, market: "30.10", lots: [.init(cost: "20.05", qty: 3)]),
            passes[1].id: CollectionRecord(owned: true, market: "0.00", lots: [.init(cost: "5.00", qty: 2)]),
            passes[2].id: CollectionRecord(owned: true)
        ]
        let result = ArchiveRules.stats(catalog: catalog, collection: collection)
        XCTAssertEqual(result.owned, 3)
        XCTAssertEqual(result.quantity, 5)
        XCTAssertEqual(result.cost, "70.15")
        XCTAssertEqual(result.market, "90.30")
        XCTAssertEqual(result.profit, "30.15")
        XCTAssertEqual(result.pricedOwned, 1)
        XCTAssertEqual(try ArchiveRules.normalized(.init(owned: false, market: "10", lots: [.init(cost: "4", qty: 2)])), .empty)
        for qty in [0, 1000] { XCTAssertThrowsError(try ArchiveRules.normalized(.init(owned: true, lots: [.init(cost: "1", qty: qty)]))) }
    }

    func testFixedBoxCountedOnceWithoutPurchaseLots() throws {
        let catalog = try loadCatalog()
        let series = try XCTUnwrap(catalog.series.first { !$0.passes.isEmpty && $0.passes[0].officialUnitPrice == nil })
        let records = Dictionary(uniqueKeysWithValues: series.passes.map { ($0.id, CollectionRecord(owned: true)) })
        let result = ArchiveRules.stats(catalog: catalog, collection: records)
        XCTAssertEqual(result.official, ArchiveRules.currency(series.officialBoxPrice))
        XCTAssertEqual(result.quantity, 0)
        XCTAssertEqual(result.completedSeries, 1)
    }

    func testStandardBackupPreservesUnknownJSONAndOptionalFields() throws {
        let catalog = try loadCatalog()
        let id = catalog.series[0].passes[0].id
        let data = Data("""
        {"schema_version":1,"catalog_version":"old","collection":{"\(id)":{"owned":true,"market":"0","lots":[]},"future":{"x":[null,true,123.45]}},"unmapped":{"kept":{"nested":"data"}}}
        """.utf8)
        let (backup, warnings) = try ArchiveRules.importBackup(data, catalog: catalog)
        XCTAssertEqual(backup.collection[id]?.market, "0.00")
        XCTAssertEqual(backup.unmapped.count, 2)
        XCTAssertEqual(warnings.count, 1)
        let again = try ArchiveRules.importBackup(ArchiveCoding.encoder().encode(backup), catalog: catalog).0
        XCTAssertTrue(backup.hasSameContent(as: again))
    }

    func testLegacyBackupSingleCostAndLots() throws {
        let catalog = try loadCatalog(), series = catalog.series[0]
        let a = series.passes[0], b = series.passes[1]
        let value: JSONValue = .object(["exportedAt": .string("old"), "collection": .object([
            series.name: .object([
                "ownedChars": .object([a.label: .bool(true), b.label: .bool(true), "未知干员": .bool(true)]),
                "prices": .object([
                    a.label: .object(["cost": .string("12.3"), "market": .number(15)]),
                    b.label: .object(["lots": .array([.object(["cost": .string(""), "qty": .number(1)]), .object(["cost": .string("2.50"), "qty": .number(3)])])])
                ])
            ])
        ])])
        let (backup, _) = try ArchiveRules.importBackup(ArchiveCoding.encoder().encode(value), catalog: catalog)
        XCTAssertEqual(backup.collection[a.id]?.lots, [.init(cost: "12.30", qty: 1)])
        XCTAssertEqual(backup.collection[b.id]?.lots, [.init(cost: "2.50", qty: 3)])
        XCTAssertEqual(backup.unmapped.count, 1)
    }

    func testRejectsMalformedBackupAndInvalidTypes() throws {
        let catalog = try loadCatalog(), id = catalog.series[0].passes[0].id
        for text in [
            "[]", "null", "{", #"{"schema_version":2,"collection":{}}"#,
            #"{"schema_version":true,"collection":{}}"#,
            #"{"schema_version":1,"collection":{},"followed_series":["unknown"]}"#,
            #"{"schema_version":1,"collection":{},"unmapped":[]}"#,
            #"{"schema_version":1,"collection":{"\#(id)":{"owned":1}}}"#,
            #"{"schema_version":1,"collection":{"\#(id)":{"owned":true,"market":false}}}"#,
            #"{"schema_version":1,"collection":{"\#(id)":{"owned":true,"lots":[{"qty":true}]}}}"#,
            #"{"schema_version":1,"collection":{"\#(id)":{"owned":true,"lots":[{"qty":1.5}]}}}"#
        ] {
            XCTAssertThrowsError(try ArchiveRules.importBackup(Data(text.utf8), catalog: catalog), text)
        }
        XCTAssertThrowsError(try ArchiveRules.importBackup(Data(repeating: 32, count: ArchiveRules.maximumBackupSize + 1), catalog: catalog))
    }

    func testSearchIncludesBoxBarcodePinyinAndOwnership() throws {
        let catalog = try loadCatalog()
        var backup = ArchiveBackup(catalogVersion: catalog.version)
        let series = catalog.series[0], pass = series.passes[0]
        backup.collection[pass.id] = .init(owned: true)
        backup.followedSeries = [series.id]
        for text in ["AMY", "ＡＭＩＹＡ", "阿米娅", series.barcodes[0], "1.0"] {
            let result = ArchiveRules.search(catalog: catalog, backup: backup, query: .init(text: text, ownership: .owned, followedOnly: true))
            XCTAssertEqual(result.flatMap(\.passes).map(\.id), [pass.id], text)
        }
        let missing = ArchiveRules.search(catalog: catalog, backup: backup, query: .init(ownership: .missing))
        XCTAssertFalse(missing.flatMap(\.passes).contains { $0.id == pass.id })
    }
}

final class ArchiveMergeTests: XCTestCase {
    func testIndependentEditsAndDeletionMerge() throws {
        var base = ArchiveBackup(catalogVersion: "v")
        base.collection["deleted"] = .init(owned: true)
        var local = base, cloud = base
        local.collection["a"] = .init(owned: true)
        local.collection.removeValue(forKey: "deleted")
        cloud.collection["b"] = .init(owned: true)
        let result = try ArchiveMerge.merge(base: base, local: local, cloud: cloud)
        XCTAssertTrue(result.conflicts.isEmpty)
        XCTAssertEqual(Set(result.backup.collection.keys), ["a", "b"])
    }

    func testConflictNeedsExplicitChoiceIncludingDeletionAndUnknownData() throws {
        var base = ArchiveBackup(catalogVersion: "v")
        base.collection["a"] = .init(owned: true, market: "10.00")
        var local = base, cloud = base
        local.collection["a"]?.market = "20.00"
        cloud.collection.removeValue(forKey: "a")
        local.unmapped["unknown"] = .string("ours")
        cloud.unmapped["unknown"] = .string("theirs")
        let result = try ArchiveMerge.merge(base: base, local: local, cloud: cloud)
        XCTAssertEqual(result.conflicts.count, 2)
        let chosen = try ArchiveMerge.merge(base: base, local: local, cloud: cloud, choice: .cloud)
        XCTAssertNil(chosen.backup.collection["a"])
        XCTAssertEqual(chosen.backup.unmapped["unknown"], .string("theirs"))
    }

    func testFollowChangesMergeByMembership() throws {
        var base = ArchiveBackup(catalogVersion: "v")
        base.followedSeries = ["old"]
        var local = base, cloud = base
        local.followedSeries = ["local"]
        cloud.followedSeries = ["old", "cloud"]
        let result = try ArchiveMerge.merge(base: base, local: local, cloud: cloud)
        XCTAssertEqual(result.backup.followedSeries, ["cloud", "local"])
    }
}

@MainActor final class StubAPI: ArchiveAPI {
    let baseURL = AccountAPI.productionURL
    let data: Data
    var currentUser: AccountUser?
    var cloud: CloudArchive
    var sessionFailure: Error?
    var saveConflicts = 0
    var writes = 0
    var beforeSave: (() async -> Void)?

    init(catalog: Catalog) throws {
        data = try ArchiveCoding.encoder().encode(catalog)
        cloud = CloudArchive(userId: 1, revision: 0, backup: ArchiveBackup(catalogVersion: catalog.version), updatedAt: nil)
    }
    func catalog() async throws -> Data { data }
    func session() async throws -> AccountSession {
        if let sessionFailure { throw sessionFailure }
        return AccountSession(authenticated: currentUser != nil, user: currentUser, csrfToken: "test")
    }
    func authenticate(username: String, password: String, confirmation: String?, remember: Bool) async throws -> AccountSession {
        currentUser = AccountUser(id: 1, username: username)
        return try await session()
    }
    func archive() async throws -> CloudArchive { cloud }
    func saveArchive(userId: Int, revision: Int, backup: ArchiveBackup) async throws -> CloudArchive {
        let action = beforeSave
        beforeSave = nil
        await action?()
        if saveConflicts > 0 {
            saveConflicts -= 1
            throw APIError(status: 409, code: "revision_conflict", message: "conflict")
        }
        guard userId == cloud.userId, revision == cloud.revision else { throw ArchiveError("wrong account/revision") }
        writes += 1
        cloud = CloudArchive(userId: userId, revision: revision + 1, backup: backup, updatedAt: nil)
        return cloud
    }
    func logout(userId: Int) async throws { currentUser = nil }
    func changePassword(userId: Int, current: String, password: String, confirmation: String) async throws { }
}

final class ArchiveStoreTests: XCTestCase {
    @MainActor private func makeStore() throws -> (ArchiveStore, StubAPI, ModelContainer) {
        let catalog = try loadCatalog(), api = try StubAPI(catalog: catalog)
        let container = try ModelContainer(for: LocalArchive.self, configurations: ModelConfiguration(isStoredInMemoryOnly: true))
        let store = try ArchiveStore(container: container, api: api, bundledCatalog: api.data)
        store.isActive = false // 同步由测试显式触发，避免后台计时影响断言。
        return (store, api, container)
    }

    @MainActor func testLegacyOwnedMigrationAndPersistentReload() throws {
        let catalog = try loadCatalog(), api = try StubAPI(catalog: catalog)
        let container = try ModelContainer(for: LocalArchive.self, configurations: ModelConfiguration(isStoredInMemoryOnly: true))
        let id = catalog.series[0].passes[0].id
        container.mainContext.insert(LocalArchive(ownedData: try JSONEncoder().encode([id, "removed-id"])))
        try container.mainContext.save()
        let first = try ArchiveStore(container: container, api: api, bundledCatalog: api.data)
        XCTAssertTrue(first.owned.contains(id))
        XCTAssertNotNil(first.backup.unmapped["removed-id"])
        first.isActive = false
        first.toggleFollow(catalog.series[0].id)
        let second = try ArchiveStore(container: container, api: api, bundledCatalog: api.data)
        XCTAssertTrue(second.backup.hasSameContent(as: first.backup))
    }

    @MainActor func testGuestAndAccountAreIsolatedAndSignOutRestoresGuest() async throws {
        let (store, api, _) = try makeStore()
        let passes = store.catalog.series[0].passes
        store.setOwned(passes[0].id, true)
        let success = await store.authenticate(username: "tester", password: "fixture", confirmation: nil, remember: false)
        XCTAssertTrue(success)
        XCTAssertTrue(store.owned.isEmpty)
        XCTAssertEqual(api.writes, 0)
        store.setOwned(passes[1].id, true)
        await store.sync()
        XCTAssertEqual(api.cloud.backup.collection[passes[1].id]?.owned, true)
        XCTAssertNil(api.cloud.backup.collection[passes[0].id])
        await store.signOut()
        XCTAssertNil(store.user)
        XCTAssertEqual(store.owned, [passes[0].id])
    }

    @MainActor func testOfflineEditsRemainAndReauthDoesNotReplaceThem() async throws {
        let (store, api, container) = try makeStore()
        _ = await store.authenticate(username: "tester", password: "fixture", confirmation: nil, remember: false)
        let id = store.catalog.series[0].passes[0].id
        store.setOwned(id, true)
        api.sessionFailure = APIError(status: 0, code: nil, message: "offline")
        await store.sync()
        XCTAssertTrue(store.hasPendingChanges)
        let reopened = try ArchiveStore(container: container, api: api, bundledCatalog: api.data)
        reopened.isActive = false
        XCTAssertTrue(reopened.owned.contains(id))
        api.sessionFailure = nil
        api.currentUser = nil
        await reopened.sync()
        XCTAssertTrue(reopened.authenticationRequired)
        _ = await reopened.authenticate(username: "tester", password: "fixture", confirmation: nil, remember: false)
        XCTAssertFalse(reopened.hasPendingChanges)
        XCTAssertEqual(api.cloud.backup.collection[id]?.owned, true)
    }

    @MainActor func testEditsDuringUploadAreRetainedAndUploadedNextRound() async throws {
        let (store, api, _) = try makeStore()
        _ = await store.authenticate(username: "tester", password: "fixture", confirmation: nil, remember: false)
        let a = store.catalog.series[0].passes[0].id, b = store.catalog.series[0].passes[1].id
        store.setOwned(a, true)
        api.beforeSave = { store.setOwned(a, false); store.setOwned(b, true) }
        await store.sync()
        XCTAssertEqual(store.backup.collection[a]?.owned, false)
        XCTAssertEqual(api.cloud.backup.collection[a]?.owned, false)
        XCTAssertEqual(api.cloud.backup.collection[b]?.owned, true)
        XCTAssertEqual(api.writes, 2)
        XCTAssertFalse(store.hasPendingChanges)
    }

    @MainActor func testDebouncedUploadIsNotCancelledByTheNextEdit() async throws {
        let (store, api, _) = try makeStore()
        _ = await store.authenticate(username: "tester", password: "fixture", confirmation: nil, remember: false)
        let a = store.catalog.series[0].passes[0].id, b = store.catalog.series[0].passes[1].id
        var cancelled = false
        api.beforeSave = {
            store.setOwned(b, true)
            cancelled = Task.isCancelled
        }
        store.isActive = true
        store.setOwned(a, true)
        try await Task.sleep(for: .milliseconds(1400))
        store.isActive = false
        XCTAssertFalse(cancelled)
        XCTAssertEqual(api.cloud.backup.collection[a]?.owned, true)
        XCTAssertEqual(api.cloud.backup.collection[b]?.owned, true)
        XCTAssertFalse(store.hasPendingChanges)
    }

    @MainActor func testConflictsNeverUploadUntilUserChooses() async throws {
        let (store, api, _) = try makeStore()
        _ = await store.authenticate(username: "tester", password: "fixture", confirmation: nil, remember: false)
        let id = store.catalog.series[0].passes[0].id
        store.setOwned(id, true)
        var cloud = api.cloud.backup
        cloud.collection[id] = .init(owned: true, market: "9.00")
        api.cloud = CloudArchive(userId: 1, revision: 1, backup: cloud, updatedAt: nil)
        await store.sync()
        XCTAssertEqual(store.conflicts.count, 1)
        XCTAssertEqual(api.writes, 0)
        await store.sync(choice: .cloud)
        XCTAssertTrue(store.conflicts.isEmpty)
        XCTAssertEqual(store.backup.collection[id]?.market, "9.00")
        XCTAssertEqual(api.writes, 0)
    }

    @MainActor func testChangedSessionCannotWriteIntoOtherAccount() async throws {
        let (store, api, _) = try makeStore()
        _ = await store.authenticate(username: "tester", password: "fixture", confirmation: nil, remember: false)
        store.setOwned(store.catalog.series[0].passes[0].id, true)
        api.currentUser = AccountUser(id: 2, username: "other")
        await store.sync()
        XCTAssertTrue(store.authenticationRequired)
        XCTAssertTrue(store.hasPendingChanges)
        XCTAssertEqual(api.writes, 0)
        XCTAssertEqual(store.user?.id, 1)
    }

    @MainActor func testNewCloudConflictRequiresAnotherReview() async throws {
        let (store, api, _) = try makeStore()
        _ = await store.authenticate(username: "tester", password: "fixture", confirmation: nil, remember: false)
        let id = store.catalog.series[0].passes[0].id
        store.setOwned(id, true)
        var cloud = api.cloud.backup
        cloud.collection[id] = .init(owned: true, market: "9.00")
        api.cloud = CloudArchive(userId: 1, revision: 1, backup: cloud, updatedAt: nil)
        await store.sync()
        XCTAssertEqual(store.conflicts.count, 1)
        let reviewed = store.conflicts
        // 用户选择前 Web 又改了一次，旧确认不能覆盖新价格。
        cloud.collection[id]?.market = "12.00"
        api.cloud = CloudArchive(userId: 1, revision: 2, backup: cloud, updatedAt: nil)
        await store.sync(choice: .local)
        XCTAssertEqual(store.conflicts.count, 1)
        XCTAssertEqual(api.writes, 0)
        // 即使自动轮询已更新列表，打开确认框时看到的旧版本也不能用于新冲突。
        await store.sync(choice: .local, expectedConflicts: reviewed)
        XCTAssertEqual(api.writes, 0)
        await store.sync(choice: .cloud)
        XCTAssertTrue(store.conflicts.isEmpty)
        XCTAssertEqual(store.backup.collection[id]?.market, "12.00")
    }

    @MainActor func testOfflineSignOutKeepsUnsyncedAccountAndGuest() async throws {
        let (store, api, _) = try makeStore()
        let id = store.catalog.series[0].passes[0].id
        store.setOwned(id, true)
        _ = await store.authenticate(username: "tester", password: "fixture", confirmation: nil, remember: false)
        store.setOwned(id, true)
        api.sessionFailure = APIError(status: 0, code: nil, message: "offline")
        await store.signOut()
        XCTAssertEqual(store.user?.username, "tester")
        XCTAssertTrue(store.hasPendingChanges)
        XCTAssertTrue(store.hasGuestData)
        XCTAssertNotNil(store.errorMessage)
    }

    @MainActor func testRevisionConflictRetriesWithoutDroppingEdits() async throws {
        let (store, api, _) = try makeStore()
        _ = await store.authenticate(username: "tester", password: "fixture", confirmation: nil, remember: false)
        let id = store.catalog.series[0].passes[0].id
        store.setOwned(id, true)
        api.saveConflicts = 1
        await store.sync()
        XCTAssertFalse(store.hasPendingChanges)
        XCTAssertEqual(api.writes, 1)
        XCTAssertEqual(api.cloud.backup.collection[id]?.owned, true)
    }

    @MainActor func testImportPreviewRecoveryAndStaleEditorGuards() async throws {
        let (store, _, _) = try makeStore()
        let id = store.catalog.series[0].passes[0].id
        var imported = store.backup
        imported.collection[id] = .init(owned: true, market: "12.00")
        let prepared = try store.prepareImport(ArchiveCoding.encoder().encode(imported))
        try store.applyImport(prepared)
        XCTAssertTrue(store.hasRestorePoint)
        XCTAssertEqual(store.backup.collection[id]?.market, "12.00")
        XCTAssertThrowsError(try store.saveRecord(id, value: .empty, observed: .empty, scope: store.scope))
        try store.restoreBeforeImport()
        XCTAssertTrue(store.backup.collection.isEmpty)
        _ = await store.authenticate(username: "tester", password: "fixture", confirmation: nil, remember: false)
        XCTAssertThrowsError(try store.applyImport(prepared))
        XCTAssertThrowsError(try store.saveRecord(id, value: .empty, observed: .empty, scope: "guest"))
    }

    @MainActor func testImportPreviewCannotOverwriteEditsMadeAfterPreview() async throws {
        let (store, _, _) = try makeStore()
        let id = store.catalog.series[0].passes[0].id
        store.setOwned(id, true)
        var imported = store.backup
        imported.collection[id] = .init(owned: true, market: "12.00")
        let prepared = try store.prepareImport(ArchiveCoding.encoder().encode(imported))
        try store.saveRecord(id, value: .init(owned: true, market: "30.00"), observed: .init(owned: true), scope: store.scope)
        XCTAssertThrowsError(try store.applyImport(prepared))
        XCTAssertEqual(store.backup.collection[id]?.market, "30.00")
        XCTAssertFalse(store.hasRestorePoint)
    }

    @MainActor func testFileCancellationIsQuietAndSystemErrorsHaveReadableHints() throws {
        let (store, _, _) = try makeStore()
        store.report(CocoaError(.userCancelled))
        XCTAssertNil(store.errorMessage)
        store.report(NSError(domain: NSCocoaErrorDomain, code: NSFileWriteOutOfSpaceError,
                             userInfo: [NSLocalizedDescriptionKey: "No space left on device"]))
        XCTAssertTrue(store.errorMessage?.contains("设备存储空间") == true)
        store.report(ArchiveError("这条记录已有更新，请返回后重新编辑。"))
        XCTAssertEqual(store.errorMessage, "这条记录已有更新，请返回后重新编辑。")
    }
}
