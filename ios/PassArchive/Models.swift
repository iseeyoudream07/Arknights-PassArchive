// 与 Web/API 共用的目录、收藏和备份协议。金额保存为十进制字符串。
import Foundation

struct Catalog: Codable, Sendable {
    let version: String
    let series: [PassSeries]
    let counts: CatalogCounts
}
struct CatalogCounts: Codable, Sendable {
    let series: Int
    let passes: Int
    let operators: Int
}
struct PassSeries: Codable, Identifiable, Sendable {
    let id: String
    let name: String
    let type: String
    let year: String?
    let boxNumber: String?
    let releaseDate: String?
    let replicateDates: [String]
    let image: String?
    let barcodes: [String]
    let officialBoxPrice: Decimal
    let passes: [PassItem]
    var typeLabel: String {
        ["main": "常规", "endfield": "终末地", "carnival": "嘉年华", "collab": "联动", "elite": "精英", "sp": "SP", "special": "特别系列"][type] ?? type
    }
}
struct PassItem: Codable, Identifiable, Sendable {
    let id: String
    let operatorId: String
    let name: String
    let label: String
    let variant: String?
    let avatar: String?
    let en: String?
    let rarity: Int?
    let officialUnitPrice: Decimal?
    let searchText: String
}
struct PurchaseLot: Codable, Equatable, Sendable {
    var cost: String
    var qty: Int
}
struct CollectionRecord: Codable, Equatable, Sendable {
    var owned = false
    var market: String?
    var lots: [PurchaseLot] = []
    static let empty = CollectionRecord()
    var quantity: Int { lots.reduce(0) { $0 + $1.qty } }
}
// 待匹配数据保留原 JSON 类型，跨端同步时不丢掉未知字段或数值精度。
enum JSONValue: Codable, Equatable, Sendable {
    case object([String: JSONValue]), array([JSONValue]), string(String), number(Decimal), bool(Bool), null
    init(from decoder: Decoder) throws {
        let value = try decoder.singleValueContainer()
        if value.decodeNil() { self = .null }
        else if let item = try? value.decode(Bool.self) { self = .bool(item) }
        else if let item = try? value.decode(String.self) { self = .string(item) }
        else if let item = try? value.decode(Decimal.self) { self = .number(item) }
        else if let item = try? value.decode([String: JSONValue].self) { self = .object(item) }
        else { self = .array(try value.decode([JSONValue].self)) }
    }
    func encode(to encoder: Encoder) throws {
        var value = encoder.singleValueContainer()
        switch self {
        case .object(let item): try value.encode(item)
        case .array(let item): try value.encode(item)
        case .string(let item): try value.encode(item)
        case .number(let item): try value.encode(item)
        case .bool(let item): try value.encode(item)
        case .null: try value.encodeNil()
        }
    }
    var object: [String: JSONValue]? { if case .object(let value) = self { return value }; return nil }
    var array: [JSONValue]? { if case .array(let value) = self { return value }; return nil }
    var string: String? { if case .string(let value) = self { return value }; return nil }
    var bool: Bool? { if case .bool(let value) = self { return value }; return nil }
}
struct ArchiveBackup: Codable, Equatable, Sendable {
    var schemaVersion = 1
    var catalogVersion: String
    var collection: [String: CollectionRecord] = [:]
    var unmapped: [String: JSONValue] = [:]
    var followedSeries: [String] = []
    var exportedAt: String?
    func hasSameContent(as other: ArchiveBackup) -> Bool {
        collection == other.collection && unmapped == other.unmapped && Set(followedSeries) == Set(other.followedSeries)
    }
    init(catalogVersion: String) { self.catalogVersion = catalogVersion }
    // 合成解码不使用属性默认值；Web 的旧版标准备份可以没有关注字段。
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        schemaVersion = try c.decode(Int.self, forKey: .schemaVersion)
        catalogVersion = try c.decode(String.self, forKey: .catalogVersion)
        collection = try c.decode([String: CollectionRecord].self, forKey: .collection)
        unmapped = try c.decodeIfPresent([String: JSONValue].self, forKey: .unmapped) ?? [:]
        followedSeries = try c.decodeIfPresent([String].self, forKey: .followedSeries) ?? []
        exportedAt = try c.decodeIfPresent(String.self, forKey: .exportedAt)
    }
}
struct ArchiveStats: Codable, Equatable, Sendable {
    var total = 0
    var owned = 0
    var quantity = 0
    var progress: Double = 0
    var official = "0.00"
    var market = "0.00"
    var cost = "0.00"
    var profit = "0.00"
    var pricedOwned = 0
    var completedSeries = 0
    var rulesVersion = "upstream-v3-compat-1"
}
struct AccountUser: Codable, Equatable, Sendable {
    let id: Int
    let username: String
}
struct AccountSession: Codable, Sendable {
    let authenticated: Bool
    let user: AccountUser?
    let csrfToken: String
}
struct CloudArchive: Codable, Sendable {
    let userId: Int
    let revision: Int
    let backup: ArchiveBackup
    let updatedAt: String?
}
struct AccountCache: Codable, Sendable {
    var user: AccountUser
    var revision: Int
    var base: ArchiveBackup
    var backup: ArchiveBackup
    var syncedAt: Date?
    var beforeImport: ArchiveBackup?
}
struct ArchiveState: Codable, Sendable {
    var guest: ArchiveBackup
    var guestBeforeImport: ArchiveBackup?
    var account: AccountCache?
}
enum ArchiveCoding {
    static func decoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return decoder
    }
    static func encoder() -> JSONEncoder {
        let encoder = JSONEncoder()
        encoder.keyEncodingStrategy = .convertToSnakeCase
        encoder.outputFormatting = [.sortedKeys, .prettyPrinted, .withoutEscapingSlashes]
        return encoder
    }
}
struct ArchiveError: LocalizedError {
    let message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { message }
}
enum OwnershipFilter: String, CaseIterable, Identifiable {
    case all = "全部", owned = "已拥有", missing = "未拥有"
    var id: String { rawValue }
}
struct CatalogQuery {
    var text = ""
    var type = ""
    var ownership: OwnershipFilter = .all
    var followedOnly = false
    var rarity: Int?
}
struct SeriesMatch: Identifiable {
    let series: PassSeries
    let passes: [PassItem]
    var id: String { series.id }
}
struct PreparedImport: Identifiable {
    let id = UUID()
    let backup: ArchiveBackup
    let warnings: [String]
    let scope: String
    let observed: ArchiveBackup
    let replacingCount: Int
}
