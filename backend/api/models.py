# 账号存档和认证限流的数据库模型；字段变更需要另建 Django 迁移。

from django.conf import settings
from django.db import models


# 每个用户对应一份标准 JSON 存档；revision 由应用在内容变化时递增。
class CloudArchive(models.Model):
    # 一对一关联保证账号间隔离；删除用户时同时删除其存档。
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    # 并发同步版本，只有 document 实际变化时才在 accounts.archive 中递增。
    revision = models.PositiveBigIntegerField(default=0)
    # 保存标准备份 JSON，包括 collection、unmapped 和 followed_series。
    document = models.JSONField(default=dict)
    updated_at = models.DateTimeField(auto_now=True)


# 认证尝试计数桶；仅保存摘要键、窗口起点和次数，不直接存 IP 或用户名。
class AuthRateBucket(models.Model):
    # The keyed digest keeps IP addresses and usernames out of rate-limit rows.
    key = models.CharField(max_length=64, primary_key=True)
    started_at = models.DateTimeField()
    count = models.PositiveIntegerField(default=0)


class CatalogState(models.Model):
    """全站唯一的目录覆盖层；锁定该行后检查版本，不改写随包分发的原始目录。"""
    id = models.PositiveSmallIntegerField(primary_key=True, default=1, editable=False)
    revision = models.PositiveBigIntegerField(default=0)
    document = models.JSONField(default=dict)
    updated_at = models.DateTimeField(auto_now=True)


class CatalogChange(models.Model):
    """每次成功保存的审计记录；不包含密码、Cookie 或外部接入令牌。"""
    revision = models.PositiveBigIntegerField(unique=True)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL)
    source = models.CharField(max_length=100, default='web')
    operations = models.JSONField(default=list)
    created_at = models.DateTimeField(auto_now_add=True)
