/*
 * 独立来源与许可页面入口；复用终端的致谢内容与主题偏好。
 */
import './vendor/rhine-full/fonts.css';
import './credits-page.css';
import { terminalCreditsMarkup } from './terminal-credits.ts';
import { paintTheme } from './vendor/rhine-full/theme-ui.ts';
import { ContentTransition } from './vendor/rhine-full/ui-transitions.ts';
let dark = matchMedia('(prefers-color-scheme: dark)').matches;
let animate = !matchMedia('(prefers-reduced-motion: reduce)').matches;
try {
    const theme = localStorage.getItem('pass-archive-theme');
    if (theme)
        dark = theme === 'dark';
    const prefs = JSON.parse(localStorage.getItem('pass-archive-rhine-settings') ?? 'null');
    if (typeof prefs?.motion?.surfaceTransitions === 'boolean')
        animate = prefs.motion.surfaceTransitions;
}
catch { /* 浏览器存储不可读时，来源页仍可按默认主题显示。 */
}
paintTheme(dark ? 1 : 0);
const content = document.querySelector<HTMLElement>('#credits-content')!;
content.innerHTML = terminalCreditsMarkup().replace('<h2>', '<h1>').replace('</h2>', '</h1>');
new ContentTransition().reveal(content, !animate);
