# 收藏业务规则：目录读取、金额校验、收藏统计和新旧备份转换。
# 金额使用 Decimal；已拥有种类数与实际购买数量分开统计，规则需与 web/src/core.ts 保持一致。

"""Portable collection rules, migrated from the upstream v3 application.

Ownership counts unique passes. Valuation uses only recorded lot quantities.
Market prices <= 0 do not participate in estimated P/L, as upstream does.
"""
import json
import re
from decimal import Decimal
from functools import lru_cache
from django.conf import settings
from rest_framework.exceptions import ValidationError
from .json_limits import JSONDepthError, check_json_depth

# 只缓存只读基础目录；管理员覆盖层每次从数据库读取，多个 worker 即时共享修改。
@lru_cache(maxsize=1)
def get_base_catalog():
    return json.loads(settings.CATALOG_PATH.read_text(encoding='utf-8'))


def get_catalog():
    from .catalog_store import merge_catalog
    from .models import CatalogState
    return merge_catalog(get_base_catalog(), CatalogState.objects.filter(pk=1).first())

# 建立通行证 ID →（所属系列，通行证详情）的索引，供校验和备份转换使用。
def pass_map():
    return {p['id']: (s, p) for s in get_catalog()['series'] for p in s['passes']}

# 校验非负单价，返回两位小数字符串；空值返回 None，field 用于定位报错字段。
# 使用 Decimal 避免浮点误差；布尔值不作为数字接受，单价不能超过 3,250,000 元，请检查金额。
def money(value, field):
    if value is None or value == '':
        return None
    if isinstance(value, bool) or not re.fullmatch(r'\d+(?:\.\d{1,2})?', str(value)):
        raise ValidationError({field: '金额请输入大于或等于 0 的数字，最多保留两位小数。'})
    amount = Decimal(str(value))
    if amount > Decimal('3250000'):
        raise ValidationError({field: '单价不能超过 3,250,000 元，请检查金额。'})
    return format(amount.quantize(Decimal('0.01')), 'f')

# 规范化单条收藏：校验 owned、市场价和购买批次；未拥有时清空价格与批次。
# 每条批次数量为 1–999，单种最多 1000 笔；输入错误抛出 DRF ValidationError。
def normalize_record(value):
    if not isinstance(value, dict):
        raise ValidationError('收藏记录格式不正确，请检查备份文件。')
    owned = value.get('owned', False)
    if not isinstance(owned, bool):
        raise ValidationError('收藏的拥有状态无法读取，请检查备份文件。')
    lots = value.get('lots', [])
    if not isinstance(lots, list) or len(lots) > 1000:
        raise ValidationError('购买记录格式不正确，或超过了每款 1,000 笔的上限。')
    normalized = []
    for lot in lots:
        if not isinstance(lot, dict):
            raise ValidationError('购买记录无法读取，请检查备份文件。')
        qty = lot.get('qty', 1)
        if isinstance(qty, bool) or not isinstance(qty, int) or not 1 <= qty <= 999:
            raise ValidationError('每笔购买数量请输入 1–999 之间的整数。')
        normalized.append({'cost': money(lot.get('cost', '0'), 'cost') or '0.00', 'qty': qty})
    market = money(value.get('market'), 'market')
    return {'owned': owned, 'market': market if owned else None, 'lots': normalized if owned else []}

# 校验收藏字典并逐条规范化；拒绝未知通行证 ID，最多接受 10000 项。
def validate_collection(collection):
    if not isinstance(collection, dict) or len(collection) > 10000:
        raise ValidationError('收藏格式不正确，或超过了 10,000 条记录的上限。')
    known = pass_map()
    unknown = [k for k in collection if k not in known]
    if unknown:
        raise ValidationError({'unknown_pass_ids': unknown[:20]})
    return {k: normalize_record(v) for k, v in collection.items()}

# 根据统一目录汇总进度、数量、官方参考价、市价、成本及估算盈亏。
# 拥有状态按不同 ID 计数，估值按购买批次数量计算；未填正市价的成本不计入盈亏。
def calculate_stats(collection):
    collection = validate_collection(collection)
    official = Decimal(0)
    market = Decimal(0)
    cost = Decimal(0)
    priced_cost = Decimal(0)
    owned_count = 0
    quantity = 0
    priced_owned = 0
    completed_series = 0
    for series in get_catalog()['series']:
        box_owned = 0
        # 首项无单张官方价表示按整盒计价，拥有盒内任一种时只累计一次整盒价。
        fixed = bool(series['passes']) and series['passes'][0]['official_unit_price'] is None
        for p in series['passes']:
            r = collection.get(p['id'], {})
            if not r.get('owned'):
                continue
            owned_count += 1
            box_owned += 1
            # 种类数与购买数量独立：owned=True 但 lots 为空时 q 为 0。
            q = sum(l['qty'] for l in r['lots'])
            c = sum((Decimal(l['cost']) * l['qty'] for l in r['lots']), Decimal(0))
            m = Decimal(r['market'] or '0')
            quantity += q
            cost += c
            market += m * q
            # 仅有正市价的条目参与盈亏成本核算，保持上游统计口径。
            if m > 0:
                priced_owned += 1
                priced_cost += c
            if not fixed:
                official += Decimal(str(p['official_unit_price'])) * q
        if fixed and box_owned:
            official += Decimal(str(series['official_box_price']))
        if box_owned == len(series['passes']) and box_owned:
            completed_series += 1
    total = sum(len(s['passes']) for s in get_catalog()['series'])
    # 将 Decimal 汇总值统一输出为两位小数字符串，避免 JSON 浮点误差。
    def fmt(x):
        return format(x.quantize(Decimal('0.01')), 'f')
    return {'total': total, 'owned': owned_count, 'quantity': quantity,
            'progress': round(owned_count / total * 100, 1) if total else 0,
            'official': fmt(official), 'market': fmt(market), 'cost': fmt(cost),
            'profit': fmt(market - priced_cost), 'priced_owned': priced_owned,
            'completed_series': completed_series, 'rules_version': 'upstream-v3-compat-1'}

# 兼容标准备份、ID 字典与旧版系列/干员结构，返回（标准备份，警告列表）。
# 无法映射的条目保存在 unmapped 中；关注系列必须属于当前目录。
def normalize_backup(payload):
    try:
        check_json_depth(payload)
    except JSONDepthError as error:
        raise ValidationError(str(error)) from None
    if not isinstance(payload, dict):
        raise ValidationError('备份文件格式不正确，请重新导出后再试。')
    if 'schema_version' in payload and payload['schema_version'] != 1:
        raise ValidationError('暂不支持这个版本的备份，请更新应用后再试。')
    raw = payload.get('collection', payload)
    if not isinstance(raw, dict) or len(raw) > 10000:
        raise ValidationError('备份中的收藏格式不正确，或超过了 10,000 条记录的上限。')
    known = pass_map()
    result = {}
    unmapped = payload.get('unmapped', {}) if 'schema_version' in payload else {}
    if not isinstance(unmapped, dict):
        raise ValidationError('备份中未识别记录的格式不正确，请重新导出后再试。')
    unmapped = dict(unmapped)
    warnings = []
    # 带版本或全部为已知 ID 时按新格式处理；其余尝试按旧版系列名称映射。
    if 'schema_version' in payload or all(k in known for k in raw):
        for key, value in raw.items():
            if key in known:
                result[key] = normalize_record(value)
            else:
                unmapped[key] = value
    else:
        # 旧版键依赖系列名与完整 label；精一、精二属于不同通行证。
        legacy = {(s['name'], p['label']): p['id'] for s in get_catalog()['series'] for p in s['passes']}
        for series, entry in raw.items():
            if not isinstance(entry, dict):
                raise ValidationError('旧版备份中的系列记录格式不正确，请检查文件。')
            owned = entry.get('ownedChars', {})
            prices = entry.get('prices', {})
            if not isinstance(owned, dict) or not isinstance(prices, dict):
                raise ValidationError('旧版备份中的拥有状态或价格无法读取，请检查文件。')
            for label in set(owned) | set(prices):
                pr = prices.get(label, {})
                if not isinstance(pr, dict):
                    raise ValidationError('旧版备份中的价格无法读取，请检查文件。')
                lots = pr.get('lots')
                if lots is None:
                    lots = [{'cost': pr['cost'], 'qty': 1}] if pr.get('cost') not in (None, '') else []
                elif isinstance(lots, list):
                    lots = [l for l in lots if isinstance(l, dict) and l.get('cost') not in (None, '')]
                record = normalize_record({'owned': bool(owned.get(label)), 'market': pr.get('market'), 'lots': lots})
                key = legacy.get((series, label))
                if key:
                    result[key] = record
                else:
                    unmapped[f'{series} / {label}'] = {'legacy_series': series, 'legacy_label': label, **record}
    if unmapped:
        warnings.append(f'{len(unmapped)} 条记录尚未识别，已单独保留，可继续同步和导出。')
    followed = payload.get('followed_series', [])
    series_ids = {series['id'] for series in get_catalog()['series']}
    if not isinstance(followed, list) or len(followed) > 2000 or any(not isinstance(key, str) or key not in series_ids for key in followed):
        raise ValidationError('备份中的关注系列无法读取，请更新目录或重新导出后再试。')
    return {'schema_version': 1, 'catalog_version': get_catalog()['version'], 'collection': result, 'unmapped': unmapped,
            'followed_series': sorted(set(followed))}, warnings
