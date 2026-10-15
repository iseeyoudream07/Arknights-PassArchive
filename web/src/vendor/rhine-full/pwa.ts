/** The host owns the service worker; this terminal shares its same-origin cache. */
export function pwaSettingsMarkup() {
  return '<div class="settings-shortcuts"><span>OFFLINE ARCHIVE</span><p>已访问的页面、字体与模型会在本机缓存。首次使用 360° 查看器时请保持联网。收藏数据请通过备份保存。</p></div>';
}
export async function initPwa(_notify: (message: string) => void) {
  // Registration and updates are handled once, by the outer Pass Archive app.
}
