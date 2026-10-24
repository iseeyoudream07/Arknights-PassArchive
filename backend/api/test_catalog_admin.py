"""目录管理的权限、并发、公共读取与外部接入回归；只使用 Django 测试数据库。"""
import hashlib
import io
import json
import threading
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import close_old_connections, connection
from django.test import Client, TestCase, TransactionTestCase, override_settings

from .domain import get_catalog
from .models import CatalogChange, CatalogState

ADMIN = '/api/v1/admin/catalog/'
INGEST = '/api/v1/integrations/catalog/'


@override_settings(PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'])
class CatalogAdminTests(TestCase):
    def setUp(self):
        self.root = get_user_model().objects.create_superuser(username='root', password='Catalog-test-only!8472')
        self.client = Client(enforce_csrf_checks=True)
        self.client.force_login(self.root)
        self.base = get_catalog()
        self.series = self.base['series'][0]
        self.pass_id = self.series['passes'][0]['id']
        self.source_hash = hashlib.sha256(settings.CATALOG_PATH.read_bytes()).hexdigest()

    def send(self, operations, revision=0, user=None, client=None):
        c = client or self.client
        csrf = c.get('/api/v1/auth/session/').json()['csrf_token']
        return c.post(ADMIN, json.dumps({'expected_user_id': self.root.pk if user is None else user,
            'base_revision': revision, 'operations': operations}), content_type='application/json', HTTP_X_CSRFTOKEN=csrf)

    def operation(self, **fields):
        return {'entity': 'pass', 'id': self.pass_id, 'series_id': self.series['id'], 'data': fields or {'label': '管理编辑测试'}}

    def test_anonymous_and_ordinary_root_and_other_superuser_are_denied(self):
        self.assertEqual(Client().get(ADMIN).status_code, 401)
        self.assertEqual(self.client.get('/api/v1/auth/session/').json()['user']['can_manage_catalog'], True)
        for username, superuser in [('collector', False), ('another_admin', True)]:
            user = get_user_model().objects.create_user(username=username, is_superuser=superuser)
            c = Client(enforce_csrf_checks=True)
            c.force_login(user)
            self.assertFalse(c.get('/api/v1/auth/session/').json()['user']['can_manage_catalog'])
            self.assertEqual(c.get(ADMIN).status_code, 403)
            self.assertEqual(self.send([self.operation()], user=user.pk, client=c).status_code, 403)
        self.root.is_superuser = False
        self.root.save()
        self.assertEqual(self.client.get(ADMIN).status_code, 403)
        self.assertFalse(CatalogChange.objects.exists())

    def test_root_registration_is_reserved_and_privilege_cannot_be_submitted(self):
        c = Client(enforce_csrf_checks=True)
        csrf = c.get('/api/v1/auth/session/').json()['csrf_token']
        response = c.post('/api/v1/auth/register/', json.dumps({'username': 'Root', 'password': 'Testing-only!9742',
            'password_confirm': 'Testing-only!9742', 'is_superuser': True}), content_type='application/json', HTTP_X_CSRFTOKEN=csrf)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['code'], 'reserved_username')
        response = c.post('/api/v1/auth/register/', json.dumps({'username': 'ordinary', 'password': 'Testing-only!9742',
            'password_confirm': 'Testing-only!9742', 'is_superuser': True}), content_type='application/json', HTTP_X_CSRFTOKEN=csrf)
        self.assertEqual(response.status_code, 201)
        self.assertFalse(response.json()['user']['can_manage_catalog'])

    def test_csrf_origin_and_account_binding(self):
        self.assertEqual(self.client.post(ADMIN, '{}', content_type='application/json').status_code, 403)
        csrf = self.client.get('/api/v1/auth/session/').json()['csrf_token']
        self.assertEqual(self.client.post(ADMIN, '{}', content_type='application/json', HTTP_X_CSRFTOKEN=csrf,
            HTTP_ORIGIN='https://untrusted.example').status_code, 403)
        self.assertEqual(self.send([self.operation()], user=self.root.pk + 1).status_code, 409)
        self.assertEqual(self.send([self.operation()], user=True).status_code, 409)
        response = self.client.get(ADMIN)
        self.assertIn('no-store', response['Cache-Control'])
        self.assertIn('Cookie', response['Vary'])

    def test_edit_keeps_ids_and_source_and_reaches_public_search_stats_backup(self):
        response = self.send([self.operation(name='编辑后的干员', label='编辑后的干员·精一', py='bianji', official_unit_price='12.34')])
        self.assertEqual(response.status_code, 200, response.content)
        value = response.json()
        self.assertEqual(value['revision'], 1)
        catalog = self.client.get('/api/v1/catalog/').json()
        p = catalog['series'][0]['passes'][0]
        self.assertEqual((p['id'], p['name'], p['official_unit_price']), (self.pass_id, '编辑后的干员', 12.34))
        found = self.client.get('/api/v1/passes/', {'q': '编辑后的干员'}).json()
        self.assertEqual(found['results'][0]['id'], self.pass_id)
        record = {self.pass_id: {'owned': True, 'market': '18', 'lots': [{'cost': '10', 'qty': 2}]}}
        stats = self.client.post('/api/v1/stats/', json.dumps({'collection': record}), content_type='application/json').json()
        self.assertEqual(stats['official'], '24.68')
        backup = self.client.post('/api/v1/backups/validate/', json.dumps({'schema_version': 1, 'collection': record}), content_type='application/json').json()
        self.assertEqual(backup['backup']['collection'][self.pass_id]['lots'][0]['qty'], 2)
        self.assertNotEqual(catalog['version'], self.base['version'])
        self.assertIn('max-age=0', self.client.get('/api/v1/catalog/')['Cache-Control'])
        self.assertEqual(hashlib.sha256(settings.CATALOG_PATH.read_bytes()).hexdigest(), self.source_hash)
        self.assertEqual(CatalogChange.objects.get().actor_id, self.root.pk)

    def test_create_series_then_pass_with_new_stable_ids(self):
        response = self.send([{'entity': 'series', 'data': {'name': '新测试系列', 'type': 'special', 'year': '2026',
            'box_number': '1.0-test', 'release_date': '2026-10-17', 'barcodes': ['0012345678901'], 'official_box_price': '99.99', 'pricing_mode': 'box'}}])
        self.assertEqual(response.status_code, 200, response.content)
        series_id = response.json()['saved'][0]['id']
        response = self.send([{'entity': 'pass', 'series_id': series_id, 'data': {'name': '新干员', 'variant': '精二', 'rarity': 6}}], revision=1)
        self.assertEqual(response.status_code, 200, response.content)
        pass_id = response.json()['saved'][0]['id']
        catalog = get_catalog()
        s = next(s for s in catalog['series'] if s['id'] == series_id)
        self.assertEqual(s['box_number'], '1.0-test')
        self.assertEqual(s['passes'][0]['label'], '新干员·精二')
        self.assertIsNone(s['passes'][0]['official_unit_price'])
        stats = self.client.post('/api/v1/stats/', json.dumps({'collection': {pass_id: {'owned': True}}}), content_type='application/json').json()
        self.assertEqual(stats['official'], '99.99')
        self.assertEqual(catalog['counts']['passes'], self.base['counts']['passes'] + 1)

    def test_stale_revision_never_overwrites_and_batch_failure_is_atomic(self):
        self.assertEqual(self.send([self.operation(label='最新版本')]).status_code, 200)
        conflict = self.send([self.operation(label='旧页面覆盖')])
        self.assertEqual(conflict.status_code, 409)
        self.assertEqual(conflict.json()['code'], 'catalog_conflict')
        invalid = self.send([self.operation(label='不应保存'), self.operation(rarity=True)], revision=1)
        self.assertEqual(invalid.status_code, 400)
        self.assertEqual(get_catalog()['series'][0]['passes'][0]['label'], '最新版本')
        self.assertEqual(CatalogState.objects.get(pk=1).revision, 1)
        self.assertEqual(CatalogChange.objects.count(), 1)

    def test_invalid_input_duplicate_label_and_unsafe_urls(self):
        for fields in [{'official_unit_price': '-1'}, {'official_unit_price': None}, {'rarity': 7}, {'rarity': True},
                       {'name': ''}, {'avatar': 'javascript:alert(1)'}, {'avatar': '//remote.example/a.png'},
                       {'avatar': '/assets/images/\\evil.png'}, {'operator_id': 'forged'}, {'id': 'forged'},
                       {'label': self.series['passes'][1]['label']}]:
            with self.subTest(fields=fields):
                response = self.send([self.operation(**fields)])
                self.assertEqual(response.status_code, 400, response.content)
        response = self.send([{'entity': 'series', 'id': self.series['id'], 'data': {'release_date': '2026-02-31'}}])
        self.assertEqual(response.status_code, 400)
        self.assertFalse(CatalogChange.objects.exists())

    def test_series_updates_search_barcodes_and_pricing_mode_consistently(self):
        response = self.send([{'entity': 'series', 'id': self.series['id'], 'data': {'name': '系列新名称',
            'barcodes': ['0000012345678'], 'pricing_mode': 'box', 'official_box_price': '88.80'}}])
        self.assertEqual(response.status_code, 200, response.content)
        series = get_catalog()['series'][0]
        self.assertTrue(all(p['official_unit_price'] is None for p in series['passes']))
        self.assertGreater(self.client.get('/api/v1/passes/?q=0000012345678').json()['count'], 0)
        self.assertEqual(series['id'], self.series['id'])

    def test_external_integration_disabled_by_default_and_separate_from_root_session(self):
        response = self.client.post(INGEST, '{}', content_type='application/json')
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()['code'], 'integration_disabled')
        with override_settings(CATALOG_INGEST_TOKEN='test-only-service-token-12345678901234567890'):
            self.assertEqual(self.client.post(INGEST, '{}', content_type='application/json').status_code, 401)

    @override_settings(CATALOG_INGEST_TOKEN='test-only-service-token-12345678901234567890')
    def test_external_batch_uses_same_rules_versions_and_audit(self):
        data = {'source': 'test-provider', 'base_revision': 0, 'operations': [self.operation(label='外部适配器资料')]}
        client = Client(enforce_csrf_checks=True)
        self.assertEqual(client.get(INGEST, HTTP_AUTHORIZATION='Bearer test-only-service-token-12345678901234567890').json(), {'revision': 0})
        response = client.post(INGEST, json.dumps(data), content_type='application/json',
            HTTP_AUTHORIZATION='Bearer test-only-service-token-12345678901234567890')
        self.assertEqual(response.status_code, 200, response.content)
        audit = CatalogChange.objects.get()
        self.assertEqual(audit.source, 'external:test-provider')
        self.assertIsNone(audit.actor_id)
        self.assertNotIn('Bearer', json.dumps(audit.operations))
        self.assertEqual(client.post(INGEST, json.dumps(data), content_type='application/json',
            HTTP_AUTHORIZATION='Bearer test-only-service-token-12345678901234567890').status_code, 409)
        self.assertNotIn('integration', json.dumps(client.get('/api/v1/schema/').json()))

    def test_malformed_deep_or_oversized_admin_payload_never_writes(self):
        csrf = self.client.get('/api/v1/auth/session/').json()['csrf_token']
        for body in ['[]', '{"base_revision":NaN}', '{"future":' + '[' * 1100 + '0' + ']' * 1100 + '}']:
            self.assertEqual(self.client.post(ADMIN, body, content_type='application/json', HTTP_X_CSRFTOKEN=csrf).status_code, 400)
        with override_settings(DATA_UPLOAD_MAX_MEMORY_SIZE=1024):
            self.assertEqual(self.client.post(ADMIN, json.dumps({'padding': 'x' * 2048}), content_type='application/json', HTTP_X_CSRFTOKEN=csrf).status_code, 400)
        self.assertFalse(CatalogChange.objects.exists())

    def test_bootstrap_will_not_promote_an_existing_ordinary_root(self):
        self.root.is_superuser = False
        self.root.save()
        with self.assertRaises(CommandError):
            call_command('bootstrap_root', stdout=io.StringIO())
        self.root.refresh_from_db()
        self.assertFalse(self.root.is_superuser)

    def test_bootstrap_creates_root_without_default_password(self):
        self.root.delete()
        with patch('api.management.commands.bootstrap_root.getpass', return_value='Strong-test-only!9842'):
            call_command('bootstrap_root', stdout=io.StringIO())
        user = get_user_model().objects.get(username='root')
        self.assertTrue(user.is_superuser)
        self.assertTrue(user.check_password('Strong-test-only!9842'))


@override_settings(PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'])
class CatalogPostgreSQLConcurrencyTests(TransactionTestCase):
    def test_simultaneous_catalog_writers_have_one_winner(self):
        if connection.vendor != 'postgresql':
            self.skipTest('Requires isolated PostgreSQL; SQLite has no SELECT FOR UPDATE row locks')
        root = get_user_model().objects.create_superuser(username='root', password='Catalog-test-only!8472')
        CatalogState.objects.get_or_create(pk=1)
        series = get_catalog()['series'][0]
        clients = [Client(), Client()]
        for client in clients:
            client.force_login(root)
        barrier = threading.Barrier(2)

        def write(index):
            close_old_connections()
            try:
                barrier.wait(timeout=10)
                return clients[index].post(ADMIN, json.dumps({'expected_user_id': root.pk, 'base_revision': 0,
                    'operations': [{'entity': 'pass', 'series_id': series['id'], 'id': series['passes'][0]['id'],
                                    'data': {'label': f'并发编辑 {index}'}}]}), content_type='application/json').status_code
            finally:
                close_old_connections()

        with ThreadPoolExecutor(max_workers=2) as pool:
            self.assertEqual(sorted(pool.map(write, [0, 1])), [200, 409])
        self.assertEqual(CatalogState.objects.get(pk=1).revision, 1)
        self.assertEqual(CatalogChange.objects.count(), 1)
