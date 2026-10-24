// 所有改动先提交 SwiftData，再发布到 UI；云端同步不会越过账号边界。
import Foundation
import Combine
import SwiftData
import Network

@MainActor final class ArchiveStore: ObservableObject {
    @Published private(set) var catalog: Catalog
    @Published private(set) var backup: ArchiveBackup
    @Published private(set) var user: AccountUser?
    @Published private(set) var stats: ArchiveStats
    @Published private(set) var syncStatus = "本地收藏"
    @Published private(set) var catalogStatus = "已加载离线目录，联网后可下拉更新。"
    @Published private(set) var conflicts: [MergeConflict] = []
    @Published private(set) var isSyncing = false
    @Published private(set) var isAccountBusy = false
    @Published private(set) var authenticationRequired = false
    @Published var errorMessage: String?
    var isActive = true
    var canEdit: Bool { !isAccountBusy }
    var owned: Set<String> { Set(backup.collection.filter { $0.value.owned }.keys) }
    var scope: String { state.account.map { "account:\($0.user.id)" } ?? "guest" }
    var hasPendingChanges: Bool { state.account.map { !$0.backup.hasSameContent(as: $0.base) } ?? false }
    var hasRestorePoint: Bool { state.account?.beforeImport != nil || (state.account == nil && state.guestBeforeImport != nil) }
    var hasGuestData: Bool { !state.guest.collection.isEmpty || !state.guest.unmapped.isEmpty || !state.guest.followedSeries.isEmpty }
    var syncedAt: Date? { state.account?.syncedAt }
    var baseURL: URL { api.baseURL }

    private let container: ModelContainer
    private let context: ModelContext
    private let record: LocalArchive
    private let api: any ArchiveAPI
    private var state: ArchiveState
    private var generation = 0
    private var initialized = false
    private var syncAgain = false
    private var debounce: Task<Void, Never>?
    private var monitor: NWPathMonitor?

    init(container: ModelContainer, api: (any ArchiveAPI)? = nil, bundledCatalog: Data? = nil) throws {
        self.container = container
        self.api = api ?? AccountAPI()
        context = container.mainContext
        context.autosaveEnabled = false
        let key = self.api.baseURL == AccountAPI.productionURL ? "main" : "server:\(self.api.baseURL.absoluteString)"
        let records = try context.fetch(FetchDescriptor<LocalArchive>())
        let selected = records.first { $0.key == key } ?? LocalArchive(key: key)
        record = selected
        if !records.contains(where: { $0 === selected }) { context.insert(selected) }
        #if SWIFT_PACKAGE
        let bundle = Bundle.module
        #else
        let bundle = Bundle.main
        #endif
        let bundled = try bundledCatalog ?? Data(contentsOf: bundle.url(forResource: "catalog", withExtension: "json")!)
        let savedCatalog = try? ArchiveCoding.decoder().decode(Catalog.self, from: record.catalogData)
        let loadedCatalog = try savedCatalog ?? ArchiveCoding.decoder().decode(Catalog.self, from: bundled)
        catalog = loadedCatalog
        if record.stateData.isEmpty {
            var guest = ArchiveBackup(catalogVersion: loadedCatalog.version)
            if !record.ownedData.isEmpty {
                let ids = try JSONDecoder().decode(Set<String>.self, from: record.ownedData)
                guest.collection = Dictionary(uniqueKeysWithValues: ids.map { ($0, CollectionRecord(owned: true)) })
                // 老版本 iOS 收藏仍属于访客，升级不会自动上传。
                guest = try ArchiveRules.importBackup(ArchiveCoding.encoder().encode(guest), catalog: loadedCatalog).0
            }
            state = ArchiveState(guest: guest)
            record.stateData = try ArchiveCoding.encoder().encode(state)
            try context.save()
        } else {
            // 损坏的缓存必须报错，不能静默替换成空收藏。
            state = try ArchiveCoding.decoder().decode(ArchiveState.self, from: record.stateData)
        }
        let loadedBackup = state.account?.backup ?? state.guest
        backup = loadedBackup
        user = state.account?.user
        stats = ArchiveRules.stats(catalog: loadedCatalog, collection: loadedBackup.collection)
        if user != nil { syncStatus = "已加载此账号的本地收藏，联网后继续同步" }
    }

    deinit {
        monitor?.cancel()
        debounce?.cancel()
    }

    // 一次落盘同时保存当前编辑、云端基线与恢复点；失败后恢复数据库现场。
    private func persist(_ next: ArchiveState) throws {
        let previous = record.stateData
        do {
            record.stateData = try ArchiveCoding.encoder().encode(next)
            try context.save()
        } catch {
            context.rollback()
            record.stateData = previous
            throw ArchiveError("本机保存失败，请检查设备空间后重试。")
        }
        state = next
        backup = next.account?.backup ?? next.guest
        user = next.account?.user
        stats = ArchiveRules.stats(catalog: catalog, collection: backup.collection)
    }

    func start(monitorNetwork: Bool = true) async {
        guard !initialized else { return }
        initialized = true
        isAccountBusy = true
        defer { isAccountBusy = false }
        do {
            let session = try await api.session()
            if let account = state.account {
                if session.user?.id != account.user.id {
                    authenticationRequired = true
                    syncStatus = "登录已失效，请重新登录"
                }
            } else if let user = session.user {
                try await attach(user)
            }
        } catch {
            syncStatus = user == nil ? "离线 · 本地收藏" : "当前离线，账号收藏已保存在此设备"
        }
        if monitorNetwork {
            let path = NWPathMonitor()
            path.pathUpdateHandler = { [weak self] value in
                guard value.status == .satisfied else { return }
                Task { @MainActor [weak self] in
                    guard let self, self.isActive else { return }
                    await self.sync()
                }
            }
            path.start(queue: DispatchQueue(label: "win.yukkuri.passarchive.network"))
            monitor = path
        }
        // 登录切换已结束，允许刷新期间继续编辑。
        isAccountBusy = false
        await refresh()
        await sync()
    }

    func refresh() async {
        do {
            let data = try await api.catalog()
            let updated = try ArchiveCoding.decoder().decode(Catalog.self, from: data)
            // 目录与所有存档一起重映射，保留失去映射的收藏；基线也同步转换。
            func normalize(_ backup: ArchiveBackup) throws -> ArchiveBackup {
                try ArchiveRules.importBackup(ArchiveCoding.encoder().encode(backup), catalog: updated).0
            }
            var next = state
            next.guest = try normalize(next.guest)
            if let before = next.guestBeforeImport { next.guestBeforeImport = try normalize(before) }
            if var account = next.account {
                account.backup = try normalize(account.backup)
                account.base = try normalize(account.base)
                if let before = account.beforeImport { account.beforeImport = try normalize(before) }
                next.account = account
            }
            let previous = record.catalogData
            record.catalogData = data
            do { try persist(next) }
            catch { record.catalogData = previous; throw error }
            catalog = updated
            stats = ArchiveRules.stats(catalog: catalog, collection: backup.collection)
            catalogStatus = "目录已更新 · \(updated.counts.passes) 款通行认证"
        } catch is CancellationError { }
        catch { catalogStatus = "正在使用离线目录，联网后可下拉更新。" }
    }

    private func edit(_ change: (inout ArchiveBackup) throws -> Void, beforeImport: Bool = false) throws {
        guard canEdit else { throw ArchiveError("账号正在切换，请稍后重试。") }
        var next = state
        if var account = next.account {
            if beforeImport { account.beforeImport = account.backup }
            try change(&account.backup)
            next.account = account
        } else {
            if beforeImport { next.guestBeforeImport = next.guest }
            try change(&next.guest)
        }
        try persist(next)
        conflicts = []
        if user != nil {
            syncStatus = "已保存到本地，等待同步"
            scheduleSync()
        } else { syncStatus = "已保存到本地" }
    }

    func saveRecord(_ id: String, value: CollectionRecord, observed: CollectionRecord, scope expectedScope: String) throws {
        guard scope == expectedScope else { throw ArchiveError("登录的账号已更换，请返回后重新打开这条记录。") }
        guard (backup.collection[id] ?? .empty) == observed else { throw ArchiveError("这条记录已有更新，请返回后重新打开再编辑。") }
        guard catalog.series.contains(where: { $0.passes.contains { $0.id == id } }) else { throw ArchiveError("目录中已没有这条记录。") }
        let value = try ArchiveRules.normalized(value)
        try edit { $0.collection[id] = value }
    }

    func setOwned(_ id: String, _ value: Bool) {
        do {
            let previous = backup.collection[id] ?? .empty
            var next = previous
            next.owned = value
            try saveRecord(id, value: next, observed: previous, scope: scope)
        } catch { report(error) }
    }

    func setSeriesOwned(_ series: PassSeries, _ owned: Bool) {
        do {
            try edit { backup in
                for pass in series.passes {
                    var value = backup.collection[pass.id] ?? .empty
                    value.owned = owned
                    backup.collection[pass.id] = try ArchiveRules.normalized(value)
                }
            }
        } catch { report(error) }
    }

    func toggleFollow(_ id: String) {
        do {
            try edit {
                var ids = Set($0.followedSeries)
                if !ids.insert(id).inserted { ids.remove(id) }
                $0.followedSeries = ids.sorted()
            }
        } catch { report(error) }
    }

    func prepareImport(_ data: Data) throws -> PreparedImport {
        let (value, warnings) = try ArchiveRules.importBackup(data, catalog: catalog)
        return PreparedImport(backup: value, warnings: warnings, scope: scope, observed: backup,
                              replacingCount: value.collection.keys.filter { backup.collection[$0] != nil }.count)
    }

    func prepareGuestImport() -> PreparedImport {
        PreparedImport(backup: state.guest, warnings: [], scope: scope, observed: backup,
                       replacingCount: state.guest.collection.keys.filter { backup.collection[$0] != nil }.count)
    }

    func applyImport(_ prepared: PreparedImport) throws {
        guard scope == prepared.scope else { throw ArchiveError("当前账号已变化，请重新选择备份。") }
        // 预览必须与用户看到的收藏版本一致，不能覆盖预览期间收到的新编辑或同步。
        guard backup.hasSameContent(as: prepared.observed) else {
            throw ArchiveError("收藏记录已有更新，请关闭预览，重新选择备份后再导入。")
        }
        try edit({ value in
            value.collection.merge(prepared.backup.collection) { _, imported in imported }
            value.unmapped.merge(prepared.backup.unmapped) { _, imported in imported }
            value.followedSeries = Array(Set(value.followedSeries).union(prepared.backup.followedSeries)).sorted()
        }, beforeImport: true)
    }

    func restoreBeforeImport() throws {
        let point = state.account?.beforeImport ?? (state.account == nil ? state.guestBeforeImport : nil)
        guard let point else { throw ArchiveError("还没有可恢复的导入前备份。") }
        try edit({ $0 = point }, beforeImport: true)
    }

    func exportBackup() throws -> Data {
        var value = backup
        value.catalogVersion = catalog.version
        value.exportedAt = ISO8601DateFormatter().string(from: Date())
        return try ArchiveCoding.encoder().encode(value)
    }

    func authenticate(username: String, password: String, confirmation: String?, remember: Bool) async -> Bool {
        guard !isAccountBusy && !isSyncing else { return false }
        let username = username.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if let message = AccountInput.authentication(username: username, password: password, confirmation: confirmation) {
            errorMessage = message
            return false
        }
        if let current = user, current.username != username {
            errorMessage = "请先同步并退出当前账号，再切换账号。"
            return false
        }
        isAccountBusy = true
        defer { isAccountBusy = false }
        do {
            let result = try await api.authenticate(username: username, password: password, confirmation: confirmation, remember: remember)
            guard let user = result.user else { throw ArchiveError("登录未成功，请稍后重试。") }
            if state.account?.user.id == user.id {
                authenticationRequired = false
            } else { try await attach(user) }
            authenticationRequired = false
            isAccountBusy = false
            await sync()
            return true
        } catch { report(error); return false }
    }

    private func attach(_ user: AccountUser) async throws {
        let cloud = try await api.archive()
        guard cloud.userId == user.id else { throw ArchiveError("账号已变化，请重新登录。") }
        let normalized = try ArchiveRules.importBackup(ArchiveCoding.encoder().encode(cloud.backup), catalog: catalog).0
        var next = state
        next.account = AccountCache(user: user, revision: cloud.revision, base: normalized, backup: normalized, syncedAt: Date())
        try persist(next)
        generation += 1
        syncStatus = "已同步"
    }

    private func scheduleSync() {
        debounce?.cancel()
        guard isActive else { return }
        debounce = Task { [weak self] in
            do { try await Task.sleep(for: .milliseconds(900)) } catch { return }
            guard let self, !Task.isCancelled else { return }
            // 延迟计时已经结束。后续编辑只能重置新计时，不能取消正在上传的请求。
            self.debounce = nil
            await self.sync()
        }
    }

    // 每次 await 后重新取本机副本，并校验账号代次；等待上传期间的新编辑不会被旧响应覆盖。
    func sync(choice: MergeChoice? = nil, expectedConflicts: [MergeConflict]? = nil) async {
        guard state.account != nil, !isAccountBusy else { return }
        if isSyncing { syncAgain = true; return }
        isSyncing = true
        let currentGeneration = generation
        let userId = user!.id
        let approvedConflicts = choice == nil ? [] : (expectedConflicts ?? conflicts)
        defer { isSyncing = false }
        syncStatus = "正在同步"
        do {
            for _ in 0..<4 {
                syncAgain = false
                let session = try await api.session()
                guard generation == currentGeneration, user?.id == userId else { return }
                guard session.user?.id == userId else {
                    throw APIError(status: 401, code: "account_changed", message: "登录已失效，请重新登录；本机记录已保留。")
                }
                let cloud = try await api.archive()
                guard generation == currentGeneration, var account = state.account, account.user.id == userId else { return }
                guard cloud.userId == userId else { throw ArchiveError("云端账号与本机不一致，已停止同步。") }
                let normalized = try ArchiveRules.importBackup(ArchiveCoding.encoder().encode(cloud.backup), catalog: catalog).0
                let preview = try ArchiveMerge.merge(base: account.base, local: account.backup, cloud: normalized)
                if !preview.conflicts.isEmpty && (choice == nil || !preview.conflicts.allSatisfy({ approvedConflicts.contains($0) })) {
                    conflicts = preview.conflicts
                    syncStatus = "有 \(conflicts.count) 条记录待确认，请选择要保留的版本"
                    return
                }
                let merged = try ArchiveMerge.merge(base: account.base, local: account.backup, cloud: normalized, choice: choice)
                var next = state
                account.base = normalized
                account.revision = cloud.revision
                account.backup = merged.backup
                next.account = account
                try persist(next)
                if account.backup.hasSameContent(as: normalized) {
                    next.account?.syncedAt = Date()
                    try persist(next)
                    conflicts = []
                    authenticationRequired = false
                    syncStatus = "已同步"
                    return
                }
                let submitted = account.backup
                let saved: CloudArchive
                do { saved = try await api.saveArchive(userId: userId, revision: cloud.revision, backup: submitted) }
                catch let error as APIError where error.status == 409 && error.code == "revision_conflict" { continue }
                guard generation == currentGeneration, var latest = state.account, latest.user.id == userId else { return }
                guard saved.userId == userId else { throw ArchiveError("账号已变化，已停止同步。") }
                let savedBackup = try ArchiveRules.importBackup(ArchiveCoding.encoder().encode(saved.backup), catalog: catalog).0
                let retained = try ArchiveMerge.merge(base: submitted, local: latest.backup, cloud: savedBackup)
                guard retained.conflicts.isEmpty else { throw ArchiveError("云端返回了不同的记录，本机编辑已保留，请重新同步。") }
                latest.backup = retained.backup
                latest.base = savedBackup
                latest.revision = saved.revision
                latest.syncedAt = Date()
                next = state
                next.account = latest
                try persist(next)
                conflicts = []
                authenticationRequired = false
                if !hasPendingChanges && !syncAgain { syncStatus = "已同步"; return }
            }
            syncStatus = "已保存在此设备，稍后继续同步"
            scheduleSync()
        } catch is CancellationError {
            syncStatus = hasPendingChanges ? "已保存到本机，等待同步" : "本机记录已保留"
        } catch let error as APIError {
            guard generation == currentGeneration else { return }
            if error.status == 401 || error.code == "account_changed" {
                authenticationRequired = true
                syncStatus = "请重新登录，本机记录已保留"
            } else if error.status == 0 || error.status >= 500 {
                syncStatus = "离线 · 本机记录已保留，联网后继续同步"
            } else { syncStatus = error.message }
        } catch {
            guard generation == currentGeneration else { return }
            syncStatus = error.localizedDescription
        }
    }

    func signOut() async {
        guard let user, !isSyncing, !isAccountBusy else { return }
        if hasPendingChanges { await sync() }
        guard !hasPendingChanges, conflicts.isEmpty else {
            errorMessage = "还有记录未同步，请先完成同步并确认冲突记录，再退出登录。也可以先导出备份，保留当前收藏。"
            return
        }
        isAccountBusy = true
        defer { isAccountBusy = false }
        do {
            try await api.logout(userId: user.id)
            var next = state
            next.account = nil
            try persist(next)
            generation += 1
            debounce?.cancel()
            conflicts = []
            authenticationRequired = false
            syncStatus = "已退出登录，当前显示未登录时的收藏"
        } catch { report(error) }
    }

    func changePassword(current: String, password: String, confirmation: String) async -> Bool {
        guard let user, !isAccountBusy, !isSyncing else { return false }
        if let message = AccountInput.newPassword(password, confirmation: confirmation) {
            errorMessage = message
            return false
        }
        isAccountBusy = true
        defer { isAccountBusy = false }
        do {
            try await api.changePassword(userId: user.id, current: current, password: password, confirmation: confirmation)
            return true
        } catch { report(error); return false }
    }

    func imageURL(_ path: String?) -> URL? {
        guard let path, !path.isEmpty, let url = URL(string: path, relativeTo: baseURL)?.absoluteURL,
              ["https", "http"].contains(url.scheme?.lowercased() ?? "") else { return nil }
        return url
    }
    func report(_ error: Error) {
        let system = error as NSError
        if error is CancellationError || (system.domain == NSCocoaErrorDomain && system.code == NSUserCancelledError) { return }
        if error is ArchiveError || error is APIError { errorMessage = error.localizedDescription }
        else { errorMessage = "暂时无法完成操作，请检查文件访问权限和设备存储空间后重试。" }
    }
}
