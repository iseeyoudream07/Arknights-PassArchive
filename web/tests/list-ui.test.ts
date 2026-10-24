/* 列表 DOM 回归：按 ID 复用卡片、保留图片和键盘焦点，减少重复渲染。
 * 使用项目现有 npm test 运行；本文件不连接线上账号数据库。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { reconcileCards, patchPassCard } from '../src/list-ui.ts';
import type { RecordEntry } from '../src/types.ts';
function fixture() {
    const dom = new JSDOM('<main><input id="search"><div class="pass-grid"></div></main>');
    const grid = dom.window.document.querySelector('.pass-grid') as unknown as HTMLElement;
    const make = (id: string) => {
        const card = dom.window.document.createElement('article');
        card.innerHTML = `<button class="avatar-button"><img src="/${id}.png"></button><h3>${id}</h3><div class="pass-price"></div><div class="pass-actions"><button data-toggle="${id}"></button><button>价格</button></div>`;
        return card as unknown as HTMLElement;
    };
    const records: Record<string, RecordEntry> = {};
    const draw = (ids: string[]) => reconcileCards(grid, ids, id => id, make, (card, id) => patchPassCard(card, records[id], id), '[data-toggle]');
    return { dom, grid, records, draw };
}
test('marking a pass preserves every card avatar button and keyboard focus', () => {
    const { dom, grid, records, draw } = fixture();
    draw(['a', 'b', 'c']);
    const cards = Array.from(grid.children), images = Array.from(grid.querySelectorAll('img'));
    const button = grid.querySelector<HTMLButtonElement>('[data-toggle="b"]')!;
    button.focus();
    records.b = { owned: true, market: '23.45', lots: [{ cost: '12.50', qty: 2 }] };
    assert.equal(draw(['a', 'b', 'c']).created, 0);
    assert.deepEqual(Array.from(grid.children), cards);
    assert.deepEqual(Array.from(grid.querySelectorAll('img')), images);
    assert.equal(grid.querySelector('[data-toggle="b"]'), button);
    assert.equal(dom.window.document.activeElement, button);
    assert.equal(button.getAttribute('aria-pressed'), 'true');
    assert.equal(cards[1].querySelector('.pass-price')!.textContent, '市价 ¥23.45 ×2');
    assert.equal(cards[0].querySelector('.pass-price')!.textContent, '未收藏');
    dom.window.close();
});
test('cloud refresh with unchanged records does not mutate avatar or card contents', async () => {
    const { dom, grid, draw } = fixture();
    draw(['a', 'b']);
    const observer = new dom.window.MutationObserver(() => {
    });
    observer.observe(grid, { subtree: true, childList: true, attributes: true });
    draw(['a', 'b']);
    const mutations = observer.takeRecords();
    assert.equal(mutations.length, 0);
    dom.window.close();
});
test('unowning under a filter removes only that card and focuses the next ownership control', () => {
    const { dom, grid, draw } = fixture();
    draw(['a', 'b', 'c']);
    const first = grid.children[0], last = grid.children[2];
    grid.querySelector<HTMLButtonElement>('[data-toggle="b"]')!.focus();
    const result = draw(['a', 'c']);
    assert.equal(result.focusRemoved, true);
    assert.equal(result.created, 0);
    assert.equal(grid.children[0], first);
    assert.equal(grid.children[1], last);
    assert.equal(dom.window.document.activeElement, grid.querySelector('[data-toggle="c"]'));
    dom.window.close();
});
test('search reconciliation keeps matching nodes and search focus while adding only new results', () => {
    const { dom, grid, draw } = fixture();
    draw(['a', 'b']);
    const b = grid.children[1], avatar = b.querySelector('img');
    const search = dom.window.document.querySelector<HTMLInputElement>('#search')!;
    search.focus();
    assert.equal(draw(['b', 'c']).created, 1);
    assert.equal(grid.children[0], b);
    assert.equal(grid.children[0].querySelector('img'), avatar);
    assert.equal(dom.window.document.activeElement, search);
    draw(['c', 'b']);
    assert.equal(grid.children[1], b);
    dom.window.close();
});
