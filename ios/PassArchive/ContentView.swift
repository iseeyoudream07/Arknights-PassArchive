import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var store: ArchiveStore
    @State private var search = ""
    var filtered: [PassSeries] {
        guard let catalog = store.catalog else { return [] }
        if search.isEmpty { return catalog.series }
        return catalog.series.filter { s in
            s.name.localizedCaseInsensitiveContains(search) || s.barcodes.contains(search) ||
            s.passes.contains { $0.searchText.localizedCaseInsensitiveContains(search) }
        }
    }
    var body: some View {
        TabView {
            NavigationStack {
                List {
                    Section {
                        HStack {
                            VStack(alignment: .leading, spacing: 6) {
                                Text("PASS / ARCHIVE").font(.caption.monospaced()).foregroundStyle(.secondary)
                                Text("通行认证档案").font(.title2.weight(.medium))
                                Text("已拥有 \(store.owned.count) / \(store.catalog?.counts.passes ?? 0)").font(.subheadline)
                            }
                            Spacer()
                            Image(systemName: "circle.hexagongrid").font(.largeTitle).foregroundStyle(.orange)
                        }.padding(.vertical, 9)
                    }
                    Section("系列目录") {
                        ForEach(filtered) { series in
                            NavigationLink { SeriesView(series: series) } label: {
                                HStack(spacing: 14) {
                                    ArchiveImage(url: store.imageURL(series.image)).frame(width: 72, height: 65)
                                    VStack(alignment: .leading, spacing: 6) {
                                        Text(series.name).font(.subheadline.weight(.medium))
                                        Text("\(series.releaseDate ?? series.year ?? "—") · \(series.passes.count) 种")
                                            .font(.caption).foregroundStyle(.secondary)
                                    }
                                }.padding(.vertical, 5)
                            }
                        }
                    }
                    Section { Text(store.status).font(.caption).foregroundStyle(.secondary) }
                }
                .navigationTitle("通行认证")
                .searchable(text: $search, prompt: "干员、盒号、拼音或条码")
                .refreshable { await store.refresh() }
            }.tabItem { Label("通行认证", systemImage: "square.grid.2x2") }
            NavigationStack {
                List {
                    ForEach(store.catalog?.series ?? []) { series in
                        let selected = series.passes.filter { store.owned.contains($0.id) }
                        if !selected.isEmpty {
                            Section(series.name) { ForEach(selected) { p in PassRow(pass: p) } }
                        }
                    }
                    if store.owned.isEmpty {
                        ContentUnavailableView("从第一张开始", systemImage: "rectangle.stack.badge.plus", description: Text("在系列目录中标记已拥有的通行认证。"))
                    }
                }.navigationTitle("我的收藏")
            }.tabItem { Label("我的收藏", systemImage: "checkmark.rectangle.stack") }
        }
        .tint(Color(red: 0.72, green: 0.40, blue: 0.24))
        .task { await store.refresh() }
    }
}
struct SeriesView: View {
    @EnvironmentObject private var store: ArchiveStore
    let series: PassSeries
    var body: some View {
        List {
            Section {
                ArchiveImage(url: store.imageURL(series.image)).frame(maxWidth: .infinity).frame(height: 200)
                Text(series.name).font(.headline)
                Text("已拥有 \(series.passes.filter { store.owned.contains($0.id) }.count) / \(series.passes.count)")
                    .font(.subheadline).foregroundStyle(.secondary)
            }
            Section("盒内通行认证") { ForEach(series.passes) { PassRow(pass: $0) } }
        }.navigationTitle("系列档案").navigationBarTitleDisplayMode(.inline)
    }
}
struct PassRow: View {
    @EnvironmentObject private var store: ArchiveStore
    let pass: PassItem
    var body: some View {
        Toggle(isOn: Binding(get: { store.owned.contains(pass.id) }, set: { store.setOwned(pass.id, $0) })) {
            HStack(spacing: 12) {
                ArchiveImage(url: store.imageURL(pass.avatar)).frame(width: 54, height: 58)
                VStack(alignment: .leading, spacing: 5) {
                    Text(pass.label).font(.subheadline.weight(.medium))
                    Text(pass.en ?? "").font(.caption).foregroundStyle(.secondary)
                }
            }.padding(.vertical, 5)
        }
    }
}
struct ArchiveImage: View {
    let url: URL?
    var body: some View {
        AsyncImage(url: url) { phase in
            if let image = phase.image { image.resizable().scaledToFit() }
            else { Image(systemName: "rectangle.stack").foregroundStyle(.secondary).frame(maxWidth: .infinity, maxHeight: .infinity) }
        }
    }
}
