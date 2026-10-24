// 与 web/src/core.ts 和 backend/api/domain.py 对齐的离线规则。
import Foundation

enum ArchiveRules {
    static let maximumBackupSize = 2 * 1024 * 1024
    static let maximumJSONDepth = 64

    private static func checkDepth(_ value: JSONValue, depth: Int = 0) throws {
        guard depth <= maximumJSONDepth else { throw ArchiveError("备份内容过于复杂，暂时无法读取。请检查文件后重试。") }
        switch value {
        case .object(let items): for item in items.values { try checkDepth(item, depth: depth + 1) }
        case .array(let items): for item in items { try checkDepth(item, depth: depth + 1) }
        default: break
        }
    }

    // 不依赖文件大小元数据；最多读取上限加一个字节，避免导入大文件时耗尽内存。
    static func readBackupFile(_ url: URL) throws -> Data {
        let file: FileHandle
        do { file = try FileHandle(forReadingFrom: url) }
        catch { throw ArchiveError("无法打开备份文件，请确认文件已下载且可以读取。") }
        defer { try? file.close() }
        var result = Data()
        do {
            while result.count <= maximumBackupSize {
                let remaining = maximumBackupSize + 1 - result.count
                guard let chunk = try file.read(upToCount: min(64 * 1024, remaining)), !chunk.isEmpty else { break }
                result.append(chunk)
            }
        } catch { throw ArchiveError("读取备份失败，请重新选择文件。") }
        guard result.count <= maximumBackupSize else { throw ArchiveError("备份文件过大，请选择不超过 2 MB 的文件。") }
        return result
    }

    static func money(_ text: String?) throws -> String? {
        guard let text, !text.isEmpty else { return nil }
        guard text.range(of: #"^[0-9]+(\.[0-9]{1,2})?$"#, options: .regularExpression) != nil,
              let amount = Decimal(string: text, locale: Locale(identifier: "en_US_POSIX")),
              amount <= 3_250_000 else {
            throw ArchiveError("金额请输入 0–3,250,000 之间的数字，最多保留两位小数。")
        }
        return currency(amount)
    }

    static func currency(_ amount: Decimal) -> String {
        var source = amount, rounded = Decimal()
        NSDecimalRound(&rounded, &source, 2, .plain)
        let text = NSDecimalNumber(decimal: rounded).stringValue
        let parts = text.split(separator: ".", omittingEmptySubsequences: false)
        let fraction = parts.count > 1 ? String(parts[1]) : ""
        return String(parts[0]) + "." + fraction + String(repeating: "0", count: max(0, 2 - fraction.count))
    }

    static func normalized(_ record: CollectionRecord) throws -> CollectionRecord {
        guard record.lots.count <= 1000 else { throw ArchiveError("每款通行认证最多支持 1,000 笔购买记录。") }
        let lots = try record.lots.map { lot -> PurchaseLot in
            guard (1...999).contains(lot.qty) else { throw ArchiveError("每笔购买数量请输入 1–999 之间的整数。") }
            return PurchaseLot(cost: try money(lot.cost) ?? "0.00", qty: lot.qty)
        }
        let market = try money(record.market)
        return record.owned ? CollectionRecord(owned: true, market: market, lots: lots) : .empty
    }

    static func stats(catalog: Catalog, collection: [String: CollectionRecord]) -> ArchiveStats {
        var result = ArchiveStats()
        var official: Decimal = 0, market: Decimal = 0, cost: Decimal = 0, pricedCost: Decimal = 0
        for series in catalog.series {
            var boxOwned = 0
            let fixed = series.passes.first?.officialUnitPrice == nil
            for pass in series.passes {
                result.total += 1
                guard let record = collection[pass.id], record.owned else { continue }
                result.owned += 1
                boxOwned += 1
                let quantity = record.quantity
                let entryCost = record.lots.reduce(Decimal.zero) { $0 + decimal($1.cost) * Decimal($1.qty) }
                let price = decimal(record.market)
                result.quantity += quantity
                cost += entryCost
                market += price * Decimal(quantity)
                if price > 0 { result.pricedOwned += 1; pricedCost += entryCost }
                if !fixed { official += (pass.officialUnitPrice ?? 0) * Decimal(quantity) }
            }
            if fixed && boxOwned > 0 { official += series.officialBoxPrice }
            if boxOwned > 0 && boxOwned == series.passes.count { result.completedSeries += 1 }
        }
        result.progress = result.total == 0 ? 0 : (Double(result.owned) / Double(result.total) * 1000).rounded() / 10
        result.official = currency(official)
        result.market = currency(market)
        result.cost = currency(cost)
        result.profit = currency(market - pricedCost)
        return result
    }

    static func decimal(_ value: String?) -> Decimal {
        Decimal(string: value ?? "0", locale: Locale(identifier: "en_US_POSIX")) ?? 0
    }

    static func search(catalog: Catalog, backup: ArchiveBackup, query: CatalogQuery) -> [SeriesMatch] {
        let words = folded(query.text).split(whereSeparator: { $0.isWhitespace }).map(String.init)
        return catalog.series.compactMap { series in
            guard query.type.isEmpty || series.type == query.type,
                  !query.followedOnly || backup.followedSeries.contains(series.id) else { return nil }
            let seriesText = "\(series.name) \(series.boxNumber ?? "") \(series.barcodes.joined(separator: " "))"
            let passes = series.passes.filter { pass in
                let owned = backup.collection[pass.id]?.owned == true
                guard query.ownership != .owned || owned,
                      query.ownership != .missing || !owned,
                      query.rarity == nil || query.rarity == pass.rarity else { return false }
                let text = folded("\(seriesText) \(pass.searchText) \(pass.label) \(pass.en ?? "")")
                return words.allSatisfy { text.contains($0) }
            }
            return passes.isEmpty ? nil : SeriesMatch(series: series, passes: passes)
        }
    }

    private static func folded(_ value: String) -> String {
        value.folding(options: [.caseInsensitive, .diacriticInsensitive, .widthInsensitive], locale: Locale(identifier: "en_US_POSIX"))
            .replacingOccurrences(of: "・", with: "·")
    }

    // 本机校验，离线也能导入；未知 ID 原样进入 unmapped。
    static func importBackup(_ data: Data, catalog: Catalog) throws -> (ArchiveBackup, [String]) {
        guard data.count <= maximumBackupSize else { throw ArchiveError("备份文件过大，请选择不超过 2 MB 的文件。") }
        let value: JSONValue
        do { value = try JSONDecoder().decode(JSONValue.self, from: data) }
        catch { throw ArchiveError("无法识别备份文件，请选择从本应用或原收集册导出的 JSON 文件。") }
        try checkDepth(value)
        guard let root = value.object else { throw ArchiveError("备份文件格式不正确，请重新导出后再试。") }
        let versioned = root["schema_version"] != nil
        if let version = root["schema_version"], version != .number(1) { throw ArchiveError("暂不支持这个版本的备份，请更新应用后再试。") }
        guard let raw = (root["collection"] ?? value).object, raw.count <= 10_000 else {
            throw ArchiveError("备份中的收藏格式不正确，或超过了 10,000 条记录的上限。")
        }
        var backup = ArchiveBackup(catalogVersion: catalog.version)
        let known = Set(catalog.series.flatMap { $0.passes.map(\.id) })
        if versioned, let unmapped = root["unmapped"] {
            guard let object = unmapped.object else { throw ArchiveError("备份中未识别记录的格式不正确，请重新导出后再试。") }
            backup.unmapped = object
        }
        if versioned || raw.keys.allSatisfy({ known.contains($0) }) {
            for (id, entry) in raw {
                if known.contains(id) { backup.collection[id] = try readRecord(entry) }
                else { backup.unmapped[id] = entry }
            }
        } else {
            var legacy: [String: [String: String]] = [:]
            for series in catalog.series {
                legacy[series.name] = Dictionary(uniqueKeysWithValues: series.passes.map { ($0.label, $0.id) })
            }
            for (series, entry) in raw {
                guard let object = entry.object else { throw ArchiveError("旧版备份中的系列记录格式不正确，请检查文件。") }
                guard let own = (object["ownedChars"] ?? .object([:])).object,
                      let prices = (object["prices"] ?? .object([:])).object else {
                    throw ArchiveError("旧版备份中的拥有状态或价格无法读取，请检查文件。")
                }
                for label in Set(own.keys).union(prices.keys) {
                    guard let price = (prices[label] ?? .object([:])).object else { throw ArchiveError("旧版备份中的价格无法读取，请检查文件。") }
                    var lots = price["lots"]
                    if lots == nil || lots == .null {
                        let oldCost = price["cost"]
                        lots = oldCost == nil || oldCost == .null || oldCost == .string("") ? .array([])
                            : .array([.object(["cost": oldCost!, "qty": .number(1)])])
                    } else if let array = lots?.array {
                        lots = .array(array.filter { $0.object?["cost"] != nil && $0.object?["cost"] != .null && $0.object?["cost"] != .string("") })
                    }
                    let record = try readRecord(.object(["owned": .bool(legacyTruthy(own[label])), "market": price["market"] ?? .null, "lots": lots!]))
                    if let id = legacy[series]?[label] { backup.collection[id] = record }
                    else {
                        var preserved = try JSONDecoder().decode(JSONValue.self, from: ArchiveCoding.encoder().encode(record)).object!
                        preserved["legacy_series"] = .string(series)
                        preserved["legacy_label"] = .string(label)
                        backup.unmapped["\(series) / \(label)"] = .object(preserved)
                    }
                }
            }
        }
        if let followed = root["followed_series"] {
            let knownSeries = Set(catalog.series.map(\.id))
            guard let array = followed.array, array.count <= 2000 else { throw ArchiveError("备份中的关注系列无法读取，请重新导出后再试。") }
            let ids = try array.map { value -> String in
                guard let id = value.string, knownSeries.contains(id) else { throw ArchiveError("备份中有尚未收录的关注系列，请更新目录后再导入。") }
                return id
            }
            backup.followedSeries = Array(Set(ids)).sorted()
        }
        let warnings = backup.unmapped.isEmpty ? [] : ["\(backup.unmapped.count) 条记录尚未识别，已单独保留，可继续同步和导出。"]
        return (backup, warnings)
    }

    private static func readRecord(_ value: JSONValue) throws -> CollectionRecord {
        guard let object = value.object else { throw ArchiveError("备份中的收藏记录格式不正确，请检查文件。") }
        guard let owned = (object["owned"] ?? .bool(false)).bool else { throw ArchiveError("备份中的拥有状态无法读取，请检查文件。") }
        guard let array = (object["lots"] ?? .array([])).array, array.count <= 1000 else { throw ArchiveError("备份中的购买记录无法读取，或超过了每次 1,000 笔的上限。") }
        let lots = try array.map { value -> PurchaseLot in
            guard let lot = value.object else { throw ArchiveError("备份中的购买记录无法读取，或超过了每款 1,000 笔的上限。") }
            let quantity = lot["qty"] ?? .number(1)
            guard case .number(let number) = quantity, number >= 1, number <= 999,
                  number == Decimal(NSDecimalNumber(decimal: number).intValue) else {
                throw ArchiveError("每笔购买数量请输入 1–999 之间的整数。")
            }
            return PurchaseLot(cost: try readMoney(lot["cost"]) ?? "0.00", qty: NSDecimalNumber(decimal: number).intValue)
        }
        return try normalized(CollectionRecord(owned: owned, market: readMoney(object["market"]), lots: lots))
    }

    private static func readMoney(_ value: JSONValue?) throws -> String? {
        guard let value, value != .null else { return nil }
        switch value {
        case .string(let text): return try money(text)
        case .number(let amount): return try money(NSDecimalNumber(decimal: amount).stringValue)
        default: throw ArchiveError("金额格式不正确，请填写数字，最多保留两位小数。")
        }
    }

    private static func legacyTruthy(_ value: JSONValue?) -> Bool {
        guard let value, value != .null, value != .bool(false), value != .number(0), value != .string("") else { return false }
        return true
    }
}
