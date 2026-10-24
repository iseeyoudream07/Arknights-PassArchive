# 账号 API：会话认证、注册登录、密码修改和带版本号的收藏同步。
# 调试同步重点观察 expected_user_id、base_revision 与数据库 revision，不要在日志中输出密码或会话凭据。

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
from .json_limits import JSONDepthError, check_json_depth


# 统一输出中文 JSON，并禁止共享缓存；Vary: Cookie 区分不同会话。
def reply(value, status=200):
    response = JsonResponse(value, status=status, json_dumps_params={'ensure_ascii': False})
    response['Cache-Control'] = 'no-store, private'
    response['Vary'] = 'Cookie'
    return response


# 把 Django 的 CSRF 拒绝转换成前端可识别的 JSON 错误码。
def csrf_failure(request, reason=''):
    return reply({'detail': '登录验证已过期，请重新登录后再试。', 'code': 'csrf_failed'}, 403)


# 装饰账号视图，将请求格式和收藏校验异常转换成明确的 400 响应。
def api_errors(view):
    # 执行被包装的视图；只捕获已知输入异常，其余错误交给 Django 处理。
    @wraps(view)
    def run(request, *args, **kwargs):
        try:
            return view(request, *args, **kwargs)
        except (RecursionError, JSONDepthError):
            return reply({'detail': '数据内容过于复杂，暂时无法读取。请检查文件或重新提交。'}, 400)
        except (ValueError, UnicodeError, json.JSONDecodeError):
            return reply({'detail': '无法读取提交的数据，请检查内容后重试。'}, 400)
        except ValidationError as error:
            return reply({'detail': '收藏记录无法保存，请检查价格、数量或备份格式。', 'errors': error.detail}, 400)
    return run


# 读取 JSON 对象，限制请求体为 2 MB，并拒绝 NaN/Infinity 等非标准 JSON 常量。
def payload(request):
    if request.content_type != 'application/json':
        raise ValueError('Expected JSON')
    if len(request.body) > 2 * 1024 * 1024:
        raise ValueError('Payload too large')
    # 供 JSON 解码器回调：遇到非有限数字立即拒绝该请求。
    def invalid_constant(value):
        raise ValueError('Non-finite JSON number')
    value = json.loads(request.body, parse_constant=invalid_constant)
    check_json_depth(value)
    if not isinstance(value, dict):
        raise ValueError('Expected object')
    return value


# 返回用户 ID、用户名和后台权限标志；不返回密码哈希等用户字段。
def user_data(user):
    from .catalog_store import can_manage_catalog
    return {'id': user.pk, 'username': user.username, 'can_manage_catalog': can_manage_catalog(user)}


# 按稳定的校验码提供面向用户的提示，不直接拼接 Django 的原始翻译。
# detail 只展示最需要先处理的一项，errors 保留全部规则，供客户端逐项提示。
def password_error(error):
    messages = {
        'password_too_short': '密码至少需要 10 个字符，请设置更长的密码。',
        'password_entirely_numeric': '密码不能只包含数字，请加入字母或其他字符。',
        'password_too_similar': '密码与用户名过于相似，请换一个差别更大的密码。',
        'password_too_common': '这个密码很容易被猜到，请换一个不常用的密码。',
    }
    codes = {item.code for item in error.error_list}
    hints = [message for code, message in messages.items() if code in codes]
    if not hints:
        hints = ['这个密码不够安全，请换一个至少 10 个字符的密码。']
    return reply({'detail': hints[0], 'code': 'password_invalid', 'errors': {'password': hints}}, 400)


def password_input_error(data):
    password = data.get('password')
    if not isinstance(password, str) or not password:
        return reply({'detail': '请输入密码。', 'errors': {'password': ['请输入密码。']}}, 400)
    if len(password) > 128:
        return reply({'detail': '密码最多支持 128 个字符，请缩短后重试。',
                      'errors': {'password': ['密码最多支持 128 个字符。']}}, 400)
    if password != data.get('password_confirm'):
        return reply({'detail': '两次输入的密码不一致，请重新确认。',
                      'errors': {'password_confirm': ['两次输入的密码不一致。']}}, 400)
    return None


# 用数据库限流桶限制认证尝试；通过 HMAC 摘要关联动作、来源 IP 与用户名。
# 事务内锁定同一个桶，避免并发绕过计数；超限返回 429，否则返回 None。
def allow_attempt(request, action, username='', limit=12, seconds=900):
    # Nginx replaces X-Real-IP; direct container requests cannot reach the Internet.
    address = request.META.get('HTTP_X_REAL_IP') or request.META.get('REMOTE_ADDR', '')
    value = f'{action}:{address}:{username}'.encode()
    key = hmac.new(settings.SECRET_KEY.encode(), value, hashlib.sha256).hexdigest()
    now = timezone.now()
    # 同一限流桶的计数读写必须放在事务中，select_for_update 在 PostgreSQL 下提供行锁。
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


# 返回当前登录状态及 CSRF 令牌，未登录也可调用；前端写请求先从这里获取令牌。
@require_http_methods(['GET'])
@ensure_csrf_cookie
def session(request):
    return reply({'authenticated': request.user.is_authenticated,
                  'user': user_data(request.user) if request.user.is_authenticated else None,
                  'csrf_token': get_token(request)})


# 检查用户名及密码后，在同一事务中创建用户和空存档，再建立登录会话。
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
        return reply({'detail': '用户名需要 3–32 个字符，只能使用英文字母、数字或下划线。'}, 400)
    if username == 'root':
        return reply({'detail': '此用户名由管理员保留，请使用其他用户名。', 'code': 'reserved_username'}, 400)
    password = data.get('password')
    invalid = password_input_error(data)
    if invalid is not None:
        return invalid
    user = get_user_model()(username=username)
    try:
        validate_password(password, user)
    except PasswordError as error:
        return password_error(error)
    try:
        with transaction.atomic():
            user.set_password(password)
            user.save()
            CloudArchive.objects.create(user=user)
    except IntegrityError:
        return reply({'detail': '这个用户名已被注册，请换一个用户名。'}, 409)
    login(request, user)
    request.session.set_expiry(settings.SESSION_COOKIE_AGE if data.get('remember') is True else 0)
    return reply({'authenticated': True, 'user': user_data(user), 'csrf_token': get_token(request)}, 201)


# 同时限制 IP 与用户名的尝试次数，校验密码后更新会话和记住登录期限。
@require_http_methods(['POST'])
@csrf_protect
@sensitive_post_parameters('password')
@sensitive_variables('data', 'password')
@api_errors
def sign_in(request):
    data = payload(request)
    username = str(data.get('username', '')).strip().lower()
    password = data.get('password')
    if not re.fullmatch(r'[a-z0-9_]{3,32}', username) or not isinstance(password, str) or len(password) > 128:
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


# 核对 expected_user_id 后退出会话，避免旧标签页意外退出新登录的账号。
@require_http_methods(['POST'])
@csrf_protect
@api_errors
def sign_out(request):
    data = payload(request)
    if request.user.is_authenticated and (data.get('expected_user_id') != request.user.pk or isinstance(data.get('expected_user_id'), bool)):
        return reply({'detail': '当前账号已变化，请刷新页面后重试。', 'code': 'account_changed'}, 409)
    logout(request)
    return reply({'authenticated': False, 'user': None, 'csrf_token': get_token(request)})


# 校验当前用户、旧密码及新密码规则，更新密码并保留当前会话有效。
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
    # 确认页面所属账号仍与当前 Cookie 会话一致，防止多标签页切号后串写。
    data = payload(request)
    if data.get('expected_user_id') != request.user.pk or isinstance(data.get('expected_user_id'), bool):
        return reply({'detail': '当前账号已变化，请刷新页面后重试。', 'code': 'account_changed'}, 409)
    if not isinstance(data.get('current_password'), str) or not request.user.check_password(data['current_password']):
        return reply({'detail': '当前密码不正确。'}, 400)
    password = data.get('password')
    invalid = password_input_error(data)
    if invalid is not None:
        return invalid
    try:
        validate_password(password, request.user)
    except PasswordError as error:
        return password_error(error)
    request.user.set_password(password)
    request.user.save(update_fields=['password'])
    update_session_auth_hash(request, request.user)
    return reply({'detail': '密码已更新，其他设备需要重新登录。', 'csrf_token': get_token(request)})


# 序列化账号存档；首次空文档按当前目录版本补成标准空备份。
def archive_data(archive):
    document = archive.document or {'schema_version': 1, 'catalog_version': get_catalog()['version'],
                                    'collection': {}, 'unmapped': {}, 'followed_series': []}
    return {'user_id': archive.user_id, 'revision': archive.revision, 'backup': document, 'updated_at': archive.updated_at.isoformat()}


# GET 读取当前用户存档；PUT 按 base_revision 乐观并发控制保存完整备份。
# 版本不一致返回 409 和最新云端文档，由前端合并，避免旧设备覆盖新记录。
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
    # 客户端提交的是上次看到的云端版本；锁内再次比较，避免检查与写入之间的竞争。
    revision = data.get('base_revision')
    if isinstance(revision, bool) or not isinstance(revision, int) or revision < 0:
        return reply({'detail': '同步版本格式错误。'}, 400)
    document, _ = normalize_backup(data.get('backup'))
    with transaction.atomic():
        value, _ = CloudArchive.objects.get_or_create(user=request.user)
        value = CloudArchive.objects.select_for_update().get(pk=value.pk)
        # 409 响应携带最新存档，客户端据此进行三方合并，而不是盲目重发覆盖。
        if value.revision != revision:
            return reply({'detail': '另一台设备已更新这些记录，请合并后再同步。', 'code': 'revision_conflict',
                          **archive_data(value)}, 409)
        if value.document != document:
            value.document = document
            value.revision += 1
            value.save(update_fields=['document', 'revision', 'updated_at'])
        return reply(archive_data(value))
