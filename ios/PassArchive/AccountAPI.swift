// 原生客户端复用 Django Cookie 会话。密码/CSRF 只驻留内存，私人响应不缓存。
import Foundation

struct APIError: LocalizedError {
    let status: Int
    let code: String?
    let message: String
    var errorDescription: String? { message }
}

// 常见输入问题先在设备上提示；安全强度仍由服务器的完整密码规则校验。
enum AccountInput {
    static func authentication(username: String, password: String, confirmation: String?) -> String? {
        guard !username.isEmpty else { return "请输入用户名。" }
        if confirmation != nil, username.range(of: #"^[a-z0-9_]{3,32}$"#, options: .regularExpression) == nil {
            return "用户名需要 3–32 个字符，只能使用英文字母、数字或下划线。"
        }
        if let confirmation { return newPassword(password, confirmation: confirmation) }
        if password.isEmpty { return "请输入密码。" }
        if password.unicodeScalars.count > 128 { return "密码最多支持 128 个字符，请缩短后重试。" }
        return nil
    }

    static func newPassword(_ password: String, confirmation: String) -> String? {
        if password.unicodeScalars.count < 10 { return "密码至少需要 10 个字符，请设置更长的密码。" }
        if password.unicodeScalars.count > 128 { return "密码最多支持 128 个字符，请缩短后重试。" }
        if password.unicodeScalars.allSatisfy({ CharacterSet.decimalDigits.contains($0) }) {
            return "密码不能只包含数字，请加入字母或其他字符。"
        }
        if password != confirmation { return "两次输入的密码不一致，请重新确认。" }
        return nil
    }

    static func message(detail: String?, status: Int) -> String {
        // 兼容尚未更新的服务器，避免把旧版 Django 的混合语言报错直接展示给用户。
        let text = detail ?? ""
        if text.contains("This password is too short") { return "密码至少需要 10 个字符，请设置更长的密码。" }
        if text.contains("This password is entirely numeric") || text.contains("密码只包含数字") { return "密码不能只包含数字，请加入字母或其他字符。" }
        if text.contains("This password is too common") { return "这个密码很容易被猜到，请换一个不常用的密码。" }
        if text.contains("The password is too similar") || text.contains("密码跟") { return "密码与用户名过于相似，请换一个差别更大的密码。" }
        // 错误页面或未知英文错误不直接进入界面；完整状态码留给调用方处理。
        if !text.isEmpty, text.range(of: #"\p{Han}"#, options: .regularExpression) != nil { return String(text.prefix(400)) }
        switch status {
        case 401: return "登录已过期，请重新登录后再试。"
        case 403: return "登录验证未通过，请重新登录后再试。"
        case 429: return "尝试次数较多，请稍后再试。"
        default: return "暂时无法完成操作，请稍后重试。"
        }
    }
}

// 账号接口不需要跳转；拒绝重定向，防止密码或私人备份被转发到其他地址。
private final class AccountRedirectPolicy: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

@MainActor protocol ArchiveAPI: AnyObject {
    var baseURL: URL { get }
    func catalog() async throws -> Data
    func session() async throws -> AccountSession
    func authenticate(username: String, password: String, confirmation: String?, remember: Bool) async throws -> AccountSession
    func archive() async throws -> CloudArchive
    func saveArchive(userId: Int, revision: Int, backup: ArchiveBackup) async throws -> CloudArchive
    func logout(userId: Int) async throws
    func changePassword(userId: Int, current: String, password: String, confirmation: String) async throws
}

@MainActor final class AccountAPI: ArchiveAPI {
    nonisolated static let productionURL = URL(string: "https://arknights.yukkuri.win")!
    let baseURL: URL
    private let transport: URLSession
    private var csrf = ""

    init(baseURL: URL = AccountAPI.productionURL, transport: URLSession? = nil) {
        self.baseURL = baseURL
        if let transport { self.transport = transport }
        else {
            let config = URLSessionConfiguration.default
            config.urlCache = nil
            config.requestCachePolicy = .reloadIgnoringLocalCacheData
            config.timeoutIntervalForRequest = 12
            config.timeoutIntervalForResource = 20
            config.httpShouldSetCookies = true
            self.transport = URLSession(configuration: config)
        }
    }

    func catalog() async throws -> Data { try await request("catalog/") }

    func session() async throws -> AccountSession {
        try await decode("auth/session/")
    }

    func authenticate(username: String, password: String, confirmation: String?, remember: Bool) async throws -> AccountSession {
        _ = try await session()
        var body: [String: JSONValue] = [
            "username": .string(username), "password": .string(password), "remember": .bool(remember)
        ]
        if let confirmation { body["password_confirm"] = .string(confirmation) }
        return try await decode(confirmation == nil ? "auth/login/" : "auth/register/", method: "POST", body: .object(body))
    }

    func archive() async throws -> CloudArchive { try await decode("me/archive/") }

    func saveArchive(userId: Int, revision: Int, backup: ArchiveBackup) async throws -> CloudArchive {
        let document = try JSONDecoder().decode(JSONValue.self, from: ArchiveCoding.encoder().encode(backup))
        return try await decode("me/archive/", method: "PUT", body: .object([
            "expected_user_id": .number(Decimal(userId)),
            "base_revision": .number(Decimal(revision)),
            "backup": document
        ]))
    }

    func logout(userId: Int) async throws {
        let _: AccountSession = try await decode("auth/logout/", method: "POST", body: .object([
            "expected_user_id": .number(Decimal(userId))
        ]))
    }

    func changePassword(userId: Int, current: String, password: String, confirmation: String) async throws {
        _ = try await request("auth/password/", method: "POST", body: .object([
            "expected_user_id": .number(Decimal(userId)), "current_password": .string(current),
            "password": .string(password), "password_confirm": .string(confirmation)
        ]))
    }

    private func decode<T: Decodable>(_ path: String, method: String = "GET", body: JSONValue? = nil) async throws -> T {
        let data = try await request(path, method: method, body: body)
        do { return try ArchiveCoding.decoder().decode(T.self, from: data) }
        catch { throw APIError(status: 502, code: nil, message: "服务返回的数据格式无法识别，请稍后重试。") }
    }

    private func request(_ path: String, method: String = "GET", body: JSONValue? = nil) async throws -> Data {
        if method != "GET" && csrf.isEmpty { _ = try await session() }
        let url = baseURL.appendingPathComponent("api/v1/").appendingPathComponent(path)
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 12)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body {
            let data = try ArchiveCoding.encoder().encode(body)
            guard data.count <= ArchiveRules.maximumBackupSize else { throw ArchiveError("存档超过 2 MiB，请先导出并精简购买记录。") }
            request.httpBody = data
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        if method != "GET" {
            request.setValue(csrf, forHTTPHeaderField: "X-CSRFToken")
            // 原生 HTTPS 请求也满足 Django 的 Origin/Referer 检查。
            var origin = URLComponents(url: baseURL, resolvingAgainstBaseURL: false)!
            origin.path = ""; origin.query = nil; origin.fragment = nil
            request.setValue(origin.string, forHTTPHeaderField: "Origin")
            request.setValue(baseURL.appendingPathComponent("").absoluteString, forHTTPHeaderField: "Referer")
        }
        let data: Data
        let response: URLResponse
        do { (data, response) = try await transport.data(for: request, delegate: AccountRedirectPolicy()) }
        catch {
            if Task.isCancelled { throw CancellationError() }
            throw APIError(status: 0, code: nil, message: "网络暂不可用，本机记录已保留。")
        }
        guard let http = response as? HTTPURLResponse else {
            throw APIError(status: 0, code: nil, message: "未能连接服务器，本机记录已保留。")
        }
        let json = try? JSONDecoder().decode(JSONValue.self, from: data).object
        if let token = json?["csrf_token"]?.string { csrf = token }
        guard (200...299).contains(http.statusCode) else {
            if http.statusCode == 403 { csrf = "" }
            let detail = json?["detail"]?.string
            throw APIError(status: http.statusCode, code: json?["code"]?.string,
                           message: AccountInput.message(detail: detail, status: http.statusCode))
        }
        return data
    }
}
