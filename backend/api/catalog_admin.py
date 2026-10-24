"""Web 管理接口及独立的外部目录写入入口；两者共用校验与事务规则。"""
import hmac
from functools import wraps

from django.conf import settings
from django.core.exceptions import RequestDataTooBig
from django.views.decorators.csrf import csrf_exempt, csrf_protect
from django.views.decorators.http import require_http_methods
from rest_framework.exceptions import ValidationError

from .accounts import allow_attempt, payload, reply
from .catalog_store import RevisionConflict, can_manage_catalog, save_operations
from .domain import get_base_catalog
from .json_limits import JSONDepthError
from .models import CatalogState


def catalog_errors(view):
    @wraps(view)
    def run(request, *args, **kwargs):
        try:
            return view(request, *args, **kwargs)
        except RevisionConflict:
            return reply({'detail': '目录已在其他页面更新。请重新加载后再保存，当前填写内容已保留。', 'code': 'catalog_conflict'}, 409)
        except ValidationError as error:
            return reply({'detail': '目录未保存，请检查填写内容。', 'errors': error.detail}, 400)
        except (ValueError, UnicodeError, JSONDepthError, RecursionError, RequestDataTooBig):
            return reply({'detail': '提交格式不正确、内容过大或嵌套过深，请检查后重试。'}, 400)
    return run


@require_http_methods(['GET', 'POST'])
@csrf_protect
@catalog_errors
def catalog_admin(request):
    if not request.user.is_authenticated:
        return reply({'detail': '请先登录管理员账号。', 'code': 'sign_in_required'}, 401)
    if not can_manage_catalog(request.user):
        return reply({'detail': '当前账号没有目录管理权限。', 'code': 'admin_required'}, 403)
    if request.method == 'GET':
        from .catalog_store import merge_catalog
        state = CatalogState.objects.filter(pk=1).first()
        return reply({'catalog': merge_catalog(get_base_catalog(), state), 'revision': state.revision if state else 0})
    data = payload(request)
    expected = data.get('expected_user_id')
    if isinstance(expected, bool) or expected != request.user.pk:
        return reply({'detail': '当前账号已变化，请重新登录管理员账号。', 'code': 'account_changed'}, 409)
    return reply(save_operations(data, actor=request.user))


@require_http_methods(['GET', 'POST'])
@csrf_exempt
@catalog_errors
def ingest_catalog(request):
    """默认关闭。仅显式配置的服务令牌可用；不接受浏览器 Cookie 代替服务认证。

    此接口只接收规范化 JSON，不主动抓取 URL。令牌不返回给前端、不写入审计记录。
    """
    token = settings.CATALOG_INGEST_TOKEN
    if not token:
        return reply({'detail': '外部目录接入尚未启用。', 'code': 'integration_disabled'}, 503)
    supplied = request.headers.get('Authorization', '')
    if not hmac.compare_digest(supplied.encode(), ('Bearer ' + token).encode()):
        return reply({'detail': '服务认证失败。', 'code': 'service_auth_required'}, 401)
    blocked = allow_attempt(request, 'catalog-ingest', limit=60, seconds=3600)
    if blocked is not None:
        return blocked
    if request.method == 'GET':
        state = CatalogState.objects.filter(pk=1).first()
        return reply({'revision': state.revision if state else 0})
    data = payload(request)
    source = data.get('source')
    if not isinstance(source, str) or not source.strip() or len(source) > 80:
        return reply({'detail': '请提供不超过 80 个字符的数据源名称。'}, 400)
    return reply(save_operations(data, source='external:' + source.strip()))
