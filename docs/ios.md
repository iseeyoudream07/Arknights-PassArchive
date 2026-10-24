# iOS 原生客户端

最低 iOS 17，使用 SwiftUI、SwiftData、URLSession、Network，无第三方 Swift 包。打开 `ios/PassArchive.xcodeproj`，选择共享的 `PassArchive` scheme 和 iPhone/iPad 模拟器。当前应用版本为 0.2.0。

## 功能

| 入口 | 原生功能 |
|---|---|
| 目录 | 离线目录、在线刷新、中英文/拼音/盒号/条码搜索、类型/星级/拥有状态/关注筛选 |
| 系列档案 | 图片、发行和复刻日期、条码、关注、整系列标记、单张收藏记录 |
| 收藏记录 | 拥有状态、可空市场价、多笔购买单价和数量，每笔 1–999 张 |
| 统计 | 拥有种类、购买数量、完整系列、成本、估值、官方参考价、估算盈亏 |
| 我的 | 注册、登录、保持登录、修改密码、同步并退出、系统/浅/深色主题 |
| 备份 | 新旧 JSON 导入预览与合并、导入前恢复点、系统文件导出、保留未知数据 |
| 同步 | 与 Web 共用账号存档、离线编辑、三方合并、版本校验、冲突预览与选择 |

三维阵列、抽取解密、模型查看器通过“我的 → 打开网页版”访问浏览器。首版没有原生三维渲染、相机扫码、后台持续同步或图片全量离线缓存；条码可输入或粘贴搜索。iOS 17 和真机仍需单独验收。

## 数据与同步

默认 API 为 `https://arknights.yukkuri.win/api/v1/`。原生复用 Django Cookie + CSRF，写请求附带 `X-CSRFToken`、Origin、Referer。私人响应禁用 URL 缓存。密码不持久化，CSRF 只保存在内存；登录 Cookie 交给应用自己的系统 Cookie 存储。原生与浏览器分别登录同一账号，不交换浏览器 Cookie。

登录先读取该账号云端存档，访客收藏需主动合并。旧 SwiftData 字段保留，首次升级把原来的拥有 ID 迁入访客备份，未知 ID 放入 `unmapped`。新增 `stateData` 使用默认值进行轻量迁移；数据库不可读时显示启动错误，不删除数据。

访客和账号各有独立的备份与恢复点。退出前须完成待上传修改；失败会保留账号和编辑，成功后清除账号本机副本并恢复访客收藏。编辑页和导入预览绑定账号，同条记录更新后旧编辑不能覆盖新值。

每次编辑先写入 SwiftData，前台等待 900ms 后同步；前台每 30 秒、回到 App 或恢复网络时检查云端。iOS 挂起期间不持续同步。不同条目自动合并，同条两端改动需用户选择；选择前云端再次修改时须重新查看。上传等待期间继续编辑也会保留，并进入下一轮上传。

统计口径为 `upstream-v3-compat-1`，金额使用 Decimal。拥有种类和购买数量分别计算：只有拥有标记但没有购买批次时数量为零。固定价格特殊盒按整盒计官方价一次。未知或零市价对应成本不参与估算盈亏。

## 构建

```bash
python3 tools/make_xcode_project.py
xcodebuild -project ios/PassArchive.xcodeproj -scheme PassArchive \
  -configuration Debug -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath artifacts/ios-build CODE_SIGNING_ALLOWED=NO build
swift test --package-path ios --scratch-path artifacts/ios-swift-tests
.venv/bin/python tools/verify_ios_api.py
```

工程生成器自动登记 `ios/PassArchive/*.swift`、复制当前目录并生成共享 scheme。接口验收脚本需要先安装 Python 和 Web 依赖，会创建临时 SQLite 和临时账号，清除继承的数据库及密钥配置，不读取部署 `.env`，不操作线上用户数据。

Swift 测试覆盖全部 24 组共享统计样例、金额边界、旧备份、未知 JSON、搜索、三方合并、离线恢复、账号隔离、旧收藏迁移、同步期间编辑、409 重试与恢复点。单独执行 `swift test` 时跳过需要服务端的接口测试；接口脚本会实际执行，并使用真实 Web 规则和后端校验 iOS 导出的备份、关注与统计。

## 本机与模拟器联调

```bash
.venv/bin/python tools/verify_ios_api.py --serve --port 18084
```

在 Xcode → Edit Scheme → Run → Arguments 添加环境变量：

```text
PASSARCHIVE_API_BASE_URL=http://127.0.0.1:18084
```

此变量只对 Debug 生效，接受 HTTPS 或使用 localhost/127.0.0.1/::1 的 HTTP 地址。Release 固定使用默认 HTTPS。不同服务端地址隔离本机存档，避免不同站点的相同 user id 串用。脚本退出后移除临时测试库。真机无法通过 127.0.0.1 访问 Mac，请使用有可信 HTTPS 的独立测试站点。

在自己创建的测试模拟器上自动验收：

```bash
.venv/bin/python tools/verify_ios_api.py --port 18084 --ui-device YOUR_SIMULATOR_UUID
```

原生 UI 测试使用独立内存存档与本机 API，验证查询、关注、价格数量、统计和登录上传；截图保存到 `artifacts/ios-ui-*.xcresult`，日志及接口报告也位于 `artifacts/`。

真机需在 Xcode Signing & Capabilities 选择自己的开发团队。本次提供源码和模拟器构建，不包含签名 IPA、TestFlight 上传或 App Store 发布。

## 源码

- `Models.swift`、`LocalArchive.swift`：共享协议与兼容旧版的本机模型。
- `ArchiveRules.swift`、`ArchiveMerge.swift`：金额、统计、搜索、备份转换和三方合并。
- `AccountAPI.swift`、`ArchiveStore.swift`：HTTP、Cookie/CSRF、本机事务、迁移、同步和恢复。
- `ContentView.swift`、`RecordViews.swift`、`AccountViews.swift`：导航、目录、记录、统计、账号、备份和冲突页面。

系统接口参考：[URLSession Cookie 存储](https://developer.apple.com/documentation/foundation/urlsessionconfiguration/httpcookiestorage)、[SwiftUI FileDocument](https://developer.apple.com/documentation/swiftui/filedocument)。

本轮实测结果与截图见 [iOS 首版验收记录](ios-verification.md)。

中文提示、异常备份边界与安全修复的最新验收见 [2026-10-16 复查记录](ux-security-review-20261016.md)。
