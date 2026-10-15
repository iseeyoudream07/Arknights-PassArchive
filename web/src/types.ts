export interface Pass {id:string; operator_id:string; name:string; label:string; variant:string|null; avatar:string|null; rarity:number|null; class:string; faction:string; en:string; py:string; pyi:string; official_unit_price:number|null; search_text:string}
export interface Series {id:string; name:string; type:string; year:string; box_number:string|null; release_date:string|null; replicate_dates:string[]; barcodes:string[]; image:string|null; official_box_price:number; passes:Pass[]}
export interface Catalog {version:string; generated_at:string; source_commit:string; sources:unknown[]; series:Series[]; counts:{series:number; passes:number; operators:number}; warnings:unknown[]}
export interface Lot {cost:string; qty:number}
export interface RecordEntry {owned:boolean; market:string|null; lots:Lot[]}
export type Collection = {[id:string]:RecordEntry};
export interface Backup {schema_version:1; catalog_version:string; collection:Collection; unmapped:{[id:string]:unknown}; followed_series?:string[]; exported_at?:string}
export interface Stats {total:number; owned:number; quantity:number; progress:number; official:string; market:string; cost:string; profit:string; priced_owned:number; completed_series:number; rules_version:string}
