/*
 * 备份三方合并的纯函数：比较上次共同基线、本机版本和云端版本。
 * 不同 ID 自动合并；同一 ID 双方都变更且内容不同时记录冲突。
 */
import type { Backup, Catalog } from './types.ts';
/**
 * 同一收藏或待匹配条目的双方改动；undefined 可表示其中一方删除了记录。
 */
export interface MergeConflict {
    section: 'collection' | 'unmapped';
    id: string;
    local: unknown;
    cloud: unknown;
}
/**
 * 按当前目录版本创建标准空存档，供访客、首次登录与合并基线使用。
 */
export function emptyBackup(catalog: Catalog): Backup {
    return { schema_version: 1, catalog_version: catalog.version, collection: {}, unmapped: {}, followed_series: [] };
}
/**
 * 递归排序对象键后序列化，避免键顺序不同被误判为内容变化。
 */
export function canonical(value: unknown): string {
    if (value === undefined)
        return 'undefined';
    if (Array.isArray(value))
        return `[${value.map(canonical).join(',')}]`;
    if (value && typeof value === 'object')
        return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
    return JSON.stringify(value);
}
/**
 * 按规范化内容比较，而非比较对象引用。
 */
export const equal = (a: unknown, b: unknown) => canonical(a) === canonical(b);
/**
 * 只比较用户数据部分，忽略导出时间等不影响收藏的元信息。
 */
export function sameBackup(a: Backup, b: Backup) {
    return equal(a.collection, b.collection) && equal(a.unmapped, b.unmapped) && equal(a.followed_series ?? [], b.followed_series ?? []);
}
/**
 * 以 base 为共同基线合并 local/cloud；一方未改时采用另一方，双方同改时记录冲突。
 * choice 仅决定冲突项采用哪一方；无冲突项仍正常合并，关注系列按成员变化合并。
 */
export function mergeBackups(base: Backup, local: Backup, cloud: Backup, choice?: 'local' | 'cloud') {
    const conflicts: MergeConflict[] = [];
    const backup: Backup = { schema_version: 1, catalog_version: cloud.catalog_version, collection: Object.create(null), unmapped: Object.create(null), followed_series: [] };
    for (const section of ['collection', 'unmapped'] as const) {
        const previous = base[section], ours = local[section], theirs = cloud[section];
        for (const id of new Set([...Object.keys(previous), ...Object.keys(ours), ...Object.keys(theirs)])) {
            let value: unknown;
            if (equal(ours[id], theirs[id]))
                value = ours[id];
            else if (equal(ours[id], previous[id]))
                value = theirs[id];
            else if (equal(theirs[id], previous[id]))
                value = ours[id];
            else {
                conflicts.push({ section, id, local: ours[id], cloud: theirs[id] });
                value = choice === 'cloud' ? theirs[id] : ours[id];
            }
            if (value !== undefined)
                (backup[section] as Record<string, unknown>)[id] = structuredClone(value);
        }
    }
    const previous = new Set(base.followed_series ?? []), ours = new Set(local.followed_series ?? []), theirs = new Set(cloud.followed_series ?? []);
    backup.followed_series = [...new Set([...previous, ...ours, ...theirs])].filter(id => ours.has(id) === previous.has(id) ? theirs.has(id) : ours.has(id)).sort();
    return { backup, conflicts };
}
