import type {Backup} from './types.ts';
import {mergeBackups} from './sync-merge.ts';

/** Serialize storage while keeping independent edits made before a prior save finishes. */
export class ArchiveWrites {
  private tail:Promise<void>=Promise.resolve();
  constructor(private read:()=>Backup,private owner:()=>number|null,
    private save:(backup:Backup,previous?:Backup)=>Promise<void>){}
  enqueue(next:Backup,restorePoint=false){
    const observed=structuredClone(this.read()),owner=this.owner();
    const operation=this.tail.then(async()=>{
      if(this.owner()!==owner)throw new Error('账号已变化，请重新查看后再保存。');
      const latest=this.read(),merged=mergeBackups(observed,next,latest);
      if(merged.conflicts.length)throw new Error('另一设备更新了同一条记录，请重新查看后再编辑。');
      await this.save(merged.backup,restorePoint?structuredClone(latest):undefined);
    });
    this.tail=operation.catch(()=>{});
    return operation;
  }
}
