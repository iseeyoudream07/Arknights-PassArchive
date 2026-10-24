/*
 * 前端收藏规则，与 backend/api/domain.py 对应；保持两端的校验与统计口径一致。
 * 金额以两位小数字符串保存，汇总时转为 BigInt 分，避免浮点误差。
 */
import type { Catalog, Collection, RecordEntry, Backup, Stats } from './types.ts';
/**
 * 校验并规范单价；空值返回 null，合法输入返回两位小数字符串。
 * 拒绝布尔值、负数、超过两位小数或单价大于 3250000 元的输入。
 */
export function normalizeMoney(v: unknown): string | null {
    if (v === '' || v === undefined || v === null)
        return null;
    const s = String(v);
    if (typeof v === 'boolean' || !/^\d+(\.\d{1,2})?$/.test(s) || Number(s) > 3250000)
        throw new Error('金额请输入 0–3,250,000 之间的数字，最多保留两位小数。');
    const [a, b = ''] = s.split('.');
    return `${BigInt(a)}.${b.padEnd(2, '0')}`;
}
/**
 * 规范化单条收藏；未拥有时清空市场价与批次，批次数量和条数需在范围内。
 */
export function normalizeRecord(v: unknown): RecordEntry {
    if (!v || typeof v !== 'object')
        throw new Error('备份中的收藏记录格式不正确，请检查文件。');
    const r = v as Partial<RecordEntry>;
    if (r.owned !== undefined && typeof r.owned !== 'boolean')
        throw new Error('备份中的拥有状态无法读取，请检查文件。');
    const owned = r.owned ?? false;
    if (r.lots !== undefined && (!Array.isArray(r.lots) || r.lots.length > 1000))
        throw new Error('购买记录无法读取，或超过了每款 1,000 笔的上限。');
    const lots = (r.lots ?? []).map(l => {
        if (!l || !Number.isInteger(l.qty) || l.qty < 1 || l.qty > 999)
            throw new Error('每笔购买数量请输入 1–999 之间的整数。');
        return { cost: normalizeMoney(l.cost) ?? '0.00', qty: l.qty };
    });
    const market = normalizeMoney(r.market);
    return { owned, market: owned ? market : null, lots: owned ? lots : [] };
}
/**
 * 将规范化的元字符串转换为 BigInt 分，作为内部精确计算单位。
 */
const cents = (v: string | null) => BigInt((v ?? '0').split('.')[0]) * 100n + BigInt((v ?? '0').split('.')[1]?.padEnd(2, '0') ?? '0');
/**
 * 把整数分转换成带正负号的两位小数字符串，用于统计输出。
 */
const currency = (n: bigint) => `${n < 0n ? '-' : ''}${(n < 0n ? -n : n) / 100n}.${((n < 0n ? -n : n) % 100n).toString().padStart(2, '0')}`;
/**
 * 计算前端统计，与后端 Decimal 版本保持同一规则。
 * 拥有种类按 ID 计数，金额按购买批次乘数量；特别系列按整盒参考价计一次。
 */
export function calculateStats(catalog: Catalog, collection: Collection): Stats {
    let official = 0n, market = 0n, cost = 0n, pricedCost = 0n, owned = 0, quantity = 0, priced = 0, complete = 0, total = 0;
    for (const s of catalog.series) {
        let boxOwned = 0;
        const fixed = s.passes[0]?.official_unit_price === null;
        for (const p of s.passes) {
            total++;
            if (!collection[p.id]?.owned)
                continue;
            const r = normalizeRecord(collection[p.id]);
            owned++;
            boxOwned++;
            const q = r.lots.reduce((a, l) => a + l.qty, 0);
            const c = r.lots.reduce((a, l) => a + cents(l.cost) * BigInt(l.qty), 0n);
            const m = cents(r.market);
            quantity += q;
            cost += c;
            market += m * BigInt(q);
            if (m > 0n) {
                priced++;
                pricedCost += c;
            }
            if (!fixed)
                official += cents(String(p.official_unit_price)) * BigInt(q);
        }
        if (fixed && boxOwned)
            official += cents(String(s.official_box_price));
        if (boxOwned && boxOwned === s.passes.length)
            complete++;
    }
    return { total, owned, quantity, progress: total ? Math.round(owned / total * 1000) / 10 : 0, official: currency(official), market: currency(market), cost: currency(cost), profit: currency(market - pricedCost), priced_owned: priced, completed_series: complete, rules_version: 'upstream-v3-compat-1' };
}
/**
 * 转换标准备份、直接 ID 字典或旧版系列结构，返回规范化备份及警告。
 * 无法识别的旧条目进入 unmapped，保留它们以便后续修复映射。
 */
export function normalizeBackup(value: unknown, catalog: Catalog): {
    backup: Backup;
    warnings: string[];
} {
    // 使用迭代检查，异常文件不能在复制、同步或导出时耗尽调用栈。
    const pending: [unknown, number][] = [[value, 0]];
    while (pending.length) {
        const [item, depth] = pending.pop()!;
        if (depth > 64) throw new Error('备份内容过于复杂，暂时无法读取。请检查文件后重试。');
        if (item && typeof item === 'object')
            for (const child of Object.values(item)) pending.push([child, depth + 1]);
    }
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('备份文件格式不正确，请重新导出后再试。');
    const payload = value as {
        schema_version?: number;
        collection?: unknown;
        unmapped?: unknown;
        followed_series?: unknown;
    };
    if (payload.schema_version !== undefined && payload.schema_version !== 1)
        throw new Error('暂不支持这个版本的备份，请更新应用后再试。');
    const raw = (payload.collection ?? payload) as {
        [k: string]: unknown;
    };
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).length > 10000)
        throw new Error('备份中的收藏格式不正确，或超过了 10,000 条记录的上限。');
    const known = new Map(catalog.series.flatMap(s => s.passes.map(p => [p.id, p] as const)));
    const collection: Collection = Object.create(null);
    const unmapped: {
        [id: string]: unknown;
    } = Object.create(null);
    if (payload.schema_version !== undefined && payload.unmapped !== undefined) {
        if (!payload.unmapped || typeof payload.unmapped !== 'object' || Array.isArray(payload.unmapped))
            throw new Error('备份中未识别记录的格式不正确，请重新导出后再试。');
        Object.assign(unmapped, payload.unmapped);
    }
    if (payload.schema_version !== undefined || Object.keys(raw).every(k => known.has(k))) {
        for (const [id, v] of Object.entries(raw)) {
            if (known.has(id))
                collection[id] = normalizeRecord(v);
            else
                unmapped[id] = v;
        }
    }
    else {
        const legacy = new Map(catalog.series.flatMap(s => s.passes.map(p => [JSON.stringify([s.name, p.label]), p.id] as const)));
        for (const [series, v] of Object.entries(raw)) {
            if (!v || typeof v !== 'object' || Array.isArray(v))
                throw new Error('旧版备份中的系列记录格式不正确，请检查文件。');
            const entry = v as {
                ownedChars?: {
                    [k: string]: unknown;
                };
                prices?: {
                    [k: string]: {
                        market?: unknown;
                        cost?: unknown;
                        lots?: unknown;
                    };
                };
            };
            const own = entry.ownedChars ?? {}, prices = entry.prices ?? {};
            if (typeof own !== 'object' || Array.isArray(own) || typeof prices !== 'object' || Array.isArray(prices) || !own || !prices)
                throw new Error('旧版备份中的拥有状态或价格无法读取，请检查文件。');
            for (const label of new Set([...Object.keys(own), ...Object.keys(prices)])) {
                const pr = prices[label] ?? {};
                if (typeof pr !== 'object' || Array.isArray(pr))
                    throw new Error('旧版备份中的价格无法读取，请检查文件。');
                let lots = pr.lots;
                if (lots === undefined || lots === null)
                    lots = pr.cost !== undefined && pr.cost !== null && pr.cost !== '' ? [{ cost: pr.cost, qty: 1 }] : [];
                else if (Array.isArray(lots))
                    lots = lots.filter(l => l && l.cost !== undefined && l.cost !== null && l.cost !== '');
                const record = normalizeRecord({ owned: Boolean(own[label]), market: pr.market, lots });
                const id = legacy.get(JSON.stringify([series, label]));
                if (id)
                    collection[id] = record;
                else
                    unmapped[`${series} / ${label}`] = { legacy_series: series, legacy_label: label, ...record };
            }
        }
    }
    const followed = payload.followed_series ?? [];
    const seriesIds = new Set(catalog.series.map(series => series.id));
    if (!Array.isArray(followed) || followed.length > 2000 || followed.some(id => typeof id !== 'string' || !seriesIds.has(id)))
        throw new Error('备份中的关注系列无法读取，请更新目录或重新导出后再试。');
    const count = Object.keys(unmapped).length;
    return { backup: { schema_version: 1, catalog_version: catalog.version, collection, unmapped, followed_series: [...new Set(followed)].sort() }, warnings: count ? [`${count} 条记录尚未识别，已单独保留，可继续同步和导出。`] : [] };
}
