import type {Backup} from './types.ts';
import type {AccountUser} from './account-api.ts';
export interface AccountCache {user:AccountUser;revision:number;base:Backup;backup:Backup;syncedAt:string|null}
const dbPromise=new Promise<IDBDatabase>((resolve,reject)=>{
  const r=indexedDB.open('arknights-pass-archive',1);
  r.onupgradeneeded=()=>r.result.createObjectStore('archive');
  r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
});
export async function loadArchive():Promise<Backup|null>{
  const db=await dbPromise;
  return new Promise((resolve,reject)=>{const t=db.transaction('archive','readonly');const r=t.objectStore('archive').get('current');r.onsuccess=()=>resolve(r.result??null);r.onerror=()=>reject(r.error);});
}
export async function saveArchive(backup:Backup,previous?:Backup):Promise<void>{
  const db=await dbPromise;
  return new Promise((resolve,reject)=>{const t=db.transaction('archive','readwrite');t.objectStore('archive').put(structuredClone(backup),'current');if(previous)t.objectStore('archive').put(structuredClone(previous),'before-import');t.oncomplete=()=>resolve();t.onerror=()=>reject(t.error);t.onabort=()=>reject(t.error);});
}
export async function loadBeforeImport():Promise<Backup|null>{
  const db=await dbPromise;
  return new Promise((resolve,reject)=>{const r=db.transaction('archive').objectStore('archive').get('before-import');r.onsuccess=()=>resolve(r.result??null);r.onerror=()=>reject(r.error);});
}
export async function readStored<T>(key:string):Promise<T|null>{
  const db=await dbPromise;
  return new Promise((resolve,reject)=>{const r=db.transaction('archive').objectStore('archive').get(key);r.onsuccess=()=>resolve(r.result??null);r.onerror=()=>reject(r.error);});
}
export const loadAccountCache=(id:number)=>readStored<AccountCache>(`account:${id}`);
export const loadActiveAccount=()=>readStored<AccountUser>('active-account');
export async function storeActiveAccount(user:AccountUser|null){
  const db=await dbPromise;
  await new Promise<void>((resolve,reject)=>{const t=db.transaction('archive','readwrite');if(user)t.objectStore('archive').put(user,'active-account');else t.objectStore('archive').delete('active-account');t.oncomplete=()=>resolve();t.onerror=()=>reject(t.error);});
}
// The read/merge/write transaction also protects browsers without Web Locks.
export async function updateAccountCache(id:number,change:(current:AccountCache|null)=>AccountCache,previous?:Backup):Promise<AccountCache>{
  const db=await dbPromise;
  return new Promise((resolve,reject)=>{
    const t=db.transaction('archive','readwrite'),store=t.objectStore('archive'),read=store.get(`account:${id}`);
    let value:AccountCache;
    read.onsuccess=()=>{try{value=change(read.result??null);store.put(structuredClone(value),`account:${id}`);if(previous)store.put(structuredClone(previous),`before-import:${id}`);}catch(error){t.abort();reject(error);}};
    t.oncomplete=()=>resolve(value);t.onerror=()=>reject(t.error);t.onabort=()=>reject(t.error??new Error('本机记录未能保存。'));
  });
}
export async function clearAccountCache(id:number){
  const db=await dbPromise;
  await new Promise<void>((resolve,reject)=>{const t=db.transaction('archive','readwrite'),s=t.objectStore('archive');s.delete(`account:${id}`);s.delete(`before-import:${id}`);s.delete('active-account');t.oncomplete=()=>resolve();t.onerror=()=>reject(t.error);});
}
