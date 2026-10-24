# 中文代码导读与断点调试

先按 [PyCharm 开发说明](pycharm.md) 打开项目并选择 `.venv` 解释器。本页帮助你找到要改的代码、沿调用链阅读，以及判断断点停下后该观察哪些变量。

## 从哪些文件开始看

| 顺序 | 文件 | 先理解什么 |
| --- | --- | --- |
| 1 | [`tools/dev.py`](../tools/dev.py) | 本机启动、环境隔离、端口检查和停止清理 |
| 2 | [`backend/config/urls.py`](../backend/config/urls.py) | URL 对应哪个后端函数 |
| 3 | [`backend/api/views.py`](../backend/api/views.py) | 目录查询、搜索、统计和备份校验 |
| 4 | [`backend/api/domain.py`](../backend/api/domain.py) | 金额、拥有状态、购买批次和统计规则 |
| 5 | [`backend/api/accounts.py`](../backend/api/accounts.py) | 登录会话、账号存档、同步版本与冲突 |
| 6 | [`web/src/types.ts`](../web/src/types.ts) | 前后端交换的目录、收藏、备份和统计结构 |
| 7 | [`web/src/main.ts`](../web/src/main.ts) | 二维页面、搜索、价格编辑和保存入口 |
| 8 | [`web/src/account-sync.ts`](../web/src/account-sync.ts) | 访客隔离、本机保存、云端合并和离线恢复 |

Python 文件在模块、函数和关键分支前使用 `#` 中文注释；前端业务函数使用 `/** ... */` 说明用途和边界。较长的前端函数与样式已展开，方便逐步阅读。三维代码保留原来源声明，补充模块职责导读，并对场景、模型查看器和开屏的重要方法增加说明。

## 在 PyCharm 中调试一次后端请求

1. 如果正在运行 **02 运行整站**，先停止它，释放 8000/5173 端口。
2. 在 `backend/api/views.py` 的 `passes()` 函数内，点击可执行代码行左侧设置断点。
3. 选择 **03 API 断点调试**，点击调试按钮；需要页面操作时另行运行 **04 Web 热更新**。
4. 浏览器访问 <http://127.0.0.1:8000/api/v1/passes/?q=阿米娅>，请求会停在断点。
5. 查看 `request.query_params`、`q`、`found`，逐步执行分页与返回逻辑。

二维页面自己的搜索由 `main.ts` 的 `matches()` 完成，直接在页面搜索不一定调用后端 `passes()`。要验证这个后端断点，应访问上面的 API 地址。

**03** 使用 `--noreload`，修改后端代码后需要停止并重新调试；**04** 的前端保持热更新。Python 断点用于 `.py` 文件，`.ts` 的运行发生在浏览器，可配合浏览器开发者工具中的 Sources 和 Network 面板查看。

## 按问题选择断点

| 现象或修改目标 | 建议入口 | 重点观察 |
| --- | --- | --- |
| 启动失败、端口被占用 | `tools/dev.py` 的 `main()`、`available()`、`ready()` | 当前操作、8000/5173、解释器和依赖位置 |
| 后端关键词搜索结果不对 | `views.py` 的 `passes()` | `q`、`t`、`found`、`offset`、`limit` |
| 金额或数量被拒绝 | `domain.py` 的 `money()`、`normalize_record()` | 原始值、字段名、`qty` 和批次数 |
| 统计结果不理解 | `domain.py` 的 `calculate_stats()` | `owned_count`、`quantity`、`cost`、`priced_cost`、`fixed` |
| 登录后看不到收藏 | `accounts.py` 的 `archive()` | 当前用户 ID、请求方法、存档归属 |
| 同步提示有冲突 | `accounts.py` 的 `archive()` | `base_revision` 与 `value.revision` 是否相等 |
| 连续点击后保存不完整 | `main.ts` 的 `persist()` → `ArchiveWrites.enqueue()` | 当前账号、排队基线、最新文档和合并冲突 |
| 离线或多设备更新 | `AccountSync.runSync()` → `mergeBackups()` | `base`、`local.backup`、`remote.backup`、`revision` |
| 保存后卡片闪烁或丢焦点 | `main.ts` 的 `renderResults()` → `list-ui.ts` | 稳定 ID、已有节点和焦点所在卡片 |
| 三维入口无法打开 | `RhineTerminal.start()`、`mount()`、`receive()` | 目录是否就绪、iframe 是否加载、消息来源和类型 |

## 理解两条保存路线

二维页面修改收藏时：

```text
main.ts：toggle / edit / importFile
  → persist
  → ArchiveWrites.enqueue：排队、检查账号、合并等待期间的修改
  → AccountSync.saveLocal
  → storage.ts：IndexedDB 事务提交
  → 更新当前页面；账号模式随后触发网络同步
```

登录账号后同步时：

```text
AccountSync.runSync
  → 查询当前登录会话，确认账号归属
  → 读取账号本机缓存及云端存档
  → mergeBackups(base, local, cloud)
  → 无冲突时 PUT /api/v1/me/archive/
  → 后端检查 expected_user_id 与 base_revision
  → 事务内保存，内容改变时推进 revision
  → 更新本机云端基线，并保留请求期间新增的本机编辑
```

`base` 是上一次共同版本，`backup` 是当前本机内容，`revision` 是云端版本号。同一条记录两端都发生不同修改时，需要用户选择；不同记录可以自动合并。访客存档与每个账号的缓存分别保存。

## 修改时要保留的规则

- `owned` 统计不同通行证的种类；`lots[].qty` 才是实际购买张数。只标记拥有、未填购买批次时，种类数增加，数量和按张估值仍为零。
- 金额在收藏文档中保存为元字符串，例如 `"20.05"`。Python 使用 `Decimal`，TypeScript 汇总时使用 `BigInt` 整数分；不要改成普通浮点累加。
- `market=null` 表示未填写市价；盈亏只扣除已填写正市价条目的成本。
- `official_unit_price=null` 的系列使用整盒官方参考价，有盒内收藏时只计一次。
- 精一、精二按不同 `pass.id` 保存。`operator_id` 表示干员身份，不能代替单张通行证的收藏键。
- 盒号保留字符串，例如 `"1.0"`；兼容补充资料时合并 `barcode` 与 `barcodes`。
- 无法匹配的旧备份条目保留在 `unmapped`，不能在导入或导出时静默丢弃。
- 公开 `/stats/` 与 `/backups/validate/` 只即时计算/校验；账号收藏由 `/me/archive/` 保存。

前后端的金额、备份和统计规则需要一起核对：[`domain.py`](../backend/api/domain.py) ↔ [`core.ts`](../web/src/core.ts)。

## 改界面、数据和三维效果分别看哪里

| 修改内容 | 位置 |
| --- | --- |
| 二维布局与主题颜色 | `web/src/style.css`；账号区看 `account.css`，筛选与开关看 `controls.css` |
| 登录注册布局 | `web/src/login-entry.ts`、`web/src/login.css` |
| 三维上的业务按钮、账号信息、移动布局 | `web/src/rhine-terminal.ts`、`terminal-context.ts`、`terminal-adaptation.css` |
| 三维终端整体流程 | `web/src/vendor/rhine-full/main.ts` |
| 阵列、镜头、模型和材质 | `vendor/rhine-full/scene.ts`、`model-viewer.ts`、`motion.ts`、`appearance.ts` |
| 三维开屏与声音 | `vendor/rhine-full/boot.ts`、`boot-motion.ts`、`audio.ts` |
| 独立二维开屏 | `web/src/opening.ts` 和 `vendor/rhine/`；与整站 `rhine-full` 入口区分 |
| 离线缓存 | `web/public/sw.js`、`web/scripts/build-cache-manifest.mjs` |
| iOS 本机收藏 | `ios/PassArchive/ArchiveStore.swift`；页面在 `ContentView.swift`，编译运行使用 Xcode |
| 统一目录重建 | `tools/build_catalog.py`；输入参数与输出边界在文件头说明 |

JSON 不支持注释，因此目录和备份 JSON 保留原格式，字段含义写在类型定义与本页中。`sources/`、`upstream/`、参考素材和生成产物不作为日常业务代码编辑入口。构建目录会被重新生成，修改前端请编辑 `web/src/`，不要直接编辑 `web/dist/`。

## 修改后检查

在 PyCharm 运行 **05 本地检查**，或在项目根目录执行：

```bash
python3 tools/dev.py check
```

它使用本机开发环境执行 Django 检查、后端测试、Web 构建及现有前端测试。SQLite 下会跳过依赖真实 PostgreSQL 的并发测试；该分支由仓库 CI 的独立 PostgreSQL 服务覆盖。

测试入口也有中文覆盖说明，可从 `backend/api/tests.py`、`backend/api/test_accounts.py` 和 `web/tests/` 查找对应场景。需要修改数据库字段时生成新的迁移，不改写已执行的历史迁移。
