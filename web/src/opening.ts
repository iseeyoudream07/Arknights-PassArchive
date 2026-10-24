/*
 * 独立二维开屏控制器：驱动上游 BootSequence、跳过操作、缩放与焦点恢复。
 * 当前整站三维入口使用 RhineTerminal；这里保留独立开屏实现与回归测试。
 */
import './opening.css';
import { BootSequence } from './vendor/rhine/boot.ts';
import { brandHeading, logo } from './vendor/rhine/brand.ts';
// 参考视频片段为 6.76–26.92 秒；底层渲染器内部会再加 5 秒偏移。
const START = 1.76;
const END = 21.92;
const PREFERENCE = 'pass-archive-opening';
/**
 * 独立二维开屏的生命周期控制器；管理动画帧、按键、可见性和焦点。
 */
export class Opening {
    private root: HTMLDivElement;
    private stage: HTMLDivElement;
    private renderer: BootSequence;
    private skip: HTMLButtonElement;
    private reduced = matchMedia('(prefers-reduced-motion: reduce)');
    private raf = 0;
    private closeTimer = 0;
    private elapsed = 0;
    private lastTime = 0;
    private active = false;
    private returnFocus: HTMLElement | null = null;
    private freezeFrame: number | null = null;
    /**
     * 创建开屏 DOM 与渲染器，绑定窗口尺寸、可见性和跳过交互。
     */
    constructor(private app: HTMLElement) {
        this.root = document.createElement('div');
        this.root.id = 'opening-root';
        this.root.hidden = true;
        this.root.tabIndex = -1;
        this.root.setAttribute('role', 'dialog');
        this.root.setAttribute('aria-modal', 'true');
        this.root.setAttribute('aria-labelledby', 'opening-title');
        this.root.innerHTML = `
      <h2 id="opening-title" class="opening-sr-only">莱茵生命参考开场</h2>
      <div id="opening-stage" data-mode="boot" data-layout="opening" aria-hidden="true">
        <div id="boot-background" class="boot-background">
          <svg viewBox="0 0 1920 1080" preserveAspectRatio="none"><g fill="none" stroke="#fff" stroke-width="3">
            <path d="M-210 705C-45 705 182 704 247 567C337 377 99 306 4 435S27 680 169 631C309 584 227 314 279 111S568-113 568-113"/>
            <path d="M1560-80C1374 114 1671 168 1601 323S1371 367 1431 480S1692 666 1559 787S1329 886 1498 1130"/>
            <circle cx="1450" cy="648" r="346"/><circle cx="1450" cy="648" r="348"/>
          </g></svg><div class="boot-white"></div>
        </div>
        <header class="brand">${brandHeading}</header>
        <section class="boot">
          <div class="access-text">ACCESS</div>
          <div class="boot-logo">${logo}</div>
          <div class="auth-status"><span>▪</span><span id="auth-message"></span><i></i></div>
          <div class="scan"><svg viewBox="0 0 1920 1080">
            <g fill="none" stroke="#080a08" stroke-width="2" stroke-linecap="round">
              <path/><path stroke="#fff"/><path/><path/><path/><path/>
              <circle class="orbit-dot" r="8" fill="#ed821b" stroke="none"/>
              <circle class="orbit-dot" r="8" fill="#ed821b" stroke="none"/>
              <circle class="scan-core" cx="960" cy="540" r="5" fill="#080a08" stroke="none"/>
            </g></svg><span>PERMISSION AUTHORIZED</span>
          </div>
          <div class="welcome">
            <div class="welcome-panel"></div><div class="welcome-heading">WELCOME TO</div>
            <div class="welcome-company"><strong>RHINE LAB.LLC.</strong><strong class="welcome-highlight">RHINE LAB.LLC.</strong></div>
            <div class="welcome-database">INTERNAL DATABASE</div><div class="welcome-logo">${logo}</div>
          </div>
        </section>
        <div class="powered">POWERED BY <b>RHINE LAB</b><i></i></div>
      </div>
      <button id="opening-skip" type="button"><span>跳过开屏</span><span aria-hidden="true">↗</span></button>
      <div class="opening-caption"><span id="opening-status" role="status">正在准备通行认证档案…</span></div>`;
        document.body.appendChild(this.root);
        this.stage = this.root.querySelector<HTMLDivElement>('#opening-stage')!;
        this.skip = this.root.querySelector<HTMLButtonElement>('#opening-skip')!;
        // 重播复用同一个渲染器，固定台词图形只创建一次。
        this.renderer = new BootSequence(this.stage);
        this.skip.onclick = () => this.close();
        this.reduced.addEventListener('change', () => {
            if (this.reduced.matches)
                this.close(true);
        });
        if (import.meta.env.DEV) {
            const frame = new URLSearchParams(location.search).get('opening-frame');
            if (frame && /^\d+$/.test(frame) && Number(frame) >= 169 && Number(frame) <= 673)
                this.freezeFrame = Number(frame);
        }
    }
    /**
     * 读取开屏偏好；存储不可读时使用默认开启状态。
     */
    get enabled() {
        try {
            return localStorage.getItem(PREFERENCE) !== 'off';
        }
        catch {
            return true;
        }
    }
    /**
     * 跟随系统减少动态效果设置。
     */
    get reducedMotion() {
        return this.reduced.matches;
    }
    /**
     * 保存开屏偏好；浏览器限制存储时返回失败。
     */
    setEnabled(enabled: boolean) {
        try {
            localStorage.setItem(PREFERENCE, enabled ? 'on' : 'off');
            return true;
        }
        catch {
            return false;
        }
    }
    /**
     * 更新开屏状态提示，告知用户业务目录已就绪。
     */
    ready() {
        this.root.querySelector('#opening-status')!.textContent = '通行认证档案已就绪';
    }
    /**
     * 检查偏好后启动或重播开屏，记录原焦点并开始逐帧驱动。
     */
    start(replay = false) {
        if (this.active || this.closeTimer || this.reduced.matches || (!replay && !this.enabled))
            return;
        this.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        this.active = true;
        this.elapsed = 0;
        this.lastTime = 0;
        this.root.classList.remove('opening-leaving');
        this.root.hidden = false;
        this.app.inert = true;
        document.body.classList.add('opening-active');
        document.body.classList.remove('opening-reveal');
        this.layout();
        this.renderer.update(this.freezeFrame === null ? START : this.freezeFrame / 25 - 5 + 0.000001);
        this.root.focus({ preventScroll: true });
        window.addEventListener('resize', this.layout);
        document.addEventListener('visibilitychange', this.visibility);
        document.addEventListener('keydown', this.keyboard, true);
        if (this.freezeFrame === null)
            this.raf = requestAnimationFrame(this.tick);
    }
    /**
     * 初始化失败时立即终止开屏。
     */
    abort() {
        this.close(true);
    }
    /**
     * 按窗口尺寸计算参考画布缩放与定位，保持开屏比例。
     */
    private layout = () => {
        const width = this.root.clientWidth, height = this.root.clientHeight;
        const scale = Math.min(height / 1080, width / 1280);
        this.stage.style.width = `${width / scale}px`;
        this.stage.style.height = `${height / scale}px`;
        this.stage.style.transform = `translate(-50%, -50%) scale(${scale})`;
        this.stage.style.setProperty('--opening-scan-scale', String(Math.min(1, width / scale / 1920)));
        this.stage.dataset.openingPortrait = String(width < height);
    };
    /**
     * 页面隐藏时暂停计时，避免切回时跳过未播放的片段。
     */
    private visibility = () => {
        cancelAnimationFrame(this.raf);
        this.lastTime = 0;
        if (!document.hidden && this.active && this.freezeFrame === null)
            this.raf = requestAnimationFrame(this.tick);
    };
    /**
     * 以浏览器帧时间推进开屏；冻结帧入口用于本机视觉检查。
     */
    private tick = (now: number) => {
        if (!this.active || document.hidden)
            return;
        if (this.lastTime)
            this.elapsed += Math.max(0, now - this.lastTime) / 1000;
        this.lastTime = now;
        this.renderer.update(Math.min(END, START + this.elapsed));
        if (START + this.elapsed >= END)
            this.close();
        else
            this.raf = requestAnimationFrame(this.tick);
    };
    /**
     * 处理跳过和键盘焦点，避免焦点逃到被遮挡的业务页面。
     */
    private keyboard = (event: KeyboardEvent) => {
        if (event.key === 'Escape' || event.key === 'Enter') {
            event.preventDefault();
            event.stopPropagation();
            this.close();
        }
        else if (event.key === 'Tab') {
            event.preventDefault();
            this.skip.focus({ preventScroll: true });
        }
    };
    /**
     * 停止帧循环并按需播放退出过渡，最终交给 finish 收尾。
     */
    private close(immediate = false) {
        if (!this.active) {
            if (immediate && this.closeTimer) {
                window.clearTimeout(this.closeTimer);
                this.finish();
            }
            return;
        }
        this.active = false;
        cancelAnimationFrame(this.raf);
        window.removeEventListener('resize', this.layout);
        document.removeEventListener('visibilitychange', this.visibility);
        document.removeEventListener('keydown', this.keyboard, true);
        this.root.classList.add('opening-leaving');
        if (!immediate && !this.reduced.matches)
            document.body.classList.add('opening-reveal');
        if (immediate || this.reduced.matches)
            this.finish();
        else
            this.closeTimer = window.setTimeout(() => this.finish(), 420);
    }
    /**
     * 恢复业务区域交互及原焦点，移除开屏占用状态。
     */
    private finish() {
        this.closeTimer = 0;
        this.root.hidden = true;
        this.renderer.reset();
        this.app.inert = false;
        document.body.classList.remove('opening-active');
        const target = this.returnFocus?.isConnected && this.returnFocus !== document.body
            ? this.returnFocus : this.app.querySelector<HTMLElement>('h1, button, a');
        if (target) {
            if (target.tagName === 'H1')
                target.tabIndex = -1;
            target.focus({ preventScroll: true });
        }
    }
}
