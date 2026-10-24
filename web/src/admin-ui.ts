/** 后台的纯展示层与表单转换；事件、会话校验和保存由 admin-entry.ts 负责。 */
import type { Catalog, Pass, Series } from './types.ts';
export const esc = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export const categoryNames: Record<string, string> = { main: '主线通行认证', sp: '音律联觉', carnival: '嘉年华', collab: '联动系列', elite: '精英干员', special: '特别系列', endfield: '终末地' };
export interface AdminSnapshot { catalog: Catalog; revision: number; }
export interface CatalogOperation { entity: 'series' | 'pass'; id?: string; series_id?: string; data: Record<string, unknown>; }
export type EditorTarget = { entity: 'series'; series?: Series } | { entity: 'pass'; series: Series; pass?: Pass };
export const isBox = (s: Series) => s.passes.length ? s.passes[0].official_unit_price === null : (s as Series & { pricing_mode?: string }).pricing_mode === 'box';

export function matchingPasses(catalog: Catalog, selected: string, query: string, category: string) {
    const q = query.trim().toLocaleLowerCase();
    return catalog.series.filter(s => (!selected || s.id === selected) && (!category || s.type === category)).flatMap(s => s.passes
        .filter(p => !q || `${s.name} ${s.box_number ?? ''} ${s.barcodes.join(' ')} ${p.name} ${p.label} ${p.search_text} ${p.en} ${p.py} ${p.pyi}`.toLocaleLowerCase().includes(q))
        .map(p => ({ s, p })));
}

export function passRows(rows: { s: Series; p: Pass }[]) {
    return rows.map(({ s, p }) => `<tr><td><div class="admin-pass">${p.avatar ? `<img src="${esc(p.avatar)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '<span class="admin-avatar" aria-hidden="true">PA</span>'}<div><strong>${esc(p.label)}</strong><small>${esc([p.class, p.rarity ? `${p.rarity} 星` : '', p.faction].filter(Boolean).join(' / ') || '资料待补充')}</small></div></div></td><td><span>${esc(s.name)}</span><small>${esc(categoryNames[s.type] ?? s.type)}${s.box_number ? ` · ${esc(s.box_number)}` : ''}</small></td><td class="admin-price">${p.official_unit_price === null ? '整盒计价' : `¥ ${p.official_unit_price.toFixed(2)}`}</td><td><button class="admin-edit" data-edit-pass="${esc(p.id)}" data-series="${esc(s.id)}" aria-label="编辑${esc(p.label)}">编辑 <span aria-hidden="true">↗</span></button></td></tr>`).join('');
}

function field(name: string, label: string, value: unknown = '', options: { type?: string; required?: boolean; hint?: string; full?: boolean; attrs?: string } = {}) {
    return `<label class="admin-field${options.full ? ' admin-field-wide' : ''}"><span>${label}${options.required ? ' <b aria-hidden="true">*</b>' : ''}</span><input name="${name}" value="${esc(value)}" type="${options.type ?? 'text'}" ${options.required ? 'required' : ''} ${options.attrs ?? 'maxlength="200"'}>${options.hint ? `<small>${options.hint}</small>` : ''}</label>`;
}

export function editorMarkup(target: EditorTarget) {
    let fields: string;
    if (target.entity === 'series') {
        const s = target.series;
        fields = field('name', '系列名称', s?.name, { required: true, full: true }) +
            `<label class="admin-field"><span>系列分类 <b>*</b></span><select name="type">${Object.entries(categoryNames).map(([k, v]) => `<option value="${k}" ${k === (s?.type ?? 'main') ? 'selected' : ''}>${v}</option>`).join('')}</select></label>` +
            field('box_number', '盒号', s?.box_number, { hint: '保留原样，例如 1.0、SP。' }) +
            field('year', '年份', s?.year, { attrs: 'inputmode="numeric" pattern="[0-9]{4}" maxlength="4"' }) +
            field('release_date', '发售日期', s?.release_date, { type: 'date' }) +
            `<label class="admin-field"><span>官方价计算方式</span><select name="pricing_mode"><option value="unit" ${s && isBox(s) ? '' : 'selected'}>按单张</option><option value="box" ${s && isBox(s) ? 'selected' : ''}>按整盒</option></select><small>改为整盒后，所有单张参考价会清空；改回单张后需重新补充。</small></label>` +
            field('official_box_price', '整盒官方参考价（元）', s?.official_box_price ?? '0', { type: 'number', required: true, attrs: 'min="0" max="3250000" step="0.01" inputmode="decimal"' }) +
            field('barcodes', '包装条码', s?.barcodes.join(', '), { full: true, hint: '多条用逗号或空格分隔。', attrs: 'maxlength="10000"' }) +
            field('replicate_dates', '复刻日期', s?.replicate_dates.join(', '), { full: true, hint: 'YYYY-MM-DD，多次复刻用逗号分隔。', attrs: 'maxlength="10000"' }) +
            field('image', '系列封面地址', s?.image, { full: true, hint: '填写站内 /assets/images/ 路径或 HTTPS 图片地址。', attrs: 'maxlength="1500"' });
    } else {
        const p = target.pass;
        fields = `<p class="admin-form-context">所属系列 <strong>${esc(target.series.name)}</strong></p>` +
            field('name', '干员名称', p?.name, { required: true }) + field('variant', '款式 / 阶段', p?.variant, { hint: '例如精一、精二；无区分时可留空。' }) +
            field('label', '通行证显示名称', p?.label, { full: true, hint: '留空时由干员名称和款式自动组合。' }) +
            field('en', '英文名', p?.en) + field('faction', '阵营', p?.faction) +
            field('class', '职业', p?.class) +
            `<label class="admin-field"><span>星级</span><select name="rarity"><option value="">未知 / 未填写</option>${[1, 2, 3, 4, 5, 6].map(n => `<option value="${n}" ${p?.rarity === n ? 'selected' : ''}>${n} 星</option>`).join('')}</select></label>` +
            field('py', '拼音', p?.py) + field('pyi', '拼音首字母', p?.pyi) +
            (isBox(target.series) ? '<p class="admin-form-context">本系列按整盒官方价计算，无需填写单张参考价。</p>' : field('official_unit_price', '单张官方参考价（元）', p?.official_unit_price ?? '', { type: 'number', required: true, attrs: 'min="0" max="3250000" step="0.01" inputmode="decimal"' })) +
            field('avatar', '通行证图片地址', p?.avatar, { full: true, hint: '填写站内 /assets/images/ 路径或 HTTPS 图片地址。', attrs: 'maxlength="1500"' });
    }
    const editing = target.entity === 'series' ? !!target.series : !!target.pass;
    return `<form id="admin-form"><header class="admin-editor-head"><div><span class="admin-kicker">CATALOG / ${editing ? 'EDIT RECORD' : 'NEW RECORD'}</span><h2 id="editor-title">${editing ? '编辑' : '新增'}${target.entity === 'series' ? '系列' : '通行证'}</h2></div><button type="button" class="admin-close" aria-label="关闭编辑">×</button></header><div class="admin-form-fields">${fields}</div><div id="admin-form-error" class="admin-form-error" role="alert"></div><button type="button" id="admin-conflict-reload" class="admin-button" hidden>重新加载最新记录并核对</button><footer class="admin-editor-foot"><span>保存后会更新公开目录。</span><div><button type="button" class="admin-button admin-cancel">取消</button><button type="submit" class="admin-button admin-primary">保存并更新 ↗</button></div></footer></form>`;
}

export function formOperation(target: EditorTarget, values: FormData): CatalogOperation {
    const data: Record<string, unknown> = Object.fromEntries(values);
    if (target.entity === 'series') {
        for (const field of ['barcodes', 'replicate_dates'])
            data[field] = String(data[field] ?? '').split(/[,，;；\s]+/).map(x => x.trim()).filter(Boolean);
        return { entity: 'series', ...(target.series ? { id: target.series.id } : {}), data };
    }
    data.rarity = data.rarity ? Number(data.rarity) : null;
    data.official_unit_price = isBox(target.series) ? null : data.official_unit_price;
    return { entity: 'pass', series_id: target.series.id, ...(target.pass ? { id: target.pass.id } : {}), data };
}
