/*
 * 账号同步状态机：访客独立保存，登录后先写本机，再与云端按版本合并。
 * base 是上次云端基线，backup 是当前本机内容，revision 对应后端版本；三者不能混用。
 * 调试顺序：saveLocal → sync → runSync → mergeBackups → API PUT。
 */
import type { Backup, Catalog } from './types.ts';
import { normalizeBackup } from './core.ts';
import { AccountApi, ApiError, type AccountUser } from './account-api.ts';
import { userMessage } from './account-messages.ts';
import { emptyBackup, equal, mergeBackups, sameBackup, type MergeConflict } from './sync-merge.ts';
import { loadArchive, saveArchive, updateGuestArchive, loadAccountCache, loadActiveAccount, storeActiveAccount, updateAccountCache, finishAccountLogout, readStored, type AccountCache } from './storage.ts';
/**
 * 后端返回的云端快照；user_id 用于确认归属，revision 用于并发写入检查。
 */
interface CloudState {
    user_id: number;
    revision: number;
    backup: Backup;
    updated_at: string;
}
/**
 * 界面可见的同步状态，区分访客、待上传、离线、冲突和需要重新登录。
 */
export type SyncStatus = 'guest' | 'syncing' | 'synced' | 'pending' | 'offline' | 'conflict' | 'sign-in' | 'error';
/**
 * 维护账号本机副本、云端基线和同步任务；页面通过回调接收数据及状态变化。
 */
export class AccountSync {
    user: AccountUser | null = null;
    // 仅接受本次联网核验的权限；离线恢复的账号缓存不能显示管理入口。
    private adminVerified = false;
    get canManageCatalog() {
        return this.adminVerified && this.user?.can_manage_catalog === true && this.status !== 'sign-in';
    }
    status: SyncStatus = 'guest';
    message = '登录后可跨设备同步';
    backup: Backup;
    guest: Backup;
    conflicts: MergeConflict[] = [];
    syncedAt: string | null = null;
    private api = new AccountApi();
    /**
     * 本机缓存同时保留基线和当前编辑内容，成功同步前不能把两者直接设成相同。
     */
    private cache: AccountCache | null = null;
    private conflictCloud: CloudState | null = null;
    private timer = 0;
    private poll = 0;
    /**
     * 当前同步任务；多个触发共用此任务，requested 记录是否还需再同步一轮。
     */
    private job: Promise<void> | null = null;
    private requested = false;
    /**
     * 浏览器恢复联网时尝试同步，仅对当前登录账号生效。
     */
    private reconnect = () => {
        if (this.user)
            void this.sync();
    };
    /**
     * 页面重新可见时拉取更新，后台标签页不主动触发这一轮。
     */
    private visible = () => {
        if (this.user && !document.hidden)
            void this.sync();
    };
    /**
     * 收藏内容变化后通知页面；默认空回调，由 main.ts 接入渲染。
     */
    onArchive: (backup: Backup) => void = () => {
    };
    /**
     * 同步状态变化后通知页面更新提示和按钮。
     */
    onStatus: () => void = () => {
    };
    /**
     * 先建立空访客文档；实际存档和登录状态由 initialize 异步加载。
     */
    constructor(private catalog: Catalog) {
        this.backup = this.guest = emptyBackup(catalog);
    }
    /**
     * 集中修改状态和说明，并触发 UI 状态回调。
     */
    private state(status: SyncStatus, message: string) {
        this.status = status;
        this.message = message;
        this.onStatus();
    }
    /**
     * 替换内存文档；仅在用户数据变化时通知页面，减少无意义重绘。
     */
    private apply(backup: Backup) {
        const changed = !sameBackup(this.backup, backup);
        this.backup = backup;
        if (changed)
            this.onArchive(backup);
    }
    /**
     * 支持 Web Locks 的浏览器按账号串行操作；底层 IndexedDB 事务仍负责兜底。
     */
    private async lock<T>(action: () => Promise<T>): Promise<T> {
        if (this.user && navigator.locks)
            return navigator.locks.request(`pass-archive-account-${this.user.id}`, action);
        return action();
    }
    /**
     * 恢复访客存档和旧关注记录，查询会话，再恢复对应账号缓存并开始同步监听。
     */
    async initialize() {
        const guestSaved = await loadArchive();
        this.guest = normalizeBackup(guestSaved ?? emptyBackup(this.catalog), this.catalog).backup;
        // 仅在旧访客文档尚无关注字段时，迁移原收集册的本机关注列表。
        if (!guestSaved?.followed_series) {
            try {
                const old = JSON.parse(localStorage.getItem('pass-archive-followed-series') ?? '[]');
                if (Array.isArray(old)) {
                    const ids = new Set(this.catalog.series.map(s => s.id));
                    this.guest.followed_series = old.filter((id: unknown) => typeof id === 'string' && ids.has(id));
                }
            }
            catch {
            }
        }
        if (!guestSaved?.followed_series)
            await saveArchive(this.guest);
        this.apply(this.guest);
        try {
            const session = await this.api.session();
            this.user = session.user;
            this.adminVerified = session.user?.can_manage_catalog === true;
        }
        catch (error) {
            if (error instanceof ApiError && (error.status === 0 || error.status >= 500))
                this.user = await loadActiveAccount();
            else
                throw error;
        }
        if (this.user) {
            const blank = emptyBackup(this.catalog);
            this.cache = await loadAccountCache(this.user.id) ?? { user: this.user, revision: 0, base: blank, backup: blank, syncedAt: null };
            this.cache.backup = normalizeBackup(this.cache.backup, this.catalog).backup;
            this.cache.base = normalizeBackup(this.cache.base, this.catalog).backup;
            this.syncedAt = this.cache.syncedAt;
            await storeActiveAccount(this.user);
            this.apply(this.cache.backup);
            this.state('pending', '正在读取账号收藏');
            void this.sync();
        }
        else {
            await storeActiveAccount(null);
            this.state('guest', '本地收藏');
        }
        this.poll = window.setInterval(() => {
            if (this.user && navigator.onLine && !document.hidden)
                void this.sync();
        }, 30000);
        window.addEventListener('online', this.reconnect);
        document.addEventListener('visibilitychange', this.visible);
    }
    /**
     * 清除延迟同步、轮询和事件监听，防止重复初始化留下后台任务。
     */
    dispose() {
        window.clearTimeout(this.timer);
        window.clearInterval(this.poll);
        window.removeEventListener('online', this.reconnect);
        document.removeEventListener('visibilitychange', this.visible);
    }
    /**
     * 先保存本机，再延迟 900 毫秒发起同步；账号写入会合并其他标签页的新改动。
     * observed 是本次编辑前的快照；同项冲突时拒绝覆盖并提示重新查看。
     */
    async saveLocal(next: Backup, previous?: Backup) {
        const observed = structuredClone(this.backup);
        if (!this.user) {
            this.guest = await updateGuestArchive(stored => {
                const merged = mergeBackups(observed, next, stored ?? observed);
                if (merged.conflicts.length)
                    throw new Error('另一标签页修改了同一条记录，请刷新后再编辑。');
                return merged.backup;
            }, !!previous);
            this.apply(this.guest);
            return;
        }
        await this.lock(async () => {
            const fallback = this.cache!;
            this.cache = await updateAccountCache(this.user!.id, stored => {
                const latest = stored ?? fallback;
                const merged = mergeBackups(observed, next, latest.backup);
                if (merged.conflicts.length)
                    throw new Error('另一标签页修改了同一条记录，请刷新后再编辑。');
                return { ...latest, backup: merged.backup };
            }, previous);
            this.apply(this.cache.backup);
            this.conflicts = [];
            this.conflictCloud = null;
            this.state('pending', '已保存到本机，等待同步');
        });
        window.clearTimeout(this.timer);
        this.timer = window.setTimeout(() => void this.sync(), 900);
    }
    /**
     * 根据当前身份读取导入恢复点，访客和账号使用各自独立的键。
     */
    async beforeImport() {
        return this.user ? readStored<Backup>(`before-import:${this.user.id}`) : readStored<Backup>('before-import');
    }
    /**
     * 合并并发的同步请求，同一时刻仅运行一个任务；遇到冲突或会话变化时停止自动续跑。
     */
    async sync() {
        if (!this.user)
            return;
        if (this.job) {
            this.requested = true;
            return this.job;
        }
        this.job = this.lock(async () => {
            do {
                this.requested = false;
                try {
                    await this.runSync();
                }
                catch (error) {
                    const apiError = error instanceof ApiError ? error : null;
                    this.state(apiError?.status === 0 ? 'offline' : apiError?.status === 401 || apiError?.status === 403 || apiError?.data.code === 'account_changed' ? 'sign-in' : 'error', userMessage(error, '同步暂未完成，收藏已保存在此设备。'));
                }
            } while (this.requested && this.status !== 'conflict' && this.status !== 'sign-in');
        }).finally(() => {
            this.job = null;
        });
        return this.job;
    }
    /**
     * 先确认会话归属，再读取云端并三方合并；最多重试三次版本竞争。
     * 上传时携带 expected_user_id 和 base_revision，成功后再次合并请求期间的新本机编辑。
     */
    private async runSync() {
        const owner = this.user!;
        this.state('syncing', '正在同步');
        const session = await this.api.session();
        if (session.user?.id !== owner.id)
            throw new ApiError('登录状态已变化，请重新登录后继续同步。', 401, {});
        let local = await loadAccountCache(owner.id) ?? this.cache!;
        let remote = await this.api.request<CloudState>('/api/v1/me/archive/');
        for (let attempt = 0; attempt < 3; attempt++) {
            if (remote.user_id !== owner.id)
                throw new ApiError('当前账号已变化，请重新登录。', 409, { code: 'account_changed' });
            remote.backup = normalizeBackup(remote.backup, this.catalog).backup;
            const merged = mergeBackups(local.base, local.backup, remote.backup);
            if (merged.conflicts.length) {
                this.cache = local;
                this.apply(local.backup);
                this.conflicts = merged.conflicts;
                this.conflictCloud = remote;
                this.state('conflict', `${merged.conflicts.length} 条记录需要选择版本`);
                return;
            }
            const sent = merged.backup;
            if (!sameBackup(sent, remote.backup)) {
                try {
                    remote = await this.api.request<CloudState>('/api/v1/me/archive/', 'PUT', { expected_user_id: owner.id, base_revision: remote.revision, backup: sent });
                }
                catch (error) {
                    if (error instanceof ApiError && error.status === 409 && error.data.code === 'revision_conflict') {
                        local = { ...local, base: remote.backup, backup: sent, revision: remote.revision };
                        remote = error.data as unknown as CloudState;
                        continue;
                    }
                    throw error;
                }
            }
            this.cache = await updateAccountCache(owner.id, stored => {
                // HTTP 请求期间仍可能收到其他标签页的本机编辑；成功响应不能直接覆盖这些新改动。
                const changed = stored && !sameBackup(stored.backup, local.backup) ? mergeBackups(local.backup, stored.backup, sent) : { backup: sent, conflicts: [] };
                if (changed.conflicts.length)
                    throw new Error('另一标签页正在更新同一条记录，稍后会重新合并。');
                return { user: owner, revision: remote.revision, base: remote.backup, backup: changed.backup, syncedAt: remote.updated_at };
            });
            this.apply(this.cache.backup);
            this.syncedAt = remote.updated_at;
            this.conflicts = [];
            this.conflictCloud = null;
            const pending = !sameBackup(this.cache.backup, this.cache.base);
            this.state(pending ? 'pending' : 'synced', pending ? '还有修改等待同步' : '已同步');
            if (pending)
                this.timer = window.setTimeout(() => void this.sync(), 900);
            return;
        }
        throw new Error('其他设备正在更新收藏，请稍后同步。当前修改已保存在此设备。');
    }
    /**
     * 重新获取云端并确认版本未变，再按用户选择处理冲突项，然后继续同步。
     */
    async resolve(choice: 'local' | 'cloud', reviewed: MergeConflict[] = this.conflicts) {
        if (!this.user || !this.conflictCloud)
            return;
        const owner = this.user, shownCloud = this.conflictCloud;
        const shown = new Map(reviewed.map(c => [JSON.stringify([c.section, c.id]), structuredClone(c)]));
        await this.lock(async () => {
            const fresh = await this.api.request<CloudState>('/api/v1/me/archive/');
            if (fresh.user_id !== owner.id || this.user?.id !== owner.id)
                throw new Error('账号已变化，请重新登录。');
            if (fresh.revision !== shownCloud.revision)
                throw new Error('云端记录已有更新，请先点“立即同步”重新查看，再选择要保留的版本。');
            fresh.backup = normalizeBackup(fresh.backup, this.catalog).backup;
            this.cache = await updateAccountCache(owner.id, stored => {
                const current = stored ?? this.cache!;
                const pending = mergeBackups(current.base, current.backup, fresh.backup);
                if (pending.conflicts.length !== shown.size || pending.conflicts.some(c => !equal(c, shown.get(JSON.stringify([c.section, c.id])))))
                    throw new Error('冲突记录已有更新，请先点“立即同步”重新查看，再选择要保留的版本。');
                return { ...current, base: fresh.backup, revision: fresh.revision, backup: mergeBackups(current.base, current.backup, fresh.backup, choice).backup };
            });
            this.apply(this.cache.backup);
            this.conflicts = [];
            this.conflictCloud = null;
            this.state('pending', '选择已保存，等待同步');
        });
        await this.sync();
    }
    /**
     * 显式把访客收藏并入当前账号，原访客文档保留；同款不同记录时要求人工处理。
     */
    async importGuest() {
        if (!this.user)
            return;
        await this.lock(async () => {
            this.guest = normalizeBackup(await loadArchive() ?? this.guest, this.catalog).backup;
            this.cache = await updateAccountCache(this.user!.id, stored => {
                const current = stored ?? this.cache!;
                // 以空文档为基线，让访客和账号已有的同款差异显式成为冲突。
                const merged = mergeBackups(emptyBackup(this.catalog), this.guest, current.backup);
                if (merged.conflicts.length)
                    throw new Error('未登录时的收藏与账号中有相同款式的不同记录。请先导出未登录时的收藏，再通过备份导入确认要保留的内容。');
                return { ...current, backup: merged.backup };
            }, this.backup);
            this.apply(this.cache.backup);
            this.state('pending', '收藏已合并，等待同步');
        });
        await this.sync();
    }
    /**
     * 先尝试同步；仍有未上传修改时阻止退出，避免删除缓存造成数据丢失。
     */
    async logout() {
        if (!this.user)
            return;
        await this.sync();
        const cached = await loadAccountCache(this.user.id);
        if (cached && !sameBackup(cached.backup, cached.base))
            throw new Error('还有修改未同步，请联网完成同步后再退出。可先导出备份保存当前记录。');
        await this.api.request('/api/v1/auth/logout/', 'POST', { expected_user_id: this.user.id });
        const cleared = await finishAccountLogout(this.user.id);
        this.user = null;
        this.adminVerified = false;
        this.cache = null;
        this.conflicts = [];
        this.conflictCloud = null;
        this.syncedAt = null;
        this.guest = normalizeBackup(await loadArchive() ?? emptyBackup(this.catalog), this.catalog).backup;
        this.apply(this.guest);
        this.state('guest', cleared ? '已退出登录，当前显示未登录时的收藏。' : '已退出登录。退出期间新增的记录已保存在此设备，重新登录原账号后可继续同步。');
    }
}
