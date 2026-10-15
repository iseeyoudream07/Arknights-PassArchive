from django.http import JsonResponse
from django.views.decorators.cache import cache_control
from rest_framework.decorators import api_view
from rest_framework.response import Response
from rest_framework.exceptions import ValidationError
from .domain import get_catalog, calculate_stats, normalize_backup
from django.db import connection, DatabaseError

@api_view(['GET'])
def health(request):
    c = get_catalog()
    try:
        with connection.cursor() as cursor:
            cursor.execute('SELECT 1')
    except DatabaseError:
        return Response({'status': 'unavailable'}, status=503)
    return Response({'status': 'ok', 'catalog_version': c['version'], 'storage': 'postgresql' if connection.vendor == 'postgresql' else 'development-sqlite', 'accounts': True})

@cache_control(public=True, max_age=300)
@api_view(['GET'])
def catalog(request):
    c = get_catalog()
    response = JsonResponse(c, json_dumps_params={'ensure_ascii': False})
    response['ETag'] = '"' + c['version'] + '"'
    return response

@api_view(['GET'])
def passes(request):
    q = request.query_params.get('q', '').strip().casefold()[:200]
    t = request.query_params.get('type')
    found = [{**p, 'series_id': s['id'], 'series_name': s['name'], 'type': s['type']}
             for s in get_catalog()['series'] if not t or t == s['type']
             for p in s['passes'] if not q or q in (p.get('search_text', '') + ' ' + s['name'] + ' ' + str(s.get('box_number', '')) + ' ' + ' '.join(s.get('barcodes', []))).casefold()]
    try:
        offset = max(0, int(request.query_params.get('offset', 0)))
        limit = min(200, max(1, int(request.query_params.get('limit', 100))))
    except ValueError:
        return Response({'detail': 'offset 和 limit 必须为整数。'}, status=400)
    return Response({'count': len(found), 'results': found[offset:offset+limit]})

@api_view(['POST'])
def stats(request):
    if not isinstance(request.data, dict):
        raise ValidationError('请求根节点必须是对象。')
    response = Response(calculate_stats(request.data.get('collection', {})))
    response['Cache-Control'] = 'no-store'
    return response

@api_view(['POST'])
def backup_validate(request):
    backup, warnings = normalize_backup(request.data)
    response = Response({'backup': backup, 'warnings': warnings, 'stats': calculate_stats(backup['collection'])})
    response['Cache-Control'] = 'no-store'
    return response

@api_view(['GET'])
def schema(request):
    return Response({'api_version': 'v1', 'backup_schema_version': 1, 'catalog_version': get_catalog()['version'],
                     'endpoints': {'catalog': 'GET /api/v1/catalog/', 'passes': 'GET /api/v1/passes/?q=',
                                   'stats': 'POST /api/v1/stats/', 'validate_backup': 'POST /api/v1/backups/validate/'},
                     'record': {'owned': True, 'market': '30.00', 'lots': [{'cost': '25.00', 'qty': 2}]},
                     'collection_storage': 'local-cache-and-account-postgresql', 'server_retention': 'account-scoped',
                     'account_endpoints': {'session': 'GET /api/v1/auth/session/', 'register': 'POST /api/v1/auth/register/',
                         'login': 'POST /api/v1/auth/login/', 'logout': 'POST /api/v1/auth/logout/',
                         'password': 'POST /api/v1/auth/password/', 'archive': 'GET/PUT /api/v1/me/archive/'},
                     'rules': ['进度按已拥有的不同通行证计数。', '金额统计按购买记录数量计算；仅标记拥有但没有购买记录时，数量为零。',
                               '特殊礼盒拥有任意一张时，官方价按整盒计一次。', '未填市场价或市场价为零的条目不参与估算盈亏。']})
