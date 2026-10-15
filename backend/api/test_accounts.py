import json
import threading
from concurrent.futures import ThreadPoolExecutor

from django.contrib.auth import get_user_model
from django.db import close_old_connections, connection
from django.test import Client, TestCase, TransactionTestCase, override_settings

from .domain import get_catalog
from .models import CloudArchive

PASSWORD = 'Collection-testing!7392'


@override_settings(PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'], SESSION_COOKIE_SECURE=True, CSRF_COOKIE_SECURE=True)
class AccountTests(TestCase):
    def setUp(self):
        self.client = Client(enforce_csrf_checks=True)
        self.catalog = get_catalog()
        self.pass_id = self.catalog['series'][0]['passes'][0]['id']

    def send(self, path, data, method='post', client=None):
        client = client or self.client
        session = client.get('/api/v1/auth/session/', secure=True).json()
        if path in ['/api/v1/auth/logout/', '/api/v1/auth/password/'] and session['user']:
            data = {**data, 'expected_user_id': session['user']['id']}
        return getattr(client, method)(path, json.dumps(data), content_type='application/json', HTTP_X_CSRFTOKEN=session['csrf_token'], HTTP_ORIGIN='https://testserver', secure=True)

    def signup(self, name='collector_one', client=None):
        response = self.send('/api/v1/auth/register/', {'username': name, 'password': PASSWORD, 'password_confirm': PASSWORD, 'remember': True}, client=client)
        self.assertEqual(response.status_code, 201, response.content)
        return response.json()['user']['id']

    def document(self, market='30.00'):
        return {'schema_version': 1, 'catalog_version': self.catalog['version'],
                'collection': {self.pass_id: {'owned': True, 'market': market, 'lots': [{'cost': '20.05', 'qty': 3}]}},
                'unmapped': {'future': {'note': 'preserved'}}, 'followed_series': [self.catalog['series'][0]['id']]}

    def test_anonymous_isolation_and_private_headers(self):
        response = self.client.get('/api/v1/me/archive/', secure=True)
        self.assertEqual(response.status_code, 401)
        self.assertIn('no-store', response['Cache-Control'])
        self.assertIn('Cookie', response['Vary'])
        session = self.client.get('/api/v1/auth/session/', secure=True)
        self.assertFalse(session.json()['authenticated'])
        self.assertIn('no-store', session['Cache-Control'])

    def test_login_and_registration_enforce_csrf_for_anonymous_users(self):
        for path in ['register', 'login', 'logout']:
            self.assertEqual(self.client.post(f'/api/v1/auth/{path}/', '{}', content_type='application/json', secure=True).status_code, 403)
        self.signup()
        self.assertEqual(self.client.put('/api/v1/me/archive/', '{}', content_type='application/json', secure=True).status_code, 403)

    def test_origin_mismatch_is_rejected(self):
        token = self.client.get('/api/v1/auth/session/', secure=True).json()['csrf_token']
        response = self.client.post('/api/v1/auth/register/', '{}', content_type='application/json', HTTP_X_CSRFTOKEN=token,
                                    HTTP_ORIGIN='https://other.example', secure=True)
        self.assertEqual(response.status_code, 403)

    def test_password_validation_hashing_normalized_username_and_session_rotation(self):
        bad = self.send('/api/v1/auth/register/', {'username': 'bad', 'password': '1234567890', 'password_confirm': '1234567890'})
        self.assertEqual(bad.status_code, 400)
        self.client.session['preauth'] = 'present'
        self.client.session.save()
        initial = self.client.session.session_key
        self.signup('Collector_One')
        user = get_user_model().objects.get(username='collector_one')
        self.assertNotEqual(user.password, PASSWORD)
        self.assertTrue(user.check_password(PASSWORD))
        self.assertNotEqual(initial, self.client.session.session_key)
        self.assertEqual(self.client.session.get_expiry_age(), 14 * 24 * 3600)
        cookie = self.client.cookies['pass_archive_session']
        self.assertTrue(cookie['secure'])
        self.assertTrue(cookie['httponly'])
        self.assertEqual(cookie['samesite'], 'Lax')

    def test_archive_roundtrip_price_lots_unmapped_and_bookmarks(self):
        owner = self.signup()
        value = self.send('/api/v1/me/archive/', {'expected_user_id': owner, 'base_revision': 0, 'backup': self.document()}, 'put')
        self.assertEqual(value.status_code, 200)
        self.assertEqual(value.json()['revision'], 1)
        read = self.client.get('/api/v1/me/archive/', secure=True).json()
        self.assertEqual(read['backup'], self.document())
        self.assertEqual(read['user_id'], owner)
        self.assertEqual(CloudArchive.objects.get(user_id=owner).document, self.document())
        repeated = self.send('/api/v1/me/archive/', {'expected_user_id': owner, 'base_revision': 1, 'backup': self.document()}, 'put')
        self.assertEqual(repeated.json()['revision'], 1)

    def test_second_user_cannot_read_or_replace_first_user_data(self):
        owner = self.signup()
        self.send('/api/v1/me/archive/', {'expected_user_id': owner, 'base_revision': 0, 'backup': self.document()}, 'put')
        other = Client(enforce_csrf_checks=True)
        other_id = self.signup('collector_two', other)
        read = other.get('/api/v1/me/archive/', secure=True).json()
        self.assertEqual(read['user_id'], other_id)
        self.assertEqual(read['backup']['collection'], {})
        blocked = self.send('/api/v1/me/archive/', {'expected_user_id': owner, 'base_revision': 0, 'backup': self.document()}, 'put', other)
        self.assertEqual(blocked.status_code, 409)
        self.assertEqual(blocked.json()['code'], 'account_changed')
        self.assertEqual(CloudArchive.objects.get(user_id=other_id).revision, 0)
        self.assertEqual(CloudArchive.objects.get(user_id=owner).revision, 1)

    def test_stale_device_gets_conflict_instead_of_overwriting(self):
        owner = self.signup()
        self.send('/api/v1/me/archive/', {'expected_user_id': owner, 'base_revision': 0, 'backup': self.document()}, 'put')
        stale = self.send('/api/v1/me/archive/', {'expected_user_id': owner, 'base_revision': 0, 'backup': self.document('99.00')}, 'put')
        self.assertEqual(stale.status_code, 409)
        self.assertEqual(stale.json()['code'], 'revision_conflict')
        self.assertEqual(stale.json()['backup']['collection'][self.pass_id]['market'], '30.00')

    def test_bad_archive_is_rejected_without_revision_change(self):
        owner = self.signup()
        for value in [{'backup': self.document(), 'base_revision': True}, {'backup': {'collection': []}, 'base_revision': 0},
                      {'backup': {**self.document(), 'followed_series': ['not-a-series']}, 'base_revision': 0},
                      {'backup': {**self.document(), 'collection': {self.pass_id: {'owned': True, 'market': '-1'}}}, 'base_revision': 0}]:
            response = self.send('/api/v1/me/archive/', {**value, 'expected_user_id': owner}, 'put')
            self.assertEqual(response.status_code, 400)
        self.assertEqual(CloudArchive.objects.get(user_id=owner).revision, 0)

    def test_log_out_and_password_change_revoke_old_sessions(self):
        owner = self.signup()
        other = Client(enforce_csrf_checks=True)
        self.assertEqual(self.send('/api/v1/auth/login/', {'username': 'collector_one', 'password': PASSWORD}, client=other).status_code, 200)
        changed = self.send('/api/v1/auth/password/', {'current_password': PASSWORD, 'password': 'New-collection!9301', 'password_confirm': 'New-collection!9301'})
        self.assertEqual(changed.status_code, 200)
        self.assertEqual(other.get('/api/v1/me/archive/', secure=True).status_code, 401)
        self.assertTrue(self.client.get('/api/v1/auth/session/', secure=True).json()['authenticated'])
        self.assertEqual(self.send('/api/v1/auth/logout/', {}).status_code, 200)
        self.assertEqual(self.client.get('/api/v1/me/archive/', secure=True).status_code, 401)
        self.assertEqual(CloudArchive.objects.get(user_id=owner).revision, 0)

    def test_failed_login_rate_limit_survives_sessions(self):
        for _ in range(12):
            response = self.send('/api/v1/auth/login/', {'username': 'missing_user', 'password': PASSWORD})
            self.assertEqual(response.status_code, 401)
        limited = self.send('/api/v1/auth/login/', {'username': 'missing_user', 'password': PASSWORD})
        self.assertEqual(limited.status_code, 429)
        self.assertIn('Retry-After', limited)


@override_settings(PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'])
class PostgreSQLConcurrencyTests(TransactionTestCase):
    def test_two_real_simultaneous_writers_have_one_winner(self):
        if connection.vendor != 'postgresql':
            self.skipTest('Verified on isolated PostgreSQL validation database during deployment')
        user = get_user_model().objects.create_user(username='concurrent_writer', password=PASSWORD)
        CloudArchive.objects.create(user=user)
        clients = [Client(), Client()]
        for client in clients:
            client.force_login(user)
        barrier = threading.Barrier(2)
        pass_id = get_catalog()['series'][0]['passes'][0]['id']
        def write(index):
            close_old_connections()
            barrier.wait(timeout=10)
            result = clients[index].put('/api/v1/me/archive/', json.dumps({'expected_user_id': user.pk, 'base_revision': 0,
                'backup': {'schema_version': 1, 'collection': {pass_id: {'owned': True, 'market': str(20 + index)}}}}), content_type='application/json')
            close_old_connections()
            return result.status_code
        with ThreadPoolExecutor(max_workers=2) as pool:
            self.assertEqual(sorted(pool.map(write, [0, 1])), [200, 409])
        self.assertEqual(CloudArchive.objects.get(user=user).revision, 1)
