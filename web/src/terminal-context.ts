/*
 * 定义宿主传入三维终端的只读业务上下文，以及终端回传宿主的消息入口。
 */
import type { Catalog } from './types.ts';
import type { MotionPreferences } from './vendor/rhine-full/motion-preferences.ts';
/**
 * 初始化上下文：统一目录、开屏和主题，以及可选的登录显示信息与关注系列。
 */
export interface PassTerminalContext {
    catalog: Catalog;
    playOpening: boolean;
    theme: 'light' | 'dark';
    authenticated?: boolean;
    username?: string | null;
    followed_series?: string[];
}
declare global {
    interface Window {
        passTerminalContext: PassTerminalContext;
    }
}
/**
 * 取得已由 terminal-entry 校验并设置的上下文。
 */
export const passContext = () => window.passTerminalContext;
/**
 * 只向同源父窗口发送终端消息，由宿主验证后执行实际业务操作。
 */
export function passToHost(type: string, value: Record<string, unknown> = {}) {
    window.parent.postMessage({ channel: 'pass-archive-terminal', type, ...value }, location.origin);
}
/**
 * 把终端的主题与动效偏好同步回宿主。
 */
export function passPreferences(theme: 'light' | 'dark', motion: MotionPreferences) {
    passToHost('preferences', { theme, motion });
}
