# 清理超过一天的认证限流桶；调用方式：manage.py prune_auth_attempts。
# 该命令会删除过期限流记录；日常查看代码无需执行它。

from datetime import timedelta

from django.core.management.base import BaseCommand
from django.utils import timezone

from api.models import AuthRateBucket


# 注册 prune_auth_attempts 管理命令，用于定期清理失效的认证限流状态。
class Command(BaseCommand):
    help = 'Remove authentication rate-limit buckets older than one day.'

    # 删除窗口起点早于一天前的桶，并输出删除记录数。
    def handle(self, *args, **options):
        count, _ = AuthRateBucket.objects.filter(started_at__lt=timezone.now() - timedelta(days=1)).delete()
        self.stdout.write(f'Removed {count} expired authentication attempt buckets.')
