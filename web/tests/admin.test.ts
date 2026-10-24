/** 后台表单往返、搜索和注入边界；不接触在线数据。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import { editorMarkup, formOperation, matchingPasses, passRows, type EditorTarget } from '../src/admin-ui.ts';
import type { Catalog } from '../src/types.ts';
const catalog: Catalog = JSON.parse(fs.readFileSync(new URL('../../data/catalog.json', import.meta.url), 'utf8'));

function form(target: EditorTarget) {
    const dom = new JSDOM(editorMarkup(target));
    const data = new dom.window.FormData(dom.window.document.querySelector('form')!);
    return { dom, operation: formOperation(target, data as unknown as FormData) };
}

test('series editor preserves multiple barcodes, date lists, and literal decimal box numbers', () => {
    const s = { ...catalog.series[0], box_number: '1.0', barcodes: ['0000012345678', '0987654321098'], replicate_dates: ['2026-01-02', '2026-10-17'] };
    const { dom, operation } = form({ entity: 'series', series: s });
    assert.equal(operation.id, s.id);
    assert.equal(operation.data.box_number, '1.0');
    assert.deepEqual(operation.data.barcodes, s.barcodes);
    assert.deepEqual(operation.data.replicate_dates, s.replicate_dates);
    assert(!('id' in operation.data));
    dom.window.close();
});

test('pass editing preserves reference ID and explicit zero price while box series send null', () => {
    const s = structuredClone(catalog.series[0]);
    s.passes[0].official_unit_price = 0;
    const unit = form({ entity: 'pass', series: s, pass: s.passes[0] });
    assert.equal(unit.operation.id, s.passes[0].id);
    assert.equal(unit.operation.series_id, s.id);
    assert.equal(unit.operation.data.official_unit_price, '0');
    assert.equal(unit.operation.data.rarity, s.passes[0].rarity);
    unit.dom.window.close();
    const box = catalog.series.find(s => s.passes[0]?.official_unit_price === null)!;
    const fixed = form({ entity: 'pass', series: box });
    assert.equal(fixed.operation.data.official_unit_price, null);
    assert(!('id' in fixed.operation));
    fixed.dom.window.close();
});

test('admin search respects series and category and matches barcode and pinyin', () => {
    const s = catalog.series[0];
    assert.equal(matchingPasses(catalog, s.id, '', s.type).length, s.passes.length);
    assert.equal(matchingPasses(catalog, s.id, '', 'endfield').length, 0);
    assert(matchingPasses(catalog, '', s.barcodes[0], '').some(row => row.s.id === s.id));
    assert(matchingPasses(catalog, '', s.passes[0].py, '').some(row => row.p.id === s.passes[0].id));
});

test('untrusted names and image attributes remain text in editor and list', () => {
    const s = structuredClone(catalog.series[0]);
    const p = { ...s.passes[0], name: '<script>bad()</script>', label: '\"><img src=x onerror=bad()>', avatar: '\" onerror=bad() x=\"' };
    const dom = new JSDOM(`<table>${passRows([{ s, p }])}</table>${editorMarkup({ entity: 'pass', series: s, pass: p })}`);
    assert.equal(dom.window.document.querySelector('script'), null);
    assert.equal(dom.window.document.querySelector('[onerror]'), null);
    assert.equal(dom.window.document.querySelector<HTMLInputElement>('[name=name]')!.value, p.name);
    assert.equal(dom.window.document.querySelector('strong')!.textContent, p.label);
    dom.window.close();
});
