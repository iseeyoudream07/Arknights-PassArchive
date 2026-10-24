// 旧字段保留以兼容已有 SwiftData 数据库；新增字段用默认值进行轻量迁移。
import Foundation
import SwiftData

@Model final class LocalArchive {
    var key: String
    var ownedData: Data
    var catalogData: Data
    var stateData: Data = Data()

    init(key: String = "main", ownedData: Data = Data(), catalogData: Data = Data()) {
        self.key = key
        self.ownedData = ownedData
        self.catalogData = catalogData
    }
}
