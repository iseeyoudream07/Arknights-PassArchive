// 与 Web 相同的三方合并：删除也参与比较；关注系列按成员变化合并。
import Foundation

enum MergeChoice { case local, cloud }

struct MergeConflict: Identifiable, Equatable {
    let section: String
    let key: String
    let local: JSONValue?
    let cloud: JSONValue?
    var id: String { "\(section):\(key)" }
}
struct MergeResult {
    var backup: ArchiveBackup
    var conflicts: [MergeConflict]
}
enum ArchiveMerge {
    static func merge(base: ArchiveBackup, local: ArchiveBackup, cloud: ArchiveBackup, choice: MergeChoice? = nil) throws -> MergeResult {
        var backup = ArchiveBackup(catalogVersion: cloud.catalogVersion)
        var conflicts: [MergeConflict] = []
        backup.collection = try mergeMap(base.collection, local.collection, cloud.collection, section: "collection", choice: choice, conflicts: &conflicts)
        backup.unmapped = try mergeMap(base.unmapped, local.unmapped, cloud.unmapped, section: "unmapped", choice: choice, conflicts: &conflicts)
        let previous = Set(base.followedSeries), ours = Set(local.followedSeries), theirs = Set(cloud.followedSeries)
        backup.followedSeries = previous.union(ours).union(theirs).filter { id in
            ours.contains(id) == previous.contains(id) ? theirs.contains(id) : ours.contains(id)
        }.sorted()
        return MergeResult(backup: backup, conflicts: conflicts)
    }
    private static func mergeMap<T: Codable & Equatable>(
        _ base: [String: T], _ local: [String: T], _ cloud: [String: T], section: String,
        choice: MergeChoice?, conflicts: inout [MergeConflict]
    ) throws -> [String: T] {
        var result: [String: T] = [:]
        for id in Set(base.keys).union(local.keys).union(cloud.keys).sorted() {
            let previous = base[id], ours = local[id], theirs = cloud[id]
            let value: T?
            if ours == theirs { value = ours }
            else if ours == previous { value = theirs }
            else if theirs == previous { value = ours }
            else {
                func json(_ value: T?) throws -> JSONValue? {
                    guard let value else { return nil }
                    return try JSONDecoder().decode(JSONValue.self, from: ArchiveCoding.encoder().encode(value))
                }
                conflicts.append(try MergeConflict(section: section, key: id, local: json(ours), cloud: json(theirs)))
                value = choice == .cloud ? theirs : ours
            }
            result[id] = value
        }
        return result
    }
}
