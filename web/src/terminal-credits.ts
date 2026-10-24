/*
 * 三维终端和独立致谢页共用的来源、授权与数据说明 HTML。
 */
import './terminal-credits.css';
/**
 * 返回来源、许可及数据存储说明，独立页面和三维终端复用同一内容。
 */
export function terminalCreditsMarkup() {
    return `<h2>SOURCES &amp; LICENSES<small>来源、许可与致谢</small></h2>
  <p class="credits-intro">PASS ARCHIVE · 通行认证收藏档案</p>
  <div class="credits-sections">
    <section><span class="credits-index">01 / COLLECTION DATA</span><h3>目录与统计规则</h3><p>主体目录、精一与精二拆分、官方参考价及统计规则来自 SpectMercyRE / Arknights-pass-statistics。固定源提交 1f31daf9edc7c0afb3ddc6744cd5809ca911957f。保留其 MIT 版权声明及原项目非商业使用说明。</p><div class="credits-links"><a href="https://github.com/SpectMercyRE/Arknights-pass-statistics" target="_blank" rel="noopener">原收集册 ↗</a><a href="/licenses/upstream-MIT.txt" target="_blank">MIT 全文 ↗</a><a href="/licenses/upstream-DISCLAIMER.txt" target="_blank">原版权说明 ↗</a></div></section>
    <section><span class="credits-index">02 / TERMINAL &amp; MOTION</span><h3>界面、动效与三维模型</h3><p>开屏、玻璃阵列、档案抽取与解密、文字滚动、主题传播及独立模型查看器来自 LBEILC / RhineLabUI，固定提交 12cc5e4013acb9408f753ff71de6b8492299b7c8。代码和作者原创模型采用 MIT，Copyright (c) 2026 LBEILC。构建与动效基线参考 RhineLabUI-Workflow。</p><div class="credits-links"><a href="https://github.com/LBEILC/RhineLabUI" target="_blank" rel="noopener">RhineLabUI ↗</a><a href="https://github.com/LBEILC/RhineLabUI-Workflow" target="_blank" rel="noopener">制作流程 ↗</a><a href="/licenses/rhine-full-MIT.txt" target="_blank">MIT 全文 ↗</a></div></section>
    <section><span class="credits-index">03 / TYPE &amp; LIBRARIES</span><h3>字体、文字图形与依赖</h3><p>终端使用 MiSans 字体，保留小米字体许可与源包说明。开屏固定台词使用上游已制作的 SVG 字形图形；不分发 Novecento 字体文件。编号、标题与时钟滚动使用 Rolling Number 0.4.1；三维渲染使用 Three.js 0.183.2。</p><div class="credits-links"><a href="/rhine/fonts/MiSans-license.pdf" target="_blank" rel="noopener">MiSans 许可 ↗</a><a href="/licenses/rhine-opening-lettering.txt" target="_blank">文字图形声明 ↗</a><a href="/rhine/licenses/rolling-number.txt" target="_blank">Rolling Number 许可 ↗</a><a href="/licenses/three-MIT.txt" target="_blank">Three.js 许可 ↗</a></div></section>
    <section><span class="credits-index">04 / SUPPLEMENTARY SOURCES</span><h3>补充资料、图片与声音</h3><p>盒号、条码、首发与复刻日期来自上传的 ArknightsAuthorization_Series 数据仓库，按其 CC BY-NC 4.0 声明使用。图片来自上传的 images.zip。三轨配乐为 RhineLabUI 原创程序编配；原片逐字短音沿用其单独的来源与权利声明。</p><div class="credits-links"><a href="https://github.com/awadwd/ArknightsAuthorization_Series-mirror" target="_blank" rel="noopener">补充数据仓库 ↗</a><a href="https://creativecommons.org/licenses/by-nc/4.0/" target="_blank" rel="noopener">CC BY-NC 4.0 ↗</a><a href="/rhine/audio/README.md" target="_blank">声音来源 ↗</a><a href="/data-audit.json" target="_blank">数据核验记录 ↗</a></div></section>
    <section><span class="credits-index">05 / PROJECT &amp; YOUR DATA</span><h3>项目与本机存档</h3><p>这是非官方、非商业的个人学习交流项目，与游戏官方无隶属关系。《明日方舟》《明日方舟：终末地》及相关名称、标志、美术、设定和原片音频的权利归各自权利人所有。</p><p>访客收藏保存在本机；登录后的拥有状态、价格、购买记录与关注系列同步到当前账号。离线编辑先保留在本机，联网后继续同步。备份导入导出在本机处理，服务器统计核对仍为即时计算。账号密码以安全哈希保存，不存储明文密码。</p></section>
  </div><div class="modal-bottom"><span>PASS ARCHIVE / 0.4.5</span><span>COLLECTION · RECORD · PRESERVE</span></div>`;
}
