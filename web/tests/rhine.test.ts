import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {makeRhineRecords,rhineColumnTypes,seriesLabels} from '../src/rhine-records.ts';
import {baselineSelectionWave,returnStep,ALIGNMENT_EPSILON} from '../src/vendor/rhine-full/motion.ts';
import {ThemeWave} from '../src/vendor/rhine-full/theme-motion.ts';

const catalog=JSON.parse(fs.readFileSync(new URL('../public/catalog.json',import.meta.url),'utf8'));
test('all 106 real series retain stable business IDs and use independent finite display numbers',()=>{
  const records=makeRhineRecords(catalog);
  assert.equal(records.length,106);
  assert.equal(new Set(records.map(record=>record.seriesId)).size,106);
  records.forEach((record,index)=>{
    assert.equal(record.seriesId,catalog.series[index].id);
    assert.equal(Number(record.id.slice(2)),index+1);
  });
  assert.equal(rhineColumnTypes[2],'main');
  assert(records[54].searchText.includes('55.0'));
});
test('series descriptions use literal box numbers and list each operator once without merging pass variants',()=>{
  const records=makeRhineRecords(catalog);
  records.forEach((record,index)=>{
    const series=catalog.series[index];
    const names=[...new Set(series.passes.map((pass:{name:string})=>pass.name.trim()).filter(Boolean))];
    assert.equal(record.lead,names.join('、'));
    assert.equal(record.findings[3],`盒内通行认证：${names.join('、')}`);
    if(series.type==='main')assert.equal(record.department,`通行认证 ${series.box_number}`);
    assert(!record.lead.includes('·精一'));
    assert(!record.lead.includes('·精二'));
  });
  assert.equal(records[0].department,'通行认证 1.0');
  assert.equal(records[54].department,'通行认证 55.0');
  assert.equal(catalog.series[0].passes.length,14);
  assert.equal(records[0].lead.split('、').length,8);
  assert.equal(records[99].department,'白名单凭证3.0');
});
test('continuous loop maps all unequal columns correctly across 20000 directional moves',async()=>{
  (globalThis as unknown as {window:unknown}).window={passTerminalContext:{catalog}};
  const {selectionCell,fileAtCell,wrap}=await import('../src/vendor/rhine-full/archive-loop.ts');
  const {columnFiles,fileLocation,archiveColumns}=await import('../src/vendor/rhine-full/data.ts');
  assert.deepEqual(archiveColumns,rhineColumnTypes.map(type=>seriesLabels[type]));
  let index=0,cell={lane:2,row:12};
  for(let step=0;step<20000;step++){
    const direction=step%3?1:-1;
    const axis=step%9?'row':'lane';
    const current=fileLocation(index);
    const files=columnFiles(axis==='row'?current.lane:wrap(current.lane+direction,7));
    index=axis==='row'?files[wrap(files.indexOf(index)+direction,files.length)]:files[0];
    const next=selectionCell(index,cell,{axis,direction});
    assert.equal(fileAtCell(next),index);
    if(axis==='row')assert.equal(next.row-cell.row,direction);
    else assert.equal(next.lane-cell.lane,direction);
    cell=next;
  }
  for(let i=0;i<106;i++)assert.equal(fileAtCell(fileLocation(i)),i);
});
test('hiding an iframe never resizes its Three.js camera or allocates zero-sized render buffers',async()=>{
  (globalThis as unknown as {window:unknown}).window={passTerminalContext:{catalog}};
  const {ArchiveScene}=await import('../src/vendor/rhine-full/scene.ts');
  let invalidations=0;
  const camera={aspect:1.6,fov:3.33,projectionMatrix:{elements:[1,2,3,4]}};
  for(const [width,height] of [[0,0],[1728,0],[0,1080],[1728,1080]]){
    const retained={container:{clientWidth:width,clientHeight:height,getBoundingClientRect:()=>({width:0,height:0})},camera,loaded:true,last:16,clock:16,renderState:{invalidate:()=>invalidations++}};
    ArchiveScene.prototype.resize.call(retained as unknown as InstanceType<typeof ArchiveScene>);
    ArchiveScene.prototype.update.call(retained as unknown as InstanceType<typeof ArchiveScene>,38);
    assert.deepEqual(camera,{aspect:1.6,fov:3.33,projectionMatrix:{elements:[1,2,3,4]}});
    assert.equal(retained.last,16);
    assert.equal(retained.clock,16);
  }
  assert.equal(invalidations,0);
});
test('chosen baseline keeps the negative wave and aligns before return descent',()=>{
  assert.ok(baselineSelectionWave(0,0.7)<0);
  let angle=1;
  for(let frame=0;frame<200;frame++)angle=returnStep(angle,1/60);
  assert.equal(angle,0);
  assert.equal(returnStep(ALIGNMENT_EPSILON/2,1/60),0);
});
test('theme wave reverses from its visible state instead of resetting the material',()=>{
  const wave=new ThemeWave();
  wave.set(true,0,{row:12,lane:2});
  wave.beginFrame();
  const before=wave.sample({row:12,lane:2},0.25);
  wave.set(false,0.25,{row:12,lane:2});
  assert.equal(wave.sample({row:12,lane:2},0.25),before);
  assert.equal(wave.sample({row:12,lane:2},2),0);
});
