import SwiftUI

private struct LotDraft: Identifiable {
    let id = UUID()
    var cost: String
    var quantity: String
}

struct RecordEditorView: View {
    @EnvironmentObject private var store: ArchiveStore
    @Environment(\.dismiss) private var dismiss
    let pass: PassItem
    let observed: CollectionRecord
    let scope: String
    @State private var owned: Bool
    @State private var market: String
    @State private var lots: [LotDraft]
    @State private var confirmClear = false
    @State private var validation: String?
    init(pass: PassItem, record: CollectionRecord, scope: String) {
        self.pass = pass; self.observed = record; self.scope = scope
        _owned = State(initialValue: record.owned)
        _market = State(initialValue: record.market ?? "")
        _lots = State(initialValue: record.lots.map { LotDraft(cost: $0.cost, quantity: String($0.qty)) })
    }
    var body: some View {
        Form {
            Section {
                HStack(spacing: 18) {
                    ArchiveImage(url: store.imageURL(pass.avatar)).frame(width: 70, height: 84)
                    VStack(alignment: .leading, spacing: 6) {
                        Text(pass.label).font(.headline)
                        Text(pass.en ?? "").font(.subheadline).foregroundStyle(.secondary)
                        if let price = pass.officialUnitPrice { Text("官方参考价（每张） ¥\(ArchiveRules.currency(price))").font(.caption).foregroundStyle(.secondary) }
                        else { Text("此系列的官方参考价按整盒计算").font(.caption).foregroundStyle(.secondary) }
                    }
                }
                Toggle("已拥有", isOn: $owned)
            }
            if owned {
                Section {
                    LabeledContent("单张参考市价") {
                        TextField("未填写", text: $market).keyboardType(.decimalPad).multilineTextAlignment(.trailing)
                            .accessibilityIdentifier("record-market")
                    }
                } footer: { Text("不知道市价时可留空。填写 0 表示市价为零；只有市价大于 0 的款式参与盈亏计算。") }
                Section {
                    ForEach($lots) { $lot in
                        VStack(alignment: .leading, spacing: 12) {
                            HStack {
                                Text("购买记录").font(.subheadline.weight(.medium))
                                Spacer()
                                Button(role: .destructive) { lots.removeAll { $0.id == lot.id } } label: { Image(systemName: "minus.circle") }
                                    .buttonStyle(.borderless).accessibilityLabel("删除这笔购买记录")
                            }
                            LabeledContent("购入单价") {
                                TextField("0.00", text: $lot.cost).keyboardType(.decimalPad).multilineTextAlignment(.trailing)
                                    .accessibilityIdentifier("lot-cost")
                            }
                            LabeledContent("数量") {
                                TextField("1–999", text: $lot.quantity).keyboardType(.numberPad).multilineTextAlignment(.trailing)
                                    .accessibilityIdentifier("lot-quantity")
                            }
                        }.padding(.vertical, 5)
                    }
                    Button("添加一笔购买记录", systemImage: "plus") { lots.append(LotDraft(cost: "", quantity: "1")) }
                        .disabled(lots.count >= 1000)
                } header: { Text("购买记录 · \(lots.count) 笔") }
                footer: { Text("每笔记录填写购入单价和张数。只标记“已拥有”时，会计入收集进度；填写购买记录后，才计入数量和金额统计。") }
            }
            if let validation { Section { Text(validation).foregroundStyle(.red).font(.footnote) } }
        }
        .disabled(!store.canEdit)
        .navigationTitle("收藏记录").navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItem(placement: .topBarTrailing) {
            Button("保存") {
                if !owned && observed.owned && (!observed.lots.isEmpty || observed.market != nil) { confirmClear = true }
                else { save() }
            }.fontWeight(.semibold).disabled(!store.canEdit)
        } }
        .confirmationDialog("取消拥有后，将删除这张通行认证的市价和购买记录。", isPresented: $confirmClear, titleVisibility: .visible) {
            Button("删除记录并保存", role: .destructive) { save() }
        }
    }
    private func save() {
        do {
            let entries = try owned ? lots.map { lot -> PurchaseLot in
                guard let qty = Int(lot.quantity), (1...999).contains(qty) else { throw ArchiveError("每笔购买数量请输入 1–999 之间的整数。") }
                return PurchaseLot(cost: try ArchiveRules.money(lot.cost) ?? "0.00", qty: qty)
            } : []
            let value = CollectionRecord(owned: owned, market: owned ? try ArchiveRules.money(market) : nil, lots: entries)
            try store.saveRecord(pass.id, value: value, observed: observed, scope: scope)
            dismiss()
        } catch { validation = error.localizedDescription }
    }
}

struct StatisticsView: View {
    @EnvironmentObject private var store: ArchiveStore
    private var stats: ArchiveStats { store.stats }
    var body: some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: 12) {
                    Text("COLLECTION / OVERVIEW").font(.caption.monospaced()).tracking(1.5).foregroundStyle(.secondary)
                    HStack(alignment: .firstTextBaseline) {
                        Text("\(stats.progress, specifier: "%.1f")").font(.system(size: 54, weight: .light, design: .rounded))
                        Text("%").font(.title2).foregroundStyle(.secondary)
                        Spacer()
                        Image(systemName: "chart.pie").font(.largeTitle).foregroundStyle(ArchiveTheme.green)
                    }.monospacedDigit()
                    ProgressView(value: Double(stats.owned), total: Double(max(1, stats.total))).tint(ArchiveTheme.green)
                    Text("\(stats.owned) / \(stats.total) 款 · 已集齐 \(stats.completedSeries) 个系列").font(.subheadline).foregroundStyle(.secondary)
                }.padding(.vertical, 8)
            }
            Section("数量") {
                LabeledContent("已拥有款式", value: "\(stats.owned) 款")
                LabeledContent("已记录购买数量", value: "\(stats.quantity) 张")
                LabeledContent("参与盈亏计算", value: "\(stats.pricedOwned) 款")
                LabeledContent("关注系列", value: "\(store.backup.followedSeries.count) 个")
            }
            Section("金额 · 人民币") {
                moneyRow("购入总额", stats.cost)
                moneyRow("市价估值", stats.market)
                moneyRow("官方参考价合计", stats.official)
                HStack {
                    Text("估算盈亏")
                    Spacer()
                    Text("¥\(stats.profit)").monospacedDigit().foregroundStyle(ArchiveRules.decimal(stats.profit) >= 0 ? ArchiveTheme.green : .red)
                }
            }
            Section("各系列进度") {
                ForEach(store.catalog.series.filter { series in series.passes.contains { store.backup.collection[$0.id]?.owned == true } }) { series in
                    NavigationLink { SeriesView(seriesID: series.id) } label: {
                        VStack(alignment: .leading, spacing: 8) {
                            Text(series.name).font(.subheadline)
                            let count = series.passes.filter { store.backup.collection[$0.id]?.owned == true }.count
                            HStack {
                                ProgressView(value: Double(count), total: Double(max(1, series.passes.count))).tint(ArchiveTheme.green)
                                Text("\(count)/\(series.passes.count)").font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                            }
                        }.padding(.vertical, 4)
                    }
                }
                if stats.owned == 0 { Text("将通行认证标记为“已拥有”后，这里会显示收集进度。").foregroundStyle(.secondary) }
            }
        }.navigationTitle("收藏统计")
        .refreshable { await store.sync() }
    }

    private func moneyRow(_ title: String, _ value: String) -> some View {
        HStack {
            Text(title)
            Spacer()
            Text("¥\(value)").monospacedDigit().foregroundStyle(.secondary)
        }
    }
}
