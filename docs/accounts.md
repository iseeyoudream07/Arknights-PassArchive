# Web / iOS 账号与同步

登录入口：`https://arknights.yukkuri.win/login.html`。使用用户名和密码，无需邮箱。用户名支持 3–32 个英文字母、数字或下划线，密码为 10–128 个字符，拒绝常见、纯数字或过于相似的密码。可选择在当前设备保持登录 14 天；未勾选则使用浏览器会话。修改密码需验证当前密码，其他设备的旧会话会失效。当前没有邮件找回密码流程。

收藏、市场价、多笔购买记录、数量、未匹配条目和关注系列构成同一份账号存档。精一与精二仍是独立条目。访客收藏不会在注册时自动上传；登录后可在“数据与设置”选择合并。退出会恢复原来的访客收藏，通常会清除已退出账号的浏览器缓存，云端记录保留。未同步完成时会阻止退出，可先导出备份保存当前记录。如果退出请求期间另一标签页新增了未同步编辑，则保留该账号的本地副本，并提示重新登录原账号继续同步。

每次编辑先写入 IndexedDB，900ms 后合并保存；连续操作会合并同步。在线可见时每 30 秒检查云端，恢复联网或回到页面时也检查。离线可查看/编辑此前缓存的账号记录，联网后继续同步。首次登录没有本机缓存时，需要联网读取云端。

iOS 使用相同接口和三方合并规则，本机介质为 SwiftData。前台编辑延迟 900ms 同步，前台每 30 秒、回到 App 或恢复网络时检查；不申请后台持续运行。原生与浏览器分别登录，存档通过账号共享。访客迁移、备份恢复与联调方法见 [iOS 开发说明](ios.md)。

## 合并与隔离

会话用户增加可选的 `can_manage_catalog` 标志，普通账号为 false，只有有效的 `root` 超级用户为 true。Web 据此展示后台入口，服务器仍逐次核验权限。iOS 忽略这个新增字段，保持现有界面。root 禁止公开注册，初始化见 [Web 管理后台](admin.md)。

本机保留上次成功同步版本，用它与本机、云端进行三方合并。不同条目独立更新会自动合并；同一条通行证两端都修改时，设置页显示冲突，用户选择本机或云端版本。取消拥有和删除记录也参与合并。关注系列按成员变化合并。

服务器在事务内锁定账号存档，再校验 `base_revision`，旧版本返回 409 并附该账号的最新存档。每次保存同时校验 `expected_user_id`，其他标签页更换账号后，旧页面不能上传到新账号。相同文档重复保存不会增加版本。客户端通过 Web Locks 和 IndexedDB 原子事务保护多标签页编辑；未登录的收藏也采用原子合并。同款冲突会停止保存，避免悄悄覆盖。冲突确认绑定到打开确认框时展示的记录；确认前两端有新修改时，需要重新查看。

使用同源 Django 会话认证，密码由 Django 哈希保存。会话及 CSRF Cookie 在正式环境使用 Secure、HttpOnly、SameSite=Lax；CSRF token 由同源会话接口返回，仅保存在页面内存。私人响应为 `Cache-Control: no-store, private`，服务工作器不缓存账号接口。登录和注册受数据库计数与 Nginx 限速限制。

## 接口

| 方法与路径 | 用途 |
|---|---|
| GET `/api/v1/auth/session/` | 登录状态、用户 id/用户名和 CSRF token |
| POST `/api/v1/auth/register/` | 用户名、密码、确认密码、remember |
| POST `/api/v1/auth/login/` | 用户名、密码、remember |
| POST `/api/v1/auth/logout/` | expected_user_id，退出会话 |
| POST `/api/v1/auth/password/` | expected_user_id、当前密码、新密码、确认新密码 |
| GET `/api/v1/me/archive/` | 当前账号的 user_id、revision、backup、updated_at |
| PUT `/api/v1/me/archive/` | expected_user_id、base_revision、backup |

所有写入都使用 JSON 和 `X-CSRFToken`，Cookie 随请求发送。backup 兼容原 JSON 备份协议，新增可选 `followed_series` 字符串数组。401 表示需要登录，403 表示 CSRF 校验失败，409 区分 `revision_conflict` 与 `account_changed`，429 表示稍后重试。请求上限 2 MiB，JSON 根节点为第 0 层，最多支持 64 层嵌套。现有 `/catalog/`、`/statistics/`、`/backup/validate/` 保留。

## 输入提示与备份保护

注册和修改密码按稳定的校验码返回中文提示。密码强度不合格时，HTTP 400 带有 `code: password_invalid`、一条优先处理的 `detail` 和完整的 `errors.password` 列表。客户端先检查长度、纯数字和确认密码；服务器继续执行用户名相似度、常见密码等完整校验。旧服务端的混合语言提示也会在客户端转成中文。

客户端账号请求禁止重定向，避免密码或私人备份被转发。网页版遇到过期的 CSRF 令牌时，下次由用户重试会重新获取令牌，不会自动重复写请求。

导入预览绑定账号和预览时的收藏快照，确认前有修改时拒绝覆盖。导入前保留恢复点，未知记录在支持的大小与嵌套层数内继续原样保留。

## 本地验证

先执行 README 的 migrate 与开发服务步骤。开发使用 SQLite 时，会跳过真正的 PostgreSQL 并发写入测试，其余后端测试正常运行。

真实 PostgreSQL 测试需要独立数据库，不能对正在提供用户服务的数据库执行测试。`pass_app` 无创建数据库权限，管理员应先创建隔离数据库，将所有者设为 pass_app；然后在账号容器设置 `DB_TEST_NAME=passarchive_validation`，运行 `python manage.py test api --keepdb --noinput`。确认全部测试通过，且 PostgreSQL 并发用例实际执行后，由管理员删除该隔离测试库。已在线运行的真实用户库不得作为测试目标。

## 生产部署

使用 `deploy/compose.release.yml` 与 [deployment-guide.md](deployment-guide.md)。数据库与密钥由实例管理员在服务器上生成，仓库和 Release 不包含值。应用角色只拥有本站数据库，不是超级用户，不能创建角色或数据库。部署采用 PostgreSQL 内部网络和仅监听本机的 API，经 HTTPS 反向代理提供同源访问。

更新已有实例前备份，保留原密钥、卷与 Compose 项目名；不要用新的空数据库替换用户存档。恢复先在隔离数据库核验，再计划停写切换。所有测试、日志和公开演示均使用独立测试数据。

官方实现参考：[Django 会话认证](https://docs.djangoproject.com/en/5.2/topics/auth/default/)、[Django CSRF](https://docs.djangoproject.com/en/5.2/howto/csrf/)、[Django PostgreSQL](https://docs.djangoproject.com/en/5.2/ref/databases/#postgresql-notes)、[官方 PostgreSQL 容器](https://hub.docker.com/_/postgres)。
