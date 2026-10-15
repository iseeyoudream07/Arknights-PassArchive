import type {Catalog, Collection, RecordEntry, Backup, Stats} from './types.ts';

export function normalizeMoney(v:unknown):string|null {
  if (v === '' || v === undefined || v === null) return null;
  const s = String(v);
  if (typeof v === 'boolean' || !/^\d+(\.\d{1,2})?$/.test(s) || Number(s) > 3250000) throw new Error('金额须为非负数，最多两位小数，上限 3250000 元。');
  const [a,b=''] = s.split('.');
  return `${BigInt(a)}.${b.padEnd(2,'0')}`;
}
export function normalizeRecord(v:unknown):RecordEntry {
  if (!v || typeof v !== 'object') throw new Error('收藏条目格式错误。');
  const r=v as Partial<RecordEntry>;
  if (r.owned !== undefined && typeof r.owned !== 'boolean') throw new Error('拥有状态须为布尔值。');
  const owned=r.owned ?? false;
  if (r.lots !== undefined && (!Array.isArray(r.lots) || r.lots.length>1000)) throw new Error('购买记录格式错误。');
  const lots=(r.lots ?? []).map(l=> {
    if (!l || !Number.isInteger(l.qty) || l.qty<1 || l.qty>999) throw new Error('每条购买数量须为 1–999 的整数。');
    return {cost:normalizeMoney(l.cost) ?? '0.00',qty:l.qty};
  });
  const market=normalizeMoney(r.market);
  return {owned, market:owned?market:null, lots:owned?lots:[]};
}
const cents=(v:string|null)=>BigInt((v??'0').split('.')[0])*100n+BigInt((v??'0').split('.')[1]?.padEnd(2,'0') ?? '0');
const currency=(n:bigint)=>`${n<0n?'-':''}${(n<0n?-n:n)/100n}.${((n<0n?-n:n)%100n).toString().padStart(2,'0')}`;
export function calculateStats(catalog:Catalog, collection:Collection):Stats {
  let official=0n,market=0n,cost=0n,pricedCost=0n,owned=0,quantity=0,priced=0,complete=0,total=0;
  for (const s of catalog.series) {
    let boxOwned=0;
    const fixed=s.passes[0]?.official_unit_price===null;
    for (const p of s.passes) {
      total++;
      if (!collection[p.id]?.owned) continue;
      const r=normalizeRecord(collection[p.id]); owned++;boxOwned++;
      const q=r.lots.reduce((a,l)=>a+l.qty,0);
      const c=r.lots.reduce((a,l)=>a+cents(l.cost)*BigInt(l.qty),0n);
      const m=cents(r.market); quantity+=q;cost+=c;market+=m*BigInt(q);
      if (m>0n) {priced++;pricedCost+=c;}
      if (!fixed) official+=cents(String(p.official_unit_price))*BigInt(q);
    }
    if (fixed&&boxOwned) official+=cents(String(s.official_box_price));
    if (boxOwned&&boxOwned===s.passes.length) complete++;
  }
  return {total,owned,quantity,progress:total?Math.round(owned/total*1000)/10:0,official:currency(official),market:currency(market),cost:currency(cost),profit:currency(market-pricedCost),priced_owned:priced,completed_series:complete,rules_version:'upstream-v3-compat-1'};
}
export function normalizeBackup(value:unknown,catalog:Catalog):{backup:Backup;warnings:string[]} {
  if (!value||typeof value!=='object'||Array.isArray(value)) throw new Error('备份根节点须为对象。');
  const payload=value as {schema_version?:number; collection?:unknown; unmapped?:unknown; followed_series?:unknown};
  if (payload.schema_version!==undefined && payload.schema_version!==1) throw new Error('暂不支持此备份版本。');
  const raw=(payload.collection??payload) as {[k:string]:unknown};
  if (!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).length>10000) throw new Error('收藏数据格式错误或超出大小限制。');
  const known=new Map(catalog.series.flatMap(s=>s.passes.map(p=>[p.id,p] as const)));
  const collection:Collection=Object.create(null);
  const unmapped:{[id:string]:unknown}=Object.create(null);
  if (payload.schema_version!==undefined&&payload.unmapped!==undefined) {
    if (!payload.unmapped||typeof payload.unmapped!=='object'||Array.isArray(payload.unmapped)) throw new Error('待匹配数据格式错误。');
    Object.assign(unmapped,payload.unmapped);
  }
  if (payload.schema_version!==undefined||Object.keys(raw).every(k=>known.has(k))) {
    for(const [id,v] of Object.entries(raw)) {if(known.has(id))collection[id]=normalizeRecord(v);else unmapped[id]=v;}
  } else {
    const legacy=new Map(catalog.series.flatMap(s=>s.passes.map(p=>[JSON.stringify([s.name,p.label]),p.id] as const)));
    for(const [series,v] of Object.entries(raw)) {
      if(!v||typeof v!=='object'||Array.isArray(v)) throw new Error('旧版系列条目格式错误。');
      const entry=v as {ownedChars?:{[k:string]:unknown};prices?:{[k:string]:{market?:unknown;cost?:unknown;lots?:unknown}}};
      const own=entry.ownedChars??{},prices=entry.prices??{};
      if(typeof own!=='object'||Array.isArray(own)||typeof prices!=='object'||Array.isArray(prices)||!own||!prices) throw new Error('旧版拥有状态或价格格式错误。');
      for(const label of new Set([...Object.keys(own),...Object.keys(prices)])) {
        const pr=prices[label]??{};
        if(typeof pr!=='object'||Array.isArray(pr)) throw new Error('旧版价格格式错误。');
        let lots=pr.lots;
        if(lots===undefined||lots===null) lots=pr.cost!==undefined&&pr.cost!==null&&pr.cost!==''?[{cost:pr.cost,qty:1}]:[];
        else if(Array.isArray(lots))lots=lots.filter(l=>l&&l.cost!==undefined&&l.cost!==null&&l.cost!=='');
        const record=normalizeRecord({owned:Boolean(own[label]),market:pr.market,lots});
        const id=legacy.get(JSON.stringify([series,label]));
        if(id)collection[id]=record;else unmapped[`${series} / ${label}`]={legacy_series:series,legacy_label:label,...record};
      }
    }
  }
  const followed=payload.followed_series??[];
  const seriesIds=new Set(catalog.series.map(series=>series.id));
  if(!Array.isArray(followed)||followed.length>2000||followed.some(id=>typeof id!=='string'||!seriesIds.has(id)))throw new Error('关注系列格式错误。');
  const count=Object.keys(unmapped).length;
  return{backup:{schema_version:1,catalog_version:catalog.version,collection,unmapped,followed_series:[...new Set(followed)].sort()},warnings:count?[`${count} 项无法匹配当前目录，已保留在待匹配数据中。`]:[]};
}
