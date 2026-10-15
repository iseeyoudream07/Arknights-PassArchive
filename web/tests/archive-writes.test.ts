import test from 'node:test';
import assert from 'node:assert/strict';
import {ArchiveWrites} from '../src/archive-writes.ts';
import type {Backup} from '../src/types.ts';

const blank=():Backup=>({schema_version:1,catalog_version:'fixture',collection:{},unmapped:{},followed_series:[]});
const own=(base:Backup,id:string,market:string|null=null)=>({...structuredClone(base),collection:{...base.collection,[id]:{owned:true,market,lots:[]}}});

test('rapid independent checkmarks survive delayed storage without overwriting the first one',async()=>{
  let archive=blank(),release!:()=>void,calls=0;
  const blocked=new Promise<void>(resolve=>release=resolve);
  const writes=new ArchiveWrites(()=>archive,()=>1,async next=>{if(calls++===0)await blocked;archive=structuredClone(next);});
  const first=writes.enqueue(own(archive,'a')),second=writes.enqueue(own(archive,'b'));
  await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,1);
  release();await Promise.all([first,second]);
  assert.deepEqual(Object.keys(archive.collection).sort(),['a','b']);
});

test('competing queued edits of the same pass stop instead of silently choosing a price',async()=>{
  let archive=blank(),release!:()=>void,calls=0;
  const blocked=new Promise<void>(resolve=>release=resolve);
  const writes=new ArchiveWrites(()=>archive,()=>1,async next=>{if(calls++===0)await blocked;archive=structuredClone(next);});
  const first=writes.enqueue(own(archive,'a','10.00')),second=writes.enqueue(own(archive,'a','20.00'));
  const rejected=assert.rejects(second,/同一条记录/);
  release();await first;await rejected;
  assert.equal(archive.collection.a.market,'10.00');assert.equal(calls,1);
});

test('a queued edit cannot write into an account selected while the prior save was pending',async()=>{
  let owner=1,release!:()=>void,calls=0;
  const archives:Record<number,Backup>={1:blank(),2:blank()};
  const blocked=new Promise<void>(resolve=>release=resolve);
  const writes=new ArchiveWrites(()=>archives[owner],()=>owner,async next=>{
    const target=owner;calls++;await blocked;archives[target]=structuredClone(next);
  });
  const first=writes.enqueue(own(archives[1],'a')),second=writes.enqueue(own(archives[1],'b'));
  const rejected=assert.rejects(second,/账号已变化/);
  await new Promise(resolve=>setImmediate(resolve));owner=2;release();await first;await rejected;
  assert.equal(calls,1);assert.deepEqual(archives[2].collection,{});assert.equal(archives[1].collection.a.owned,true);
});
