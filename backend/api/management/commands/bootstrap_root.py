"""交互创建 root 管理员，不提供默认密码，不自动提升已存在的普通 root。"""
from getpass import getpass

from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError


class Command(BaseCommand):
    help = '交互创建 Web 目录管理员 root；密码由终端隐藏输入。'

    def handle(self, *args, **options):
        users = get_user_model().objects
        existing = users.filter(username__iexact='root').first()
        if existing:
            if existing.username == 'root' and existing.is_superuser and existing.is_active:
                self.stdout.write('root 管理员已存在；本命令未修改账号或密码。')
                return
            raise CommandError('root 名称已被现有账号占用。请先由实例管理员核实身份；本命令不会自动提权。')
        user = get_user_model()(username='root', is_staff=True, is_superuser=True)
        password = getpass('root 密码（10–128 个字符）：')
        if password != getpass('再次输入密码：'):
            raise CommandError('两次密码不一致。')
        if len(password) > 128:
            raise CommandError('密码最多支持 128 个字符。')
        try:
            validate_password(password, user)
        except ValidationError as error:
            raise CommandError(' '.join(error.messages)) from None
        user.set_password(password)
        user.save()
        self.stdout.write(self.style.SUCCESS('root 管理员已创建。请在 Web 登录后进入通行证管理。'))
