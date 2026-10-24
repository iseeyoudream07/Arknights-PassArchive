/*
 * 模块导读：终端内的 PWA 安装与缓存设置入口；实际缓存边界见 web/public/sw.js。
 * 此目录基于 RhineLabUI；原版权与来源见 NOTICE.md，具体调用关系见 docs/code-guide-zh.md。
 */

/** The host owns the service worker; this terminal shares its same-origin cache. */
export function pwaSettingsMarkup() {
  return '<div class="settings-shortcuts"><span>OFFLINE ARCHIVE</span><p>已加载的页面和模型可离线使用。首次查看三维模型时需要联网；建议定期导出收藏备份。</p></div>';
}
export async function initPwa(_notify: (message: string) => void) {
  // Registration and updates are handled once, by the outer Pass Archive app.
}
