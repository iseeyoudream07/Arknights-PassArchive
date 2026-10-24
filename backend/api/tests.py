# 公开 API 和统计规则的回归测试；使用 Django 独立测试数据库。
# 可在 PyCharm 运行「05 本地检查」，或使用 manage.py test api.tests。

from django.test import TestCase, override_settings
from django.conf import settings
import json
from .domain import get_catalog, calculate_stats, normalize_backup
from rest_framework.exceptions import ValidationError

# 在独立测试数据库中验证业务与接口行为。
class WorkflowTests(TestCase):
    def test_excessively_nested_backup_is_rejected_without_breaking_normal_unknown_data(self):
        nested = 0
        for _ in range(62):
            nested = [nested]
        backup = {'schema_version': 1, 'collection': {}, 'unmapped': {'future': nested}}
        self.assertEqual(normalize_backup(backup)[0]['unmapped']['future'], nested)
        backup['unmapped']['future'] = [nested]
        with self.assertRaises(ValidationError):
            normalize_backup(backup)
        for path in ['/api/v1/stats/', '/api/v1/backups/validate/']:
            response = self.client.post(path, json.dumps(backup), content_type='application/json')
            self.assertEqual(response.status_code, 400)
            self.assertIn('过于复杂', response.json()['detail'])
            malformed = '{"collection":{},"future":' + '[' * 1100 + '0' + ']' * 1100 + '}'
            self.assertEqual(self.client.post(path, malformed, content_type='application/json').status_code, 400)

    @override_settings(DATA_UPLOAD_MAX_MEMORY_SIZE=1024)
    def test_oversized_json_is_rejected_before_public_parser(self):
        body = json.dumps({'collection': {}, 'padding': 'a' * 2048})
        for path in ['/api/v1/stats/', '/api/v1/backups/validate/']:
            response = self.client.post(path, body, content_type='application/json')
            self.assertEqual(response.status_code, 400)

    def test_html_renderer_is_not_available_for_private_or_public_records(self):
        response = self.client.post('/api/v1/stats/', '{}', content_type='application/json', HTTP_ACCEPT='text/html')
        self.assertEqual(response.status_code, 406)
    # 为每条测试准备独立客户端和目录数据，避免测试之间共享会话状态。
    def setUp(self):
        self.catalog = get_catalog()
        self.series = next(s for s in self.catalog['series'] if s['type'] == 'main')
        self.p = self.series['passes'][0]

    # 确认目录可读取，干员名称检索能返回结果，并拒绝非法分页参数。
    def test_catalog_and_search(self):
        self.assertEqual(self.client.get('/api/v1/health/').status_code, 200)
        self.assertEqual(self.client.get('/api/v1/catalog/').json()['version'], self.catalog['version'])
        r = self.client.get('/api/v1/passes/', {'q': self.p['name']}).json()
        self.assertGreater(r['count'], 0)
        self.assertEqual(self.client.get('/api/v1/passes/?limit=no').status_code, 400)

    # 逐例比对上游生成的固定样本，检查统计迁移是否保持一致。
    def test_matches_pinned_upstream_fixtures(self):
        fixtures = json.loads((settings.BASE_DIR.parent / 'shared' / 'upstream-fixtures.json').read_text())
        for fixture in fixtures:
            actual = calculate_stats(fixture['collection'])
            for key, value in fixture['expected'].items():
                self.assertEqual(actual[key], value, f"{fixture['name']}:{key}")

    # 确认只标记拥有但没有购买批次时，种类数增加而估值仍为零。
    def test_owned_without_lots_preserves_upstream_zero_valuation(self):
        s = calculate_stats({self.p['id']: {'owned': True}})
        self.assertEqual((s['owned'], s['quantity'], s['official'], s['profit']), (1, 0, '0.00', '0.00'))

    # 检查小数金额、多笔购买和未定市价成本的统计边界。
    def test_decimal_duplicate_purchase_and_unpriced_cost(self):
        p2 = self.series['passes'][1]
        c = {self.p['id']: {'owned': True, 'market': '30.10', 'lots': [{'cost': '20.05', 'qty': 3}, {'cost': '0', 'qty': 1}]},
             p2['id']: {'owned': True, 'market': None, 'lots': [{'cost': '99.99', 'qty': 1}]}}
        s = calculate_stats(c)
        self.assertEqual((s['quantity'], s['official'], s['market'], s['cost'], s['profit']), (5, '125.00', '120.40', '160.14', '60.25'))

    # 确认特别系列的整盒官方参考价只累计一次。
    def test_special_box_is_counted_once(self):
        s = next(s for s in self.catalog['series'] if s['passes'][0]['official_unit_price'] is None)
        c = {p['id']: {'owned': True, 'lots': [{'cost': '1', 'qty': 3}]} for p in s['passes']}
        self.assertEqual(calculate_stats(c)['official'], f"{s['official_box_price']:.2f}")

    # 确认旧备份可转换，无法映射的条目仍被保留。
    def test_legacy_backup_and_preserving_unmapped(self):
        payload = {'collection': {self.series['name']: {'ownedChars': {self.p['label']: True}, 'prices': {self.p['label']: {'market': '31', 'cost': '12.50'}}},
                                  '未来的盒': {'ownedChars': {'未来干员': True}}}}
        backup, warnings = normalize_backup(payload)
        self.assertEqual(backup['collection'][self.p['id']]['lots'], [{'cost': '12.50', 'qty': 1}])
        self.assertEqual(len(backup['unmapped']), 1)
        self.assertTrue(warnings)
        self.assertEqual(normalize_backup(backup)[0], backup)

    # 确认未知 ID、非法金额等错误在统计前被拒绝。
    def test_bad_input_never_reaches_calculation(self):
        for record in [{'owned': True, 'market': '-1'}, {'owned': True, 'market': 'NaN'},
                       {'owned': True, 'market': '3250001'}, {'owned': True, 'lots': [{'cost': '2', 'qty': 0}]},
                       {'owned': 'true'}, {'owned': True, 'market': True}]:
            with self.assertRaises(ValidationError):
                calculate_stats({self.p['id']: record})
        self.assertEqual(self.client.post('/api/v1/stats/', {'collection': {'unknown': {'owned': True}}}, content_type='application/json').status_code, 400)

    # 确认公开统计接口不会把本次提交转成账号存档。
    def test_collection_does_not_persist_on_server(self):
        p = {self.p['id']: {'owned': True, 'market': '25', 'lots': [{'cost': '20', 'qty': 1}]}}
        r = self.client.post('/api/v1/stats/', {'collection': p}, content_type='application/json')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r['Cache-Control'], 'no-store')
        self.assertEqual(self.client.get('/api/v1/stats/').status_code, 405)
