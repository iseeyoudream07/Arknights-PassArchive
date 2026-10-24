#!/usr/bin/env python3
# Django 命令行入口；PyCharm 的「03 API 断点调试」从这里启动。
# 调试接口时通常在 api/views.py 或 api/accounts.py 中设断点，具体业务规则在 api/domain.py。

import os

import sys

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
from django.core.management import execute_from_command_line
execute_from_command_line(sys.argv)
