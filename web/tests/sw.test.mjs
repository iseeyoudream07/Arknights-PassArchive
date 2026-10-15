import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
test('production shell precaches its real hashed assets and falls back offline without caching private requests', async()=>{
  const dist=path.resolve(import.meta.dirname,'../dist');
  const handlers=new Map(),stores=new Map();let offline=false;
  const key=r=>typeof r==='string'?new URL(r,'https://example.test').href:r.url;
  const fetchAsset=async r=>{if(offline)throw new Error('offline');const url=new URL(key(r));const file=path.join(dist,url.pathname==='/'?'index.html':decodeURIComponent(url.pathname));return new Response(fs.readFileSync(file));};
  const caches={keys:async()=>[...stores.keys()],delete:async k=>stores.delete(k),open:async name=>{
    if(!stores.has(name))stores.set(name,new Map());const entries=stores.get(name);
    return {put:async(r,v)=>entries.set(key(r),v.clone()),match:async r=>entries.get(key(r))?.clone(),addAll:async paths=>{for(const p of paths)entries.set(key(p),(await fetchAsset(p)).clone());}};
  }};
  const self={location:new URL('https://example.test'),addEventListener:(n,f)=>handlers.set(n,f),skipWaiting:async()=>{},clients:{claim:async()=>{}}};
  vm.runInNewContext(fs.readFileSync(path.join(dist,'sw.js'),'utf8'),{self,caches,fetch:fetchAsset,URL,Response});
  let task;handlers.get('install')({waitUntil:p=>task=p});await task;
  const saved=[...stores.values()][0];
  const manifest=JSON.parse(fs.readFileSync(path.join(dist,'app-cache.json'),'utf8'));
  const pkg=JSON.parse(fs.readFileSync(path.join(dist,'../package.json'),'utf8'));
  assert.equal(manifest.version,pkg.version);
  assert(fs.readFileSync(path.join(dist,'sw.js'),'utf8').includes('pass-archive-v'+pkg.version));
  for(const resource of manifest.resources)assert(saved.has(key(resource)),resource);
  assert(saved.has(key('/terminal.html')));
  assert(saved.has(key('/credits.html')));
  assert(saved.has(key('/login.html')));
  assert(saved.has(key('/rhine/assets/archive-cassette.glb')));
  assert(saved.has(key('/rhine/assets/archive-assembly.glb')));
  offline=true;
  let response;
  handlers.get('fetch')({request:{method:'GET',url:'https://example.test/unknown-page',mode:'navigate'},respondWith:p=>response=p});
  assert.match(await (await response).text(),/PASS ARCHIVE/);
  handlers.get('fetch')({request:{method:'GET',url:'https://example.test/catalog.json',mode:'cors'},respondWith:p=>response=p});
  assert.equal(JSON.parse(await(await response).text()).counts.passes,1019);
  handlers.get('fetch')({request:{method:'GET',url:'https://example.test/terminal.html?scene=archive',mode:'navigate'},respondWith:p=>response=p});
  assert.match(await(await response).text(),/RHINE TERMINAL/);
  handlers.get('fetch')({request:{method:'GET',url:'https://example.test/credits.html?offline',mode:'navigate'},respondWith:p=>response=p});
  assert.match(await(await response).text(),/credits-content/);
  let captured=false;
  handlers.get('fetch')({request:{method:'POST',url:'https://example.test/api/v1/stats/'},respondWith:()=>captured=true});
  assert.equal(captured,false);
  for(const url of ['/api/v1/auth/session/','/api/v1/me/archive/']){
    handlers.get('fetch')({request:{method:'GET',url:'https://example.test'+url},respondWith:()=>captured=true});
    assert.equal(captured,false);
  }
  handlers.get('fetch')({request:{method:'GET',url:'https://example.test/login.html?offline',mode:'navigate'},respondWith:p=>response=p});
  assert.match(await(await response).text(),/auth-content/);
});
