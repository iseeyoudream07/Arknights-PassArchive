# Web 通行证管理

管理页面为 `/admin.html`。登录 `root` 管理员后，二维页面侧栏增加“05 通行证管理”，账号与同步面板也提供入口；登录成功可直接进入后台。未登录、普通账号、只拥有 `root` 用户名而无超级用户权限的账号均不能读取管理接口或保存。iOS 不增加管理入口和编辑功能。

## 首次启用

在运行 Django 的环境执行迁移，再交互创建管理员：

```bash
.venv/bin/python backend/manage.py migrate
.venv/bin/python backend/manage.py bootstrap_root
```

命令隐藏输入密码，没有默认密码。已存在的有效 `root` 管理员会保持原账号和密码；同名普通账号或大小写冲突会停止初始化，由实例维护者核实身份后处理，不会自动提权。`root` 禁止通过公开注册接口创建；普通注册不能提交权限字段来获得管理权限。也可使用 Django 的 `createsuperuser --username root` 初始化同一身份。

生产容器内对应为 `python manage.py migrate --noinput` 和 `python manage.py bootstrap_root`。更新前按现有部署流程备份 PostgreSQL，保留实例密钥、数据卷和项目名，同时发布 Web 与 API。迁移只新增目录覆盖层及审计表，不改已有收藏。后台需要同源 Django，单独上传静态 Web 包不能启用保存。

## 使用

后台沿用网页的字体、暖灰材质、细线和强调色，支持深浅主题和窄屏浏览器。选择左侧系列，再新增通行证；也可新增系列、编辑系列详情，按干员、拼音、盒号、条码搜索，或按分类筛选。表格每页 40 项。

- 系列：名称、分类、盒号、年份、发售日期、复刻日期、包装条码、封面、整盒官方参考价与计价方式。
- 通行证：干员名称、显示名称、款式/阶段、英文名、阵营、职业、星级、拼音、首字母、图片与单张官方参考价。
- 图片可填已有 `/assets/images/` 资源路径或 HTTPS 图片地址；本次不增加文件上传服务。

盒号和条码始终按文字保留，避免丢失 `1.0` 或前导零。金额非负、最多两位小数，上限 3,250,000 元。按整盒计价时，所有单张官方价为 null；切回单张时先按 0 元保存，需逐款补充实际参考价。切换计价方式会影响该系列后续的官方参考金额统计。

编辑保留系列/通行证原 ID，已有收藏、价格、批次、关注不依赖新名称重新关联；不提供删除功能。保存成功后更新服务器公开目录，查询、统计、备份校验使用同一生效版本。其他已打开的客户端在重新加载目录后看到更新，已缓存的离线目录保持最后一次获取版本。

保存采用 `base_revision` 校验。其他页面先保存后，旧页面返回 409，保留填写内容并停止再次提交；复制需要保留的内容，再明确放弃旧表单并重新加载、核对。账号更换、会话过期和撤权均由服务器再次拦截。后台不缓存管理 HTML/API，离线不恢复后台；页面恢复可见时及每 30 秒核验会话。

## 数据保存与审计

`data/catalog.json` 和随包静态数据只读，后台不改写上传资料。`CatalogState` 单行存放已编辑系列的快照及全局 revision，多进程每次读取数据库。`CatalogChange` 保存操作者、版本、来源、时间及修改前后内容；与账号一起由完整 PostgreSQL 备份覆盖。

覆盖层以整个系列为单位保存。以后重新构建基础目录时，应先核对后台已编辑系列，避免覆盖层遮住同系列的新源条目；本次不会自动合并外部仓库或运行抓取任务。

## 管理 API

| 接口 | 约定 |
|---|---|
| `GET /api/v1/admin/catalog/` | root 会话；返回 `{catalog, revision}`；禁止缓存 |
| `POST /api/v1/admin/catalog/` | root 会话、CSRF、`expected_user_id`、`base_revision`、`operations` |

`operations` 每批 1–100 项，任一项无效则全部回滚。`entity` 为 `series` 或 `pass`，`data` 是需要创建或修改的字段；有 `id` 为编辑，无 `id` 为新增。通行证操作必须提供 `series_id`，不可改动既有 ID 或转移所属系列。成功返回 `{catalog, revision, saved}`；新 ID 在 `saved` 内。

```json
{
  "expected_user_id": 1,
  "base_revision": 0,
  "operations": [
    {
      "entity": "pass",
      "id": "p_2c5e1f6aa02d56d7",
      "series_id": "s_de6d1000fc53ae10",
      "data": {"label": "阿米娅·精一", "official_unit_price": "25.00"}
    }
  ]
}
```

示例中的用户 ID 与 revision 需替换为当前会话和 GET 返回值。400 表示字段错误；401 需要登录；403 为权限或 CSRF 拒绝；409 的 `catalog_conflict` 为目录版本过期，`account_changed` 为账号变化。

## 预留外部数据源接口

前端不提供配置、状态展示或调用入口。默认不启用，不主动读取任意 URL。协议位置：

| 接口 | 约定 |
|---|---|
| `GET /api/v1/integrations/catalog/` | 独立 Bearer 服务认证，返回当前 `{revision}` |
| `POST /api/v1/integrations/catalog/` | 同一 Bearer 认证，接收 `{source, base_revision, operations}` |

未配置服务令牌时返回 503 `integration_disabled`。将独立高强度令牌放在 API 服务可读的只读 secret 文件，配置 `CATALOG_INGEST_TOKEN_FILE` 为其路径并重启 API；至少 32 个字符。不要复用管理员密码或 Django 密钥。通过 HTTPS 的 `Authorization: Bearer <服务令牌>` 认证，Cookie 会话不能替代它，浏览器前端不持有令牌。每个来源 IP 每小时最多 60 次已认证请求。

外部适配器先 GET 获取 revision，再把外部数据映射成上述标准 operations。新系列需先创建并取回 ID，再添加通行证。外部接口沿用所有字段规则、原子事务和版本检查；版本过期需重新读取和核对，不能盲目重发。`source` 为 1–80 字符的来源名称，审计记为 `external:<source>`，不保存认证头。服务令牌只能调用此目录入口，不能访问用户私人存档。

请求 JSON 上限 2 MiB、嵌套最多 64 层；所有私人响应禁止缓存。首次启用真实数据源前，应在独立数据库验证映射、重复数据处理与版本冲突，再配置生产令牌。
