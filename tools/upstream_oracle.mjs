/*
 * 从固定的上游快照提取原统计函数，生成独立于本项目实现的对照样本。
 * 固定随机种子保证样本可复现；执行会重写 shared/upstream-fixtures.json。
 */
// Fixture oracle evaluates the pinned upstream's own data and calculation code.
// It is deliberately separate from our Python and TypeScript implementations.
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const html = fs.readFileSync(path.join(root, 'upstream/index.html'), 'utf8');
const data = fs.readFileSync(path.join(root, 'upstream/data.js'), 'utf8');
const ctx = vm.createContext({ window: {}, collection: {} }, { codeGeneration: { strings: false, wasm: false } });
vm.runInContext(data, ctx, { timeout: 1000 });
vm.runInContext('const PASS_DATA=window.PASS_DATA;', ctx);
const prices = html.slice(html.indexOf('    const OFFICIAL_PRICE ='), html.indexOf('    let collection ='));
vm.runInContext(prices, ctx);
vm.runInContext(html.slice(html.indexOf('    const CARNIVAL_SET'), html.indexOf('    function isOwned')), ctx);
vm.runInContext(html.slice(html.indexOf('    function isOwned'), html.indexOf('    let currentFilter')), ctx);
const statHead = html.slice(html.indexOf('    function renderStats()'), html.indexOf('      // 增量更新：只改文本节点'));
vm.runInContext(statHead + `return {total,owned:ownedCount,progress:Number(pct.toFixed(1)),official:officialSum.toFixed(2),market:marketSum.toFixed(2),cost:costSum.toFixed(2),profit:profit.toFixed(2)};}`, ctx);
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'data/catalog.json'), 'utf8'));
const fixtures = [];
let seed = 325799;
const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
};
for (let n = 0; n < 24; n++) {
    const collection = {}, legacy = {};
    for (const s of catalog.series)
        for (const p of s.passes) {
            if (rand() > (n === 0 ? 0 : .09))
                continue;
            const owned = rand() > .1;
            const market = rand() > .35 ? (Math.floor(rand() * 25000) / 100).toFixed(2) : null;
            const lots = Array.from({ length: Math.floor(rand() * 4) }, () => ({ cost: (Math.floor(rand() * 16000) / 100).toFixed(2), qty: 1 + Math.floor(rand() * 6) }));
            collection[p.id] = { owned, market: owned ? market : null, lots: owned ? lots : [] };
            legacy[s.name] ??= { ownedChars: {}, prices: {} };
            legacy[s.name].ownedChars[p.label] = owned;
            if (owned)
                legacy[s.name].prices[p.label] = { market: market ?? '', lots };
        }
    ctx.collection = legacy;
    const expected = vm.runInContext('renderStats()', ctx, { timeout: 1000 });
    fixtures.push({ name: `seeded-${n}`, collection, expected });
}
fs.mkdirSync(path.join(root, 'shared'), { recursive: true });
fs.writeFileSync(path.join(root, 'shared/upstream-fixtures.json'), JSON.stringify(fixtures, null, 2) + '\n');
console.log(`Created ${fixtures.length} fixtures from original upstream rules`);
