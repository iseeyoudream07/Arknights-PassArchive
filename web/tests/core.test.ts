import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {calculateStats,normalizeBackup,normalizeRecord} from '../src/core.ts';
import type {Catalog,Collection} from '../src/types.ts';
const catalog:Catalog=JSON.parse(fs.readFileSync(new URL('../../data/catalog.json',import.meta.url),'utf8'));
const fixtures=JSON.parse(fs.readFileSync(new URL('../../shared/upstream-fixtures.json',import.meta.url),'utf8'));
test('offline calculations match the pinned upstream across 24 representative portfolios',()=>{
  for(const f of fixtures){const s=calculateStats(catalog,f.collection as Collection);for(const [k,v]of Object.entries(f.expected))assert.equal(s[k as keyof typeof s],v,`${f.name}:${k}`);}
});
test('legacy backup maps E1/E2 and preserves unknown entries across export and reimport',()=>{
  const s=catalog.series[0],p=s.passes[0];
  const input={collection:{[s.name]:{ownedChars:{[p.label]:true},prices:{[p.label]:{market:'31',cost:'12.50'}}},'未来的盒':{ownedChars:{'待收录干员':true}}}};
  const {backup,warnings}=normalizeBackup(input,catalog);
  assert.deepEqual(backup.collection[p.id],{owned:true,market:'31.00',lots:[{cost:'12.50',qty:1}]});
  assert.equal(Object.keys(backup.unmapped).length,1);assert.equal(warnings.length,1);
  assert.deepEqual(normalizeBackup(JSON.parse(JSON.stringify(backup)),catalog).backup,backup);
});
test('invalid prices, quantities and booleans are rejected before saving',()=>{
  for(const r of [{owned:true,market:'-1'},{owned:true,market:'NaN'},{owned:true,market:'3250001'},{owned:true,lots:[{cost:'1',qty:0}]},{owned:'true'}])assert.throws(()=>normalizeRecord(r));
});
