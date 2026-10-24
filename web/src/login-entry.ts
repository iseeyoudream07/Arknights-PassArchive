/*
 * 登录、注册和修改密码页面；复用账号 API，成功登录后进入设置页。
 * 密码只用于当前请求；排查请求时不要把表单密码写入日志。
 */
import './vendor/rhine-full/fonts.css';
import './login.css';
import { paintTheme } from './vendor/rhine-full/theme-ui.ts';
import { ContentTransition } from './vendor/rhine-full/ui-transitions.ts';
import { AccountApi, type AccountSession } from './account-api.ts';
import { loadAccountCache, finishAccountLogout } from './storage.ts';
import { sameBackup } from './sync-merge.ts';
import { newPasswordMessage, userMessage } from './account-messages.ts';
const api = new AccountApi(), content = document.querySelector<HTMLElement>('#auth-content')!;
const transition = new ContentTransition();
/**
 * 转义用户名等可变文本后再插入 HTML。
 */
const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
let animate = !matchMedia('(prefers-reduced-motion: reduce)').matches;
let mode: 'login' | 'register' = 'login', session: AccountSession | null = null, dark = matchMedia('(prefers-color-scheme: dark)').matches;
let busy = false;
function setBusy(value: boolean) {
    busy = value;
    content.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input, button').forEach(control => control.disabled = value);
}
function validate(form: HTMLFormElement, creating: boolean) {
    const values = new FormData(form);
    const username = String(values.get('username') ?? '').trim();
    if (form.elements.namedItem('username') && !/^[A-Za-z0-9_]{3,32}$/.test(username)) {
        error('用户名需要 3–32 个字符，只能使用英文字母、数字或下划线。');
        form.querySelector<HTMLInputElement>('[name="username"]')!.focus();
        return false;
    }
    const empty = [...form.querySelectorAll<HTMLInputElement>('input[required]')].find(input => !input.value);
    if (empty) {
        error(`请${empty.name === 'password_confirm' ? '再次输入密码' : empty.name === 'current_password' ? '输入当前密码' : '输入密码'}。`);
        empty.focus();
        return false;
    }
    if (creating) {
        const message = newPasswordMessage(String(values.get('password')), String(values.get('password_confirm')));
        if (message) {
            error(message);
            form.querySelector<HTMLInputElement>('[name="password"]')!.focus();
            return false;
        }
    }
    return true;
}
try {
    const theme = localStorage.getItem('pass-archive-theme');
    if (theme)
        dark = theme === 'dark';
    const prefs = JSON.parse(localStorage.getItem('pass-archive-rhine-settings') ?? 'null');
    if (typeof prefs?.motion?.surfaceTransitions === 'boolean')
        animate = prefs.motion.surfaceTransitions;
}
catch {
}
paintTheme(dark ? 1 : 0);
document.querySelector<HTMLButtonElement>('#auth-theme')!.onclick = () => {
    dark = !dark;
    paintTheme(dark ? 1 : 0);
    try {
        localStorage.setItem('pass-archive-theme', dark ? 'dark' : 'light');
    }
    catch {
    }
};
/**
 * 更新表单错误和终端状态提示。
 */
const error = (text: string, success = false) => {
    const notice = document.querySelector<HTMLElement>('#auth-error')!;
    notice.textContent = text;
    notice.classList.toggle('is-success', success);
    notice.setAttribute('role', success ? 'status' : 'alert');
    document.querySelector('#access-state')!.textContent = text ? success ? '已完成' : '请检查提示' : '就绪';
};
/**
 * 生成带标签、自动填充和格式约束的表单字段；最终规则仍以后端校验为准。
 */
function field(name: string, label: string, type = 'text', hint = '', autocomplete = name) {
    return `<div class="auth-field"><label for="auth-${name}">${label}</label><input id="auth-${name}" name="${name}" type="${type}" autocomplete="${autocomplete}" required maxlength="${name === 'username' ? 32 : 128}" ${hint ? `aria-describedby="auth-${name}-hint"` : ''} ${name === 'username' ? 'minlength="3" pattern="[A-Za-z0-9_]{3,32}" autocapitalize="none" spellcheck="false"' : type === 'password' && autocomplete === 'new-password' ? 'minlength="10"' : ''}>${hint ? `<small id="auth-${name}-hint">${hint}</small>` : ''}</div>`;
}
/**
 * 按动效偏好显示当前表单内容。
 */
function reveal() {
    transition.reveal(content, !animate);
}
/**
 * 根据已登录状态或登录/注册模式构建表单并绑定提交事件。
 */
function render() {
    if (session?.authenticated) {
        content.innerHTML = `<div class="auth-signed-in"><p>ACCOUNT / 已登录</p><h2>${esc(session.user!.username)}</h2><p>已登录此账号，可返回查看收藏和同步状态。</p><a class="auth-primary-link" href="/?view=settings">查看我的收藏<span>→</span></a>${session.user?.can_manage_catalog === true ? '<a class="auth-primary-link" href="/admin.html">通行证管理<span>↗</span></a>' : ''}<button class="auth-secondary" id="auth-password">修改密码 ↗</button><br><button class="auth-secondary" id="auth-logout">退出登录</button></div><p id="auth-error" class="auth-error" role="alert"></p>`;
        document.querySelector<HTMLButtonElement>('#auth-password')!.onclick = passwordForm;
        document.querySelector<HTMLButtonElement>('#auth-logout')!.onclick = () => void (async () => {
            if (busy) return;
            const owner = session!.user!;
            setBusy(true);
            try {
                const cached = await loadAccountCache(owner.id);
                if (cached && !sameBackup(cached.backup, cached.base))
                    throw new Error('还有修改未同步，请返回收藏页面完成同步后再退出。可先导出备份保存当前记录。');
                await api.request('/api/v1/auth/logout/', 'POST', { expected_user_id: owner.id });
                const cleared = await finishAccountLogout(owner.id);
                session = null;
                busy = false;
                render();
                if (!cleared) error('已退出登录。退出期间新增的记录已保存在此设备，重新登录原账号后可继续同步。', true);
            }
            catch (e) {
                error(userMessage(e, '退出未完成，请稍后重试。'));
                setBusy(false);
            }
        })();
    }
    else {
        content.innerHTML = `<div class="auth-tabs" role="tablist" aria-label="账号访问方式"><button role="tab" data-mode="login" aria-selected="${mode === 'login'}">登录</button><button role="tab" data-mode="register" aria-selected="${mode === 'register'}">创建账号</button></div><form id="auth-form" novalidate aria-label="${mode === 'register' ? '创建账号' : '登录账号'}">${field('username', '用户名', 'text', mode === 'register' ? '3–32 个英文字母、数字或下划线' : '', 'username')}${field('password', '密码', 'password', mode === 'register' ? '10–128 个字符，不能只用数字，也不要与用户名过于相似' : '', mode === 'register' ? 'new-password' : 'current-password')}${mode === 'register' ? field('password_confirm', '再次输入密码', 'password', '', 'new-password') : ''}<label class="auth-remember"><input name="remember" type="checkbox" checked> 14 天内保持登录</label><p id="auth-error" class="auth-error" role="alert"></p><button class="auth-submit" type="submit">${mode === 'register' ? '创建账号' : '登录'}<span>→</span></button></form>`;
        content.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(button => button.onclick = () => {
            if (busy) return;
            mode = button.dataset.mode as typeof mode;
            render();
        });
        document.querySelector<HTMLFormElement>('#auth-form')!.onsubmit = event => {
            event.preventDefault();
            if (busy || !validate(event.currentTarget as HTMLFormElement, mode === 'register')) return;
            void (async () => {
                const form = event.currentTarget as HTMLFormElement, values = new FormData(form), submittedMode = mode;
                setBusy(true);
                error('');
                document.querySelector('#access-state')!.textContent = '正在验证';
                try {
                    session = await api.request<AccountSession>(`/api/v1/auth/${submittedMode === 'register' ? 'register' : 'login'}/`, 'POST', { username: values.get('username'), password: values.get('password'), password_confirm: values.get('password_confirm'), remember: values.get('remember') === 'on' });
                    form.reset();
                    location.assign(session.user?.can_manage_catalog === true ? '/admin.html' : '/?view=settings');
                }
                catch (e) {
                    error(userMessage(e, '登录未完成，请稍后重试。'));
                    setBusy(false);
                }
            })();
        };
    }
    error('');
    reveal();
}
/**
 * 显示改密表单，提交时附带当前账号 ID，避免多标签页切号后改错账号。
 */
function passwordForm() {
    if (busy) return;
    content.innerHTML = `<div class="auth-password"><button id="auth-back" class="auth-secondary">← 返回账号页面</button><h2>修改密码</h2><form id="password-form" novalidate>${field('current_password', '当前密码', 'password', '', 'current-password')}${field('password', '新密码', 'password', '10–128 个字符，不能只用数字', 'new-password')}${field('password_confirm', '再次输入新密码', 'password', '', 'new-password')}<p id="auth-error" class="auth-error" role="alert"></p><button type="submit" class="auth-submit">保存新密码<span>→</span></button></form></div>`;
    document.querySelector<HTMLButtonElement>('#auth-back')!.onclick = render;
    document.querySelector<HTMLFormElement>('#password-form')!.onsubmit = event => {
        event.preventDefault();
        if (busy || !validate(event.currentTarget as HTMLFormElement, true)) return;
        void (async () => {
            const form = event.currentTarget as HTMLFormElement, values = new FormData(form);
            setBusy(true);
            error('');
            document.querySelector('#access-state')!.textContent = '正在保存';
            try {
                await api.request('/api/v1/auth/password/', 'POST', { ...Object.fromEntries(values), expected_user_id: session!.user!.id });
                form.reset();
                busy = false;
                render();
                error('密码已更新，其他设备需要重新登录。', true);
            }
            catch (e) {
                error(userMessage(e, '密码未能更新，请稍后重试。'));
                setBusy(false);
            }
        })();
    };
    error('');
    reveal();
}
render();
void api.session().then(value => {
    if (busy) return;
    session = value;
    if (value.authenticated)
        render();
}).catch(e => error(userMessage(e, '暂时无法连接账号服务，请稍后重试。')));
