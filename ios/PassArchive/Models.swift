import Foundation
import SwiftData

struct Catalog: Decodable, Sendable {
    let version: String
    let series: [PassSeries]
    let counts: CatalogCounts
}
struct CatalogCounts: Decodable, Sendable {
    let series: Int
    let passes: Int
    let operators: Int
}
struct PassSeries: Decodable, Identifiable, Sendable {
    let id: String
    let name: String
    let type: String
    let year: String?
    let releaseDate: String?
    let image: String?
    let barcodes: [String]
    let passes: [PassItem]
}
struct PassItem: Decodable, Identifiable, Sendable {
    let id: String
    let name: String
    let label: String
    let variant: String?
    let avatar: String?
    let en: String?
    let rarity: Int?
    let searchText: String
}
@Model final class LocalArchive {
    var key: String
    var ownedData: Data
    var catalogData: Data
    init(key: String = "main", ownedData: Data = Data(), catalogData: Data = Data()) {
        self.key = key
        self.ownedData = ownedData
        self.catalogData = catalogData
    }
}
