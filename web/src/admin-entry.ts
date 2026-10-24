/** Web 专用目录后台：核验会话 → 加载目录 → 编辑 → 带版本保存。
 * 管理内容仅在服务端确认 root 权限后挂载；离线不恢复后台快照。
 */
import './vendor/rhine-full/fonts.css';
import './admin.css';
import { paintTheme } from './vendor/rhine-full/theme-ui.ts';
import { AccountApi, ApiError, type AccountUser } from './account-api.ts';
import { categoryNames, editorMarkup, esc, formOperation, matchingPasses, passRows, type AdminSnapshot, type EditorTarget } from './admin-ui.ts';

const root = document.querySelector<HTMLElement>('#admin-root')!;
const editor = document.querySelector<HTMLDialogElement>('#admin-editor')!;
const api = new AccountApi();
let user: AccountUser | null = null;
let snapshot: AdminSnapshot | null = null;
let selected = '', query = '', category = '', offset = 0;
let busy = false, dirty = false, denied = false, verifying = false;
let toastTimer = 0;
const pageSize = 40;
let dark = matchMedia('(prefers-color-scheme: dark)').matches;
try { dark = (localStorage.getItem('pass-archive-theme') ?? (dark ? 'dark' : 'light')) === 'dark'; } catch { /* 主题仍可在本页切换。 */ }
function theme() { paintTheme(dark ? 1 : 0); document.documentElement.style.colorScheme = dark ? 'dark' : 'light'; }
theme();

function toast(message: string) {
    const node = document.querySelector<HTMLElement>('#admin-toast')!;
    node.textContent = message;
    node.classList.add('visible');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => node.classList.remove('visible'), 4500);
}

function gate(message: string, signIn = false) {
    denied = true;
    user = null;
    snapshot = null;
    dirty = false;
    if (editor.open) editor.close();
    editor.innerHTML = '';
    root.hidden = false;
    root.innerHTML = `<div class="admin-gate"><span class="admin-kicker">PASS ARCHIVE / ACCESS CONTROL</span><h1>${signIn ? '请先登录管理员账号' : '暂时无法进入管理页面'}</h1><p role="alert">${esc(message)}</p><div><a class="admin-button admin-primary" href="/login.html?next=admin">${signIn ? '前往登录' : '管理账号'} ↗</a><a class="admin-button" href="/?view=catalog">返回通行认证</a><button class="admin-button" id="admin-retry">重新验证</button></div></div>`;
    document.querySelector<HTMLButtonElement>('#admin-retry')!.onclick = () => void boot();
}

/** 服务端权限标志与真实管理 API 均必须通过；切号、退出和撤权会立即收起内容。 */
async function verify() {
    const session = await api.session();
    if (!session.authenticated) { gate('登录后才能管理目录。', true); return false; }
    if (session.user?.can_manage_catalog !== true) { gate('当前账号没有通行证管理权限。请使用 root 管理员账号登录。'); return false; }
    if (user && user.id !== session.user.id) { gate('当前登录账号已变化，请重新验证后继续。'); return false; }
    user = session.user;
    return true;
}

async function readCatalog() {
    const result = await api.request<AdminSnapshot>('/api/v1/admin/catalog/');
    if (!result.catalog || !Array.isArray(result.catalog.series) || !Number.isInteger(result.revision))
        throw new Error('目录返回格式不正确，请稍后重试。');
    snapshot = result;
    if (selected && !result.catalog.series.some(s => s.id === selected)) selected = '';
}

function shell() {
    const { catalog, revision } = snapshot!;
    root.hidden = false;
    root.innerHTML = `<div class="admin-shell"><header class="admin-header"><a class="admin-brand" href="/?view=catalog"><span class="admin-brand-mark" aria-hidden="true">◉</span><span>PASS ARCHIVE<small>通行认证档案</small></span></a><div class="admin-header-links"><a href="/?view=settings">返回我的档案 ↗</a><a class="admin-user" href="/login.html">${esc(user!.username)} <span>管理员</span></a><button id="admin-theme" aria-label="切换深浅主题">◐</button></div></header><main class="admin-main"><section class="admin-intro"><div><div class="admin-kicker"><i></i>05 / CATALOG MANAGEMENT</div><h1>通行证管理<span>Catalog desk.</span></h1><p>维护每一份通行认证的资料。</p></div><div class="admin-access-stamp"><span>ACCESS GRANTED</span><strong>ROOT<span> / 01</span></strong><small>目录编辑权限已验证</small></div></section><section class="admin-overview" aria-label="目录概览"><div><span>收录系列</span><strong>${catalog.counts.series}<small> SERIES</small></strong></div><div><span>通行证款式</span><strong>${catalog.counts.passes.toLocaleString()}<small> RECORDS</small></strong></div><div><span>收录干员</span><strong>${catalog.counts.operators}<small> OPERATORS</small></strong></div><div class="admin-revision"><span>目录版本</span><strong>R${String(revision).padStart(3, '0')}</strong><small>保存后同步至公开目录</small></div></section><section class="admin-workspace"><aside class="admin-series-panel"><div class="admin-panel-title"><h2>系列索引</h2><button id="admin-new-series" aria-label="新增系列">＋</button></div><label class="admin-series-search"><span class="sr-only">筛选系列</span><input id="admin-series-search" placeholder="查找系列、盒号" type="search"></label><div id="admin-series-list"></div></aside><section class="admin-records" aria-label="通行证目录"><div class="admin-records-heading"><div><span class="admin-kicker">RECORD INDEX</span><h2 id="admin-current-title"></h2><p id="admin-series-meta"></p></div><div class="admin-actions"><button class="admin-button" id="admin-edit-series" hidden>编辑系列</button><button class="admin-button admin-primary" id="admin-new-pass">新增通行证 ＋</button></div></div><div class="admin-toolbar"><label class="admin-search"><span aria-hidden="true">⌕</span><input id="admin-search" type="search" aria-label="搜索通行证" placeholder="搜索干员、款式、拼音或条码" value="${esc(query)}"></label><select id="admin-category" aria-label="按系列分类"><option value="">全部分类</option>${Object.entries(categoryNames).map(([k, v]) => `<option value="${k}" ${category === k ? 'selected' : ''}>${v}</option>`).join('')}</select><button class="admin-refresh" id="admin-refresh" aria-label="重新加载目录">↻ <span>刷新</span></button></div><div class="admin-table-scroll"><table class="admin-table"><thead><tr><th scope="col">通行证 / 干员</th><th scope="col">所属系列</th><th scope="col">官方参考价</th><th scope="col"><span class="sr-only">操作</span></th></tr></thead><tbody id="admin-rows"></tbody></table><div id="admin-empty" class="admin-empty" hidden></div></div><div class="admin-pagination"><span id="admin-result-count" role="status"></span><div><button id="admin-prev" aria-label="上一页">←</button><span id="admin-page-number"></span><button id="admin-next" aria-label="下一页">→</button></div></div></section></section></main><footer class="admin-footer"><span>PASS ARCHIVE / CATALOG DESK</span><a href="/credits.html">来源与许可 ↗</a><span>COLLECTION · RECORD · PRESERVE</span></footer></div>`;
    document.querySelector<HTMLButtonElement>('#admin-theme')!.onclick = () => { dark = !dark; theme(); try { localStorage.setItem('pass-archive-theme', dark ? 'dark' : 'light'); } catch { /* 本次主题不依赖本地存储。 */ } };
    document.querySelector<HTMLInputElement>('#admin-search')!.oninput = event => { query = (event.target as HTMLInputElement).value; offset = 0; results(); };
    document.querySelector<HTMLSelectElement>('#admin-category')!.onchange = event => { category = (event.target as HTMLSelectElement).value; offset = 0; results(); };
    document.querySelector<HTMLInputElement>('#admin-series-search')!.oninput = seriesList;
    document.querySelector<HTMLButtonElement>('#admin-prev')!.onclick = () => { offset = Math.max(0, offset - pageSize); results(); };
    document.querySelector<HTMLButtonElement>('#admin-next')!.onclick = () => { offset += pageSize; results(); };
    document.querySelector<HTMLButtonElement>('#admin-new-series')!.onclick = () => openEditor({ entity: 'series' });
    document.querySelector<HTMLButtonElement>('#admin-edit-series')!.onclick = () => openEditor({ entity: 'series', series: catalog.series.find(s => s.id === selected)! });
    document.querySelector<HTMLButtonElement>('#admin-new-pass')!.onclick = () => {
        const s = catalog.series.find(s => s.id === selected);
        if (!s) { toast('请先在左侧选择所属系列，再新增通行证。'); document.querySelector<HTMLInputElement>('#admin-series-search')!.focus(); return; }
        openEditor({ entity: 'pass', series: s });
    };
    document.querySelector<HTMLButtonElement>('#admin-refresh')!.onclick = () => void refresh();
    document.querySelector('#admin-rows')!.addEventListener('click', event => {
        const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-edit-pass]');
        if (!button) return;
        const s = catalog.series.find(s => s.id === button.dataset.series)!;
        openEditor({ entity: 'pass', series: s, pass: s.passes.find(p => p.id === button.dataset.editPass)! });
    });
    seriesList();
    results();
}

function seriesList() {
    const search = document.querySelector<HTMLInputElement>('#admin-series-search')!.value.trim().toLowerCase();
    const list = snapshot!.catalog.series.filter(s => `${s.name} ${s.box_number ?? ''}`.toLowerCase().includes(search));
    document.querySelector('#admin-series-list')!.innerHTML = `<button class="admin-series-option" data-select="" aria-pressed="${!selected}"><span>全部通行证</span><small>${snapshot!.catalog.counts.passes}</small></button>${list.map(s => `<button class="admin-series-option" data-select="${esc(s.id)}" aria-pressed="${s.id === selected}"><span>${esc(s.name)}<small>${esc(categoryNames[s.type])}${s.year ? ` / ${esc(s.year)}` : ''}</small></span><b>${s.passes.length}</b></button>`).join('')}${!list.length ? '<p class="admin-no-series">没有匹配的系列</p>' : ''}`;
    document.querySelectorAll<HTMLButtonElement>('[data-select]').forEach(button => button.onclick = () => { selected = button.dataset.select!; category = ''; query = ''; offset = 0; document.querySelector<HTMLInputElement>('#admin-search')!.value = ''; document.querySelector<HTMLSelectElement>('#admin-category')!.value = ''; seriesList(); results(); });
}

function results() {
    const s = snapshot!.catalog.series.find(s => s.id === selected);
    document.querySelector('#admin-current-title')!.textContent = s?.name ?? '全部通行证';
    document.querySelector('#admin-series-meta')!.textContent = s ? `${s.release_date ?? '发售日期待补充'} · ${s.barcodes.length ? `条码 ${s.barcodes.join(' / ')}` : '条码待补充'}` : '选择系列查看资料，或搜索全部收录款式。';
    document.querySelector<HTMLButtonElement>('#admin-edit-series')!.hidden = !s;
    const matches = matchingPasses(snapshot!.catalog, selected, query, category);
    offset = Math.min(offset, Math.max(0, Math.ceil(matches.length / pageSize) - 1) * pageSize);
    document.querySelector('#admin-rows')!.innerHTML = passRows(matches.slice(offset, offset + pageSize));
    const empty = document.querySelector<HTMLElement>('#admin-empty')!;
    empty.hidden = matches.length !== 0;
    empty.innerHTML = `<strong>${s && !s.passes.length ? '这个系列还没有通行证' : '没有找到匹配的通行证'}</strong><p>${s && !s.passes.length ? '点击“新增通行证”，补充第一份资料。' : '试试其他关键词，或切换系列与分类。'}</p>`;
    document.querySelector('#admin-result-count')!.textContent = matches.length ? `共 ${matches.length} 款 · 显示 ${offset + 1}–${Math.min(offset + pageSize, matches.length)}` : '共 0 款';
    document.querySelector('#admin-page-number')!.textContent = `${Math.floor(offset / pageSize) + 1} / ${Math.max(1, Math.ceil(matches.length / pageSize))}`;
    document.querySelector<HTMLButtonElement>('#admin-prev')!.disabled = offset === 0;
    document.querySelector<HTMLButtonElement>('#admin-next')!.disabled = offset + pageSize >= matches.length;
}

async function refresh() {
    if (busy) return;
    busy = true;
    try { if (await verify()) { await readCatalog(); shell(); toast('目录已更新。'); } }
    catch (error) { handle(error); }
    finally { busy = false; }
}

function handle(error: unknown) {
    if (error instanceof ApiError && (error.status === 401 || error.status === 403 && error.data.code === 'admin_required' || error.data.code === 'account_changed')) {
        gate(error.message, error.status === 401);
    } else toast(error instanceof ApiError && error.status === 0 ? '网络暂不可用，请联网后重试。' : error instanceof Error ? error.message : '暂时无法完成操作。');
}

function closeEditor() {
    if (busy || dirty && !confirm('尚有未保存的修改，确定放弃并关闭吗？')) return;
    dirty = false;
    editor.close();
}

function openEditor(target: EditorTarget) {
    if (busy || denied) return;
    editor.innerHTML = editorMarkup(target);
    dirty = false;
    const form = editor.querySelector<HTMLFormElement>('form')!;
    form.oninput = () => { dirty = true; };
    editor.querySelectorAll<HTMLButtonElement>('.admin-close,.admin-cancel').forEach(b => b.onclick = closeEditor);
    const observedRevision = snapshot!.revision;
    form.onsubmit = event => {
        event.preventDefault();
        if (busy || !form.reportValidity()) return;
        void (async () => {
            const operation = formOperation(target, new FormData(form));
            busy = true;
            form.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>('input,button,select').forEach(x => x.disabled = true);
            const errorNode = editor.querySelector<HTMLElement>('#admin-form-error')!;
            errorNode.textContent = '';
            let conflict = false;
            try {
                const value = await api.request<AdminSnapshot & { saved: { series_id: string }[] }>('/api/v1/admin/catalog/', 'POST', { expected_user_id: user!.id, base_revision: observedRevision, operations: [operation] });
                snapshot = value;
                selected = value.saved[0].series_id;
                offset = 0;
                dirty = false;
                editor.close();
                shell();
                toast('已保存，公开目录已更新。');
            } catch (error) {
                if (error instanceof ApiError && (error.status === 401 || error.data.code === 'admin_required' || error.data.code === 'account_changed')) handle(error);
                else {
                    errorNode.textContent = error instanceof ApiError && error.status === 0 ? '网络暂不可用，填写内容已保留。请联网后重试。' : error instanceof Error ? error.message : '保存失败，请稍后重试。';
                    if (error instanceof ApiError && error.data.errors && typeof error.data.errors === 'object') {
                        const names = new Map([...form.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[name]')].map(n => [n.name, n]));
                        for (const [key, value] of Object.entries(error.data.errors)) {
                            errorNode.textContent += ` ${Array.isArray(value) ? value.join(' ') : String(value)}`;
                            const field = names.get(key);
                            field?.setAttribute('aria-invalid', 'true');
                            field?.addEventListener('input', () => field.removeAttribute('aria-invalid'), { once: true });
                        }
                    }
                    conflict = error instanceof ApiError && error.data.code === 'catalog_conflict';
                    const reload = editor.querySelector<HTMLButtonElement>('#admin-conflict-reload')!;
                    reload.hidden = !conflict;
                    reload.onclick = () => {
                        if (!confirm('将加载最新记录并放弃当前未保存的填写内容。请先复制需要保留的内容。继续吗？')) return;
                        dirty = false;
                        editor.close();
                        void refresh();
                    };
                }
            } finally {
                busy = false;
                form.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>('input,button,select').forEach(x => x.disabled = false);
                if (conflict) form.querySelector<HTMLButtonElement>('[type=submit]')!.disabled = true;
            }
        })();
    };
    editor.showModal();
}

editor.addEventListener('cancel', event => { event.preventDefault(); closeEditor(); });
window.addEventListener('beforeunload', event => { if (dirty) event.preventDefault(); });
// 防止浏览器历史快照直接恢复已退出账号的管理界面。
window.addEventListener('pagehide', () => { root.hidden = true; if (editor.open) editor.close(); });
async function recheck() {
    if (verifying || document.hidden) return;
    verifying = true;
    try { if (await verify()) { if (denied || !snapshot) await boot(); else root.hidden = false; } }
    catch { if (root.hidden) gate('暂时无法验证登录状态，请联网后重新验证。'); }
    finally { verifying = false; }
}
window.addEventListener('pageshow', event => { if (event.persisted) void recheck(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) void recheck(); });
window.setInterval(() => { if (!denied) void recheck(); }, 30000);
async function boot() {
    try {
        if (!await verify()) return;
        await readCatalog();
        denied = false;
        shell();
    } catch (error) { gate(error instanceof ApiError && error.status === 0 ? '网络暂不可用，管理页面需要联网验证。' : error instanceof Error ? error.message : '请稍后重试。'); }
}
void boot();
