/*
 * 共享业务类型：目录、通行证、购买批次、收藏、备份与统计。
 * 目录和收藏分开：收藏按稳定 pass.id 关联目录；金额以元为单位的字符串表示。
 */
/**
 * 单张通行证的目录信息；id 区分系列与精英阶段，operator_id 关联同名干员。
 * label 含精一/精二标记；official_unit_price 为 null 时按所属系列整盒计价。
 */
export interface Pass {
    id: string;
    operator_id: string;
    name: string;
    label: string;
    variant: string | null;
    avatar: string | null;
    rarity: number | null;
    class: string;
    faction: string;
    en: string;
    py: string;
    pyi: string;
    official_unit_price: number | null;
    search_text: string;
}
/**
 * 一个系列/盒的目录记录；box_number 保留字符串形式，barcodes 可包含多个包装条码。
 * release_date 可未知，replicate_dates 记录复刻日期；passes 是盒内实际收录列表。
 */
export interface Series {
    id: string;
    name: string;
    type: string;
    year: string;
    box_number: string | null;
    release_date: string | null;
    replicate_dates: string[];
    barcodes: string[];
    image: string | null;
    official_box_price: number;
    passes: Pass[];
}
/**
 * 统一目录快照；version 用于识别内容版本，counts 用于展示总量。
 */
export interface Catalog {
    version: string;
    generated_at: string;
    source_commit: string;
    sources: unknown[];
    series: Series[];
    counts: {
        series: number;
        passes: number;
        operators: number;
    };
    warnings: unknown[];
}
/**
 * 一笔购买批次；cost 是单张购入价（元、两位小数字符串），qty 是购买数量。
 */
export interface Lot {
    cost: string;
    qty: number;
}
/**
 * 用户对单张通行证的记录；owned 表示拥有，market 是当前单张市价，lots 是购买批次。
 */
export interface RecordEntry {
    owned: boolean;
    market: string | null;
    lots: Lot[];
}
/**
 * 按通行证稳定 ID 索引的收藏字典；未出现的 ID 视作尚未记录。
 */
export type Collection = {
    [id: string]: RecordEntry;
};
/**
 * 标准备份文档；unmapped 保留无法映射的旧数据，followed_series 保存关注系列。
 */
export interface Backup {
    schema_version: 1;
    catalog_version: string;
    collection: Collection;
    unmapped: {
        [id: string]: unknown;
    };
    followed_series?: string[];
    exported_at?: string;
}
/**
 * 统计结果；owned 是不同款数，quantity 是购买总张数，金额字段为元字符串。
 * profit 仅扣除已填写正市价条目的成本，rules_version 标明统计口径。
 */
export interface Stats {
    total: number;
    owned: number;
    quantity: number;
    progress: number;
    official: string;
    market: string;
    cost: string;
    profit: string;
    priced_owned: number;
    completed_series: number;
    rules_version: string;
}
