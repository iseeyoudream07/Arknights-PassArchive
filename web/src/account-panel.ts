/*
 * 生成设置页的账号同步面板；仅返回 HTML，按钮事件在 main.ts 绑定。
 */
import type { AccountSync } from './account-sync.ts';
import type { Catalog, RecordEntry } from './types.ts';
/**
 * 转义用户可变文本，避免插入面板 HTML 时被解释为标签。
 */
const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
/**
 * 同步状态到中文短标签的映射；状态本身由 AccountSync 管理。
 */
export const syncLabels = { guest: '本地收藏', syncing: '同步中', synced: '已同步', pending: '待同步', offline: '等待联网', conflict: '记录待确认', 'sign-in': '请重新登录', error: '同步未完成' };
/**
 * 把冲突项转换成可阅读摘要，用于让用户比较本机与云端版本。
 */
function version(value: unknown) {
    if (value === undefined)
        return '已删除';
    const r = record(value);
    if (!r) return '未识别的记录，可展开查看完整内容';
    return `${r.owned ? '已拥有' : '未拥有'} · ${r.market ? `市价 ¥${r.market}` : '市价未填写'} · ${r.lots.reduce((sum, lot) => sum + lot.qty, 0)} 张 / ${r.lots.length} 笔购买记录`;
}

function record(value: unknown): RecordEntry | null {
    if (!value || typeof value !== 'object') return null;
    const r = value as RecordEntry;
    if (typeof r.owned !== 'boolean' || !(r.market === null || typeof r.market === 'string') || !Array.isArray(r.lots) ||
        !r.lots.every(lot => lot && typeof lot.cost === 'string' && Number.isInteger(lot.qty))) return null;
    return r;
}
function fullVersion(value: unknown): string {
    if (value === undefined) return '已删除';
    const r = record(value);
    if (!r) return JSON.stringify(value, null, 2);
    return [`拥有状态：${r.owned ? '已拥有' : '未拥有'}`, `单张参考市价：${r.market === null ? '未填写' : `¥${r.market}`}`,
        ...r.lots.map((lot, index) => `第 ${index + 1} 笔：单价 ¥${lot.cost} × ${lot.qty} 张`)].join('\n');
}
/**
 * 根据账号状态生成面板；包含同步时间、访客导入入口和冲突选择信息。
 */
export function accountPanelMarkup(account: AccountSync, catalog: Catalog) {
    const header = '<div class="panel-heading"><h2>账号与同步</h2><span class="mono">PERSONAL ARCHIVE</span></div>';
    if (!account.user)
        return header + `<p>登录后，收藏、市价、购买记录和关注系列可在不同设备间同步。未登录时，收藏保存在当前浏览器。</p><a href="/login.html" class="primary account-link">登录 / 创建账号 ↗</a>${account.message.startsWith('已退出登录。退出期间') ? `<p role="status">${esc(account.message)}</p>` : ''}`;
    const guestCount = Object.values(account.guest.collection).filter(r => r.owned).length;
    const names = new Map(catalog.series.flatMap(s => s.passes.map(p => [p.id, `${p.label} · ${s.name}`] as const)));
    const date = account.syncedAt ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(account.syncedAt)) : '尚未同步';
    return header + `<div class="account-heading"><strong>${esc(account.user.username)}</strong><span class="sync-chip" data-status="${account.status}">${syncLabels[account.status]}</span></div><p class="account-sync-message" role="status">${esc(account.status === 'synced' ? '收藏已与云端同步。' : account.message)}</p><dl><dt>上次同步</dt><dd>${esc(date)}</dd><dt>关注系列</dt><dd>${account.backup.followed_series?.length ?? 0} 个</dd></dl><div class="button-row"><button id="account-sync-now" class="primary" ${account.status === 'syncing' ? 'disabled' : ''}>立即同步 ↗</button><a href="/login.html" class="secondary account-link">管理账号</a>${account.canManageCatalog ? '<a href="/admin.html" class="secondary account-link">通行证管理 ↗</a>' : ''}<button id="account-signout" class="text-button">退出登录</button></div>${guestCount || account.guest.followed_series?.length ? `<div class="guest-transfer"><p>未登录时的收藏还有 ${guestCount} 款通行认证、${account.guest.followed_series?.length ?? 0} 个关注系列，可选择合并到当前账号。</p><button id="account-import-guest" class="secondary">合并未登录时的收藏 ↗</button></div>` : ''}${account.conflicts.length ? `<div class="sync-conflicts"><h3>选择要保留的记录</h3><p>这些记录在此设备和云端都有修改，请比较后选择保留的版本。其他记录会自动合并。</p><div class="sync-conflict-list">${account.conflicts.map(c => {
        const title = c.section === 'collection' ? names.get(c.id) ?? c.id : `未识别记录：${c.id}`;
        return `<article><strong>${esc(title)}</strong><p>此设备：${esc(version(c.local))}<br>云端：${esc(version(c.cloud))}</p><details><summary>查看完整记录</summary><pre>此设备\n${esc(fullVersion(c.local))}\n\n云端\n${esc(fullVersion(c.cloud))}</pre></details></article>`;
    }).join('')}</div><div class="button-row"><button id="account-keep-local" class="secondary">这 ${account.conflicts.length} 条全部保留此设备的版本</button><button id="account-keep-cloud" class="secondary">这 ${account.conflicts.length} 条全部保留云端版本</button></div></div>` : ''}`;
}
