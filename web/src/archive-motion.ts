/*
 * 二维页面的动效适配：内容显现、卡片入场、统计数字、弹窗和主题传播。
 * 通过 animate 回调读取用户偏好，动画关闭时仍完成最终界面状态。
 */
import '@kitlangton/rolling-number/styles.css';
import { createRollingNumber } from '@kitlangton/rolling-number';
import { ContentTransition, SurfaceTransition } from './vendor/rhine-full/ui-transitions.ts';
import { ThemeWave } from './vendor/rhine-full/theme-motion.ts';
import type { MotionPreferences } from './vendor/rhine-full/motion-preferences.ts';
/**
 * 读取某一动效偏好，统一决定是否播放动画。
 */
type AnimationCheck = (key: keyof MotionPreferences) => boolean;
/**
 * 复用终端动效工具管理二维页面效果，不负责收藏数据。
 */
export class ArchiveMotion {
    private content = new ContentTransition();
    private cards = new WeakSet<Element>();
    private previousNumbers = new Map<number, number>();
    private numbers = new WeakMap<Element, {
        number: ReturnType<typeof createRollingNumber>;
        value: number;
        decimals: number;
    }>();
    private wave = new ThemeWave();
    private themeRAF = 0;
    private palettes?: [
        Record<string, number[]>,
        Record<string, number[]>
    ];
    /**
     * 注入偏好读取函数，使设置变化后能即时生效。
     */
    constructor(private animate: AnimationCheck) {
    }
    /**
     * 显示新内容，并为新卡片和概览数字安装动效。
     */
    reveal(root: HTMLElement) {
        this.content.reveal(root, !this.animate('surfaceTransitions'));
        this.decorate(root);
    }
    /**
     * 只为尚未处理的卡片添加入场效果；数字节点保留无障碍文本。
     */
    decorate(root: HTMLElement) {
        root.querySelectorAll<HTMLElement>('.series-card,.pass-card').forEach((card, index) => {
            if (this.cards.has(card))
                return;
            this.cards.add(card);
            if (this.animate('surfaceTransitions'))
                card.animate([{ opacity: .35, transform: 'translateY(12px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 300, delay: Math.min(index, 15) * 16, easing: 'cubic-bezier(.22,1,.36,1)' });
        });
        root.querySelectorAll<HTMLElement>('.overview strong').forEach((strong, index) => {
            const valueNode = strong.firstChild;
            if (!valueNode || valueNode.nodeType !== Node.TEXT_NODE)
                return;
            const text = valueNode.textContent?.trim() ?? '';
            const value = Number(text);
            if (!Number.isFinite(value))
                return;
            const span = document.createElement('span');
            span.className = 'archive-rolling-number';
            span.setAttribute('aria-hidden', 'true');
            valueNode.replaceWith(span);
            const start = this.previousNumbers.get(index) ?? value;
            const decimals = text.includes('.') ? text.split('.')[1].length : 0;
            const number = createRollingNumber(span, { value: start, duration: 460, motionBlur: true, animated: false, format: { useGrouping: false, minimumFractionDigits: decimals, maximumFractionDigits: decimals } });
            number.update({ value, animated: this.animate('rollingNumbers') });
            this.numbers.set(strong, { number, value, decimals });
            strong.setAttribute('aria-label', `${text}${strong.querySelector('small')?.textContent ?? ''}`);
            this.previousNumbers.set(index, value);
        });
    }
    /**
     * 更新已有滚动数字实例，避免重新创建统计节点。
     */
    updateOverview(root: HTMLElement, values: readonly number[]) {
        root.querySelectorAll<HTMLElement>('.overview strong').forEach((strong, index) => {
            const state = this.numbers.get(strong), value = values[index];
            if (!state || value === undefined || value === state.value)
                return;
            state.number.update({ value, animated: this.animate('rollingNumbers') });
            state.value = value;
            this.previousNumbers.set(index, value);
            strong.setAttribute('aria-label', `${value.toFixed(state.decimals)}${strong.querySelector('small')?.textContent ?? ''}`);
        });
    }
    /**
     * 包装原生 dialog 的显示与关闭，使动画结束后才触发真正关闭。
     */
    dialog(dialog: HTMLDialogElement) {
        const transition = new SurfaceTransition(dialog, undefined, 300, 200);
        const nativeClose = dialog.close.bind(dialog);
        let closing = false;
        dialog.close = (value?: string) => {
            if (!dialog.open || closing)
                return;
            closing = true;
            transition.hide(!this.animate('surfaceTransitions'), () => {
                nativeClose(value);
                dialog.hidden = false;
                closing = false;
            });
        };
        dialog.addEventListener('cancel', event => {
            event.preventDefault();
            dialog.close();
        });
        return () => {
            closing = false;
            dialog.hidden = true;
            dialog.showModal();
            transition.show(!this.animate('surfaceTransitions'));
            dialog.querySelector<HTMLElement>('input,button')?.focus({ preventScroll: true });
        };
    }
    /**
     * 采样深浅主题 CSS 变量，按波前插值过渡，结束后清除临时行内颜色。
     */
    theme(dark: boolean) {
        const root = document.documentElement;
        const keys = ['--paper', '--panel', '--ink', '--muted', '--line', '--accent', '--field', '--focus'];
        if (!this.palettes) {
            const previous = root.dataset.theme;
            const canvas = document.createElement('canvas');
            canvas.width = canvas.height = 1;
            const context = canvas.getContext('2d')!;
            this.palettes = ['light', 'dark'].map(theme => {
                root.dataset.theme = theme;
                const style = getComputedStyle(root);
                return Object.fromEntries(keys.filter(key => style.getPropertyValue(key).trim()).map(key => {
                    context.clearRect(0, 0, 1, 1);
                    context.fillStyle = style.getPropertyValue(key).trim();
                    context.fillRect(0, 0, 1, 1);
                    return [key, Array.from(context.getImageData(0, 0, 1, 1).data)];
                }));
            }) as [
                Record<string, number[]>,
                Record<string, number[]>
            ];
            root.dataset.theme = previous;
            this.wave.set(previous === 'dark', performance.now() / 1000, { row: 0, lane: 0 }, true);
        }
        root.dataset.theme = dark ? 'dark' : 'light';
        cancelAnimationFrame(this.themeRAF);
        const animated = this.animate('surfaceTransitions');
        this.wave.set(dark, performance.now() / 1000, { row: 0, lane: 0 }, !animated);
        const cards = Array.from(document.querySelectorAll<HTMLElement>('.series-card,.pass-card'));
        const paint = (element: HTMLElement, amount: number) => {
            for (const [key, left] of Object.entries(this.palettes![0])) {
                const right = this.palettes![1][key];
                if (!right)
                    continue;
                const result = left.map((value, index) => value + (right[index] - value) * amount);
                element.style.setProperty(key, `rgba(${result[0]},${result[1]},${result[2]},${result[3] / 255})`);
            }
        };
        const begun = performance.now();
        const tick = () => {
            const time = performance.now() / 1000;
            this.wave.beginFrame();
            paint(root, this.wave.background(time));
            cards.forEach((card, index) => paint(card, this.wave.sample({ row: Math.floor(index / 4), lane: index % 4 }, time)));
            if (animated && performance.now() - begun < 1180)
                this.themeRAF = requestAnimationFrame(tick);
            else {
                for (const node of [root, ...cards])
                    for (const key of keys)
                        node.style.removeProperty(key);
            }
        };
        tick();
    }
}
