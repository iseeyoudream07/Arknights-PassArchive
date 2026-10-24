import XCTest

// 只操作自己的 App 测试进程与临时本机 API，不需要解锁或控制宿主 Mac。
@MainActor final class PassArchiveUITests: XCTestCase {
    private let base = URL(string: "http://127.0.0.1:18084/api/v1/")!
    override func setUpWithError() throws { continueAfterFailure = false }

    private func app() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment["PASSARCHIVE_UI_TESTING"] = "1"
        app.launchEnvironment["PASSARCHIVE_API_BASE_URL"] = "http://127.0.0.1:18084"
        app.launchArguments = ["-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN"]
        app.launch()
        return app
    }
    private func snapshot(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    func testGuestPurchaseEditingAndStatistics() throws {
        let app = app()
        let firstSeries = app.staticTexts["明日方舟通行认证 1.0"].firstMatch
        XCTAssertTrue(firstSeries.waitForExistence(timeout: 20))
        snapshot(app, "01-catalog")
        firstSeries.tap()
        let firstPass = app.staticTexts["阿米娅·精一"].firstMatch
        XCTAssertTrue(firstPass.waitForExistence(timeout: 5))
        firstPass.tap()
        let owned = app.switches["已拥有"].firstMatch
        XCTAssertTrue(owned.waitForExistence(timeout: 5))
        // SwiftUI 暴露带标签的容器开关与内部实际开关，点击实际控件。
        (owned.switches.firstMatch.exists ? owned.switches.firstMatch : owned).tap()
        let market = app.textFields["record-market"]
        XCTAssertTrue(market.waitForExistence(timeout: 5))
        market.tap(); market.typeText("30.10")
        app.buttons["添加一笔购买记录"].tap()
        let cost = app.textFields["lot-cost"].firstMatch
        cost.tap(); cost.typeText("20.05")
        let quantity = app.textFields["lot-quantity"].firstMatch
        quantity.tap()
        // 右对齐的整行输入框默认点击可能把光标置于开头，明确点到现有数字之后。
        quantity.coordinate(withNormalizedOffset: CGVector(dx: 0.999, dy: 0.5)).tap()
        // 直接向当前焦点发送输入，避免 TextField.typeText 再次点击整行而移动光标。
        app.typeText(XCUIKeyboardKey.delete.rawValue + "3")
        XCTAssertEqual(quantity.value as? String, "3")
        snapshot(app, "02-record-editor")
        app.navigationBars.buttons["保存"].tap()
        XCTAssertTrue(app.staticTexts["3 张 · 市价 ¥30.10"].waitForExistence(timeout: 5))
        app.tabBars.buttons["统计"].tap()
        XCTAssertTrue(app.staticTexts["¥60.15"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["¥90.30"].exists)
        XCTAssertTrue(app.staticTexts["¥30.15"].exists)
        snapshot(app, "03-statistics")
        app.tabBars.buttons["我的"].tap()
        XCTAssertTrue(app.buttons["导出备份"].waitForExistence(timeout: 5))
        snapshot(app, "04-account-and-backup")
    }

    func testPinyinSearchAndFollowingSeries() throws {
        let app = app()
        XCTAssertTrue(app.staticTexts["明日方舟通行认证 1.0"].firstMatch.waitForExistence(timeout: 20))
        app.swipeDown()
        let search = app.searchFields.firstMatch
        XCTAssertTrue(search.waitForExistence(timeout: 5))
        search.tap(); search.typeText("AMY")
        let result = app.staticTexts["明日方舟通行认证 1.0"].firstMatch
        XCTAssertTrue(result.waitForExistence(timeout: 5))
        result.tap()
        XCTAssertTrue(app.staticTexts["阿米娅·精一"].firstMatch.waitForExistence(timeout: 5))
        app.buttons["关注系列"].tap()
        app.navigationBars.buttons.element(boundBy: 0).tap()
        let follow = app.switches["关注"].firstMatch
        XCTAssertTrue(follow.waitForExistence(timeout: 5))
        follow.tap()
        XCTAssertTrue(app.staticTexts["1 个系列 · 2 款通行认证"].waitForExistence(timeout: 5))
        snapshot(app, "05-search-and-follow")
    }

    func testNativeLoginAndCloudRoundtrip() async throws {
        let transport = URLSession(configuration: .ephemeral)
        func request(_ path: String, method: String = "GET", body: [String: Any]? = nil, csrf: String? = nil) async throws -> [String: Any] {
            var request = URLRequest(url: base.appendingPathComponent(path))
            request.httpMethod = method
            if let body {
                request.httpBody = try JSONSerialization.data(withJSONObject: body)
                request.setValue("application/json", forHTTPHeaderField: "Content-Type")
                request.setValue(csrf, forHTTPHeaderField: "X-CSRFToken")
                request.setValue("http://127.0.0.1:18084", forHTTPHeaderField: "Origin")
            }
            let (data, response) = try await transport.data(for: request)
            XCTAssertTrue((200...299).contains((response as! HTTPURLResponse).statusCode),
                          "\(path) HTTP \((response as! HTTPURLResponse).statusCode)")
            return try JSONSerialization.jsonObject(with: data) as! [String: Any]
        }
        let csrf = try await request("auth/session/")["csrf_token"] as! String
        let suffix = UUID().uuidString.replacingOccurrences(of: "-", with: "").prefix(10).lowercased()
        let username = "ui_\(suffix)", password = "Shelf!\(UUID().uuidString)"
        let created = try await request("auth/register/", method: "POST",
                                       body: ["username": username, "password": password, "password_confirm": password, "remember": true], csrf: csrf)
        let userId = (created["user"] as! [String: Any])["id"] as! Int
        let app = app()
        XCTAssertTrue(app.tabBars.buttons["我的"].waitForExistence(timeout: 20))
        app.tabBars.buttons["我的"].tap()
        app.buttons["登录 / 注册"].tap()
        let name = app.textFields["auth-username"]
        XCTAssertTrue(name.waitForExistence(timeout: 5))
        name.tap(); name.typeText(username)
        let secret = app.secureTextFields["auth-password"]
        secret.tap(); secret.typeText(password)
        app.buttons["auth-submit"].tap()
        XCTAssertTrue(app.staticTexts[username].waitForExistence(timeout: 15))
        app.tabBars.buttons["目录"].tap()
        app.staticTexts["明日方舟通行认证 1.0"].firstMatch.tap()
        app.buttons["标记拥有 阿米娅·精一"].tap()
        app.tabBars.buttons["我的"].tap()
        app.buttons["立即同步"].tap()
        let predicate = NSPredicate { _, _ in app.staticTexts["已同步"].exists }
        let synced = expectation(for: predicate, evaluatedWith: nil)
        await fulfillment(of: [synced], timeout: 15)
        let cloud = try await request("me/archive/")
        XCTAssertEqual(cloud["user_id"] as? Int, userId)
        let backup = cloud["backup"] as! [String: Any]
        let collection = backup["collection"] as! [String: Any]
        XCTAssertEqual((collection["p_2c5e1f6aa02d56d7"] as? [String: Any])?["owned"] as? Bool, true)
        snapshot(app, "06-cloud-synced")
    }

    func testRegistrationWeakPasswordShowsOneChineseHint() throws {
        try registrationHint(password: "114514", expected: "密码至少需要 10 个字符，请设置更长的密码。", snapshotName: "07-registration-password-hint")
    }

    func testRegistrationCommonPasswordShowsChineseServerHint() throws {
        try registrationHint(password: "password123", expected: "这个密码很容易被猜到，请换一个不常用的密码。", snapshotName: "08-registration-common-password")
    }

    private func registrationHint(password: String, expected: String, snapshotName: String) throws {
        let app = app()
        XCTAssertTrue(app.tabBars.buttons["我的"].waitForExistence(timeout: 20))
        app.tabBars.buttons["我的"].tap()
        app.buttons["登录 / 注册"].tap()
        app.segmentedControls.buttons["注册"].tap()
        let username = app.textFields["auth-username"]
        username.tap(); username.typeText("114514")
        let secret = app.secureTextFields["auth-password"]
        secret.tap(); secret.typeText(password)
        let confirmation = app.secureTextFields["auth-confirmation"]
        confirmation.tap(); confirmation.typeText(password)
        app.buttons["auth-submit"].tap()
        let notice = app.staticTexts["user-notice"].firstMatch
        XCTAssertTrue(notice.waitForExistence(timeout: 10))
        XCTAssertEqual(notice.label, expected)
        XCTAssertFalse(app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "This password")).firstMatch.exists)
        snapshot(app, snapshotName)
    }
}
