"""目录覆盖层与管理写入规则。公开查询、统计和备份共用同一份生效目录。

调试链路：catalog_admin → save_operations → normalize_series/normalize_pass。
原始 JSON 只读，所有编辑落在数据库；通行证和系列的稳定 ID 不随名称变化。
"""
import copy
import hashlib
import re
import uuid
from datetime import date
from urllib.parse import urlsplit

from django.db import transaction
from rest_framework.exceptions import ValidationError

from .models import CatalogChange, CatalogState

TYPES = {'main', 'sp', 'carnival', 'collab', 'elite', 'special', 'endfield'}


def can_manage_catalog(user):
    return bool(user.is_authenticated and user.is_active and user.is_superuser and user.username == 'root')


def invalid(field, message):
    raise ValidationError({field: message})


def text(data, field, limit=200, required=False):
    value = data.get(field, '')
    if value is None and not required:
        return ''
    if not isinstance(value, str) or len(value.strip()) > limit:
        invalid(field, f'请输入不超过 {limit} 个字符的文字。')
    value = value.strip()
    if required and not value:
        invalid(field, '此项不能为空。')
    return value


def image_url(data, field):
    value = text(data, field, 1500)
    if not value:
        return None
    parts = urlsplit(value)
    # 图片可使用已有本地资源或 HTTPS 地址，拒绝脚本、协议相对地址及反斜杠路径。
    if ('\\' in value or any(ord(c) < 32 for c in value) or
            not (value.startswith('/assets/images/') or
                 parts.scheme == 'https' and parts.netloc and not parts.username and not parts.password)):
        invalid(field, '请使用 /assets/images/ 下的图片路径或完整 HTTPS 图片地址。')
    return value


def date_value(value, field):
    if value is None or value == '':
        return None
    if not isinstance(value, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', value):
        invalid(field, '日期请使用 YYYY-MM-DD 格式。')
    try:
        date.fromisoformat(value)
    except ValueError:
        invalid(field, '请输入有效日期。')
    return value


def normalize_series(data, previous):
    from .domain import money
    allowed = {'name', 'type', 'year', 'box_number', 'release_date', 'replicate_dates', 'barcodes', 'image', 'official_box_price', 'pricing_mode'}
    if set(data) - allowed:
        invalid('fields', '提交了不支持的系列字段。')
    value = {**previous, **data}
    result = copy.deepcopy(previous)
    result.update({key: text(value, key, required=key == 'name') for key in ['name', 'type', 'year', 'box_number']})
    if result['type'] not in TYPES:
        invalid('type', '请选择有效的系列分类。')
    if result['year'] and not re.fullmatch(r'\d{4}', result['year']):
        invalid('year', '年份请使用四位数字。')
    result['box_number'] = result['box_number'] or None
    result['release_date'] = date_value(value.get('release_date'), 'release_date')
    result['image'] = image_url(value, 'image')
    result['official_box_price'] = float(money(value.get('official_box_price', '0'), 'official_box_price') or '0')
    for field in ['barcodes', 'replicate_dates']:
        entries = value.get(field, [])
        if not isinstance(entries, list) or len(entries) > 100 or any(not isinstance(x, str) or not x.strip() or len(x) > 100 for x in entries):
            invalid(field, '请填写不超过 100 项的文字列表。')
        result[field] = list(dict.fromkeys(x.strip() for x in entries))
    for entry in result['replicate_dates']:
        date_value(entry, 'replicate_dates')
    mode = value.get('pricing_mode', pricing_mode(previous))
    if mode not in ['unit', 'box']:
        invalid('pricing_mode', '请选择按单张或按整盒计价。')
    result['pricing_mode'] = mode
    for item in result['passes']:
        item['official_unit_price'] = None if mode == 'box' else item['official_unit_price'] if item['official_unit_price'] is not None else 0
    return result


def pricing_mode(series):
    if series.get('passes'):
        return 'box' if series['passes'][0]['official_unit_price'] is None else 'unit'
    return series.get('pricing_mode', 'unit')


def normalize_pass(data, previous, series, catalog):
    from .domain import money
    allowed = {'name', 'label', 'variant', 'avatar', 'rarity', 'class', 'faction', 'en', 'py', 'pyi', 'official_unit_price'}
    if set(data) - allowed:
        invalid('fields', '提交了不支持的通行证字段。')
    value = {**previous, **data}
    result = copy.deepcopy(previous)
    for field in ['name', 'label', 'variant', 'class', 'faction', 'en', 'py', 'pyi']:
        result[field] = text(value, field, required=field == 'name')
    result['variant'] = result['variant'] or None
    result['label'] = result['label'] or result['name'] + (f"·{result['variant']}" if result['variant'] else '')
    rarity = value.get('rarity')
    if rarity is not None and (isinstance(rarity, bool) or not isinstance(rarity, int) or not 1 <= rarity <= 6):
        invalid('rarity', '星级只能是 1–6 的整数，或留空。')
    result['rarity'] = rarity
    result['avatar'] = image_url(value, 'avatar')
    unit = money(value.get('official_unit_price'), 'official_unit_price')
    if pricing_mode(series) == 'unit' and unit is None:
        invalid('official_unit_price', '按单张计价的系列需要填写单张官方参考价。')
    if pricing_mode(series) == 'box' and unit is not None:
        invalid('official_unit_price', '此系列按整盒计价，单张官方参考价应留空。')
    result['official_unit_price'] = float(unit) if unit is not None else None
    # 同名干员复用既有身份；修改通行证名称仍保留 pass.id，因此收藏关联不变。
    identities = {p['name']: p['operator_id'] for s in catalog['series'] for p in s['passes']}
    result['operator_id'] = identities.get(result['name'], 'o_' + hashlib.sha256(result['name'].encode()).hexdigest()[:16])
    if any(p['id'] != result['id'] and p['label'].casefold() == result['label'].casefold() for p in series['passes']):
        invalid('label', '此系列已有相同的通行证名称，请补充不同的款式。')
    return result


def merge_catalog(base, state):
    """用数据库中的系列快照覆盖只读基础目录，并重建搜索文本和干员计数。"""
    result = copy.deepcopy(base)
    if not state or not state.revision:
        return result
    overrides = state.document
    series = {s['id']: s for s in result['series']}
    series.update(copy.deepcopy(overrides))
    result['series'] = list(series.values())
    for s in result['series']:
        for p in s['passes']:
            p['search_text'] = ' '.join(str(x or '') for x in [s['name'], s.get('box_number'), *s['barcodes'],
                p['name'], p['label'], p['en'], p['py'], p['pyi'], p['class'], p['faction']]).casefold()
    operators = {}
    original = {o['id']: o for o in base.get('operators', [])}
    for s in result['series']:
        for p in s['passes']:
            operators[p['operator_id']] = {**original.get(p['operator_id'], {}),
                **{key: p[key] for key in ['name', 'avatar', 'rarity', 'class', 'faction', 'en', 'py', 'pyi']}, 'id': p['operator_id']}
    result['operators'] = sorted(operators.values(), key=lambda o: o['name'])
    result['counts'] = {'series': len(series), 'passes': sum(len(s['passes']) for s in result['series']), 'operators': len(operators)}
    result['version'] = f"{base['version']}-r{state.revision}"
    result['generated_at'] = state.updated_at.isoformat()
    return result


class RevisionConflict(Exception):
    pass


def save_operations(data, actor=None, source='web'):
    """在单一事务中验证全部操作并保存；任一项失败时整批回滚。"""
    from .domain import get_base_catalog
    revision = data.get('base_revision')
    if isinstance(revision, bool) or not isinstance(revision, int) or revision < 0:
        invalid('base_revision', '请重新加载目录后保存。')
    operations = data.get('operations')
    if not isinstance(operations, list) or not 1 <= len(operations) <= 100:
        invalid('operations', '每次提交需要 1–100 项操作。')
    with transaction.atomic():
        # 迁移创建唯一行；flush 后的测试环境也可重新建立，无目录数据时仍使用基础快照。
        CatalogState.objects.get_or_create(pk=1)
        state = CatalogState.objects.select_for_update().get(pk=1)
        if state.revision != revision:
            raise RevisionConflict()
        catalog = merge_catalog(get_base_catalog(), state)
        changed = []
        for operation in operations:
            if not isinstance(operation, dict) or set(operation) - {'entity', 'id', 'series_id', 'data'}:
                invalid('operations', '操作格式不正确。')
            entity = operation.get('entity')
            fields = operation.get('data')
            if entity not in ['series', 'pass'] or not isinstance(fields, dict) or not fields:
                invalid('operations', '请选择系列或通行证，并填写详情。')
            item_id = operation.get('id')
            if item_id is not None and (not isinstance(item_id, str) or not item_id or len(item_id) > 100):
                invalid('id', '记录标识不正确。')
            if entity == 'series':
                previous = next((s for s in catalog['series'] if s['id'] == item_id), None)
                if item_id and not previous:
                    invalid('id', '这个系列已不存在，请重新加载。')
                previous = previous or {'id': 's_' + uuid.uuid4().hex[:16], 'passes': []}
                value = normalize_series(fields, previous)
                if any(s['id'] != value['id'] and s['name'].casefold() == value['name'].casefold() for s in catalog['series']):
                    invalid('name', '已有相同名称的系列。')
                catalog['series'] = [value if s['id'] == value['id'] else s for s in catalog['series']]
                if not item_id:
                    catalog['series'].append(value)
                series = value
            else:
                series = next((s for s in catalog['series'] if s['id'] == operation.get('series_id')), None)
                if not series:
                    invalid('series_id', '请先选择或创建所属系列。')
                previous = next((p for p in series['passes'] if p['id'] == item_id), None)
                if item_id and not previous:
                    invalid('id', '这个通行证不属于所选系列，请重新加载。')
                value = normalize_pass(fields, previous or {'id': 'p_' + uuid.uuid4().hex[:16]}, series, catalog)
                series['passes'] = [value if p['id'] == value['id'] else p for p in series['passes']]
                if not item_id:
                    series['passes'].append(value)
            state.document[series['id']] = copy.deepcopy(series)
            changed.append(copy.deepcopy({'entity': entity, 'id': value['id'], 'series_id': series['id'], 'before': previous if item_id else None, 'after': value}))
        if len(catalog['series']) > 2000 or sum(len(s['passes']) for s in catalog['series']) > 10000:
            invalid('catalog', '目录已超过支持的系列或通行证数量上限。')
        state.revision += 1
        state.save(update_fields=['document', 'revision', 'updated_at'])
        CatalogChange.objects.create(revision=state.revision, actor=actor, source=source, operations=changed)
        return {'revision': state.revision, 'catalog': merge_catalog(get_base_catalog(), state),
                'saved': [{'entity': o['entity'], 'id': o['id'], 'series_id': o['series_id']} for o in changed]}
