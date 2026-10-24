// 原生导航与目录。三维终端保留 Web 入口，日常查询和记录在本机完成。
import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var store: ArchiveStore
    @Environment(\.scenePhase) private var scenePhase
    @AppStorage("appearance") private var appearance = "system"
    var body: some View {
        TabView {
            NavigationStack { CatalogBrowser() }
                .tabItem { Label("目录", systemImage: "square.grid.2x2") }
            NavigationStack { CatalogBrowser(collectionOnly: true) }
                .tabItem { Label("收藏", systemImage: "checkmark.rectangle.stack") }
            NavigationStack { StatisticsView() }
                .tabItem { Label("统计", systemImage: "chart.bar.xaxis") }
            NavigationStack { AccountView() }
                .tabItem { Label("我的", systemImage: "person.crop.circle") }
        }
        .tint(ArchiveTheme.accent)
        .preferredColorScheme(appearance == "light" ? .light : appearance == "dark" ? .dark : nil)
        .safeAreaInset(edge: .top, spacing: 0) { ErrorNotice() }
        .task { await store.start() }
        .task(id: scenePhase) {
            store.isActive = scenePhase == .active
            guard scenePhase == .active else { return }
            await store.sync()
            while !Task.isCancelled {
                do { try await Task.sleep(for: .seconds(30)) } catch { return }
                guard !Task.isCancelled else { return }
                await store.sync()
            }
        }
    }
}

enum ArchiveTheme {
    static let accent = Color(red: 0.66, green: 0.37, blue: 0.23)
    static let green = Color(red: 0.27, green: 0.47, blue: 0.40)
}

struct CatalogBrowser: View {
    @EnvironmentObject private var store: ArchiveStore
    let collectionOnly: Bool
    @State private var query: CatalogQuery
    init(collectionOnly: Bool = false) {
        self.collectionOnly = collectionOnly
        _query = State(initialValue: CatalogQuery(ownership: collectionOnly ? .owned : .all))
    }
    private var matches: [SeriesMatch] { ArchiveRules.search(catalog: store.catalog, backup: store.backup, query: query) }
    private var hasNoCollection: Bool { collectionOnly && store.stats.owned == 0 }
    var body: some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: 14) {
                    HStack {
                        Text("PASS / ARCHIVE").font(.caption.monospaced()).tracking(2)
                        Spacer()
                        Image(systemName: "circle.hexagongrid.fill").foregroundStyle(ArchiveTheme.accent)
                    }.foregroundStyle(.secondary)
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Text("\(store.stats.owned)").font(.system(size: 44, weight: .light, design: .rounded)).monospacedDigit()
                        Text("/ \(store.stats.total) 款").font(.subheadline).foregroundStyle(.secondary)
                        Spacer()
                        Text("\(store.stats.progress, specifier: "%.1f")%")
                            .font(.title3.monospacedDigit()).foregroundStyle(ArchiveTheme.green)
                    }
                    ProgressView(value: Double(store.stats.owned), total: Double(max(1, store.stats.total))).tint(ArchiveTheme.green)
                    Text(collectionOnly ? "查看已拥有的通行认证和购买记录。" : "\(store.catalog.counts.series) 个系列 · \(store.catalog.counts.operators) 名干员")
                        .font(.caption).foregroundStyle(.secondary)
                }.padding(.vertical, 8)
            }
            Section {
                HStack {
                    Menu {
                        Picker("系列类型", selection: $query.type) {
                            Text("全部系列").tag("")
                            ForEach(Array(Set(store.catalog.series.map(\.type))).sorted(), id: \.self) { type in
                                Text(store.catalog.series.first { $0.type == type }?.typeLabel ?? type).tag(type)
                            }
                        }
                        Picker("星级", selection: $query.rarity) {
                            Text("全部星级").tag(Int?.none)
                            ForEach(1...6, id: \.self) { Text("\($0) 星").tag(Optional($0)) }
                        }
                        if !collectionOnly {
                            Picker("拥有状态", selection: $query.ownership) {
                                ForEach(OwnershipFilter.allCases) { Text($0.rawValue).tag($0) }
                            }
                        }
                    } label: { Label(filterLabel, systemImage: "line.3.horizontal.decrease") }
                    Spacer()
                    Toggle(isOn: $query.followedOnly) { Label("关注", systemImage: "star") }
                        .toggleStyle(.button).font(.subheadline)
                }.font(.subheadline)
            }
            Section("\(matches.count) 个系列 · \(matches.reduce(0) { $0 + $1.passes.count }) 款通行认证") {
                ForEach(matches) { match in
                    NavigationLink {
                        SeriesView(seriesID: match.id, query: query)
                    } label: { SeriesCard(series: match.series) }
                }
                if matches.isEmpty {
                    ContentUnavailableView(hasNoCollection ? "还没有收藏" : "没有找到通行认证",
                        systemImage: collectionOnly ? "rectangle.stack.badge.plus" : "magnifyingglass",
                        description: Text(hasNoCollection ? "在目录中将通行认证标记为“已拥有”，或前往“我的”导入备份。" : "试试其他关键词，或调整系列、星级和拥有状态筛选。"))
                }
            }
            Section { Text(store.catalogStatus).font(.caption).foregroundStyle(.secondary) }
        }
        .navigationTitle(collectionOnly ? "我的收藏" : "通行认证目录")
        .searchable(text: $query.text, prompt: "搜索干员、拼音、盒号或条码")
        .refreshable { await store.refresh(); await store.sync() }
    }
    private var filterLabel: String {
        let type = query.type.isEmpty ? "全部系列" : store.catalog.series.first { $0.type == query.type }?.typeLabel ?? query.type
        return type + (query.rarity.map { " · \($0)星" } ?? "") + (query.ownership == .all || collectionOnly ? "" : " · \(query.ownership.rawValue)")
    }
}

struct SeriesCard: View {
    @EnvironmentObject private var store: ArchiveStore
    let series: PassSeries
    private var owned: Int { series.passes.filter { store.backup.collection[$0.id]?.owned == true }.count }
    var body: some View {
        HStack(spacing: 14) {
            ArchiveImage(url: store.imageURL(series.image)).frame(width: 74, height: 82)
                .background(Color(.secondarySystemGroupedBackground)).clipShape(RoundedRectangle(cornerRadius: 8))
            VStack(alignment: .leading, spacing: 7) {
                HStack(alignment: .top) {
                    Text(series.name).font(.subheadline.weight(.medium)).lineLimit(2)
                    if store.backup.followedSeries.contains(series.id) { Image(systemName: "star.fill").font(.caption).foregroundStyle(ArchiveTheme.accent) }
                }
                Text("\(series.typeLabel) · \(series.releaseDate ?? series.year ?? "发行日期待补充")")
                    .font(.caption).foregroundStyle(.secondary)
                HStack {
                    ProgressView(value: Double(owned), total: Double(max(1, series.passes.count))).tint(ArchiveTheme.green)
                    Text("\(owned)/\(series.passes.count)").font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                }
            }
        }.padding(.vertical, 5)
    }
}

struct SeriesView: View {
    @EnvironmentObject private var store: ArchiveStore
    let seriesID: String
    var query = CatalogQuery()
    @State private var confirmClear = false
    private var series: PassSeries? { store.catalog.series.first { $0.id == seriesID } }
    private var passes: [PassItem] {
        ArchiveRules.search(catalog: store.catalog, backup: store.backup, query: query).first { $0.id == seriesID }?.passes ?? []
    }
    var body: some View {
        List {
            if let series {
                Section {
                    ArchiveImage(url: store.imageURL(series.image)).frame(maxWidth: .infinity).frame(height: 210)
                    Text(series.name).font(.title3.weight(.medium))
                    HStack {
                        Text(series.typeLabel)
                        Spacer()
                        Text("\(series.passes.filter { store.backup.collection[$0.id]?.owned == true }.count) / \(series.passes.count) 已拥有")
                    }.font(.subheadline).foregroundStyle(.secondary)
                    if let date = series.releaseDate { LabeledContent("发行日期", value: date).font(.subheadline) }
                    if !series.replicateDates.isEmpty {
                        LabeledContent("复刻日期", value: series.replicateDates.joined(separator: "、")).font(.caption)
                    }
                    if !series.barcodes.isEmpty {
                        Text(series.barcodes.joined(separator: "\n")).font(.caption.monospaced()).foregroundStyle(.secondary).textSelection(.enabled)
                    }
                }
                Section("通行认证 · \(passes.count) 款") {
                    ForEach(passes) { pass in PassRow(pass: pass) }
                    if passes.isEmpty { Text("没有符合条件的通行认证，返回目录可调整筛选。").foregroundStyle(.secondary) }
                }
            } else { ContentUnavailableView("系列暂不可用", systemImage: "rectangle.stack") }
        }
        .navigationTitle("系列详情").navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if let series {
                ToolbarItemGroup(placement: .topBarTrailing) {
                    Button { store.toggleFollow(series.id) } label: {
                        Image(systemName: store.backup.followedSeries.contains(series.id) ? "star.fill" : "star")
                    }.accessibilityLabel("关注系列").disabled(!store.canEdit)
                    Menu {
                        Button("将本系列全部标记为已拥有", systemImage: "checkmark.circle") { store.setSeriesOwned(series, true) }
                        Button("移除本系列全部收藏", systemImage: "trash", role: .destructive) { confirmClear = true }
                    } label: { Image(systemName: "ellipsis.circle") }.disabled(!store.canEdit)
                }
            }
        }
        .confirmationDialog("移除后，本系列将标记为“未拥有”，并删除市价和所有购买记录。", isPresented: $confirmClear, titleVisibility: .visible) {
            Button("移除本系列收藏", role: .destructive) { if let series { store.setSeriesOwned(series, false) } }
        }
    }
}

struct PassRow: View {
    @EnvironmentObject private var store: ArchiveStore
    let pass: PassItem
    @State private var confirmRemove = false
    private var record: CollectionRecord { store.backup.collection[pass.id] ?? .empty }
    var body: some View {
        HStack(spacing: 12) {
            NavigationLink {
                RecordEditorView(pass: pass, record: record, scope: store.scope)
            } label: {
                HStack(spacing: 12) {
                    ArchiveImage(url: store.imageURL(pass.avatar)).frame(width: 50, height: 60)
                    VStack(alignment: .leading, spacing: 5) {
                        Text(pass.label).font(.subheadline.weight(.medium))
                        Text(pass.en ?? "").font(.caption).foregroundStyle(.secondary)
                        if record.owned {
                            Text(record.lots.isEmpty ? "已拥有 · 购买数量未填写" : "\(record.quantity) 张 · 市价 \(record.market.map { "¥" + $0 } ?? "未填写")")
                                .font(.caption2).foregroundStyle(ArchiveTheme.green)
                        } else if let rarity = pass.rarity { Text("\(rarity) 星").font(.caption2).foregroundStyle(.secondary) }
                    }
                }
            }
            Button {
                if record.owned && (!record.lots.isEmpty || record.market != nil) { confirmRemove = true }
                else { store.setOwned(pass.id, !record.owned) }
            } label: {
                Image(systemName: record.owned ? "checkmark.circle.fill" : "plus.circle")
                    .font(.title2).foregroundStyle(record.owned ? ArchiveTheme.green : ArchiveTheme.accent)
            }
            .buttonStyle(.borderless).disabled(!store.canEdit)
            .accessibilityLabel(record.owned ? "取消拥有 \(pass.label)" : "标记拥有 \(pass.label)")
        }.padding(.vertical, 4)
        .confirmationDialog("取消拥有后，将删除这张通行认证的市价和购买记录。", isPresented: $confirmRemove, titleVisibility: .visible) {
            Button("取消拥有并删除记录", role: .destructive) { store.setOwned(pass.id, false) }
        }
    }
}

struct ArchiveImage: View {
    let url: URL?
    var body: some View {
        AsyncImage(url: url) { phase in
            if let image = phase.image { image.resizable().scaledToFit() }
            else {
                Image(systemName: "rectangle.stack").font(.title2).foregroundStyle(.tertiary)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .accessibilityHidden(true)
    }
}

struct ErrorNotice: View {
    @EnvironmentObject private var store: ArchiveStore
    var body: some View {
        if let error = store.errorMessage {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: "exclamationmark.circle")
                Text(error).font(.footnote).lineSpacing(3).frame(maxWidth: .infinity, alignment: .leading)
                    .accessibilityIdentifier("user-notice")
                Button { store.errorMessage = nil } label: { Image(systemName: "xmark") }.accessibilityLabel("关闭提示")
            }
            .foregroundStyle(.primary).padding(12).background(.regularMaterial)
        }
    }
}
