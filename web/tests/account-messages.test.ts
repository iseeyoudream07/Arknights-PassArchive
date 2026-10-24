import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { accountErrorMessage, newPasswordMessage, userMessage } from '../src/account-messages.ts';
import { AccountApi, ApiError } from '../src/account-api.ts';
import { accountPanelMarkup } from '../src/account-panel.ts';
import type { AccountSync } from '../src/account-sync.ts';
import type { Catalog } from '../src/types.ts';

test('registration and legacy mixed password errors give one actionable Chinese hint', () => {
    const mixed = '密码跟 用户名 太相似了。 This password is too short. It must contain at least 10 characters. 密码只包含数字。';
    assert.equal(accountErrorMessage(mixed, 400), '密码至少需要 10 个字符，请设置更长的密码。');
    assert.equal(newPasswordMessage('114514', '114514'), accountErrorMessage(mixed, 400));
    assert.match(newPasswordMessage('114514114514', '114514114514')!, /加入字母或其他字符/);
    assert.match(newPasswordMessage('Collection!7439', 'different')!, /不一致/);
    assert.equal(newPasswordMessage('e\u0301'.repeat(5), 'e\u0301'.repeat(5)), null);
    assert.equal(accountErrorMessage('Internal Server Error / private/path', 500), '暂时无法完成操作，请稍后重试。');
    assert.match(userMessage(new DOMException('Quota exceeded', 'QuotaExceededError')), /存储空间不足/);
});

test('a user retry after CSRF expiry fetches a fresh token and does not auto-repeat a write', async () => {
    const previous = globalThis.fetch;
    let sessions = 0, writes = 0;
    globalThis.fetch = async (input, options = {}) => {
        if (String(input).endsWith('/session/')) {
            sessions++;
            return Response.json({ authenticated: false, user: null, csrf_token: `token-${sessions}` });
        }
        writes++;
        assert.equal((options.headers as Record<string, string>)['X-CSRFToken'], `token-${writes}`);
        return writes === 1 ? Response.json({ code: 'csrf_failed', detail: '登录验证已过期，请重新登录后再试。' }, { status: 403 }) : Response.json({ ok: true });
    };
    try {
        const api = new AccountApi();
        await assert.rejects(api.request('/api/v1/auth/login/', 'POST', {}), ApiError);
        assert.equal(writes, 1);
        await api.request('/api/v1/auth/login/', 'POST', {});
        assert.equal(writes, 2);
        assert.equal(sessions, 2);
    } finally { globalThis.fetch = previous; }
});

test('malformed or non-JSON responses fail with a readable hint rather than erasing the account view', async () => {
    const previous = globalThis.fetch;
    try {
        for (const body of ['null', '[]', '<html>gateway failure</html>', '{}']) {
            globalThis.fetch = async () => new Response(body);
            await assert.rejects(new AccountApi().session(), (error: unknown) => error instanceof ApiError && error.status === 502);
        }
    } finally { globalThis.fetch = previous; }
});

test('account requests refuse redirects and keep private responses out of caches', async () => {
    const previous = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async (_input, options = {}) => {
        calls++;
        assert.equal(options.redirect, 'error');
        assert.equal(options.cache, 'no-store');
        assert.equal(options.credentials, 'same-origin');
        return new Response(JSON.stringify({ detail: 'This password is too short. It must contain at least 10 characters.' }), { status: 400 });
    };
    try {
        await assert.rejects(new AccountApi().request('/api/v1/auth/session/'), (error: unknown) =>
            error instanceof ApiError && error.status === 400 && error.message === '密码至少需要 10 个字符，请设置更长的密码。');
        assert.equal(calls, 1);
    } finally { globalThis.fetch = previous; }
});

test('all conflicts are reviewable and arbitrary preserved JSON stays escaped plain text', () => {
    const record = { owned: true, market: '30.00', lots: [{ cost: '20.05', qty: 3 }] };
    const conflicts = Array.from({ length: 12 }, (_, i) => ({ section: 'unmapped', id: `future_${i}`, local: i ? record : null, cloud: { owned: true } }));
    conflicts.push({ section: 'unmapped', id: '<img id="injected">', local: { owned: true, market: '<script>bad()</script>', lots: [] }, cloud: null as never });
    const account = {
        user: { id: 1, username: '<img id="user-injected">' }, status: 'conflict', message: '', syncedAt: null,
        guest: { collection: {}, followed_series: [] }, backup: { followed_series: [] }, conflicts,
    } as unknown as AccountSync;
    const fragment = JSDOM.fragment(accountPanelMarkup(account, { series: [] } as unknown as Catalog));
    assert.equal(fragment.querySelectorAll('.sync-conflicts article').length, 13);
    assert.equal(fragment.querySelectorAll('.sync-conflicts details').length, 13);
    assert.equal(fragment.querySelector('img, script'), null);
    assert.match(fragment.textContent!, /20.05 × 3 张/);
    assert.match(fragment.textContent!, /future_11/);
    assert.match(fragment.textContent!, /<script>bad\(\)<\/script>/);
});
