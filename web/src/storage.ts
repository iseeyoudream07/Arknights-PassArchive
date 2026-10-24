/*
 * 浏览器 IndexedDB 存储层；读写都发生在 archive 对象仓库中。
 * 访客键为 current，账号键为 account:<用户 ID>，导入恢复点也按账号隔离。
 */
import type { Backup } from './types.ts';
import type { AccountUser } from './account-api.ts';
import { sameBackup } from './sync-merge.ts';
/**
 * 单账号的本机缓存：revision/base 是云端基线，backup 可含尚未上传的修改。
 */
export interface AccountCache {
    user: AccountUser;
    revision: number;
    base: Backup;
    backup: Backup;
    syncedAt: string | null;
}
/**
 * 仅建立一次 IndexedDB 连接；首次打开时创建 archive 对象仓库。
 */
const dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open('arknights-pass-archive', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('archive');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
});
/**
 * 读取访客存档 current；未保存过时返回 null。
 */
export async function loadArchive(): Promise<Backup | null> {
    const db = await dbPromise;
    return new Promise((resolve, reject) => {
        const t = db.transaction('archive', 'readonly');
        const r = t.objectStore('archive').get('current');
        r.onsuccess = () => resolve(r.result ?? null);
        r.onerror = () => reject(r.error);
    });
}
/**
 * 在同一事务中保存访客存档，可同时保存导入前恢复点；事务完成后才算成功。
 */
export async function saveArchive(backup: Backup, previous?: Backup): Promise<void> {
    const db = await dbPromise;
    return new Promise((resolve, reject) => {
        const t = db.transaction('archive', 'readwrite');
        t.objectStore('archive').put(structuredClone(backup), 'current');
        if (previous)
            t.objectStore('archive').put(structuredClone(previous), 'before-import');
        t.oncomplete = () => resolve();
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
    });
}

/** 未登录时也用原子读改写，避免两个标签页相互覆盖收藏。 */
export async function updateGuestArchive(change: (current: Backup | null) => Backup, restorePoint = false): Promise<Backup> {
    const db = await dbPromise;
    return new Promise((resolve, reject) => {
        const transaction = db.transaction('archive', 'readwrite'), store = transaction.objectStore('archive');
        const read = store.get('current');
        let value: Backup;
        read.onsuccess = () => {
            try {
                value = change(read.result ?? null);
                if (restorePoint && read.result) store.put(structuredClone(read.result), 'before-import');
                store.put(structuredClone(value), 'current');
            } catch (error) {
                transaction.abort();
                reject(error);
            }
        };
        transaction.oncomplete = () => resolve(value);
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error ?? new Error('收藏未能保存，请稍后重试。'));
    });
}
/**
 * 读取访客最近一次导入前的恢复点，不修改当前存档。
 */
export async function loadBeforeImport(): Promise<Backup | null> {
    const db = await dbPromise;
    return new Promise((resolve, reject) => {
        const r = db.transaction('archive').objectStore('archive').get('before-import');
        r.onsuccess = () => resolve(r.result ?? null);
        r.onerror = () => reject(r.error);
    });
}
/**
 * 按键读取一项本机数据；类型参数只供编译检查，不代替业务格式校验。
 */
export async function readStored<T>(key: string): Promise<T | null> {
    const db = await dbPromise;
    return new Promise((resolve, reject) => {
        const r = db.transaction('archive').objectStore('archive').get(key);
        r.onsuccess = () => resolve(r.result ?? null);
        r.onerror = () => reject(r.error);
    });
}
/**
 * 按用户 ID 读取账号缓存，避免不同账号共用收藏。
 */
export const loadAccountCache = (id: number) => readStored<AccountCache>(`account:${id}`);
/**
 * 读取最近活动账号，供暂时离线时恢复本机视图。
 */
export const loadActiveAccount = () => readStored<AccountUser>('active-account');
/**
 * 更新活动账号标识；传 null 时只删除标识。
 */
export async function storeActiveAccount(user: AccountUser | null) {
    const db = await dbPromise;
    await new Promise<void>((resolve, reject) => {
        const t = db.transaction('archive', 'readwrite');
        if (user)
            t.objectStore('archive').put(user, 'active-account');
        else
            t.objectStore('archive').delete('active-account');
        t.oncomplete = () => resolve();
        t.onerror = () => reject(t.error);
    });
}
// The read/merge/write transaction also protects browsers without Web Locks.
/**
 * 在一个读写事务内读取最新缓存、应用 change 并保存，防止跨标签页丢失更新。
 * change 抛错会中止事务；previous 用于保存该账号的导入前恢复点。
 */
export async function updateAccountCache(id: number, change: (current: AccountCache | null) => AccountCache, previous?: Backup): Promise<AccountCache> {
    const db = await dbPromise;
    return new Promise((resolve, reject) => {
        const t = db.transaction('archive', 'readwrite'), store = t.objectStore('archive'), read = store.get(`account:${id}`);
        let value: AccountCache;
        read.onsuccess = () => {
            try {
                value = change(read.result ?? null);
                store.put(structuredClone(value), `account:${id}`);
                if (previous)
                    store.put(structuredClone(previous), `before-import:${id}`);
            }
            catch (error) {
                t.abort();
                reject(error);
            }
        };
        t.oncomplete = () => resolve(value);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error ?? new Error('本机记录未能保存。'));
    });
}
/**
 * 退出账号后删除该账号缓存、恢复点及活动账号标识，访客存档仍保留。
 */
export async function clearAccountCache(id: number) {
    const db = await dbPromise;
    await new Promise<void>((resolve, reject) => {
        const t = db.transaction('archive', 'readwrite'), s = t.objectStore('archive');
        s.delete(`account:${id}`);
        s.delete(`before-import:${id}`);
        s.delete('active-account');
        t.oncomplete = () => resolve();
        t.onerror = () => reject(t.error);
    });
}

/**
 * 退出响应到达后原子检查缓存：期间新增的未同步编辑必须保留，待原账号重新登录。
 * 活动标识也核对账号，避免旧退出请求清除另一标签页刚登录的新账号。
 */
export async function finishAccountLogout(id: number): Promise<boolean> {
    const db = await dbPromise;
    return new Promise((resolve, reject) => {
        const transaction = db.transaction('archive', 'readwrite'), store = transaction.objectStore('archive');
        let cleared = true;
        const cache = store.get(`account:${id}`), active = store.get('active-account');
        cache.onsuccess = () => {
            const value = cache.result as AccountCache | undefined;
            cleared = !value || sameBackup(value.backup, value.base);
            if (cleared) {
                store.delete(`account:${id}`);
                store.delete(`before-import:${id}`);
            }
        };
        active.onsuccess = () => {
            if (active.result?.id === id) store.delete('active-account');
        };
        transaction.oncomplete = () => resolve(cleared);
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
    });
}
