/* 账号同步集成测试：访客隔离、本机缓存、并发更新、冲突和退出前检查。
 * 使用项目现有 npm test 运行；本文件不连接线上账号数据库。
 */
import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import type { Backup, Catalog } from '../src/types.ts';
import { emptyBackup } from '../src/sync-merge.ts';
const catalog = JSON.parse(fs.readFileSync(new URL('../../data/catalog.json', import.meta.url), 'utf8')) as Catalog;
const passA = catalog.series[0].passes[0].id, passB = catalog.series[0].passes[1].id;
const callbacks = new Map<string, () => void>();
Object.defineProperty(globalThis, 'window', { value: { setTimeout: () => 0, clearTimeout: () => {
        }, setInterval: () => 0, clearInterval: () => {
        }, addEventListener: (n: string, f: () => void) => callbacks.set(n, f), removeEventListener: (n: string) => callbacks.delete(n) }, configurable: true });
Object.defineProperty(globalThis, 'document', { value: { hidden: false, addEventListener: () => {
        }, removeEventListener: () => {
        } }, configurable: true });
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });
Object.defineProperty(globalThis, 'localStorage', { value: { getItem: () => null }, configurable: true });
const { AccountSync } = await import('../src/account-sync.ts');
const { loadAccountCache, saveArchive, loadArchive, clearAccountCache } = await import('../src/storage.ts');
const { accountPanelMarkup } = await import('../src/account-panel.ts');
const entry = (market = '30.00') => ({ owned: true, market, lots: [{ cost: '20.05', qty: 3 }] });
function server(userId: number | null) {
    let activeId = userId, offline = false, revision = 0, cloud = emptyBackup(catalog), writes = 0;
    globalThis.fetch = async (input, options = {}) => {
        if (offline)
            throw new TypeError('offline');
        const path = String(input), body = options.body ? JSON.parse(String(options.body)) : {};
        const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
        if (path.endsWith('/session/'))
            return response({ authenticated: activeId !== null, user: activeId === null ? null : { id: activeId, username: `test_${activeId}` }, csrf_token: 'test-csrf-not-a-real-credential' });
        if (path.endsWith('/archive/')) {
            if (options.method === 'PUT') {
                if (body.expected_user_id !== activeId)
                    return response({ detail: 'account changed', code: 'account_changed' }, 409);
                if (body.base_revision !== revision)
                    return response({ detail: 'conflict', code: 'revision_conflict', user_id: activeId, revision, backup: cloud, updated_at: '2026-10-14T00:00:00Z' }, 409);
                cloud = structuredClone(body.backup);
                revision++;
                writes++;
            }
            return response({ user_id: activeId, revision, backup: cloud, updated_at: '2026-10-14T00:00:00Z' });
        }
        if (path.endsWith('/logout/')) {
            activeId = null;
            return response({ authenticated: false, user: null, csrf_token: 'test-csrf' });
        }
        throw new Error('Unexpected request');
    };
    return { get cloud() {
            return cloud;
        }, get writes() {
            return writes;
        }, setOffline(value: boolean) {
            offline = value;
        }, switchAccount(id: number) {
            activeId = id;
        }, remoteEdit(backup: Backup) {
            cloud = structuredClone(backup);
            revision++;
        } };
}
test('admin entry requires a live verified session and disappears after offline restore or logout', async () => {
    const remote = server(109);
    const send = globalThis.fetch;
    globalThis.fetch = async (input, options) => {
        const response = await send(input, options);
        if (!String(input).endsWith('/session/')) return response;
        const value = await response.json();
        if (value.user) value.user = { ...value.user, username: 'root', can_manage_catalog: true };
        return new Response(JSON.stringify(value), { status: response.status, headers: { 'Content-Type': 'application/json' } });
    };
    const online = new AccountSync(catalog);
    await online.initialize(); await online.sync();
    assert.equal(online.canManageCatalog, true);
    assert(accountPanelMarkup(online, catalog).includes('/admin.html'));
    remote.setOffline(true);
    const restored = new AccountSync(catalog);
    await restored.initialize();
    assert.equal(restored.user?.id, 109);
    assert.equal(restored.canManageCatalog, false);
    assert(!accountPanelMarkup(restored, catalog).includes('/admin.html'));
    restored.dispose();
    remote.setOffline(false);
    await online.logout();
    assert.equal(online.canManageCatalog, false);
    assert(!accountPanelMarkup(online, catalog).includes('/admin.html'));
    online.dispose(); await clearAccountCache(109);
});

test('offline changes survive a fresh controller and upload on reconnect without mixing guest data', async () => {
    const guest = emptyBackup(catalog);
    guest.collection[passB] = entry('50.00');
    await saveArchive(guest);
    const remote = server(101), first = new AccountSync(catalog);
    await first.initialize();
    await first.sync();
    assert.deepEqual(remote.cloud.collection, {});
    remote.setOffline(true);
    const next = structuredClone(first.backup);
    next.collection[passA] = entry();
    await first.saveLocal(next);
    await first.sync();
    assert.equal(first.status, 'offline');
    assert.equal((await loadAccountCache(101))!.backup.collection[passA].market, '30.00');
    first.dispose();
    const reopened = new AccountSync(catalog);
    await reopened.initialize();
    assert.equal(reopened.backup.collection[passA].lots[0].qty, 3);
    remote.setOffline(false);
    await reopened.sync();
    assert.equal(remote.cloud.collection[passA].market, '30.00');
    assert.equal(remote.cloud.collection[passB], undefined);
    assert.equal((await loadArchive())!.collection[passB].market, '50.00');
    reopened.dispose();
    await clearAccountCache(101);
});

test('a conflict choice cannot silently overwrite a newer local conflict from another tab', async () => {
    const remote = server(107), first = new AccountSync(catalog), second = new AccountSync(catalog);
    const baseline = emptyBackup(catalog);
    baseline.collection[passA] = entry('30.00');
    remote.remoteEdit(baseline);
    await first.initialize(); await first.sync();
    const local = structuredClone(first.backup);
    local.collection[passA] = entry('31.00');
    await first.saveLocal(local);
    const cloud = structuredClone(baseline);
    cloud.collection[passA] = entry('51.00');
    remote.remoteEdit(cloud);
    await first.sync();
    assert.equal(first.conflicts.length, 1);
    const reviewed = structuredClone(first.conflicts);
    await second.initialize(); await second.sync();
    const newer = structuredClone(second.backup);
    newer.collection[passA] = entry('99.00');
    await second.saveLocal(newer);
    await assert.rejects(first.resolve('cloud'), /冲突记录已有更新/);
    assert.equal((await loadAccountCache(107))!.backup.collection[passA].market, '99.00');
    assert.equal(remote.cloud.collection[passA].market, '51.00');
    assert.equal(remote.writes, 0);
    await first.sync();
    await assert.rejects(first.resolve('cloud', reviewed), /冲突记录已有更新/);
    assert.equal(remote.writes, 0);
    first.dispose(); second.dispose(); await clearAccountCache(107);
});

test('logout retains an edit saved by another tab while the logout request is in flight', async () => {
    const remote = server(108), first = new AccountSync(catalog), second = new AccountSync(catalog);
    await first.initialize(); await first.sync(); await second.initialize(); await second.sync();
    const next = structuredClone(second.backup);
    next.collection[passA] = entry('74.00');
    const send = globalThis.fetch;
    globalThis.fetch = async (input, options) => {
        if (String(input).endsWith('/logout/')) await second.saveLocal(next);
        return send(input, options);
    };
    await first.logout();
    assert.equal(first.user, null);
    assert.equal((await loadAccountCache(108))!.backup.collection[passA].market, '74.00');
    assert.match(first.message, /重新登录原账号/);
    remote.switchAccount(108);
    const reopened = new AccountSync(catalog);
    await reopened.initialize(); await reopened.sync();
    assert.equal(remote.cloud.collection[passA].market, '74.00');
    first.dispose(); second.dispose(); reopened.dispose(); await clearAccountCache(108);
});

test('guest tabs atomically merge independent changes and reject competing edits of one record', async () => {
    server(null);
    await saveArchive(emptyBackup(catalog));
    const first = new AccountSync(catalog), second = new AccountSync(catalog);
    await first.initialize(); await second.initialize();
    const a = structuredClone(first.backup), b = structuredClone(second.backup);
    a.collection[passA] = entry('30.00'); b.collection[passB] = entry('40.00');
    await Promise.all([first.saveLocal(a), second.saveLocal(b)]);
    const saved = (await loadArchive())!;
    assert.equal(saved.collection[passA].market, '30.00');
    assert.equal(saved.collection[passB].market, '40.00');
    const third = new AccountSync(catalog), fourth = new AccountSync(catalog);
    await third.initialize(); await fourth.initialize();
    const c = structuredClone(third.backup), d = structuredClone(fourth.backup);
    c.collection[passA] = entry('60.00'); d.collection[passA] = entry('80.00');
    await third.saveLocal(c);
    await assert.rejects(fourth.saveLocal(d), /另一标签页/);
    assert.equal((await loadArchive())!.collection[passA].market, '60.00');
    first.dispose(); second.dispose(); third.dispose(); fourth.dispose();
});
test('two open tabs retain disjoint local edits in an atomic IndexedDB merge', async () => {
    const remote = server(102), first = new AccountSync(catalog), second = new AccountSync(catalog);
    await first.initialize();
    await first.sync();
    await second.initialize();
    await second.sync();
    remote.setOffline(true);
    const a = structuredClone(first.backup), b = structuredClone(second.backup);
    a.collection[passA] = entry('31.00');
    b.collection[passB] = entry('41.00');
    await Promise.all([first.saveLocal(a), second.saveLocal(b)]);
    const cached = (await loadAccountCache(102))!.backup;
    assert.equal(cached.collection[passA].market, '31.00');
    assert.equal(cached.collection[passB].market, '41.00');
    remote.setOffline(false);
    await first.sync();
    assert.equal(remote.cloud.collection[passA].market, '31.00');
    assert.equal(remote.cloud.collection[passB].market, '41.00');
    first.dispose();
    second.dispose();
    await clearAccountCache(102);
});
test('same-record local conflict stops instead of silently discarding one tab edit', async () => {
    const remote = server(103), first = new AccountSync(catalog), second = new AccountSync(catalog);
    await first.initialize();
    await first.sync();
    await second.initialize();
    await second.sync();
    remote.setOffline(true);
    const a = structuredClone(first.backup), b = structuredClone(second.backup);
    a.collection[passA] = entry('31.00');
    b.collection[passA] = entry('41.00');
    await first.saveLocal(a);
    await assert.rejects(second.saveLocal(b), /另一标签页/);
    assert.equal((await loadAccountCache(103))!.backup.collection[passA].market, '31.00');
    first.dispose();
    second.dispose();
    await clearAccountCache(103);
});
test('changed cookie account never receives the previous account pending document', async () => {
    const remote = server(104), sync = new AccountSync(catalog);
    await sync.initialize();
    await sync.sync();
    const next = structuredClone(sync.backup);
    next.collection[passA] = entry();
    await sync.saveLocal(next);
    remote.switchAccount(105);
    await sync.sync();
    assert.equal(sync.status, 'sign-in');
    assert.equal(remote.writes, 0);
    assert.equal((await loadAccountCache(104))!.backup.collection[passA].market, '30.00');
    sync.dispose();
    await clearAccountCache(104);
});
test('cloud conflict requires an explicit choice and preserves independent new records', async () => {
    const remote = server(106), sync = new AccountSync(catalog);
    const baseline = emptyBackup(catalog);
    baseline.collection[passA] = entry();
    remote.remoteEdit(baseline);
    await sync.initialize();
    await sync.sync();
    const local = structuredClone(sync.backup);
    local.collection[passA] = entry('31.00');
    local.collection[passB] = entry('41.00');
    await sync.saveLocal(local);
    const cloud = structuredClone(baseline);
    cloud.collection[passA] = entry('51.00');
    remote.remoteEdit(cloud);
    await sync.sync();
    assert.equal(sync.status, 'conflict');
    assert.equal(remote.writes, 0);
    await sync.resolve('cloud');
    assert.equal(remote.cloud.collection[passA].market, '51.00');
    assert.equal(remote.cloud.collection[passB].market, '41.00');
    sync.dispose();
    await clearAccountCache(106);
});
