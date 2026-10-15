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
