import type {Catalog, Series} from './types.ts';

export interface RhineRecord {
  id: string;
  seriesId: string;
  title: string;
  en: string;
  department: string;
  category: string;
  date: string;
  lead: string;
  clearance: string;
  abstract: string;
  findings: string[];
  source: string;
  searchText: string;
}
export const seriesLabels: Record<string, string> = {
  main:'主线通行认证',sp:'音律联觉',carnival:'嘉年华',collab:'联动系列',
  elite:'精英干员',special:'特别系列',endfield:'终末地',
};
// The reference cinema camera is calibrated around physical lane 2.
export const rhineColumnTypes = ['carnival','collab','main','sp','endfield','special','elite'];
export function makeRhineRecords(catalog: Catalog): RhineRecord[] {
  return catalog.series.map((series: Series, index) => {
    const title=series.name.replace(/^明日方舟/,'');
    const names=[...new Set(series.passes.map(pass=>pass.name.trim()).filter(Boolean))];
    const lead=names.join('、');
    return ({
    id: `X-${String(index + 1).padStart(3,'0')}`,
    seriesId: series.id,
    title,
    en: `PASS ARCHIVE / SERIES ${String(index + 1).padStart(3,'0')}`,
    department: series.box_number && /^\d+(?:\.\d+)?$/.test(series.box_number) ? `通行认证 ${series.box_number}` : title,
    category: seriesLabels[series.type] ?? series.type,
    date: series.release_date || series.year || '暂无日期资料',
    lead,
    clearance: 'COLLECTION ARCHIVE',
    abstract: `${series.name}，收录 ${series.passes.length} 种通行认证。进入通行证管理可标记已拥有、记录价格与购买批次。`,
    findings: [
      `整盒官方参考价 ¥${series.official_box_price.toFixed(2)}`,
      `包装条码：${series.barcodes.join(' / ') || '暂无资料'}`,
      `复刻日期：${series.replicate_dates.join(' / ') || '暂无资料'}`,
      `盒内通行认证：${lead}`,
    ],
    source: '/credits.html',
    searchText: `${series.name} ${series.box_number??''} ${series.barcodes.join(' ')} ${series.passes.map(pass=>pass.search_text).join(' ')}`.toLowerCase(),
    });
  });
}
