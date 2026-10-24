/*
 * 二维页面与三维 iframe 的宿主桥接，负责显示、暂停、主题和账号状态传递。
 * 所有消息同时验证 origin、来源窗口和 channel；业务收藏仍由主页面负责保存。
 */
import './rhine-host.css';
import type { Catalog } from './types.ts';
import { SurfaceTransition } from './vendor/rhine-full/ui-transitions.ts';
import type { MotionPreferences } from './vendor/rhine-full/motion-preferences.ts';
/**
 * 宿主控制器：首次进入时挂载 iframe，之后通过消息恢复，不反复创建三维场景。
 */
export class RhineTerminal {
    private root = document.createElement('section');
    private frame = document.createElement('iframe');
    private surface: SurfaceTransition;
    private catalog?: Catalog;
    private mounted = false;
    private shown = false;
    private failed = false;
    private pendingReplay = false;
    private resumeFrame = 0;
    private authenticated = false;
    private username: string | null = null;
    private followed: string[] = [];
    private reduced = matchMedia('(prefers-reduced-motion: reduce)');
    private motion?: MotionPreferences;
    onBusiness: (page: string, seriesId?: string) => void = () => {
    };
    onFailure: (message: string) => void = () => {
    };
    onPreferences: (motion: MotionPreferences) => void = () => {
    };
    onFollowed: (ids: string[]) => void = () => {
    };
    /**
     * 建立终端容器与 iframe，并监听来自该子窗口的消息。
     */
    constructor(private app: HTMLElement) {
        this.root.id = 'rhine-terminal';
        this.root.hidden = true;
        this.root.setAttribute('aria-label', '通行认证三维终端');
        this.frame.title = '通行认证档案三维终端';
        this.frame.allow = 'fullscreen';
        this.root.append(this.frame);
        document.body.append(this.root);
        this.surface = new SurfaceTransition(this.root, undefined, 300, 200);
        window.addEventListener('message', this.receive);
    }
    /**
     * 读取是否自动播放开屏的本机偏好。
     */
    get enabled() {
        try {
            return localStorage.getItem('pass-archive-opening') !== 'off';
        }
        catch {
            return true;
        }
    }
    /**
     * 优先使用终端动效设置，缺省时遵从系统减少动态效果。
     */
    get reducedMotion() {
        if (this.motion)
            return Object.values(this.motion).every(value => !value);
        try {
            const stored = JSON.parse(localStorage.getItem('pass-archive-rhine-settings') ?? 'null');
            if (stored?.motion && Object.values(stored.motion).every(value => typeof value === 'boolean'))
                return Object.values(stored.motion).every(value => !value);
        }
        catch {
        }
        return this.reduced.matches;
    }
    /**
     * 对外暴露当前终端是否处于显示状态。
     */
    get visible() {
        return this.shown;
    }
    /**
     * 保存开屏偏好，返回是否成功持久化。
     */
    setEnabled(value: boolean) {
        try {
            localStorage.setItem('pass-archive-opening', value ? 'on' : 'off');
            return true;
        }
        catch {
            return false;
        }
    }
    /**
     * 显示三维终端；目录尚未加载时先记录意图，ready 后再继续。
     * 恢复已有 iframe 前等待可见视口的一帧，避免镜头按隐藏时尺寸恢复。
     */
    start(replay = false) {
        if (this.failed)
            return;
        this.shown = true;
        this.pendingReplay ||= replay;
        if (!this.catalog)
            return;
        this.app.inert = true;
        document.body.classList.add('rhine-terminal-active');
        this.surface.show(!this.animate('surfaceTransitions'));
        if (!this.mounted)
            this.mount();
        else {
            cancelAnimationFrame(this.resumeFrame);
            // iframe 必须先恢复可见视口，再根据当前尺寸恢复镜头。
            this.resumeFrame = requestAnimationFrame(() => {
                if (!this.shown)
                    return;
                this.send('resume');
                if (replay)
                    this.send('replay');
            });
        }
        this.frame.focus();
    }
    /**
     * 接收业务目录，并继续此前等待中的终端显示请求。
     */
    ready(catalog: Catalog) {
        this.catalog = catalog;
        if (this.shown)
            this.start(this.pendingReplay);
    }
    /**
     * 标记三维终端不可用并关闭，交回二维业务页面。
     */
    abort() {
        this.failed = true;
        this.dismiss();
    }
    /**
     * 暂停子场景并播放退出过渡，恢复业务区域和标题焦点。
     */
    dismiss(after: () => void = () => {
    }) {
        this.shown = false;
        cancelAnimationFrame(this.resumeFrame);
        this.send('pause');
        this.surface.hide(!this.animate('surfaceTransitions'), () => {
            this.app.inert = false;
            document.body.classList.remove('rhine-terminal-active');
            after();
            const heading = this.app.querySelector<HTMLElement>('h1');
            if (heading) {
                heading.tabIndex = -1;
                heading.focus({ preventScroll: true });
            }
        });
    }
    /**
     * 查询单项动效偏好，未收到设置时采用系统默认。
     */
    animate(key: keyof MotionPreferences) {
        return this.motion ? this.motion[key] : !this.reduced.matches;
    }
    /**
     * 把宿主当前深浅主题传给终端。
     */
    syncTheme() {
        this.send('theme', { theme: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light' });
    }
    /**
     * 仅在账号或关注系列变化时发送消息；不把会话或密码传入 iframe。
     */
    syncAccount(authenticated: boolean, followed: string[], username: string | null = null) {
        if (this.authenticated === authenticated && this.username === username && this.followed.length === followed.length && this.followed.every((id, index) => id === followed[index]))
            return;
        this.authenticated = authenticated;
        this.username = authenticated ? username : null;
        this.followed = [...followed];
        this.send('account', { authenticated, username: this.username, followed_series: followed });
    }
    /**
     * 请终端显示一条业务提示。
     */
    notify(message: string) {
        this.send('notice', { message });
    }
    /**
     * 首次加载终端并在 load 后发送初始化上下文；开发模式支持场景定位参数。
     */
    private mount() {
        this.mounted = true;
        this.frame.addEventListener('load', () => {
            this.send('initialize', { context: { catalog: this.catalog, playOpening: (this.enabled || this.pendingReplay) && !this.reducedMotion, theme: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light', authenticated: this.authenticated, username: this.username, followed_series: this.followed } });
            this.pendingReplay = false;
        });
        // 这些场景和时间参数只供开发模式定位画面，正常启动仍走完整初始化。
        const scene = import.meta.env.DEV ? new URLSearchParams(location.search).get('terminal-scene') : null;
        const time = import.meta.env.DEV ? new URLSearchParams(location.search).get('terminal-time') : null;
        this.frame.src = time !== null && Number.isFinite(Number(time)) && Number(time) >= 0 && Number(time) <= 27 ? `/terminal.html?time=${Number(time)}&review=1&freeze=1` : scene === 'archive' || scene === 'detail' ? `/terminal.html?scene=${scene}` : '/terminal.html';
    }
    /**
     * 向同源子窗口发送指定 channel 的消息。
     */
    private send(type: string, value: Record<string, unknown> = {}) {
        this.frame.contentWindow?.postMessage({ channel: 'pass-archive-terminal', type, ...value }, location.origin);
    }
    /**
     * 校验消息来源，再处理导航、关注、偏好和失败回退。
     * 系列 ID 与动效字段均需验证，不能直接信任 event.data。
     */
    private receive = (event: MessageEvent) => {
        if (event.origin !== location.origin || event.source !== this.frame.contentWindow || event.data?.channel !== 'pass-archive-terminal')
            return;
        const message = event.data;
        if (message.type === 'business') {
            if (!['catalog', 'collection', 'stats', 'settings', 'series', 'account'].includes(message.page))
                return;
            const id = typeof message.seriesId === 'string' && this.catalog?.series.some(series => series.id === message.seriesId) ? message.seriesId : undefined;
            if (message.page === 'series' && !id)
                return;
            this.onBusiness(message.page, id);
            this.dismiss();
        }
        else if (message.type === 'followed') {
            if (Array.isArray(message.ids) && message.ids.length <= 106 && message.ids.every((id: unknown) => typeof id === 'string' && this.catalog?.series.some(series => series.id === id)))
                this.onFollowed([...new Set<string>(message.ids)].sort());
        }
        else if (message.type === 'preferences') {
            if (message.theme === 'light' || message.theme === 'dark') {
                document.documentElement.dataset.theme = message.theme;
                try {
                    localStorage.setItem('pass-archive-theme', message.theme);
                }
                catch {
                }
            }
            if (message.motion && typeof message.motion === 'object') {
                const keys = ['boot', 'selectionWave', 'idleWave', 'pointerParallax', 'dragMomentum', 'selectionTransition', 'detailTransition', 'modelDecryption', 'documentReveal', 'rollingText', 'rollingNumbers', 'surfaceTransitions', 'viewerNavigation', 'viewerModelTransition'];
                if (keys.every(key => typeof message.motion[key] === 'boolean')) {
                    this.motion = { ...message.motion };
                    this.onPreferences(this.motion!);
                }
            }
        }
        else if (message.type === 'failure') {
            this.failed = true;
            this.dismiss(() => this.onFailure('三维页面暂时无法打开，已为你打开通行认证目录。'));
        }
    };
}
