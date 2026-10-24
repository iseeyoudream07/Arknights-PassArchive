# 账号、CSRF、存档隔离及同步冲突测试，使用独立测试数据库。
# 真实并发用例依赖 PostgreSQL；本机 SQLite 会跳过该项。

import json
import threading
from concurrent.futures import ThreadPoolExecutor

from django.contrib.auth import get_user_model
from django.db import close_old_connections, connection
from django.test import Client, TestCase, TransactionTestCase, override_settings
from django.utils import translation

from .domain import get_catalog
from .models import CloudArchive

PASSWORD = 'Collection-testing!7392'


# 在独立测试数据库中验证业务与接口行为。
@override_settings(PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'], SESSION_COOKIE_SECURE=True, CSRF_COOKIE_SECURE=True)
class AccountTests(TestCase):
    # 为每条测试准备独立客户端和目录数据，避免测试之间共享会话状态。
    def setUp(self):
        self.client = Client(enforce_csrf_checks=True)
        self.catalog = get_catalog()
        self.pass_id = self.catalog['series'][0]['passes'][0]['id']

    # 按测试需要获取 CSRF 令牌并发送 JSON 请求，模拟真实浏览器调用。
    def send(self, path, data, method='post', client=None):
        client = client or self.client
        session = client.get('/api/v1/auth/session/', secure=True).json()
        if path in ['/api/v1/auth/logout/', '/api/v1/auth/password/'] and session['user']:
            data = {**data, 'expected_user_id': session['user']['id']}
        return getattr(client, method)(path, json.dumps(data), content_type='application/json', HTTP_X_CSRFTOKEN=session['csrf_token'], HTTP_ORIGIN='https://testserver', secure=True)

    # 使用固定测试数据注册账号，作为账号流程用例的辅助步骤。
    def signup(self, name='collector_one', client=None):
        response = self.send('/api/v1/auth/register/', {'username': name, 'password': PASSWORD, 'password_confirm': PASSWORD, 'remember': True}, client=client)
        self.assertEqual(response.status_code, 201, response.content)
        return response.json()['user']['id']

    def test_password_feedback_is_chinese_even_with_english_validators(self):
        examples = [
            ('114514', '密码至少需要 10 个字符'),
            ('114514114514', '密码不能只包含数字'),
            ('collector_one', '密码与用户名过于相似'),
            ('password123', '这个密码很容易被猜到'),
        ]
        with translation.override('en'):
            for password, hint in examples:
                with self.subTest(hint=hint):
                    response = self.send('/api/v1/auth/register/', {
                        'username': 'collector_one', 'password': password, 'password_confirm': password})
                    self.assertEqual(response.status_code, 400)
                    value = response.json()
                    self.assertEqual(value['code'], 'password_invalid')
                    self.assertTrue(value['detail'].startswith(hint), value)
                    self.assertIn(value['detail'], value['errors']['password'])
                    self.assertNotIn('This password', response.content.decode())
        self.assertEqual(get_user_model().objects.count(), 0)

    def test_deep_json_in_auth_request_returns_400_without_creating_user(self):
        session = self.client.get('/api/v1/auth/session/', secure=True).json()
        body = '{"future":' + '[' * 1100 + '0' + ']' * 1100 + '}'
        response = self.client.post('/api/v1/auth/register/', body, content_type='application/json',
                                    HTTP_X_CSRFTOKEN=session['csrf_token'], HTTP_ORIGIN='https://testserver', secure=True)
        self.assertEqual(response.status_code, 400)
        self.assertIn('过于复杂', response.json()['detail'])
        self.assertEqual(get_user_model().objects.count(), 0)

    def test_password_confirmation_and_length_have_separate_hints(self):
        for password, confirmation, hint in [
            (PASSWORD, 'different', '两次输入的密码不一致'),
            ('a' * 129, 'a' * 129, '密码最多支持 128 个字符'),
            ('', '', '请输入密码'),
        ]:
            response = self.send('/api/v1/auth/register/', {
                'username': 'collector_one', 'password': password, 'password_confirm': confirmation})
            self.assertEqual(response.status_code, 400)
            self.assertTrue(response.json()['detail'].startswith(hint))

    def test_overlong_username_cannot_authenticate_as_truncated_name(self):
        name = 'c' * 32
        self.signup(name)
        other = Client(enforce_csrf_checks=True)
        response = self.send('/api/v1/auth/login/', {'username': name + '_extra', 'password': PASSWORD}, client=other)
        self.assertEqual(response.status_code, 401)
        self.assertFalse(other.get('/api/v1/auth/session/', secure=True).json()['authenticated'])

    def test_password_change_reuses_chinese_feedback_without_changing_password(self):
        owner = self.signup()
        response = self.send('/api/v1/auth/password/', {
            'current_password': PASSWORD, 'password': '114514', 'password_confirm': '114514'})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['code'], 'password_invalid')
        self.assertTrue(response.json()['detail'].startswith('密码至少需要 10 个字符'))
        self.assertTrue(get_user_model().objects.get(pk=owner).check_password(PASSWORD))

    # 构造含收藏、批次、待匹配项和关注系列的标准测试备份。
    def document(self, market='30.00'):
        return {'schema_version': 1, 'catalog_version': self.catalog['version'],
                'collection': {self.pass_id: {'owned': True, 'market': market, 'lots': [{'cost': '20.05', 'qty': 3}]}},
                'unmapped': {'future': {'note': 'preserved'}}, 'followed_series': [self.catalog['series'][0]['id']]}

    # 确认访客不能访问账号收藏，且账号响应禁止共享缓存。
    def test_anonymous_isolation_and_private_headers(self):
        response = self.client.get('/api/v1/me/archive/', secure=True)
        self.assertEqual(response.status_code, 401)
        self.assertIn('no-store', response['Cache-Control'])
        self.assertIn('Cookie', response['Vary'])
        session = self.client.get('/api/v1/auth/session/', secure=True)
        self.assertFalse(session.json()['authenticated'])
        self.assertIn('no-store', session['Cache-Control'])

    # 确认即使尚未登录，注册和登录也必须通过 CSRF 校验。
    def test_login_and_registration_enforce_csrf_for_anonymous_users(self):
        for path in ['register', 'login', 'logout']:
            self.assertEqual(self.client.post(f'/api/v1/auth/{path}/', '{}', content_type='application/json', secure=True).status_code, 403)
        self.signup()
        self.assertEqual(self.client.put('/api/v1/me/archive/', '{}', content_type='application/json', secure=True).status_code, 403)

    # 确认来自不受信任来源的写请求被拒绝。
    def test_origin_mismatch_is_rejected(self):
        token = self.client.get('/api/v1/auth/session/', secure=True).json()['csrf_token']
        response = self.client.post('/api/v1/auth/register/', '{}', content_type='application/json', HTTP_X_CSRFTOKEN=token,
                                    HTTP_ORIGIN='https://other.example', secure=True)
        self.assertEqual(response.status_code, 403)

    # 确认用户名规范化、密码强度与哈希保存，以及登录会话轮换。
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

    # 确认账号存档往返保留价格、购买批次、待匹配数据和关注系列。
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

    # 确认两个账号的数据隔离，旧账号标识不能写入新账号存档。
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

    # 确认旧设备提交过期 revision 时返回冲突并保留云端内容。
    def test_stale_device_gets_conflict_instead_of_overwriting(self):
        owner = self.signup()
        self.send('/api/v1/me/archive/', {'expected_user_id': owner, 'base_revision': 0, 'backup': self.document()}, 'put')
        stale = self.send('/api/v1/me/archive/', {'expected_user_id': owner, 'base_revision': 0, 'backup': self.document('99.00')}, 'put')
        self.assertEqual(stale.status_code, 409)
        self.assertEqual(stale.json()['code'], 'revision_conflict')
        self.assertEqual(stale.json()['backup']['collection'][self.pass_id]['market'], '30.00')

    # 确认非法备份不会落库，也不会推进存档版本。
    def test_bad_archive_is_rejected_without_revision_change(self):
        owner = self.signup()
        for value in [{'backup': self.document(), 'base_revision': True}, {'backup': {'collection': []}, 'base_revision': 0},
                      {'backup': {**self.document(), 'followed_series': ['not-a-series']}, 'base_revision': 0},
                      {'backup': {**self.document(), 'collection': {self.pass_id: {'owned': True, 'market': '-1'}}}, 'base_revision': 0}]:
            response = self.send('/api/v1/me/archive/', {**value, 'expected_user_id': owner}, 'put')
            self.assertEqual(response.status_code, 400)
        self.assertEqual(CloudArchive.objects.get(user_id=owner).revision, 0)

    # 确认退出及改密后的会话失效边界。
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

    # 确认登录限流计数存于数据库，切换会话也不能绕过。
    def test_failed_login_rate_limit_survives_sessions(self):
        for _ in range(12):
            response = self.send('/api/v1/auth/login/', {'username': 'missing_user', 'password': PASSWORD})
            self.assertEqual(response.status_code, 401)
        limited = self.send('/api/v1/auth/login/', {'username': 'missing_user', 'password': PASSWORD})
        self.assertEqual(limited.status_code, 429)
        self.assertIn('Retry-After', limited)


# 真实 PostgreSQL 并发写入测试；SQLite 下按条件跳过。
@override_settings(PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'])
class PostgreSQLConcurrencyTests(TransactionTestCase):
    # 在真实 PostgreSQL 并发连接下，确认同版本提交只有一个写入成功。
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
        # 在独立数据库连接中同步发起写入，构造真实并发竞争。
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
