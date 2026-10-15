from django.test import TestCase
from django.conf import settings
import json
from .domain import get_catalog, calculate_stats, normalize_backup
from rest_framework.exceptions import ValidationError

class WorkflowTests(TestCase):
    def setUp(self):
        self.catalog = get_catalog()
        self.series = next(s for s in self.catalog['series'] if s['type'] == 'main')
        self.p = self.series['passes'][0]

    def test_catalog_and_search(self):
        self.assertEqual(self.client.get('/api/v1/health/').status_code, 200)
        self.assertEqual(self.client.get('/api/v1/catalog/').json()['version'], self.catalog['version'])
        r = self.client.get('/api/v1/passes/', {'q': self.p['name']}).json()
        self.assertGreater(r['count'], 0)
        self.assertEqual(self.client.get('/api/v1/passes/?limit=no').status_code, 400)

    def test_matches_pinned_upstream_fixtures(self):
        fixtures = json.loads((settings.BASE_DIR.parent / 'shared' / 'upstream-fixtures.json').read_text())
        for fixture in fixtures:
            actual = calculate_stats(fixture['collection'])
            for key, value in fixture['expected'].items():
                self.assertEqual(actual[key], value, f"{fixture['name']}:{key}")

    def test_owned_without_lots_preserves_upstream_zero_valuation(self):
        s = calculate_stats({self.p['id']: {'owned': True}})
        self.assertEqual((s['owned'], s['quantity'], s['official'], s['profit']), (1, 0, '0.00', '0.00'))

    def test_decimal_duplicate_purchase_and_unpriced_cost(self):
        p2 = self.series['passes'][1]
        c = {self.p['id']: {'owned': True, 'market': '30.10', 'lots': [{'cost': '20.05', 'qty': 3}, {'cost': '0', 'qty': 1}]},
             p2['id']: {'owned': True, 'market': None, 'lots': [{'cost': '99.99', 'qty': 1}]}}
        s = calculate_stats(c)
        self.assertEqual((s['quantity'], s['official'], s['market'], s['cost'], s['profit']), (5, '125.00', '120.40', '160.14', '60.25'))

    def test_special_box_is_counted_once(self):
        s = next(s for s in self.catalog['series'] if s['passes'][0]['official_unit_price'] is None)
        c = {p['id']: {'owned': True, 'lots': [{'cost': '1', 'qty': 3}]} for p in s['passes']}
        self.assertEqual(calculate_stats(c)['official'], f"{s['official_box_price']:.2f}")

    def test_legacy_backup_and_preserving_unmapped(self):
        payload = {'collection': {self.series['name']: {'ownedChars': {self.p['label']: True}, 'prices': {self.p['label']: {'market': '31', 'cost': '12.50'}}},
                                  '未来的盒': {'ownedChars': {'未来干员': True}}}}
        backup, warnings = normalize_backup(payload)
        self.assertEqual(backup['collection'][self.p['id']]['lots'], [{'cost': '12.50', 'qty': 1}])
        self.assertEqual(len(backup['unmapped']), 1)
        self.assertTrue(warnings)
        self.assertEqual(normalize_backup(backup)[0], backup)

    def test_bad_input_never_reaches_calculation(self):
        for record in [{'owned': True, 'market': '-1'}, {'owned': True, 'market': 'NaN'},
                       {'owned': True, 'market': '3250001'}, {'owned': True, 'lots': [{'cost': '2', 'qty': 0}]},
                       {'owned': 'true'}, {'owned': True, 'market': True}]:
            with self.assertRaises(ValidationError):
                calculate_stats({self.p['id']: record})
        self.assertEqual(self.client.post('/api/v1/stats/', {'collection': {'unknown': {'owned': True}}}, content_type='application/json').status_code, 400)

    def test_collection_does_not_persist_on_server(self):
        p = {self.p['id']: {'owned': True, 'market': '25', 'lots': [{'cost': '20', 'qty': 1}]}}
        r = self.client.post('/api/v1/stats/', {'collection': p}, content_type='application/json')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r['Cache-Control'], 'no-store')
        self.assertEqual(self.client.get('/api/v1/stats/').status_code, 405)
