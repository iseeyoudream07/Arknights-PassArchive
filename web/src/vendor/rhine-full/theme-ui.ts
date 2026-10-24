/*
 * 模块导读：界面主题参数与 CSS 变量着色，供二维登录页和三维终端共用。
 * 此目录基于 RhineLabUI；原版权与来源见 NOTICE.md，具体调用关系见 docs/code-guide-zh.md。
 */

import "./theme.css";
const palette = {
  ink: ["#080a08", "#e0e3dc"], muted: ["#77756d", "#a6b0b1"], line: ["#aaa59a", "#536166"],
  paper: ["#eae5e1", "#11181b"], panel: ["#edebe4", "#202a2f"], field: ["#e7e3d9", "#2a363b"],
  accent: ["#9b7247", "#c5a16b"],
} as const;
let previous = -1;
export let themeAmount = 0;
function rgb(hex: string) { return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)); }
export function paintTheme(amount: number) {
  if (Math.abs(amount - previous) < .0001) return;
  previous = themeAmount = amount;
  const root = document.documentElement;
  root.dataset.darkSurface = String(amount > .0001);
  for (const [name, values] of Object.entries(palette)) {
    const from = rgb(values[0]), to = rgb(values[1]);
    const value = from.map((v, i) => Math.round(v + (to[i] - v) * amount)).join(", ");
    root.style.setProperty(`--theme-${name}`, `rgb(${value})`);
    root.style.setProperty(`--theme-${name}-rgb`, value);
  }
}
export function themeSettingsMarkup(dark: boolean) {
  return `<div class="theme-settings"><div><strong>外观</strong><span>切换页面和三维模型的明暗外观</span></div><div class="theme-choices" role="group" aria-label="外观"><button data-color-theme="light" aria-pressed="${!dark}">浅色</button><button data-color-theme="dark" aria-pressed="${dark}">深色</button></div></div>`;
}
