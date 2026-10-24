# Django 配置：开发环境使用 SQLite，设置 DB_HOST 后改用 PostgreSQL。
# 配置值来自环境变量或指定的密钥文件；本机开发的环境隔离见 tools/dev.py。

import os
from pathlib import Path

# 所有默认路径以 backend/ 为基准，避免 PyCharm 工作目录变化导致读错文件。
BASE_DIR = Path(__file__).resolve().parent.parent
DEBUG = os.environ.get('DJANGO_DEBUG', 'true').lower() == 'true'
# 生产环境必须提供独立密钥；默认密钥仅供 DEBUG 开发使用。
key_file = os.environ.get('DJANGO_SECRET_KEY_FILE')
SECRET_KEY = Path(key_file).read_text().strip() if key_file else os.environ.get('DJANGO_SECRET_KEY', 'local-development-only-arknights-pass')
if not DEBUG and SECRET_KEY.startswith('local-development'):
    raise RuntimeError('Set DJANGO_SECRET_KEY before production startup')
ALLOWED_HOSTS = os.environ.get('DJANGO_ALLOWED_HOSTS', '127.0.0.1,localhost,testserver').split(',')
INSTALLED_APPS = ['django.contrib.auth', 'django.contrib.contenttypes', 'django.contrib.sessions', 'rest_framework', 'api']
# 会话中间件先恢复 session，认证中间件再据此提供 request.user。
MIDDLEWARE = ['django.middleware.security.SecurityMiddleware', 'django.contrib.sessions.middleware.SessionMiddleware',
              'django.middleware.common.CommonMiddleware', 'django.middleware.csrf.CsrfViewMiddleware',
              'django.contrib.auth.middleware.AuthenticationMiddleware']
ROOT_URLCONF = 'config.urls'
WSGI_APPLICATION = 'config.wsgi.application'
# 数据库分支取决于 DB_HOST 是否非空；tools/dev.py 会清理继承的 DB_* 配置。
if os.environ.get('DB_HOST'):
    password_file = os.environ.get('DB_PASSWORD_FILE')
    DATABASES = {'default': {'ENGINE': 'django.db.backends.postgresql', 'HOST': os.environ['DB_HOST'],
        'PORT': os.environ.get('DB_PORT', '5432'), 'NAME': os.environ.get('DB_NAME', 'passarchive'),
        'USER': os.environ.get('DB_USER', 'pass_app'),
        'PASSWORD': Path(password_file).read_text().strip() if password_file else os.environ.get('DB_PASSWORD', ''),
        'CONN_MAX_AGE': 60, 'CONN_HEALTH_CHECKS': True,
        'OPTIONS': {'connect_timeout': 5}, 'TEST': {'NAME': os.environ.get('DB_TEST_NAME', 'test_passarchive')}}}
else:
    if not DEBUG:
        raise RuntimeError('Production account storage requires PostgreSQL (DB_HOST)')
    DATABASES = {'default': {'ENGINE': 'django.db.backends.sqlite3', 'NAME': os.environ.get('DEV_DB_PATH', str(BASE_DIR / 'db.sqlite3'))}}
# 密码规则由后端统一执行，前端输入约束只作提前提示。
AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator', 'OPTIONS': {'min_length': 10}},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]
# 会话 Cookie 不允许脚本读取；生产环境仅随 HTTPS 发送。
SESSION_COOKIE_NAME = 'pass_archive_session'
SESSION_COOKIE_SECURE = not DEBUG
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = 'Lax'
SESSION_COOKIE_AGE = 14 * 24 * 3600
# CSRF 令牌由会话接口显式返回，前端通过 X-CSRFToken 请求头提交。
CSRF_COOKIE_NAME = 'pass_archive_csrf'
CSRF_COOKIE_SECURE = not DEBUG
CSRF_COOKIE_HTTPONLY = True
CSRF_COOKIE_SAMESITE = 'Lax'
default_csrf_origins = 'https://arknights.yukkuri.win' + (',http://127.0.0.1:5173,http://localhost:5173' if DEBUG else '')
CSRF_TRUSTED_ORIGINS = os.environ.get('CSRF_TRUSTED_ORIGINS', default_csrf_origins).split(',')
CSRF_FAILURE_VIEW = 'api.accounts.csrf_failure'
USE_TZ = True
DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'
TIME_ZONE = 'Asia/Shanghai'
LANGUAGE_CODE = 'zh-hans'
# 基础目录只读加载；后台修改存于数据库覆盖层，源目录重建仍需重启进程。
CATALOG_PATH = Path(os.environ.get('CATALOG_PATH', str(BASE_DIR.parent / 'data' / 'catalog.json')))
# 外部接入默认关闭；部署方通过单独的只读 secret 文件提供服务令牌。
# 不复用用户密码或 Django SECRET_KEY，也不把此值发送给 Web/iOS。
catalog_ingest_token_file = os.environ.get('CATALOG_INGEST_TOKEN_FILE')
CATALOG_INGEST_TOKEN = Path(catalog_ingest_token_file).read_text().strip() if catalog_ingest_token_file else ''
if CATALOG_INGEST_TOKEN and len(CATALOG_INGEST_TOKEN) < 32:
    raise RuntimeError('CATALOG_INGEST_TOKEN_FILE requires a token of at least 32 characters')
# 公开 DRF 接口不启用会话认证；账号接口单独使用 Django 的会话与 CSRF 装饰器。
REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': [],
    'UNAUTHENTICATED_USER': None,
    'DEFAULT_RENDERER_CLASSES': ['rest_framework.renderers.JSONRenderer'],
    'DEFAULT_PARSER_CLASSES': ['api.parsers.BoundedJSONParser'],
}
DATA_UPLOAD_MAX_MEMORY_SIZE = 2 * 1024 * 1024
SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_HSTS_SECONDS = 2592000 if not DEBUG else 0
LOGGING = {'version': 1, 'disable_existing_loggers': False, 'handlers': {'console': {'class': 'logging.StreamHandler'}}, 'root': {'handlers': ['console'], 'level': 'INFO'}}
