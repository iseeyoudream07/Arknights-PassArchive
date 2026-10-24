/* 备份三方合并纯函数测试：独立修改、删除、同项冲突与关注系列变化。
 * 使用项目现有 npm test 运行；本文件不连接线上账号数据库。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeBackups, sameBackup } from '../src/sync-merge.ts';
import type { Backup, RecordEntry } from '../src/types.ts';
const record = (market: string | null = '30.00'): RecordEntry => ({ owned: true, market, lots: [{ cost: '20.05', qty: 3 }] });
const backup = (collection: Backup['collection'] = {}, followed_series: string[] = [], unmapped: Backup['unmapped'] = {}): Backup => ({ schema_version: 1, catalog_version: 'test', collection, followed_series, unmapped });
test('independent offline edits from two devices merge without losing either purchase history', () => {
    const result = mergeBackups(backup(), backup({ a: record('30.00') }), backup({ b: record('40.00') }));
    assert.equal(result.conflicts.length, 0);
    assert.deepEqual({ ...result.backup.collection }, { a: record('30.00'), b: record('40.00') });
});
test('an offline stale copy does not resurrect a pass that another device unowned', () => {
    const original = backup({ a: record() });
    const cloud = backup({ a: { owned: false, market: null, lots: [] } });
    assert(sameBackup(mergeBackups(original, original, cloud).backup, cloud));
});
test('competing price and lot edits stop for an explicit choice, while unrelated records merge', () => {
    const previous = backup({ a: record() });
    const local = backup({ a: record('31.00'), b: record() });
    const cloud = backup({ a: { ...record('35.00'), lots: [{ cost: '25.50', qty: 2 }] }, c: record() });
    const result = mergeBackups(previous, local, cloud);
    assert.equal(result.conflicts.length, 1);
    assert.equal(result.conflicts[0].id, 'a');
    assert.deepEqual(mergeBackups(previous, local, cloud, 'cloud').backup.collection.a, cloud.collection.a);
    assert.deepEqual(mergeBackups(previous, local, cloud, 'local').backup.collection.a, local.collection.a);
    assert.deepEqual(result.backup.collection.b, local.collection.b);
    assert.deepEqual(result.backup.collection.c, cloud.collection.c);
});
test('unmapped legacy data, explicit removals, and independent bookmark changes survive a roundtrip', () => {
    const previous = backup({}, ['series_a'], { removed: { note: 'old' } });
    const local = backup({}, ['series_b'], {});
    const cloud = backup({}, ['series_a', 'series_c'], { removed: { note: 'old' }, future: { note: 'preserve' } });
    const result = mergeBackups(previous, local, cloud);
    assert.deepEqual(result.backup.followed_series, ['series_b', 'series_c']);
    assert.deepEqual({ ...result.backup.unmapped }, { future: { note: 'preserve' } });
});
test('object ordering and export timestamps do not manufacture sync conflicts', () => {
    const original = backup({ a: record() }, [], { future: { a: 1, b: 2 } });
    const reordered = { ...original, exported_at: 'tomorrow', unmapped: { future: { b: 2, a: 1 } } };
    assert(sameBackup(original, reordered));
    assert.equal(mergeBackups(original, reordered, original).conflicts.length, 0);
});
