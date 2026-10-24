import SwiftUI
import UniformTypeIdentifiers

struct BackupDocument: FileDocument {
    static var readableContentTypes: [UTType] { [.json] }
    var data: Data
    init(data: Data) { self.data = data }
    init(configuration: ReadConfiguration) throws { data = configuration.file.regularFileContents ?? Data() }
    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper { FileWrapper(regularFileWithContents: data) }
}

struct AccountView: View {
    @EnvironmentObject private var store: ArchiveStore
    @AppStorage("appearance") private var appearance = "system"
    @State private var showLogin = false
    @State private var showPassword = false
    @State private var showImport = false
    @State private var showExport = false
    @State private var confirmRestore = false
    @State private var confirmLogout = false
    @State private var pendingImport: PreparedImport?
    @State private var document = BackupDocument(data: Data())
    var body: some View {
        Form {
            Section {
                HStack(spacing: 16) {
                    Image(systemName: store.user == nil ? "person.crop.circle" : "person.crop.circle.fill")
                        .font(.system(size: 42, weight: .light)).foregroundStyle(ArchiveTheme.accent)
                    VStack(alignment: .leading, spacing: 6) {
                        Text(store.user?.username ?? "USER").font(.title3.weight(.medium))
                        Text(store.user == nil ? "登录后可在不同设备间同步收藏" : "与网页版使用同一账号，收藏自动同步")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }.padding(.vertical, 8)
                if store.user == nil {
                    Button("登录 / 注册", systemImage: "person.badge.key") { showLogin = true }
                } else {
                    Label(store.syncStatus, systemImage: store.isSyncing ? "arrow.triangle.2.circlepath" : store.authenticationRequired ? "person.badge.key" : "checkmark.icloud")
                        .font(.subheadline)
                    if let date = store.syncedAt {
                        LabeledContent("上次同步") { Text(date, style: .relative).font(.caption).foregroundStyle(.secondary) }
                    }
                    if store.authenticationRequired { Button("重新登录") { showLogin = true } }
                    Button("立即同步", systemImage: "arrow.triangle.2.circlepath") { Task { await store.sync() } }
                        .disabled(store.isSyncing || store.isAccountBusy)
                    if !store.conflicts.isEmpty {
                        NavigationLink { ConflictView() } label: { Label("查看 \(store.conflicts.count) 条待确认记录", systemImage: "exclamationmark.icloud") }
                    }
                    Button("修改密码", systemImage: "key") { showPassword = true }
                        .disabled(store.isSyncing || store.isAccountBusy || store.authenticationRequired)
                    Button("退出登录", role: .destructive) { confirmLogout = true }
                        .disabled(store.isSyncing || store.isAccountBusy)
                }
            } header: { Text("账号与同步") }
            footer: { Text(store.user == nil ? "未登录时的收藏只保存在这台设备上。登录后，可选择将它们合并到账号。" : "修改会先保存在这台设备上，联网后自动同步。") }
            Section {
                Button("导出备份", systemImage: "square.and.arrow.up") {
                    do { document = BackupDocument(data: try store.exportBackup()); showExport = true }
                    catch { store.report(error) }
                }
                Button("导入备份", systemImage: "square.and.arrow.down") { showImport = true }.disabled(!store.canEdit)
                if store.user != nil && store.hasGuestData {
                    Button("合并未登录时的收藏", systemImage: "arrow.triangle.merge") { pendingImport = store.prepareGuestImport() }
                        .disabled(!store.canEdit)
                }
                if store.hasRestorePoint {
                    Button("恢复导入前的收藏", systemImage: "clock.arrow.circlepath") { confirmRestore = true }.disabled(!store.canEdit)
                }
                if !store.backup.unmapped.isEmpty {
                    NavigationLink { UnmappedView() } label: { LabeledContent("未识别的记录", value: "\(store.backup.unmapped.count) 项") }
                }
            } header: { Text("备份与恢复") }
            footer: { Text("可导入、导出 JSON 备份，与网页版通用。") }
            Section("外观") {
                Picker("主题", selection: $appearance) {
                    Text("跟随系统").tag("system")
                    Text("浅色").tag("light")
                    Text("深色").tag("dark")
                }
            }
            Section("更多") {
                Link(destination: store.baseURL.appendingPathComponent("terminal.html")) { Label("打开网页版", systemImage: "cube.transparent") }
                Link(destination: store.baseURL.appendingPathComponent("credits.html")) { Label("来源与致谢", systemImage: "info.circle") }
            }
        }
        .navigationTitle("我的")
        .sheet(isPresented: $showLogin) { NavigationStack { LoginView() }.environmentObject(store) }
        .sheet(isPresented: $showPassword) { NavigationStack { PasswordView() }.environmentObject(store) }
        .sheet(item: $pendingImport) { prepared in NavigationStack { ImportPreviewView(prepared: prepared) }.environmentObject(store) }
        .fileImporter(isPresented: $showImport, allowedContentTypes: [.json]) { result in
            do {
                let url = try result.get()
                let granted = url.startAccessingSecurityScopedResource()
                defer { if granted { url.stopAccessingSecurityScopedResource() } }
                pendingImport = try store.prepareImport(ArchiveRules.readBackupFile(url))
            } catch { store.report(error) }
        }
        .fileExporter(isPresented: $showExport, document: document, contentType: .json,
                      defaultFilename: "PassArchive-\(Date.now.formatted(.iso8601.year().month().day().dateSeparator(.dash)))") { result in
            if case .failure(let error) = result { store.report(error) }
        }
        .confirmationDialog("恢复后，收藏将回到上次导入前的状态。当前收藏也会保留，可再次恢复。", isPresented: $confirmRestore, titleVisibility: .visible) {
            Button("恢复收藏", role: .destructive) { do { try store.restoreBeforeImport() } catch { store.report(error) } }
        }
        .confirmationDialog("退出前会先同步账号收藏。退出后，显示这台设备上未登录时的收藏。", isPresented: $confirmLogout, titleVisibility: .visible) {
            Button("同步并退出", role: .destructive) { Task { await store.signOut() } }
        }
    }
}

struct LoginView: View {
    @EnvironmentObject private var store: ArchiveStore
    @Environment(\.dismiss) private var dismiss
    @State private var registering = false
    @State private var username = ""
    @State private var password = ""
    @State private var confirmation = ""
    @State private var remember = true
    @State private var submitting = false
    var body: some View {
        Form {
            if store.user == nil {
                Picker("方式", selection: $registering) { Text("登录").tag(false); Text("注册").tag(true) }.pickerStyle(.segmented)
            }
            Section {
                TextField("用户名", text: $username).textContentType(.username).textInputAutocapitalization(.never).autocorrectionDisabled()
                    .accessibilityIdentifier("auth-username")
                    .disabled(store.user != nil)
                SecureField("密码", text: $password).textContentType(registering ? .newPassword : .password).accessibilityIdentifier("auth-password")
                if registering { SecureField("再次输入密码", text: $confirmation).textContentType(.newPassword).accessibilityIdentifier("auth-confirmation") }
                Toggle("14 天内保持登录", isOn: $remember)
            } footer: {
                Text(registering ? "用户名支持 3–32 个字符，可使用英文字母、数字和下划线。密码至少 10 个字符，避免纯数字、常见组合或与用户名相似的内容。" : "可使用网页版的账号登录。")
            }
            ErrorNotice()
            Button {
                submitting = true
                store.errorMessage = nil
                Task {
                    let success = await store.authenticate(username: username, password: password,
                        confirmation: registering ? confirmation : nil, remember: remember)
                    submitting = false
                    if success { password = ""; confirmation = ""; dismiss() }
                }
            } label: {
                HStack { Spacer(); if submitting { ProgressView() }; Text(registering ? "创建账号" : "登录"); Spacer() }
            }
            .accessibilityIdentifier("auth-submit")
            .disabled(submitting || username.isEmpty || password.isEmpty || (registering && confirmation.isEmpty))

        }
        .disabled(submitting)
        .navigationTitle(registering ? "创建账号" : store.user == nil ? "登录" : "重新登录")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() }.disabled(submitting) } }
        .interactiveDismissDisabled(submitting)
        .onAppear { username = store.user?.username ?? ""; store.errorMessage = nil }
    }
}

struct PasswordView: View {
    @EnvironmentObject private var store: ArchiveStore
    @Environment(\.dismiss) private var dismiss
    @State private var current = ""
    @State private var password = ""
    @State private var confirmation = ""
    @State private var submitting = false
    var body: some View {
        Form {
            Section {
                SecureField("当前密码", text: $current).textContentType(.password)
                SecureField("新密码", text: $password).textContentType(.newPassword)
                SecureField("再次输入新密码", text: $confirmation).textContentType(.newPassword)
            } footer: { Text("密码为 10–128 个字符，不能只用数字。修改后，这台设备保持登录，其他设备需要重新登录。") }
            ErrorNotice()
            Button("保存新密码") {
                submitting = true
                store.errorMessage = nil
                Task {
                    let success = await store.changePassword(current: current, password: password, confirmation: confirmation)
                    submitting = false
                    if success { current = ""; password = ""; confirmation = ""; dismiss() }
                }
            }.disabled(submitting || current.isEmpty || password.isEmpty || confirmation.isEmpty)
        }
        .disabled(submitting)
        .navigationTitle("修改密码").navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() }.disabled(submitting) } }
        .interactiveDismissDisabled(submitting)
        .onAppear { store.errorMessage = nil }
    }
}

struct ImportPreviewView: View {
    @EnvironmentObject private var store: ArchiveStore
    @Environment(\.dismiss) private var dismiss
    let prepared: PreparedImport
    @State private var validation: String?
    var body: some View {
        Form {
            Section("导入预览") {
                LabeledContent("导入到", value: store.user?.username ?? "这台设备（未登录）")
                LabeledContent("收藏记录", value: "\(prepared.backup.collection.count) 项")
                LabeledContent("已拥有", value: "\(prepared.backup.collection.values.filter(\.owned).count) 款")
                LabeledContent("将替换的现有记录", value: "\(prepared.replacingCount) 项")
                LabeledContent("关注系列", value: "\(prepared.backup.followedSeries.count) 个")
                LabeledContent("未识别的记录", value: "\(prepared.backup.unmapped.count) 项")
            }
            Section {
                Text("已有相同通行认证时，用备份中的记录替换；其他收藏保留。关注的系列会合并，导入前的收藏也会自动备份。")
                    .font(.footnote).foregroundStyle(.secondary)
                ForEach(prepared.warnings, id: \.self) { Text($0).font(.footnote).foregroundStyle(.orange) }
                if let validation { Text(validation).font(.footnote).foregroundStyle(.red) }
                Button("确认导入") {
                    do { try store.applyImport(prepared); dismiss() } catch { validation = error.localizedDescription }
                }.disabled(!store.canEdit || store.scope != prepared.scope)
            }
        }.navigationTitle("导入备份").navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() } } }
    }
}

struct ConflictView: View {
    @EnvironmentObject private var store: ArchiveStore
    @State private var choice: MergeChoice?
    @State private var confirm = false
    @State private var reviewed: [MergeConflict] = []
    var body: some View {
        List {
            Section {
                Text("这些记录在这台设备和云端都有修改，请比较后选择保留的版本。其他记录会自动合并。").font(.footnote).foregroundStyle(.secondary)
                ForEach(store.conflicts) { conflict in
                    VStack(alignment: .leading, spacing: 10) {
                        Text(title(conflict)).font(.subheadline.weight(.medium))
                        Text("此设备：\(describe(conflict.local))").font(.caption)
                        Text("云端：\(describe(conflict.cloud))").font(.caption).foregroundStyle(.secondary)
                        DisclosureGroup("查看完整记录") {
                            Text("此设备\n\(fullRecord(conflict.local))\n\n云端\n\(fullRecord(conflict.cloud))")
                                .font(.caption.monospaced()).textSelection(.enabled)
                        }.font(.caption)
                    }.padding(.vertical, 5)
                }
                if store.conflicts.isEmpty { Label("所有记录已确认", systemImage: "checkmark.circle").foregroundStyle(ArchiveTheme.green) }
            }
            if !store.conflicts.isEmpty {
                Section {
                    Button("这些记录全部保留此设备的版本") { reviewed = store.conflicts; choice = .local; confirm = true }
                    Button("这些记录全部保留云端版本") { reviewed = store.conflicts; choice = .cloud; confirm = true }
                }.disabled(store.isSyncing || store.isAccountBusy)
            }
        }
        .navigationTitle("选择要保留的记录").navigationBarTitleDisplayMode(.inline)
        .confirmationDialog("将这些待确认记录全部替换为\(choice == .cloud ? "云端" : "此设备")的版本？其他记录会自动合并。", isPresented: $confirm, titleVisibility: .visible) {
            Button("确认并同步") { Task { await store.sync(choice: choice, expectedConflicts: reviewed) } }
        }
    }
    private func title(_ conflict: MergeConflict) -> String {
        guard conflict.section == "collection" else { return "未识别记录：\(conflict.key)" }
        for series in store.catalog.series {
            if let pass = series.passes.first(where: { $0.id == conflict.key }) { return "\(pass.label) · \(series.name)" }
        }
        return conflict.key
    }
    private func describe(_ value: JSONValue?) -> String {
        guard let value else { return "已删除" }
        if let object = value.object, let owned = object["owned"]?.bool {
            if !owned { return "未拥有" }
            let market = object["market"]?.string.map { "市价 ¥" + $0 } ?? "市价未填写"
            let lots = object["lots"]?.array ?? []
            var quantity = 0
            var cost: Decimal = 0
            for lot in lots {
                if case .number(let qty) = lot.object?["qty"] {
                    quantity += NSDecimalNumber(decimal: qty).intValue
                    cost += ArchiveRules.decimal(lot.object?["cost"]?.string) * qty
                }
            }
            return "已拥有 · \(market) · \(quantity) 张 / \(lots.count) 笔 · 成本 ¥\(ArchiveRules.currency(cost))"
        }
        return "未识别的记录，展开查看完整内容"
    }
    private func fullRecord(_ value: JSONValue?) -> String {
        guard let value else { return "已删除" }
        if let data = try? ArchiveCoding.encoder().encode(value),
           let record = try? ArchiveCoding.decoder().decode(CollectionRecord.self, from: data) {
            var lines = ["拥有状态：\(record.owned ? "已拥有" : "未拥有")",
                         "单张参考市价：\(record.market.map { "¥" + $0 } ?? "未填写")"]
            if record.lots.isEmpty { lines.append("购买记录：未填写") }
            for (index, lot) in record.lots.enumerated() {
                lines.append("第 \(index + 1) 笔：单价 ¥\(lot.cost) × \(lot.qty) 张")
            }
            return lines.joined(separator: "\n")
        }
        return String(data: (try? ArchiveCoding.encoder().encode(value)) ?? Data(), encoding: .utf8) ?? "无法显示"
    }
}

struct UnmappedView: View {
    @EnvironmentObject private var store: ArchiveStore
    var body: some View {
        List {
            Section { Text("这些记录暂时无法对应到当前目录，可能来自旧版备份或尚未收录的系列。记录已保留，仍可同步和导出。").font(.footnote).foregroundStyle(.secondary) }
            ForEach(store.backup.unmapped.keys.sorted(), id: \.self) { key in
                DisclosureGroup(key) {
                    Text(String(data: (try? ArchiveCoding.encoder().encode(store.backup.unmapped[key])) ?? Data(), encoding: .utf8) ?? "")
                        .font(.caption.monospaced()).textSelection(.enabled)
                }
            }
        }.navigationTitle("未识别的记录").navigationBarTitleDisplayMode(.inline)
    }
}
