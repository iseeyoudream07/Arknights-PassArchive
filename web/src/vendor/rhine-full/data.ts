/*
 * 模块导读：将业务目录转换成三维档案、分类列及位置索引，连接 rhine-records 与场景。
 * 此目录基于 RhineLabUI；原版权与来源见 NOTICE.md，具体调用关系见 docs/code-guide-zh.md。
 */

import {makeRhineRecords, rhineColumnTypes, seriesLabels, type RhineRecord} from '../../rhine-records.ts';
import {passContext} from '../../terminal-context.ts';

export type ArchiveRecord = RhineRecord;
export const records: ArchiveRecord[] = makeRhineRecords(passContext().catalog);
export const archiveColumns = rhineColumnTypes.map(type=>seriesLabels[type]).filter(category=>records.some(record=>record.category===category));
export const categories = ['全部档案',...archiveColumns];
export function columnFiles(lane: number) {
  return records.map((record,index)=>({record,index})).filter(({record})=>record.category===archiveColumns[lane]).map(({index})=>index);
}
export function fileLocation(index: number) {
  const lane=archiveColumns.indexOf(records[index].category);
  const row=12+columnFiles(lane).indexOf(index);
  return {lane,row,slot:lane*32+row};
}
