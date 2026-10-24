/*
 * 把业务目录转换成三维终端显示的档案记录；保留 seriesId 以回到业务页面。
 */
import type { Catalog, Series } from './types.ts';
/**
 * 终端显示模型；id 是终端编号，seriesId 才是业务目录的稳定系列 ID。
 */
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
    main: '主线通行认证', sp: '音律联觉', carnival: '嘉年华', collab: '联动系列',
    elite: '精英干员', special: '特别系列', endfield: '终末地',
};
// The reference cinema camera is calibrated around physical lane 2.
/**
 * 三维列与业务分类的对应顺序；镜头以参考物理列 2 为中心校准。
 */
export const rhineColumnTypes = ['carnival', 'collab', 'main', 'sp', 'endfield', 'special', 'elite'];
/**
 * 把系列的干员、日期、条码和参考价转换成三维档案文案及搜索文本。
 */
export function makeRhineRecords(catalog: Catalog): RhineRecord[] {
    return catalog.series.map((series: Series, index) => {
        const title = series.name.replace(/^明日方舟/, '');
        const names = [...new Set(series.passes.map(pass => pass.name.trim()).filter(Boolean))];
        const lead = names.join('、');
        return ({
            id: `X-${String(index + 1).padStart(3, '0')}`,
            seriesId: series.id,
            title,
            en: `PASS ARCHIVE / SERIES ${String(index + 1).padStart(3, '0')}`,
            department: series.box_number && /^\d+(?:\.\d+)?$/.test(series.box_number) ? `通行认证 ${series.box_number}` : title,
            category: seriesLabels[series.type] ?? series.type,
            date: series.release_date || series.year || '发行日期待补充',
            lead,
            clearance: 'COLLECTION ARCHIVE',
            abstract: `${series.name}，收录 ${series.passes.length} 款通行认证。进入收藏管理，可标记已拥有的款式并填写市价和购买记录。`,
            findings: [
                `整盒官方参考价 ¥${series.official_box_price.toFixed(2)}`,
                `包装条码：${series.barcodes.join(' / ') || '暂无资料'}`,
                `复刻日期：${series.replicate_dates.join(' / ') || '暂无资料'}`,
                `盒内通行认证：${lead}`,
            ],
            source: '/credits.html',
            searchText: `${series.name} ${series.box_number ?? ''} ${series.barcodes.join(' ')} ${series.passes.map(pass => pass.search_text).join(' ')}`.toLowerCase(),
        });
    });
}
