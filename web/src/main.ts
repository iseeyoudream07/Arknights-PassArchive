import './style.css';
import './account.css';
import './controls.css';
import {AccountSync} from './account-sync.ts';
import {accountPanelMarkup,syncLabels} from './account-panel.ts';
import {equal} from './sync-merge.ts';
import {ArchiveWrites} from './archive-writes.ts';
import {reconcileCards,patchPassCard,passPriceHtml,passToggleHtml} from './list-ui.ts';
import type {Catalog, Series, Pass, Backup, Collection, RecordEntry, Stats} from './types.ts';
import {calculateStats, normalizeBackup, normalizeRecord} from './core.ts';
import {loadArchive, saveArchive} from './storage.ts';
import {RhineTerminal} from './rhine-terminal.ts';
import {ArchiveMotion} from './archive-motion.ts';

const app=document.querySelector<HTMLDivElement>('#app')!;
const opening=new RhineTerminal(app);
const motion=new ArchiveMotion(key=>opening.animate(key));
const startView=new URLSearchParams(location.search).get('view');
if(!['catalog','collection','stats','settings'].includes(startView??''))opening.start();
const dialog=document.querySelector<HTMLDialogElement>('#dialog')!;
const showDialog=motion.dialog(dialog);
const toastEl=document.querySelector<HTMLDivElement>('#toast')!;
const labels:Record<string,string>={main:'主线通行认证',sp:'音律联觉',carnival:'嘉年华',collab:'联动系列',elite:'精英干员',special:'特别系列',endfield:'终末地'};
let catalog:Catalog;
let archive:Backup;
let account:AccountSync;
let page='catalog',selected:Series|null=null,query='',type='all',ownedFilter='all';
let toastTimer=0;
let writes:ArchiveWrites;
let readOnly=false;
let saving=false;
let pendingWrites=0;
const busyCards=new Set<string>();
const esc=(s:unknown)=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const currency=(v:string)=>`¥${v.replace(/\B(?=(\d{3})+(?!\d))/g,',')}`;
function toast(text:string){toastEl.textContent=text;toastEl.classList.add('visible');window.clearTimeout(toastTimer);toastTimer=window.setTimeout(()=>toastEl.classList.remove('visible'),3500);}
function fail(error:unknown){toast(error instanceof Error?error.message:'操作失败，请稍后重试。');}
function image(src:string|null,alt:string,cls='',eager=false){return src?`<img class="${cls}" src="${esc(src)}" alt="${esc(alt)}" loading="${eager?'eager':'lazy'}" decoding="async">`:`<div class="image-placeholder ${cls}"><span>NO IMAGE</span><small>暂无图片</small></div>`;}
function allPasses(){return catalog.series.flatMap(s=>s.passes.map(p=>({s,p})));}
function matches(s:Series,p:Pass){
  const r=archive.collection[p.id];
  if(ownedFilter==='owned'&&!r?.owned||ownedFilter==='unowned'&&r?.owned)return false;
  const q=query.trim().toLowerCase();
  if(!q)return true;
  const rarity=/^(?:([1-6])(?:星|\*)?|([一二三四五六])星)$/.exec(q);
  if(rarity&&(/星|\*/.test(q)))return p.rarity===Number(rarity[1]??('一二三四五六'.indexOf(rarity[2])+1));
  return `${s.name} ${s.box_number??''} ${s.barcodes.join(' ')} ${p.search_text} ${p.name} ${p.label} ${p.en} ${p.py} ${p.pyi}`.toLowerCase().includes(q);
}
function progress(s:Series){const n=s.passes.filter(p=>archive.collection[p.id]?.owned).length;return {n,pct:s.passes.length?n/s.passes.length*100:0};}
function shell(){
  app.innerHTML=`<aside class="sidebar"><a class="brand" href="#" aria-label="通行认证档案首页"><svg viewBox="0 0 64 64" aria-hidden="true"><g stroke="currentColor" fill="none" stroke-width="2"><circle cx="25" cy="32" r="17"/><circle cx="39" cy="32" r="17"/></g><path d="M30 13h4v38h-4z" fill="var(--accent)"/></svg><span>PASS<br>ARCHIVE<small>通行认证档案</small></span></a><div class="side-rule"><span>COLLECTION / INDEX</span><b>01</b></div><nav aria-label="主导航">${[['catalog','01','通行认证'],['collection','02','我的收藏'],['stats','03','收藏统计'],['settings','04','数据与设置']].map(([id,n,t])=>`<button data-page="${id}" ${page===id?'aria-current="page"':''}><span>${n}</span>${t}<i>↗</i></button>`).join('')}</nav><div class="sidebar-bottom"><button id="terminal-return" class="terminal-return"><span>返回三维档案</span><i aria-hidden="true">↗</i></button></div></aside><main><header class="topbar"><span class="mono">ARKNIGHTS · COLLECTION SYSTEM</span><div><button id="terminal-mobile-return">← 三维档案</button><button id="account-access">${account.user?'账号':'登录'}</button><span id="sync-indicator" role="status">${syncLabels[account.status]}</span><span id="connection">${navigator.onLine?'在线':'离线'}</span><button id="theme-toggle" title="切换深浅主题" aria-label="切换深浅主题">◐</button></div></header><section id="content"></section><footer><span>明日方舟 · 通行认证收藏工具</span><span class="mono">${esc(catalog.version)} &nbsp; / &nbsp; 非官方 · 非商业</span></footer></main>`;
  document.querySelector<HTMLButtonElement>('#account-access')!.onclick=()=>account.user?navigate('settings'):location.assign('/login.html');
  document.querySelector<HTMLButtonElement>('#terminal-return')!.onclick=()=>opening.start();
  document.querySelector<HTMLButtonElement>('#terminal-mobile-return')!.onclick=()=>opening.start();
  document.querySelector('.brand')!.addEventListener('click',e=>{e.preventDefault();navigate('catalog');});
  document.querySelectorAll<HTMLButtonElement>('[data-page]').forEach(b=>b.onclick=()=>navigate(b.dataset.page!));
  document.querySelector<HTMLButtonElement>('#theme-toggle')!.onclick=()=>{const dark=document.documentElement.dataset.theme==='dark';motion.theme(!dark);opening.syncTheme();try{localStorage.setItem('pass-archive-theme',dark?'light':'dark');}catch{toast('主题可切换，但浏览器限制了偏好保存。');}};
  render();
}
function navigate(next:string){page=next;selected=null;query='';type='all';ownedFilter='all';shell();window.scrollTo({top:0,behavior:'instant'});}
function hero(title:string,desc:string,index:string){return `<div class="section-intro"><div><div class="eyebrow"><i></i> ${index} / COLLECTION ARCHIVE</div><h1>${title}</h1><p>${desc}</p></div><div class="orbit" aria-hidden="true"><span></span><span></span><span></span><i></i><b>RECORD<br>YOUR<br>COLLECTION</b></div></div>`;}
function summary(){const s=calculateStats(catalog,archive.collection);return `<div class="overview"><div><span>收集进度</span><strong>${s.progress.toFixed(1)}<small>%</small></strong></div><div><span>已拥有 / 全部通行证</span><strong>${s.owned}<small> / ${s.total}</small></strong></div><div><span>已收齐系列</span><strong>${s.completed_series}<small> / ${catalog.series.length}</small></strong></div><div class="overview-note"><span class="mono">LOCAL COLLECTION</span><p>从第一张开始，<br>记录每一份热爱。</p><button data-page="stats">查看统计 ↗</button></div></div>`;}
function filterMarkup(showCategories=true){return `<div class="toolbar"><div class="search"><span aria-hidden="true">⌕</span><input id="search" type="search" placeholder="搜索干员、盒号、拼音或包装条码" value="${esc(query)}" aria-label="搜索通行认证"><kbd>/</kbd></div><div class="status-filter"><select id="owned-filter" aria-label="拥有状态"><option value="all">全部状态</option><option value="owned" ${ownedFilter==='owned'?'selected':''}>已拥有</option><option value="unowned" ${ownedFilter==='unowned'?'selected':''}>未拥有</option></select></div></div>${showCategories?`<div class="category-tabs" role="group" aria-label="系列分类"><button data-type="all" aria-pressed="${type==='all'}">全部系列<span>${catalog.series.length}</span></button>${Object.entries(labels).map(([k,v])=>`<button data-type="${k}" aria-pressed="${type===k}">${v}</button>`).join('')}</div>`:''}`;}
function seriesCard(s:Series,i:number){const p=progress(s);const visible=s.passes.filter(x=>matches(s,x));return `<article class="series-card ${p.pct===100?'complete':''}"><button class="series-image" data-series="${s.id}" aria-label="查看${esc(s.name)}">${image(s.image,s.name,'',i<4)}<span class="image-corner mono">${String(catalog.series.indexOf(s)+1).padStart(3,'0')} / FILE</span><span class="image-access">查看档案 ↗</span></button><div class="series-meta"><span>${esc(labels[s.type])}</span><span class="mono">${esc(s.release_date||s.year||'—')}</span></div><button class="series-title" data-series="${s.id}">${esc(s.name.replace(/^明日方舟/,''))}</button><div class="series-foot"><span>已拥有 <b>${p.n}</b> / ${s.passes.length}${query||ownedFilter!=='all'?` · 匹配 ${visible.length}`:''}</span><span>${p.pct===100?'已收齐 ✓':`${p.pct.toFixed(0)}%`}</span></div><div class="progress-track"><i style="width:${p.pct}%"></i></div></article>`;}
function bindFilters(){
  const input=document.querySelector<HTMLInputElement>('#search');
  let timer=0;
  if(input)input.oninput=()=>{query=input.value;window.clearTimeout(timer);timer=window.setTimeout(()=>renderResults(),120);};
  const sel=document.querySelector<HTMLSelectElement>('#owned-filter');if(sel)sel.onchange=()=>{ownedFilter=sel.value;renderResults();};
  document.querySelectorAll<HTMLButtonElement>('[data-type]').forEach(b=>b.onclick=()=>{type=b.dataset.type!;document.querySelectorAll('[data-type]').forEach(t=>t.setAttribute('aria-pressed',String((t as HTMLElement).dataset.type===type)));renderResults();});
}
function cardNode(markup:string){const template=document.createElement('template');template.innerHTML=markup;return template.content.firstElementChild as HTMLElement;}
function renderResults(){
  const el=document.querySelector<HTMLElement>('#results');if(!el)return;
  const seriesMode=page==='catalog'&&!selected,kind=seriesMode?'series':'pass';
  if(!el.querySelector(`.${kind}-grid`))el.innerHTML=`<div class="results-heading"><span></span><span class="mono"></span></div><div class="${kind}-grid"></div><div class="results-empty" hidden></div>`;
  const grid=el.querySelector<HTMLElement>(`.${kind}-grid`)!,heading=el.querySelector('.results-heading')!,emptyHolder=el.querySelector<HTMLElement>('.results-empty')!;
  const setText=(node:Element|null,value:string)=>{if(node&&node.textContent!==value)node.textContent=value;};
  let count=0,focusRemoved=false;
  if(seriesMode){
    const filtered=catalog.series.filter(s=>(type==='all'||s.type===type)&&s.passes.some(p=>matches(s,p)));
    count=filtered.length;
    setText(heading.firstElementChild,query?'检索结果':'系列档案');
    setText(heading.lastElementChild,`${count} SERIES / ${filtered.reduce((a,s)=>a+s.passes.filter(p=>matches(s,p)).length,0)} PASSES`);
    ({focusRemoved}=reconcileCards(grid,filtered,s=>s.id,(s,i)=>cardNode(seriesCard(s,i)),(card,s)=>{
      const p=progress(s),matchCount=s.passes.filter(pass=>matches(s,pass)).length;
      if(card.classList.contains('complete')!==(p.pct===100))card.classList.toggle('complete',p.pct===100);
      const foot=card.querySelector('.series-foot')!,value=`<span>已拥有 <b>${p.n}</b> / ${s.passes.length}${query||ownedFilter!=='all'?` · 匹配 ${matchCount}`:''}</span><span>${p.pct===100?'已收齐 ✓':`${p.pct.toFixed(0)}%`}</span>`;
      if(foot.innerHTML!==value)foot.innerHTML=value;
      const track=card.querySelector<HTMLElement>('.progress-track i')!,width=`${Number(p.pct.toFixed(4))}%`;if(track.style.width!==width)track.style.width=width;
    },'.series-title'));
  }else{
    const items=(selected?selected.passes.map(p=>({s:selected!,p})):allPasses()).filter(({s,p})=>(type==='all'||s.type===type)&&matches(s,p)&&(page!=='collection'||archive.collection[p.id]?.owned));
    count=items.length;
    setText(heading.firstElementChild,selected?'盒内通行认证':'已收藏通行认证');
    setText(heading.lastElementChild,`${count} PASSES`);
    ({focusRemoved}=reconcileCards(grid,items,x=>x.p.id,({s,p})=>cardNode(passCard(s,p,!selected)),(card,{p})=>patchPassCard(card,archive.collection[p.id],p.label),'[data-toggle]'));
  }
  grid.hidden=!count;emptyHolder.hidden=!!count;
  if(!count){const markup=seriesMode?empty('没有找到相关通行认证','试试干员名、盒号或其他分类。'):empty(page==='collection'?'你的收藏，从第一张开始':'没有找到匹配条目',page==='collection'?'在目录中标记已拥有的通行认证':'调整搜索词或拥有状态后再试。');if(emptyHolder.innerHTML!==markup)emptyHolder.innerHTML=markup;}
  bindCards(el);
  motion.decorate(el);
  if(focusRemoved&&!count)document.querySelector<HTMLInputElement>('#search')?.focus({preventScroll:true});
}
function refreshArchiveUI(){
  if(!document.querySelector('.sidebar'))return;
  if(page==='catalog'||page==='collection'){
    renderResults();
    const stats=calculateStats(catalog,archive.collection);
    motion.updateOverview(app,[stats.progress,stats.owned,stats.completed_series]);
    if(selected){
      const p=progress(selected),count=document.querySelector('.detail-progress strong')?.firstChild;
      if(count&&count.textContent!==String(p.n))count.textContent=String(p.n);
      const label=document.querySelector('.detail-progress>span'),text=`已拥有 ${p.pct.toFixed(1)}%`;if(label&&label.textContent!==text)label.textContent=text;
      const track=document.querySelector<HTMLElement>('.series-detail .progress-track i'),width=`${Number(p.pct.toFixed(4))}%`;if(track&&track.style.width!==width)track.style.width=width;
    }
  }else if(page==='stats'){
    const content=document.querySelector<HTMLElement>('#content')!;renderStatsPage(content);motion.decorate(content);
  }
  updateAccountUI();
}
function empty(title:string,desc:string){return `<div class="empty"><div class="empty-icon">⊕</div><h2>${title}</h2><p>${desc}</p>${page==='collection'?'<button class="primary" data-page="catalog">去浏览通行认证 ↗</button>':''}</div>`;}
function passCard(s:Series,p:Pass,showSeries=false){const r=archive.collection[p.id];return `<article class="pass-card ${r?.owned?'is-owned':''}"><button class="avatar-button" data-edit="${p.id}" aria-label="编辑${esc(p.label)}的价格">${image(p.avatar,p.label)}<span>${esc(p.variant||'通行认证')}</span></button><div class="pass-info"><div class="pass-class"><span>${esc(p.class||'干员')}</span><span>${p.rarity?'★'.repeat(p.rarity):'—'}</span></div><h3>${esc(p.name)}</h3><p class="pass-en">${esc(p.en||p.faction)}</p>${showSeries?`<p class="pass-series">${esc(s.name)}</p>`:''}<div class="pass-price">${passPriceHtml(r)}</div><div class="pass-actions"><button data-toggle="${p.id}" aria-pressed="${!!r?.owned}" aria-label="${r?.owned?'取消拥有':'标记拥有'}${esc(p.label)}">${passToggleHtml(!!r?.owned)}</button><button data-edit="${p.id}" aria-label="编辑${esc(p.label)}价格">价格 ↗</button></div></div></article>`;}
function bindCards(root:ParentNode=app){
  root.querySelectorAll<HTMLButtonElement>('[data-series]').forEach(b=>b.onclick=()=>{selected=catalog.series.find(s=>s.id===b.dataset.series)!;page='catalog';render();window.scrollTo({top:0,behavior:'instant'});});
  root.querySelectorAll<HTMLButtonElement>('[data-toggle]').forEach(b=>{b.disabled=readOnly;b.onclick=()=>{const id=b.dataset.toggle!;if(busyCards.has(id))return;busyCards.add(id);b.setAttribute('aria-busy','true');void toggle(id).catch(fail).finally(()=>{busyCards.delete(id);b.removeAttribute('aria-busy');});};});
  root.querySelectorAll<HTMLButtonElement>('[data-edit]').forEach(b=>b.onclick=()=>edit(b.dataset.edit!));
  root.querySelectorAll<HTMLButtonElement>('#content [data-page]').forEach(b=>b.onclick=()=>navigate(b.dataset.page!));
  root.querySelectorAll<HTMLImageElement>('img').forEach(img=>img.onerror=()=>{const div=document.createElement('div');div.className='image-placeholder';div.innerHTML='<span>NO IMAGE</span><small>暂无图片</small>';img.replaceWith(div);});
}
function render(){
  const el=document.querySelector('#content')!;
  if(page==='catalog'&&selected){const p=progress(selected);el.innerHTML=`<button class="back" id="back">← 返回系列目录</button><div class="series-detail"><button class="detail-image" id="preview">${image(selected.image,selected.name,'',true)}<span>放大预览 ↗</span></button><div><div class="eyebrow">${esc(labels[selected.type])} / SERIES FILE</div><h1>${esc(selected.name)}</h1><p>${selected.release_date?`首发 ${esc(selected.release_date)}`:`原目录年份 ${esc(selected.year)}`}<br>${selected.replicate_dates.length?`复刻 ${esc(selected.replicate_dates.join(' / '))}`:''}</p><div class="detail-progress"><strong>${p.n}<small> / ${selected.passes.length}</small></strong><span>已拥有 ${p.pct.toFixed(1)}%</span></div><div class="progress-track"><i style="width:${p.pct}%"></i></div><div class="detail-meta"><span>整盒官方参考价 <b>${currency(selected.official_box_price.toFixed(2))}</b></span>${selected.barcodes.length?`<details><summary>包装条码</summary><p class="mono">${esc(selected.barcodes.join(' / '))}</p></details>`:''}</div></div></div>${filterMarkup(false)}<div id="results"></div>`;
    document.querySelector<HTMLButtonElement>('#back')!.onclick=()=>{selected=null;render();};
    document.querySelector<HTMLButtonElement>('#preview')!.onclick=()=>{if(selected?.image){openDialog(`<div class="modal-head"><h2>整盒预览</h2><button data-close aria-label="关闭">×</button></div><div class="full-preview">${image(selected.image,selected.name,'',true)}</div><p>${esc(selected.name)}</p>`,'image-dialog');}};
    bindFilters();renderResults();
  } else if(page==='catalog'){el.innerHTML=hero('通行认证档案','寻找心仪的干员，整理属于你的收藏。','01')+summary()+filterMarkup()+'<div id="results"></div>';bindFilters();renderResults();}
  else if(page==='collection'){el.innerHTML=hero('我的收藏','每一张已拥有的通行认证，都在这里。','02')+summary()+filterMarkup()+'<div id="results"></div>';bindFilters();renderResults();}
  else if(page==='stats'){renderStatsPage(el);}
  else {renderSettings(el);}
  bindCards();
  motion.reveal(el as HTMLElement);
}
function renderStatsPage(el:Element){const s=calculateStats(catalog,archive.collection);el.innerHTML=hero('收藏统计','收集进度、购买记录与估算价值，一览可见。','03')+summary()+`<div class="money-grid">${[['购入总额',s.cost,'全部已拥有条目的购买记录'],['市场估值',s.market,'已填写市价 × 记录数量'],['估算盈亏',s.profit,`${s.priced_owned} 种已填写非零市价`],['官方价合计',s.official,'按原版计价规则计算']].map(([t,v,n])=>`<div><span>${t}</span><strong>${currency(v)}</strong><small>${n}</small></div>`).join('')}</div><div class="stats-columns"><section class="panel"><div class="panel-heading"><h2>系列收集进度</h2><span class="mono">BY CATEGORY</span></div>${Object.entries(labels).map(([t,l])=>{const ss=catalog.series.filter(s=>s.type===t);const ps=ss.flatMap(s=>s.passes);const n=ps.filter(p=>archive.collection[p.id]?.owned).length;return `<div class="distribution"><span>${l}</span><div class="progress-track"><i style="width:${ps.length?n/ps.length*100:0}%"></i></div><b>${n}<small> / ${ps.length}</small></b></div>`;}).join('')}</section><section class="panel"><div class="panel-heading"><h2>统计说明</h2><span class="mono">RECORD NOTES</span></div><ul class="notes"><li>收集进度按不同通行认证计数，同款多张不会重复增加进度。</li><li>已记录购买数量 <b>${s.quantity}</b> 张。仅标记拥有而未填写购买记录时，金额数量为零。</li><li>未填写市场价或市场价为零的条目，不参与估算盈亏。所有市价均由你填写。</li><li>特殊礼盒拥有任意一张时，官方价按整盒计算一次。估值供整理收藏参考。</li></ul><button id="check-api" class="secondary">核对服务器统计 ↗</button><p id="api-check-result" role="status"></p></section></div>`;
  document.querySelector<HTMLButtonElement>('#check-api')!.onclick=()=>void (async()=>{const b=document.querySelector<HTMLButtonElement>('#check-api')!;b.disabled=true;try{const response=await fetch('/api/v1/stats/',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({collection:archive.collection}),signal:AbortSignal.timeout(8000)});if(!response.ok)throw new Error('服务器核对暂不可用，本机统计仍可使用。');const remote:Stats=await response.json();const fields=['owned','quantity','official','market','cost','profit'] as const;if(fields.some(k=>remote[k]!==s[k]))throw new Error('统计结果存在差异，请先导出备份并反馈。');document.querySelector('#api-check-result')!.textContent='核对一致。服务器不保存此次收藏数据。';}catch(e){fail(e);}finally{b.disabled=false;}})();
}
function updateAccountUI(){
  const indicator=document.querySelector('#sync-indicator');if(indicator&&indicator.textContent!==syncLabels[account.status])indicator.textContent=syncLabels[account.status];
  const entry=document.querySelector('#account-access');if(entry)entry.textContent=account.user?'账号':'登录';
  opening.syncAccount(account.user!==null,account.backup.followed_series??[],account.user?.username??null);
  const panel=document.querySelector('#account-panel');if(panel){const markup=accountPanelMarkup(account,catalog);if(panel.innerHTML!==markup){panel.innerHTML=markup;bindAccountPanel();}}
}
function bindAccountPanel(){
  const bind=(id:string,action:()=>Promise<unknown>)=>{const button=document.querySelector<HTMLButtonElement>('#'+id);if(button)button.onclick=()=>{button.disabled=true;void action().catch(fail).finally(()=>{if(button.isConnected)button.disabled=false;updateAccountUI();});};};
  bind('account-sync-now',()=>account.sync());
  bind('account-signout',async()=>{await account.logout();archive=account.backup;shell();toast('已退出账号，当前为本机访客存档。');});
  bind('account-import-guest',async()=>{if(await confirmAction('合并本机收藏','将本机访客收藏并入当前账号，原本机存档仍保留。','合并收藏'))await account.importGuest();});
  bind('account-keep-local',async()=>{if(await confirmAction('保留本机冲突版本',`这 ${account.conflicts.length} 条冲突将采用本机版本，其他记录会正常合并。`,'保留本机版本'))await account.resolve('local');});
  bind('account-keep-cloud',async()=>{if(await confirmAction('保留云端冲突版本',`这 ${account.conflicts.length} 条冲突将采用云端版本，其他记录会正常合并。`,'保留云端版本'))await account.resolve('cloud');});
}
function renderSettings(el:Element){el.innerHTML=hero('数据与设置','定期备份，让每一份收藏都有归处。','04')+`<div class="settings-grid"><section class="panel" id="account-panel">${accountPanelMarkup(account,catalog)}</section><section class="panel"><div class="panel-heading"><h2>收藏备份</h2><span class="mono">YOUR DATA</span></div><p>访客收藏保存在当前浏览器；登录后的收藏会同步到账号，离线改动先保留在本机。建议定期导出备份。</p><div class="button-row"><button id="export" class="primary">导出 JSON 备份 ↓</button><button id="import" class="secondary">导入备份 ↑</button></div><input id="import-file" type="file" accept="application/json,.json" hidden><button id="undo-import" class="text-button">恢复上次导入前的收藏</button><p class="subtle">兼容原收集册的旧版备份；未匹配条目会保留在导出文件中。${Object.keys(archive.unmapped).length?`当前有 ${Object.keys(archive.unmapped).length} 项待匹配。`:''}</p></section><section class="panel"><div class="panel-heading"><h2>目录与来源</h2><span class="mono">CATALOG RECORD</span></div><dl><dt>收录系列</dt><dd>${catalog.series.length} 个</dd><dt>通行认证</dt><dd>${catalog.counts.passes} 种</dd><dt>数据版本</dt><dd class="mono">${esc(catalog.version)}</dd></dl><p>主体目录与统计规则来自 SpectMercyRE 的通行认证收集册；盒号、条码及日期补充来自上传的数据仓库。存在来源冲突的年份保持原始记录。</p><a href="/credits.html" target="_blank" rel="noopener">查看来源、许可与致谢 ↗</a></section><section class="panel"><div class="panel-heading"><h2>使用说明</h2><span class="mono">QUICK START</span></div><ol class="notes"><li>进入系列档案，标记已拥有的通行认证。</li><li>点头像或“价格”，记录市场价和购买批次。</li><li>在收藏统计中查看进度与估算盈亏。</li><li>登录账号可同步到其他设备，也可导出 JSON 另行备份。</li></ol></section><section class="panel"><div class="panel-heading"><h2>开屏与动效</h2><span class="mono">OPENING SEQUENCE</span></div><p>复刻莱茵生命终端的逐字提示、标志描绘、圆环扫描、阵列波浪、档案抽取、解密与 360° 拆解。二维开场约 20 秒，随后进入三维阵列、抽取和解密流程；可随时跳过。</p><div class="opening-controls"><label class="opening-preference"><span><strong>打开时播放开屏</strong><small>进入档案时自动播放启动序列</small></span><input id="opening-preference" type="checkbox" role="switch" aria-label="打开时播放开屏" ${opening.enabled?'checked':''}><i class="preference-toggle" aria-hidden="true"></i></label><button id="replay-opening" class="secondary" ${opening.reducedMotion?'disabled':''}>重播开屏 <span aria-hidden="true">↗</span></button></div><p class="subtle">${opening.reducedMotion?'系统已开启“减少动态效果”，当前自动跳过开屏。':'可按 Enter 或 Esc 跳过；开屏身份会随当前登录账号更新。'}</p></section><section class="panel"><div class="panel-heading"><h2>关于档案</h2><span class="mono">PASS ARCHIVE / 0.4.5</span></div><p>《明日方舟》《明日方舟：终末地》实体通行认证收藏管理工具。非官方、非商业的个人学习交流项目，与游戏官方无隶属关系。</p><p>视觉参考莱茵生命档案终端的暖灰白、细线结构与克制动效。支持手机与桌面浏览，深浅主题以及已缓存页面的离线访问。</p><p class="subtle">支持本机存档与账号同步；离线修改会在联网后继续同步。</p></section></div>`;
  bindAccountPanel();
  document.querySelector<HTMLButtonElement>('#replay-opening')!.onclick=()=>opening.start(true);
  document.querySelector<HTMLInputElement>('#opening-preference')!.onchange=e=>{if(!opening.setEnabled((e.target as HTMLInputElement).checked))toast('浏览器限制了偏好保存，本次设置无法保留。');};
  document.querySelector<HTMLButtonElement>('#export')!.onclick=()=>exportBackup();
  document.querySelector<HTMLButtonElement>('#import')!.onclick=()=>document.querySelector<HTMLInputElement>('#import-file')!.click();
  document.querySelector<HTMLInputElement>('#import-file')!.onchange=e=>void importFile((e.target as HTMLInputElement).files?.[0]).catch(fail);
  document.querySelector<HTMLButtonElement>('#undo-import')!.onclick=()=>void (async()=>{const old=await account.beforeImport();if(!old)return toast('还没有可恢复的导入前备份。');if(await confirmAction('恢复导入前的收藏','当前收藏将替换为上次导入前的存档。建议先导出当前备份。','恢复收藏')){await persist(normalizeBackup(old,catalog).backup);render();toast('已恢复导入前的收藏。');}})().catch(fail);
}
async function persist(next:Backup,previous?:Backup){
  if(readOnly)throw new Error('浏览器存储不可用，请换普通浏览模式再记录收藏。');
  pendingWrites++;saving=true;
  try{await writes.enqueue(next,!!previous);}finally{pendingWrites--;saving=pendingWrites>0;archive=account.backup;refreshArchiveUI();}
}
async function toggle(id:string){const r=archive.collection[id]??{owned:false,market:null,lots:[]};if(r.owned&&(r.market!==null||r.lots.length)&&!await confirmAction('取消拥有','取消后会清除这张通行认证的价格和购买记录。','取消拥有'))return;if(!equal(r,archive.collection[id]??{owned:false,market:null,lots:[]}))throw new Error('另一设备更新了这条记录，请重新查看后再操作。');const next=structuredClone(archive);next.collection[id]=r.owned?{owned:false,market:null,lots:[]}:{...r,owned:true};await persist(next);toast(r.owned?'已取消拥有':'已记入收藏');}
function openDialog(html:string,cls=''){dialog.className=cls;dialog.innerHTML=html;dialog.querySelectorAll<HTMLButtonElement>('[data-close]').forEach(b=>b.onclick=()=>dialog.close());showDialog();dialog.onclick=e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}};}
function confirmAction(title:string,desc:string,label:string):Promise<boolean>{return new Promise(resolve=>{openDialog(`<div class="modal-head"><h2>${title}</h2><button data-close aria-label="关闭">×</button></div><p>${desc}</p><div class="modal-actions"><button data-close class="secondary">返回</button><button id="confirm-ok" class="primary">${label}</button></div>`);let yes=false;document.querySelector<HTMLButtonElement>('#confirm-ok')!.onclick=()=>{yes=true;dialog.close();};dialog.addEventListener('close',()=>resolve(yes),{once:true});});}
function edit(id:string){const item=allPasses().find(x=>x.p.id===id)!;const r=archive.collection[id]??{owned:false,market:null,lots:[]};openDialog(`<div class="modal-head"><div><span class="eyebrow">PURCHASE RECORD</span><h2>${esc(item.p.label)}</h2></div><button data-close aria-label="关闭">×</button></div><p class="subtle">${esc(item.s.name)}</p><form id="price-form"><label class="field-label">市场参考价 <span>每张 / 元</span><input name="market" type="text" inputmode="decimal" autocomplete="off" placeholder="未填写" value="${esc(r.market??'')}"></label><div class="lots-head"><strong>购买记录</strong><button id="add-lot" type="button">＋ 添加一笔</button></div><div id="lot-rows">${r.lots.map(l=>lotRow(l)).join('')}</div><p class="subtle">购入价留空按 0 元记录。保存会同时标记已拥有。</p><div id="price-error" role="alert"></div><div class="modal-actions"><button data-close type="button" class="secondary">返回</button><button type="submit" class="primary">保存记录 ✓</button></div></form>`);
  const rows=document.querySelector('#lot-rows')!;
  const bindRemove=()=>rows.querySelectorAll<HTMLButtonElement>('[data-remove-lot]').forEach(b=>b.onclick=()=>b.closest('.lot-row')!.remove());bindRemove();
  document.querySelector<HTMLButtonElement>('#add-lot')!.onclick=()=>{rows.insertAdjacentHTML('beforeend',lotRow({cost:'',qty:1}));bindRemove();};
  document.querySelector<HTMLFormElement>('#price-form')!.onsubmit=e=>{e.preventDefault();void (async()=>{try{const lots=Array.from(rows.querySelectorAll('.lot-row')).map(row=>({cost:row.querySelector<HTMLInputElement>('[name="cost"]')!.value.trim()||'0',qty:Number(row.querySelector<HTMLInputElement>('[name="qty"]')!.value)}));if(!equal(r,archive.collection[id]??{owned:false,market:null,lots:[]}))throw new Error('另一设备更新了这条记录，请关闭后重新编辑。');const record=normalizeRecord({owned:true,market:document.querySelector<HTMLInputElement>('[name="market"]')!.value.trim(),lots});const next=structuredClone(archive);next.collection[id]=record;const button=dialog.querySelector<HTMLButtonElement>('[type="submit"]')!;button.disabled=true;try{await persist(next);}finally{button.disabled=false;}dialog.close();toast('价格与购买记录已保存');}catch(e){document.querySelector('#price-error')!.textContent=e instanceof Error?e.message:'保存失败';}})();};
}
function lotRow(l:{cost:string;qty:number}){return `<div class="lot-row"><label>购入单价<input name="cost" type="text" inputmode="decimal" autocomplete="off" placeholder="0.00" value="${esc(l.cost)}"></label><label>数量<input name="qty" type="number" min="1" max="999" step="1" value="${l.qty}"></label><button type="button" data-remove-lot aria-label="删除这笔购买记录">×</button></div>`;}
function exportBackup(){const b={...archive,exported_at:new Date().toISOString()};const url=URL.createObjectURL(new Blob([JSON.stringify(b,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=`通行认证收藏_${new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(new Date())}.json`;a.click();window.setTimeout(()=>URL.revokeObjectURL(url),1000);toast('已导出收藏备份');}
async function importFile(file?:File){if(!file)return;if(file.size>2*1024*1024)throw new Error('备份文件上限为 2 MB。');let value:unknown;try{value=JSON.parse(await file.text());}catch{throw new Error('无法读取 JSON 文件，请检查备份格式。');}const normalized=normalizeBackup(value,catalog);const conflicts=Object.keys(normalized.backup.collection).filter(id=>archive.collection[id]).length;const stats=calculateStats(catalog,normalized.backup.collection);if(!await confirmAction('导入备份',`将合并 ${Object.keys(normalized.backup.collection).length} 条记录，其中已拥有 ${stats.owned} 种；${conflicts} 条现有记录将采用备份内容。${esc(normalized.warnings.join(' '))} 导入前的收藏会自动保留一份，可在设置中恢复。`,'合并导入'))return;const next={...archive,collection:{...archive.collection,...normalized.backup.collection},unmapped:{...archive.unmapped,...normalized.backup.unmapped},followed_series:[...new Set([...(archive.followed_series??[]),...(normalized.backup.followed_series??[])])].sort()};await persist(next,archive);render();toast('备份已合并，导入前存档已保留');}
async function boot(){
  try{document.documentElement.dataset.theme=localStorage.getItem('pass-archive-theme')??(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');}catch{}
  try{const r=await fetch('/api/v1/catalog/',{signal:AbortSignal.timeout(3500)});if(!r.ok)throw new Error('API unavailable');catalog=await r.json();}catch{const r=await fetch('/catalog.json');if(!r.ok)throw new Error('目录暂时无法加载，请联网后刷新。');catalog=await r.json();}
  if(!Array.isArray(catalog.series)||!catalog.series.length)throw new Error('目录格式错误。');
  archive={schema_version:1,catalog_version:catalog.version,collection:{},unmapped:{}};
  try{const saved=await loadArchive();if(saved)archive=normalizeBackup(saved,catalog).backup;else{const legacy=localStorage.getItem('arknights_pass_collection_v3');if(legacy){archive=normalizeBackup(JSON.parse(legacy),catalog).backup;await saveArchive(archive);}}}catch{readOnly=true;toast('无法读取本机存档：请使用普通浏览模式，或导出旧备份后恢复。');}
  account=new AccountSync(catalog);
  writes=new ArchiveWrites(()=>account.backup,()=>account.user?.id??null,(next,previous)=>account.saveLocal(next,previous));
  account.onArchive=value=>{archive=value;opening.syncAccount(account.user!==null,archive.followed_series??[],account.user?.username??null);if(!saving)refreshArchiveUI();};
  account.onStatus=updateAccountUI;
  try{await account.initialize();archive=account.backup;}catch{readOnly=true;toast('本机存储不可用，暂不能记录或同步收藏。');}
  if(['catalog','collection','stats','settings'].includes(startView??''))page=startView!;
  shell();
  opening.syncAccount(account.user!==null,archive.followed_series??[],account.user?.username??null);
  opening.ready(catalog);
  if('serviceWorker' in navigator&&location.hostname!=='127.0.0.1'&&location.hostname!=='localhost')navigator.serviceWorker.register('/sw.js').catch(()=>{});
  window.addEventListener('online',()=>{const el=document.querySelector('#connection');if(el)el.textContent='在线';});window.addEventListener('offline',()=>{const el=document.querySelector('#connection');if(el)el.textContent='离线';});
  document.addEventListener('keydown',e=>{if(e.key==='/'&&!dialog.open&&!['INPUT','TEXTAREA','SELECT'].includes((e.target as HTMLElement)?.tagName)){e.preventDefault();document.querySelector<HTMLInputElement>('#search')?.focus();}});
}
opening.onBusiness=(next,id)=>{if(next==='account'){if(account.user)navigate('settings');else location.assign('/login.html');}else if(next==='series'){selected=catalog.series.find(series=>series.id===id)??null;page='catalog';query='';type='all';ownedFilter='all';shell();window.scrollTo({top:0,behavior:'instant'});}else navigate(next);};
opening.onFollowed=ids=>{const next=structuredClone(archive);next.followed_series=ids;void persist(next).catch(error=>{opening.syncAccount(account.user!==null,archive.followed_series??[],account.user?.username??null);opening.notify(error instanceof Error?error.message:'关注暂未保存。');});};
opening.onFailure=message=>toast(message);
void boot().catch(error=>{app.innerHTML=`<div class="initial-load"><h1>目录暂不可用</h1><p>${esc(error instanceof Error?error.message:error)}</p><button id="retry-load">重新加载</button></div>`;document.querySelector<HTMLButtonElement>('#retry-load')!.onclick=()=>location.reload();opening.abort();});
