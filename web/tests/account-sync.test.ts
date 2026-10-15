import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import type {Backup,Catalog} from '../src/types.ts';
import {emptyBackup} from '../src/sync-merge.ts';

const catalog=JSON.parse(fs.readFileSync(new URL('../../data/catalog.json',import.meta.url),'utf8')) as Catalog;
const passA=catalog.series[0].passes[0].id,passB=catalog.series[0].passes[1].id;
const callbacks=new Map<string,()=>void>();
Object.defineProperty(globalThis,'window',{value:{setTimeout:()=>0,clearTimeout:()=>{},setInterval:()=>0,clearInterval:()=>{},addEventListener:(n:string,f:()=>void)=>callbacks.set(n,f),removeEventListener:(n:string)=>callbacks.delete(n)},configurable:true});
Object.defineProperty(globalThis,'document',{value:{hidden:false,addEventListener:()=>{},removeEventListener:()=>{}},configurable:true});
Object.defineProperty(globalThis,'navigator',{value:{onLine:true},configurable:true});
Object.defineProperty(globalThis,'localStorage',{value:{getItem:()=>null},configurable:true});
const {AccountSync}=await import('../src/account-sync.ts');
const {loadAccountCache,saveArchive,loadArchive,clearAccountCache}=await import('../src/storage.ts');
const entry=(market='30.00')=>({owned:true,market,lots:[{cost:'20.05',qty:3}]});
function server(userId:number){
  let activeId=userId,offline=false,revision=0,cloud=emptyBackup(catalog),writes=0;
  globalThis.fetch=async(input,options={})=>{
    if(offline)throw new TypeError('offline');
    const path=String(input),body=options.body?JSON.parse(String(options.body)):{};
    const response=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
    if(path.endsWith('/session/'))return response({authenticated:true,user:{id:activeId,username:`test_${activeId}`},csrf_token:'test-csrf-not-a-real-credential'});
    if(path.endsWith('/archive/')){
      if(options.method==='PUT'){
        if(body.expected_user_id!==activeId)return response({detail:'account changed',code:'account_changed'},409);
        if(body.base_revision!==revision)return response({detail:'conflict',code:'revision_conflict',user_id:activeId,revision,backup:cloud,updated_at:'2026-10-14T00:00:00Z'},409);
        cloud=structuredClone(body.backup);revision++;writes++;
      }
      return response({user_id:activeId,revision,backup:cloud,updated_at:'2026-10-14T00:00:00Z'});
    }
    if(path.endsWith('/logout/'))return response({authenticated:false,user:null,csrf_token:'test-csrf'});
    throw new Error('Unexpected request');
  };
  return {get cloud(){return cloud;},get writes(){return writes;},setOffline(value:boolean){offline=value;},switchAccount(id:number){activeId=id;},remoteEdit(backup:Backup){cloud=structuredClone(backup);revision++;}};
}
test('offline changes survive a fresh controller and upload on reconnect without mixing guest data',async()=>{
  const guest=emptyBackup(catalog);guest.collection[passB]=entry('50.00');await saveArchive(guest);
  const remote=server(101),first=new AccountSync(catalog);
  await first.initialize();await first.sync();assert.deepEqual(remote.cloud.collection,{});
  remote.setOffline(true);
  const next=structuredClone(first.backup);next.collection[passA]=entry();await first.saveLocal(next);await first.sync();
  assert.equal(first.status,'offline');assert.equal((await loadAccountCache(101))!.backup.collection[passA].market,'30.00');first.dispose();
  const reopened=new AccountSync(catalog);await reopened.initialize();assert.equal(reopened.backup.collection[passA].lots[0].qty,3);
  remote.setOffline(false);await reopened.sync();assert.equal(remote.cloud.collection[passA].market,'30.00');assert.equal(remote.cloud.collection[passB],undefined);
  assert.equal((await loadArchive())!.collection[passB].market,'50.00');reopened.dispose();await clearAccountCache(101);
});
test('two open tabs retain disjoint local edits in an atomic IndexedDB merge',async()=>{
  const remote=server(102),first=new AccountSync(catalog),second=new AccountSync(catalog);
  await first.initialize();await first.sync();await second.initialize();await second.sync();remote.setOffline(true);
  const a=structuredClone(first.backup),b=structuredClone(second.backup);a.collection[passA]=entry('31.00');b.collection[passB]=entry('41.00');
  await Promise.all([first.saveLocal(a),second.saveLocal(b)]);
  const cached=(await loadAccountCache(102))!.backup;assert.equal(cached.collection[passA].market,'31.00');assert.equal(cached.collection[passB].market,'41.00');
  remote.setOffline(false);await first.sync();assert.equal(remote.cloud.collection[passA].market,'31.00');assert.equal(remote.cloud.collection[passB].market,'41.00');
  first.dispose();second.dispose();await clearAccountCache(102);
});
test('same-record local conflict stops instead of silently discarding one tab edit',async()=>{
  const remote=server(103),first=new AccountSync(catalog),second=new AccountSync(catalog);
  await first.initialize();await first.sync();await second.initialize();await second.sync();remote.setOffline(true);
  const a=structuredClone(first.backup),b=structuredClone(second.backup);a.collection[passA]=entry('31.00');b.collection[passA]=entry('41.00');
  await first.saveLocal(a);await assert.rejects(second.saveLocal(b),/另一标签页/);
  assert.equal((await loadAccountCache(103))!.backup.collection[passA].market,'31.00');first.dispose();second.dispose();await clearAccountCache(103);
});
test('changed cookie account never receives the previous account pending document',async()=>{
  const remote=server(104),sync=new AccountSync(catalog);await sync.initialize();await sync.sync();
  const next=structuredClone(sync.backup);next.collection[passA]=entry();await sync.saveLocal(next);remote.switchAccount(105);await sync.sync();
  assert.equal(sync.status,'sign-in');assert.equal(remote.writes,0);assert.equal((await loadAccountCache(104))!.backup.collection[passA].market,'30.00');
  sync.dispose();await clearAccountCache(104);
});
test('cloud conflict requires an explicit choice and preserves independent new records',async()=>{
  const remote=server(106),sync=new AccountSync(catalog);const baseline=emptyBackup(catalog);baseline.collection[passA]=entry();remote.remoteEdit(baseline);
  await sync.initialize();await sync.sync();
  const local=structuredClone(sync.backup);local.collection[passA]=entry('31.00');local.collection[passB]=entry('41.00');await sync.saveLocal(local);
  const cloud=structuredClone(baseline);cloud.collection[passA]=entry('51.00');remote.remoteEdit(cloud);await sync.sync();assert.equal(sync.status,'conflict');assert.equal(remote.writes,0);
  await sync.resolve('cloud');assert.equal(remote.cloud.collection[passA].market,'51.00');assert.equal(remote.cloud.collection[passB].market,'41.00');
  sync.dispose();await clearAccountCache(106);
});
