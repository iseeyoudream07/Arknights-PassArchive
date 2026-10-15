"""Same-origin session accounts and revision-checked private collection storage."""
import hashlib
import hmac
import json
import re
from datetime import timedelta
from functools import wraps

from django.conf import settings
from django.contrib.auth import authenticate, get_user_model, login, logout, update_session_auth_hash
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as PasswordError
from django.db import IntegrityError, transaction
from django.http import JsonResponse
from django.middleware.csrf import get_token
from django.utils import timezone
from django.views.decorators.csrf import csrf_protect, ensure_csrf_cookie
from django.views.decorators.debug import sensitive_post_parameters, sensitive_variables
from django.views.decorators.http import require_http_methods
from rest_framework.exceptions import ValidationError

from .domain import get_catalog, normalize_backup
from .models import AuthRateBucket, CloudArchive


def reply(value, status=200):
    response = JsonResponse(value, status=status, json_dumps_params={'ensure_ascii': False})
    response['Cache-Control'] = 'no-store, private'
    response['Vary'] = 'Cookie'
    return response


def csrf_failure(request, reason=''):
    return reply({'detail': '登录校验已过期，请刷新页面后重试。', 'code': 'csrf_failed'}, 403)


def api_errors(view):
    @wraps(view)
    def run(request, *args, **kwargs):
        try:
            return view(request, *args, **kwargs)
        except (ValueError, UnicodeError, json.JSONDecodeError):
            return reply({'detail': '请求数据格式错误。'}, 400)
        except ValidationError as error:
            return reply({'detail': '收藏数据校验失败。', 'errors': error.detail}, 400)
    return run


def payload(request):
    if request.content_type != 'application/json':
        raise ValueError('Expected JSON')
    if len(request.body) > 2 * 1024 * 1024:
        raise ValueError('Payload too large')
    def invalid_constant(value):
        raise ValueError('Non-finite JSON number')
    value = json.loads(request.body, parse_constant=invalid_constant)
    if not isinstance(value, dict):
        raise ValueError('Expected object')
    return value


def user_data(user):
    return {'id': user.pk, 'username': user.username}


def allow_attempt(request, action, username='', limit=12, seconds=900):
    # Nginx replaces X-Real-IP; direct container requests cannot reach the Internet.
    address = request.META.get('HTTP_X_REAL_IP') or request.META.get('REMOTE_ADDR', '')
    value = f'{action}:{address}:{username}'.encode()
    key = hmac.new(settings.SECRET_KEY.encode(), value, hashlib.sha256).hexdigest()
    now = timezone.now()
    with transaction.atomic():
        bucket, _ = AuthRateBucket.objects.get_or_create(key=key, defaults={'started_at': now})
        bucket = AuthRateBucket.objects.select_for_update().get(pk=key)
        if now - bucket.started_at >= timedelta(seconds=seconds):
            bucket.started_at, bucket.count = now, 0
        if bucket.count >= limit:
            response = reply({'detail': '尝试次数较多，请稍后再试。', 'code': 'rate_limited'}, 429)
            response['Retry-After'] = str(max(1, int(seconds - (now - bucket.started_at).total_seconds())))
            return response
        bucket.count += 1
        bucket.save(update_fields=['count', 'started_at'])
    return None


@require_http_methods(['GET'])
@ensure_csrf_cookie
def session(request):
    return reply({'authenticated': request.user.is_authenticated,
                  'user': user_data(request.user) if request.user.is_authenticated else None,
                  'csrf_token': get_token(request)})


@require_http_methods(['POST'])
@csrf_protect
@sensitive_post_parameters('password', 'password_confirm')
@sensitive_variables('data', 'password')
@api_errors
def register(request):
    if request.user.is_authenticated:
        return reply({'detail': '请先退出当前账号。'}, 409)
    data = payload(request)
    username = str(data.get('username', '')).strip().lower()
    blocked = allow_attempt(request, 'register', limit=5, seconds=3600)
    if blocked:
        return blocked
    if not re.fullmatch(r'[a-z0-9_]{3,32}', username):
        return reply({'detail': '用户名需为 3–32 位英文字母、数字或下划线。'}, 400)
    password = data.get('password')
    if not isinstance(password, str) or len(password) > 128 or password != data.get('password_confirm'):
        return reply({'detail': '两次密码需一致，长度最多 128 位。'}, 400)
    user = get_user_model()(username=username)
    try:
        validate_password(password, user)
    except PasswordError as error:
        return reply({'detail': ' '.join(error.messages)}, 400)
    try:
        with transaction.atomic():
            user.set_password(password)
            user.save()
            CloudArchive.objects.create(user=user)
    except IntegrityError:
        return reply({'detail': '这个用户名已被使用。'}, 409)
    login(request, user)
    request.session.set_expiry(settings.SESSION_COOKIE_AGE if data.get('remember') is True else 0)
    return reply({'authenticated': True, 'user': user_data(user), 'csrf_token': get_token(request)}, 201)


@require_http_methods(['POST'])
@csrf_protect
@sensitive_post_parameters('password')
@sensitive_variables('data', 'password')
@api_errors
def sign_in(request):
    data = payload(request)
    username = str(data.get('username', '')).strip().lower()[:32]
    password = data.get('password')
    if not isinstance(password, str) or len(password) > 128:
        return reply({'detail': '用户名或密码不正确。'}, 401)
    for action, name, limit in [('login-ip', '', 60), ('login-user', username, 12)]:
        blocked = allow_attempt(request, action, name, limit=limit)
        if blocked:
            return blocked
    user = authenticate(request, username=username, password=password)
    if user is None:
        return reply({'detail': '用户名或密码不正确。'}, 401)
    login(request, user)
    request.session.set_expiry(settings.SESSION_COOKIE_AGE if data.get('remember') is True else 0)
    return reply({'authenticated': True, 'user': user_data(user), 'csrf_token': get_token(request)})


@require_http_methods(['POST'])
@csrf_protect
@api_errors
def sign_out(request):
    data = payload(request)
    if request.user.is_authenticated and (data.get('expected_user_id') != request.user.pk or isinstance(data.get('expected_user_id'), bool)):
        return reply({'detail': '当前账号已变化，请刷新页面后重试。', 'code': 'account_changed'}, 409)
    logout(request)
    return reply({'authenticated': False, 'user': None, 'csrf_token': get_token(request)})


@require_http_methods(['POST'])
@csrf_protect
@sensitive_post_parameters('current_password', 'password', 'password_confirm')
@sensitive_variables('data', 'password')
@api_errors
def change_password(request):
    if not request.user.is_authenticated:
        return reply({'detail': '请先登录。', 'code': 'sign_in_required'}, 401)
    blocked = allow_attempt(request, 'password', str(request.user.pk), limit=8)
    if blocked:
        return blocked
    data = payload(request)
    if data.get('expected_user_id') != request.user.pk or isinstance(data.get('expected_user_id'), bool):
        return reply({'detail': '当前账号已变化，请刷新页面后重试。', 'code': 'account_changed'}, 409)
    if not isinstance(data.get('current_password'), str) or not request.user.check_password(data['current_password']):
        return reply({'detail': '当前密码不正确。'}, 400)
    password = data.get('password')
    if not isinstance(password, str) or len(password) > 128 or password != data.get('password_confirm'):
        return reply({'detail': '两次新密码需一致，长度最多 128 位。'}, 400)
    try:
        validate_password(password, request.user)
    except PasswordError as error:
        return reply({'detail': ' '.join(error.messages)}, 400)
    request.user.set_password(password)
    request.user.save(update_fields=['password'])
    update_session_auth_hash(request, request.user)
    return reply({'detail': '密码已更新，其他设备需要重新登录。', 'csrf_token': get_token(request)})


def archive_data(archive):
    document = archive.document or {'schema_version': 1, 'catalog_version': get_catalog()['version'],
                                    'collection': {}, 'unmapped': {}, 'followed_series': []}
    return {'user_id': archive.user_id, 'revision': archive.revision, 'backup': document, 'updated_at': archive.updated_at.isoformat()}


@require_http_methods(['GET', 'PUT'])
@csrf_protect
@api_errors
def archive(request):
    if not request.user.is_authenticated:
        return reply({'detail': '请先登录。', 'code': 'sign_in_required'}, 401)
    if request.method == 'GET':
        value, _ = CloudArchive.objects.get_or_create(user=request.user)
        return reply(archive_data(value))
    data = payload(request)
    if data.get('expected_user_id') != request.user.pk or isinstance(data.get('expected_user_id'), bool):
        return reply({'detail': '当前账号已变化，请重新登录后再同步。', 'code': 'account_changed'}, 409)
    revision = data.get('base_revision')
    if isinstance(revision, bool) or not isinstance(revision, int) or revision < 0:
        return reply({'detail': '同步版本格式错误。'}, 400)
    document, _ = normalize_backup(data.get('backup'))
    with transaction.atomic():
        value, _ = CloudArchive.objects.get_or_create(user=request.user)
        value = CloudArchive.objects.select_for_update().get(pk=value.pk)
        if value.revision != revision:
            return reply({'detail': '另一台设备已更新这些记录，请合并后再同步。', 'code': 'revision_conflict',
                          **archive_data(value)}, 409)
        if value.document != document:
            value.document = document
            value.revision += 1
            value.save(update_fields=['document', 'revision', 'updated_at'])
        return reply(archive_data(value))
