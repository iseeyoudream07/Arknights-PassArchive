import XCTest
@testable import PassArchiveCore

// 仅由隔离验收脚本启用，拒绝对公网服务创建测试账号。
final class APIIntegrationTests: XCTestCase {
    @MainActor func testDjangoSessionCSRFRevisionBackupAndAccountIsolation() async throws {
        guard let value = ProcessInfo.processInfo.environment["PASSARCHIVE_TEST_API"],
              let base = URL(string: value), ["localhost", "127.0.0.1"].contains(base.host ?? "") else {
            throw XCTSkip("通过 tools/verify_ios_api.py 启用隔离本机 API 验收。")
        }
        func client() -> AccountAPI { AccountAPI(baseURL: base, transport: URLSession(configuration: .ephemeral)) }
        let first = client(), second = client(), other = client()
        let catalog = try ArchiveCoding.decoder().decode(Catalog.self, from: await first.catalog())
        let suffix = UUID().uuidString.replacingOccurrences(of: "-", with: "").prefix(12).lowercased()
        let username = "ios_\(suffix)", password = "Shelf!\(UUID().uuidString)"
        let anonymous = try await first.session()
        XCTAssertNil(anonymous.user)
        do {
            _ = try await first.authenticate(username: "114514", password: "114514", confirmation: "114514", remember: false)
            XCTFail("弱密码应返回明确的中文提示")
        } catch let error as APIError {
            XCTAssertEqual(error.code, "password_invalid")
            XCTAssertEqual(error.message, "密码至少需要 10 个字符，请设置更长的密码。")
        }
        let registered = try await first.authenticate(username: username, password: password, confirmation: password, remember: true)
        let user = try XCTUnwrap(registered.user)
        let login = try await second.authenticate(username: username, password: password, confirmation: nil, remember: false)
        XCTAssertEqual(login.user, user)
        let initial = try await second.archive()
        XCTAssertEqual(initial.revision, 0)
        var document = initial.backup
        document.collection[catalog.series[0].passes[0].id] = .init(owned: true, market: "30.10", lots: [.init(cost: "20.05", qty: 3)])
        document.followedSeries = [catalog.series[0].id]
        document.unmapped["future-item"] = .object(["kept": .array([.bool(true), .null, .number(123.45)])])
        let saved = try await first.saveArchive(userId: user.id, revision: 0, backup: document)
        XCTAssertEqual(saved.revision, 1)
        XCTAssertTrue(saved.backup.hasSameContent(as: document))
        let fromWebSession = try await second.archive()
        XCTAssertTrue(fromWebSession.backup.hasSameContent(as: document))
        let repeated = try await second.saveArchive(userId: user.id, revision: 1, backup: document)
        XCTAssertEqual(repeated.revision, 1)
        do {
            _ = try await second.saveArchive(userId: user.id, revision: 0, backup: document)
            XCTFail("旧版本不能覆盖云端")
        } catch let error as APIError {
            XCTAssertEqual(error.status, 409)
            XCTAssertEqual(error.code, "revision_conflict")
        }
        let another = try await other.authenticate(username: "other_\(suffix)", password: password, confirmation: password, remember: false)
        let anotherId = try XCTUnwrap(another.user?.id)
        let anotherArchive = try await other.archive()
        XCTAssertTrue(anotherArchive.backup.collection.isEmpty)
        do {
            _ = try await other.saveArchive(userId: user.id, revision: 0, backup: document)
            XCTFail("不能把一个账号的数据写到另一个账号")
        } catch let error as APIError {
            XCTAssertEqual(error.status, 409)
            XCTAssertEqual(error.code, "account_changed")
        }
        XCTAssertNotEqual(user.id, anotherId)
        if let directory = ProcessInfo.processInfo.environment["PASSARCHIVE_TEST_EXPORT_DIR"] {
            let folder = URL(fileURLWithPath: directory)
            try ArchiveCoding.encoder().encode(saved.backup).write(to: folder.appendingPathComponent("native-backup.json"))
            try ArchiveCoding.encoder().encode(ArchiveRules.stats(catalog: catalog, collection: saved.backup.collection))
                .write(to: folder.appendingPathComponent("native-stats.json"))
        }
        let newPassword = "Updated!\(UUID().uuidString)"
        try await first.changePassword(userId: user.id, current: password, password: newPassword, confirmation: newPassword)
        let invalidated = try await second.session(), retained = try await first.session()
        XCTAssertNil(invalidated.user)
        XCTAssertEqual(retained.user, user)
        try await first.logout(userId: user.id)
        let loggedOut = try await first.session()
        XCTAssertNil(loggedOut.user)
    }
}
