import type {Backup,Catalog} from './types.ts';
import {normalizeBackup} from './core.ts';
import {AccountApi,ApiError,type AccountUser} from './account-api.ts';
import {emptyBackup,mergeBackups,sameBackup,type MergeConflict} from './sync-merge.ts';
import {loadArchive,saveArchive,loadAccountCache,loadActiveAccount,storeActiveAccount,updateAccountCache,clearAccountCache,readStored,type AccountCache} from './storage.ts';

interface CloudState {user_id:number;revision:number;backup:Backup;updated_at:string}
export type SyncStatus='guest'|'syncing'|'synced'|'pending'|'offline'|'conflict'|'sign-in'|'error';
export class AccountSync {
  user:AccountUser|null=null;
  status:SyncStatus='guest';
  message='登录后可跨设备同步';
  backup:Backup;
  guest:Backup;
  conflicts:MergeConflict[]=[];
  syncedAt:string|null=null;
  private api=new AccountApi();
  private cache:AccountCache|null=null;
  private conflictCloud:CloudState|null=null;
  private timer=0;
  private poll=0;
  private job:Promise<void>|null=null;
  private requested=false;
  private reconnect=()=>{if(this.user)void this.sync();};
  private visible=()=>{if(this.user&&!document.hidden)void this.sync();};
  onArchive:(backup:Backup)=>void=()=>{};
  onStatus:()=>void=()=>{};
  constructor(private catalog:Catalog){this.backup=this.guest=emptyBackup(catalog);}
  private state(status:SyncStatus,message:string){this.status=status;this.message=message;this.onStatus();}
  private apply(backup:Backup){const changed=!sameBackup(this.backup,backup);this.backup=backup;if(changed)this.onArchive(backup);}
  private async lock<T>(action:()=>Promise<T>):Promise<T>{
    if(this.user&&navigator.locks)return navigator.locks.request(`pass-archive-account-${this.user.id}`,action);
    return action();
  }
  async initialize(){
    const guestSaved=await loadArchive();
    this.guest=normalizeBackup(guestSaved??emptyBackup(this.catalog),this.catalog).backup;
    // Migrate the original reference's local bookmarks into the guest document once.
    if(!guestSaved?.followed_series){try{const old=JSON.parse(localStorage.getItem('pass-archive-followed-series')??'[]');if(Array.isArray(old)){const ids=new Set(this.catalog.series.map(s=>s.id));this.guest.followed_series=old.filter((id:unknown)=>typeof id==='string'&&ids.has(id));}}catch{}}
    if(!guestSaved?.followed_series)await saveArchive(this.guest);
    this.apply(this.guest);
    try{const session=await this.api.session();this.user=session.user;}catch(error){if(error instanceof ApiError&&(error.status===0||error.status>=500))this.user=await loadActiveAccount();else throw error;}
    if(this.user){
      const blank=emptyBackup(this.catalog);
      this.cache=await loadAccountCache(this.user.id)??{user:this.user,revision:0,base:blank,backup:blank,syncedAt:null};
      this.cache.backup=normalizeBackup(this.cache.backup,this.catalog).backup;
      this.cache.base=normalizeBackup(this.cache.base,this.catalog).backup;
      this.syncedAt=this.cache.syncedAt;
      await storeActiveAccount(this.user);
      this.apply(this.cache.backup);
      this.state('pending','正在连接账号存档');
      void this.sync();
    }else{await storeActiveAccount(null);this.state('guest','本机存档');}
    this.poll=window.setInterval(()=>{if(this.user&&navigator.onLine&&!document.hidden)void this.sync();},30000);
    window.addEventListener('online',this.reconnect);
    document.addEventListener('visibilitychange',this.visible);
  }
  dispose(){window.clearTimeout(this.timer);window.clearInterval(this.poll);window.removeEventListener('online',this.reconnect);document.removeEventListener('visibilitychange',this.visible);}
  async saveLocal(next:Backup,previous?:Backup){
    const observed=structuredClone(this.backup);
    if(!this.user){await saveArchive(next,previous);this.guest=next;this.apply(next);return;}
    await this.lock(async()=>{
      const fallback=this.cache!;
      this.cache=await updateAccountCache(this.user!.id,stored=>{
        const latest=stored??fallback;
        const merged=mergeBackups(observed,next,latest.backup);
        if(merged.conflicts.length)throw new Error('另一标签页修改了同一条记录，请刷新后再编辑。');
        return {...latest,backup:merged.backup};
      },previous);
      this.apply(this.cache.backup);
      this.conflicts=[];this.conflictCloud=null;
      this.state('pending','已保存到本机，等待同步');
    });
    window.clearTimeout(this.timer);this.timer=window.setTimeout(()=>void this.sync(),900);
  }
  async beforeImport(){return this.user?readStored<Backup>(`before-import:${this.user.id}`):readStored<Backup>('before-import');}
  async sync(){
    if(!this.user)return;
    if(this.job){this.requested=true;return this.job;}
    this.job=this.lock(async()=>{
      do {
        this.requested=false;
        try{await this.runSync();}catch(error){
          const apiError=error instanceof ApiError?error:null;
          this.state(apiError?.status===0?'offline':apiError?.status===401||apiError?.status===403||apiError?.data.code==='account_changed'?'sign-in':'error',error instanceof Error?error.message:'同步暂未完成，本机记录已保留。');
        }
      }while(this.requested&&this.status!=='conflict'&&this.status!=='sign-in');
    }).finally(()=>{this.job=null;});
    return this.job;
  }
  private async runSync(){
    const owner=this.user!;
    this.state('syncing','正在同步');
    const session=await this.api.session();
    if(session.user?.id!==owner.id)throw new ApiError('登录状态已变化，请重新登录后继续同步。',401,{});
    let local=await loadAccountCache(owner.id)??this.cache!;
    let remote=await this.api.request<CloudState>('/api/v1/me/archive/');
    for(let attempt=0;attempt<3;attempt++){
      if(remote.user_id!==owner.id)throw new ApiError('当前账号已变化，请重新登录。',409,{code:'account_changed'});
      remote.backup=normalizeBackup(remote.backup,this.catalog).backup;
      const merged=mergeBackups(local.base,local.backup,remote.backup);
      if(merged.conflicts.length){
        this.cache=local;this.apply(local.backup);this.conflicts=merged.conflicts;this.conflictCloud=remote;
        this.state('conflict',`${merged.conflicts.length} 条记录需要选择版本`);return;
      }
      const sent=merged.backup;
      if(!sameBackup(sent,remote.backup)){
        try{remote=await this.api.request<CloudState>('/api/v1/me/archive/','PUT',{expected_user_id:owner.id,base_revision:remote.revision,backup:sent});}
        catch(error){if(error instanceof ApiError&&error.status===409&&error.data.code==='revision_conflict'){
          local={...local,base:remote.backup,backup:sent,revision:remote.revision};remote=error.data as unknown as CloudState;continue;
        }throw error;}
      }
      this.cache=await updateAccountCache(owner.id,stored=>{
        // Edits from a browser without Web Locks may have arrived while HTTP was in flight.
        const changed=stored&&!sameBackup(stored.backup,local.backup)?mergeBackups(local.backup,stored.backup,sent):{backup:sent,conflicts:[]};
        if(changed.conflicts.length)throw new Error('另一标签页正在更新同一条记录，稍后会重新合并。');
        return {user:owner,revision:remote.revision,base:remote.backup,backup:changed.backup,syncedAt:remote.updated_at};
      });
      this.apply(this.cache.backup);this.syncedAt=remote.updated_at;this.conflicts=[];this.conflictCloud=null;
      const pending=!sameBackup(this.cache.backup,this.cache.base);
      this.state(pending?'pending':'synced',pending?'本机还有待同步记录':'已同步');
      if(pending)this.timer=window.setTimeout(()=>void this.sync(),900);
      return;
    }
    throw new Error('其他设备正在更新，稍后重试即可，本机记录已保留。');
  }
  async resolve(choice:'local'|'cloud'){
    if(!this.user||!this.conflictCloud)return;
    await this.lock(async()=>{
      const fresh=await this.api.request<CloudState>('/api/v1/me/archive/');
      if(fresh.user_id!==this.user!.id)throw new Error('账号已变化，请重新登录。');
      if(fresh.revision!==this.conflictCloud!.revision)throw new Error('云端又有更新，请先点“立即同步”查看新冲突。');
      this.cache=await updateAccountCache(this.user!.id,stored=>{
        const current=stored??this.cache!;
        return {...current,base:fresh.backup,revision:fresh.revision,backup:mergeBackups(current.base,current.backup,fresh.backup,choice).backup};
      });
      this.apply(this.cache.backup);this.conflicts=[];this.conflictCloud=null;
      this.state('pending','选择已保存，等待同步');
    });
    await this.sync();
  }
  async importGuest(){
    if(!this.user)return;
    await this.lock(async()=>{
      this.guest=normalizeBackup(await loadArchive()??this.guest,this.catalog).backup;
      this.cache=await updateAccountCache(this.user!.id,stored=>{
        const current=stored??this.cache!;
        // An empty baseline makes pre-existing versions explicit conflicts.
        const merged=mergeBackups(emptyBackup(this.catalog),this.guest,current.backup);
        if(merged.conflicts.length)throw new Error('本机与账号有同款不同记录。请导出本机备份，再用备份导入选择需要的记录。');
        return {...current,backup:merged.backup};
      },this.backup);
      this.apply(this.cache.backup);this.state('pending','本机收藏已并入，等待同步');
    });
    await this.sync();
  }
  async logout(){
    if(!this.user)return;
    await this.sync();
    const cached=await loadAccountCache(this.user.id);
    if(cached&&!sameBackup(cached.backup,cached.base))throw new Error('本机还有未同步记录，请先完成同步或导出备份。');
    await this.api.request('/api/v1/auth/logout/','POST',{expected_user_id:this.user.id});
    await clearAccountCache(this.user.id);
    this.user=null;this.cache=null;this.conflicts=[];this.conflictCloud=null;this.syncedAt=null;
    this.guest=normalizeBackup(await loadArchive()??emptyBackup(this.catalog),this.catalog).backup;
    this.apply(this.guest);this.state('guest','本机存档');
  }
}
