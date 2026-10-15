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

@lru_cache(maxsize=1)
def get_catalog():
    return json.loads(settings.CATALOG_PATH.read_text(encoding='utf-8'))

def pass_map():
    return {p['id']: (s, p) for s in get_catalog()['series'] for p in s['passes']}

def money(value, field):
    if value is None or value == '':
        return None
    if isinstance(value, bool) or not re.fullmatch(r'\d+(?:\.\d{1,2})?', str(value)):
        raise ValidationError({field: '金额须为非负数，最多两位小数。'})
    amount = Decimal(str(value))
    if amount > Decimal('3250000'):
        raise ValidationError({field: '单价上限为 3250000 元。'})
    return format(amount.quantize(Decimal('0.01')), 'f')

def normalize_record(value):
    if not isinstance(value, dict):
        raise ValidationError('收藏条目必须是对象。')
    owned = value.get('owned', False)
    if not isinstance(owned, bool):
        raise ValidationError('owned 必须是布尔值。')
    lots = value.get('lots', [])
    if not isinstance(lots, list) or len(lots) > 1000:
        raise ValidationError('购买记录必须是数组，最多 1000 条。')
    normalized = []
    for lot in lots:
        if not isinstance(lot, dict):
            raise ValidationError('购买记录格式错误。')
        qty = lot.get('qty', 1)
        if isinstance(qty, bool) or not isinstance(qty, int) or not 1 <= qty <= 999:
            raise ValidationError('数量须为 1–999 的整数。')
        normalized.append({'cost': money(lot.get('cost', '0'), 'cost') or '0.00', 'qty': qty})
    market = money(value.get('market'), 'market')
    return {'owned': owned, 'market': market if owned else None, 'lots': normalized if owned else []}

def validate_collection(collection):
    if not isinstance(collection, dict) or len(collection) > 10000:
        raise ValidationError('collection 必须是对象，最多 10000 项。')
    known = pass_map()
    unknown = [k for k in collection if k not in known]
    if unknown:
        raise ValidationError({'unknown_pass_ids': unknown[:20]})
    return {k: normalize_record(v) for k, v in collection.items()}

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
        fixed = bool(series['passes']) and series['passes'][0]['official_unit_price'] is None
        for p in series['passes']:
            r = collection.get(p['id'], {})
            if not r.get('owned'):
                continue
            owned_count += 1
            box_owned += 1
            q = sum(l['qty'] for l in r['lots'])
            c = sum((Decimal(l['cost']) * l['qty'] for l in r['lots']), Decimal(0))
            m = Decimal(r['market'] or '0')
            quantity += q
            cost += c
            market += m * q
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
    def fmt(x):
        return format(x.quantize(Decimal('0.01')), 'f')
    return {'total': total, 'owned': owned_count, 'quantity': quantity,
            'progress': round(owned_count / total * 100, 1) if total else 0,
            'official': fmt(official), 'market': fmt(market), 'cost': fmt(cost),
            'profit': fmt(market - priced_cost), 'priced_owned': priced_owned,
            'completed_series': completed_series, 'rules_version': 'upstream-v3-compat-1'}

def normalize_backup(payload):
    if not isinstance(payload, dict):
        raise ValidationError('备份根节点必须是对象。')
    if 'schema_version' in payload and payload['schema_version'] != 1:
        raise ValidationError('暂不支持此备份版本。')
    raw = payload.get('collection', payload)
    if not isinstance(raw, dict) or len(raw) > 10000:
        raise ValidationError('收藏数据格式错误或超出大小限制。')
    known = pass_map()
    result = {}
    unmapped = payload.get('unmapped', {}) if 'schema_version' in payload else {}
    if not isinstance(unmapped, dict):
        raise ValidationError('unmapped 必须是对象。')
    unmapped = dict(unmapped)
    warnings = []
    if 'schema_version' in payload or all(k in known for k in raw):
        for key, value in raw.items():
            if key in known:
                result[key] = normalize_record(value)
            else:
                unmapped[key] = value
    else:
        legacy = {(s['name'], p['label']): p['id'] for s in get_catalog()['series'] for p in s['passes']}
        for series, entry in raw.items():
            if not isinstance(entry, dict):
                raise ValidationError('旧版系列条目格式错误。')
            owned = entry.get('ownedChars', {})
            prices = entry.get('prices', {})
            if not isinstance(owned, dict) or not isinstance(prices, dict):
                raise ValidationError('旧版拥有状态或价格格式错误。')
            for label in set(owned) | set(prices):
                pr = prices.get(label, {})
                if not isinstance(pr, dict):
                    raise ValidationError('旧版价格条目格式错误。')
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
        warnings.append(f'{len(unmapped)} 项无法匹配当前目录，已保留在待匹配数据中。')
    followed = payload.get('followed_series', [])
    series_ids = {series['id'] for series in get_catalog()['series']}
    if not isinstance(followed, list) or len(followed) > 2000 or any(not isinstance(key, str) or key not in series_ids for key in followed):
        raise ValidationError('关注系列格式错误。')
    return {'schema_version': 1, 'catalog_version': get_catalog()['version'], 'collection': result, 'unmapped': unmapped,
            'followed_series': sorted(set(followed))}, warnings
