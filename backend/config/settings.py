import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
DEBUG = os.environ.get('DJANGO_DEBUG', 'true').lower() == 'true'
key_file = os.environ.get('DJANGO_SECRET_KEY_FILE')
SECRET_KEY = Path(key_file).read_text().strip() if key_file else os.environ.get('DJANGO_SECRET_KEY', 'local-development-only-arknights-pass')
if not DEBUG and SECRET_KEY.startswith('local-development'):
    raise RuntimeError('Set DJANGO_SECRET_KEY before production startup')
ALLOWED_HOSTS = os.environ.get('DJANGO_ALLOWED_HOSTS', '127.0.0.1,localhost,testserver').split(',')
INSTALLED_APPS = ['django.contrib.auth', 'django.contrib.contenttypes', 'django.contrib.sessions', 'rest_framework', 'api']
MIDDLEWARE = ['django.middleware.security.SecurityMiddleware', 'django.contrib.sessions.middleware.SessionMiddleware',
              'django.middleware.common.CommonMiddleware', 'django.middleware.csrf.CsrfViewMiddleware',
              'django.contrib.auth.middleware.AuthenticationMiddleware']
ROOT_URLCONF = 'config.urls'
WSGI_APPLICATION = 'config.wsgi.application'
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
AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator', 'OPTIONS': {'min_length': 10}},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]
SESSION_COOKIE_NAME = 'pass_archive_session'
SESSION_COOKIE_SECURE = not DEBUG
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = 'Lax'
SESSION_COOKIE_AGE = 14 * 24 * 3600
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
CATALOG_PATH = Path(os.environ.get('CATALOG_PATH', str(BASE_DIR.parent / 'data' / 'catalog.json')))
REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': [],
    'UNAUTHENTICATED_USER': None,
    'DEFAULT_RENDERER_CLASSES': ['rest_framework.renderers.JSONRenderer'],
    'DEFAULT_PARSER_CLASSES': ['rest_framework.parsers.JSONParser'],
}
DATA_UPLOAD_MAX_MEMORY_SIZE = 2 * 1024 * 1024
SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_HSTS_SECONDS = 2592000 if not DEBUG else 0
LOGGING = {'version': 1, 'disable_existing_loggers': False, 'handlers': {'console': {'class': 'logging.StreamHandler'}}, 'root': {'handlers': ['console'], 'level': 'INFO'}}
