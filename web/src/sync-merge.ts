import type {Backup, Catalog} from './types.ts';

export interface MergeConflict {section:'collection'|'unmapped';id:string;local:unknown;cloud:unknown}
export function emptyBackup(catalog:Catalog):Backup {return {schema_version:1,catalog_version:catalog.version,collection:{},unmapped:{},followed_series:[]};}
export function canonical(value:unknown):string {
  if(value===undefined)return 'undefined';
  if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`;
  if(value&&typeof value==='object')return `{${Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  return JSON.stringify(value);
}
export const equal=(a:unknown,b:unknown)=>canonical(a)===canonical(b);
export function sameBackup(a:Backup,b:Backup) {return equal(a.collection,b.collection)&&equal(a.unmapped,b.unmapped)&&equal(a.followed_series??[],b.followed_series??[]);}
export function mergeBackups(base:Backup,local:Backup,cloud:Backup,choice?:'local'|'cloud') {
  const conflicts:MergeConflict[]=[];
  const backup:Backup={schema_version:1,catalog_version:cloud.catalog_version,collection:Object.create(null),unmapped:Object.create(null),followed_series:[]};
  for(const section of ['collection','unmapped'] as const){
    const previous=base[section],ours=local[section],theirs=cloud[section];
    for(const id of new Set([...Object.keys(previous),...Object.keys(ours),...Object.keys(theirs)])){
      let value:unknown;
      if(equal(ours[id],theirs[id]))value=ours[id];
      else if(equal(ours[id],previous[id]))value=theirs[id];
      else if(equal(theirs[id],previous[id]))value=ours[id];
      else {conflicts.push({section,id,local:ours[id],cloud:theirs[id]});value=choice==='cloud'?theirs[id]:ours[id];}
      if(value!==undefined)(backup[section] as Record<string,unknown>)[id]=structuredClone(value);
    }
  }
  const previous=new Set(base.followed_series??[]),ours=new Set(local.followed_series??[]),theirs=new Set(cloud.followed_series??[]);
  backup.followed_series=[...new Set([...previous,...ours,...theirs])].filter(id=>ours.has(id)===previous.has(id)?theirs.has(id):ours.has(id)).sort();
  return {backup,conflicts};
}
