# 生产 WSGI 入口，供 Gunicorn 加载；本机调试一般使用 manage.py。

import os
from django.core.wsgi import get_wsgi_application
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
application = get_wsgi_application()
