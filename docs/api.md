# 共享 API v1

基础地址 `https://arknights.yukkuri.win/api/v1/`。所有路径以 `/` 结尾，POST 使用 `Content-Type: application/json`。请求正文上限 2 MB。

| 接口 | 说明 |
|---|---|
| `GET health/` | 运行状态与目录版本 |
| `GET catalog/` | 完整统一目录；含稳定 ID、图片、条码、元数据和来源 |
| `GET passes/?q=阿米娅&type=main&offset=0&limit=100` | 查询，最多每页 200 项，返回 count/results |
| `POST stats/` | 计算传入收藏，返回统计；不持久保存 |
| `POST backups/validate/` | 校验新旧备份，返回统一格式、警告和统计；不持久保存 |
| `GET schema/` | 简要协议说明 |
| `GET auth/session/` | 会话、用户与 CSRF token |
| `POST auth/register/` / `auth/login/` | 创建账号 / 登录 |
| `POST auth/logout/` / `auth/password/` | 退出 / 修改密码 |
| `GET me/archive/` / `PUT me/archive/` | 读取 / 按账号与版本校验保存私人存档 |

## 收藏记录

```json
{
  "collection": {
    "p_2c5e1f6aa02d56d7": {
      "owned": true,
      "market": "30.10",
      "lots": [{"cost": "20.05", "qty": 3}]
    }
  }
}
```

`market` 的 `null` 表示未录入；`0.00` 是明确零价，但按上游规则不参与盈亏。单价非负，最多两位小数，上限 3,250,000；每条数量为 1–999 的整数。金额响应是精确的十进制字符串。未拥有条目清除价格与购买记录。

统计口径：不同通行证计拥有种类，购买批次计总数量。未填写批次的拥有条目数量为零。官方参考价按批次数量计算；固定价格特殊盒的官方价在拥有任一张时计整盒一次。盈亏仅以非零市价条目的估值减其对应购入成本。

## 新版备份

```json
{
  "schema_version": 1,
  "catalog_version": "catalog-3c7071ff615c12a1",
  "collection": {},
  "unmapped": {},
  "followed_series": [],
  "exported_at": "2026-10-14T00:00:00Z"
}
```

`unmapped` 保存无法关联当前目录的条目，新旧备份都保留。旧版 `{exportedAt, collection}` 与直接系列字典可转换，兼容 `{market,cost}` 和 `{market,lots}`。导入采用用户确认后的合并，同一 ID 以导入值为准；本机保留导入前恢复点。

目录 ID 基于原系列、原标签及原干员名生成，并保存旧名映射。更新名称时需要维护迁移映射，不能直接删除旧关联。目录、规则和图片应作为一个版本发布。

## 账号与同步

目录仍为公共只读数据，统计与备份校验接口仍无状态。Web 账号使用同源 Cookie 会话与 CSRF 校验；私人存档保存在 PostgreSQL，所有私人响应禁止缓存。

`GET me/archive/` 返回 `{user_id,revision,backup,updated_at}`。PUT 接收 `{expected_user_id,base_revision,backup}`，事务内校验版本与当前账号。版本冲突返回 409 `revision_conflict` 和自己的最新云端文档；账号不匹配返回 409 `account_changed`。客户端进行三方合并，同一条不同改动由用户选择，不会静默覆盖。完整协议与实现范围见 `accounts.md`。iOS 登录和同步尚未接入。
