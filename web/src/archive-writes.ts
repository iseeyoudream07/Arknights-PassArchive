/*
 * 二维界面的保存队列：串行写入，并合并等待期间发生的独立编辑。
 * 队列会检查账号是否变化；同一条记录的冲突交给用户重新查看。
 */
import type { Backup } from './types.ts';
import { mergeBackups, sameBackup } from './sync-merge.ts';
export interface ArchiveObservation { backup: Backup; owner: number | null }
/** 串行执行保存，同时保留上一轮尚未完成期间产生的独立编辑。 */
/**
 * 将连续交互排成保存队列；每次执行前与最新存档合并，并检查账号归属。
 */
export class ArchiveWrites {
    private tail: Promise<void> = Promise.resolve();
    /**
     * 注入读取当前存档、读取当前账号及实际保存的方法，便于复用和测试。
     */
    constructor(private read: () => Backup, private owner: () => number | null, private save: (backup: Backup, previous?: Backup) => Promise<void>) {
    }
    /**
     * 记录用户操作时的基线和账号，轮到执行时合并最新数据；restorePoint 控制恢复点。
     * 失败只影响本次 Promise，队列尾部会吞掉已上报异常，使后续保存仍可继续。
     */
    enqueue(next: Backup, restorePoint = false, expected?: ArchiveObservation) {
        const observed = structuredClone(expected ? expected.backup : this.read()), owner = expected ? expected.owner : this.owner();
        const operation = this.tail.then(async () => {
            if (this.owner() !== owner)
                throw new Error('账号已变化，请重新查看后再保存。');
            const latest = this.read();
            if (expected && !sameBackup(observed, latest))
                throw new Error('收藏记录已有更新，请重新预览后再确认。');
            const merged = mergeBackups(observed, next, latest);
            if (merged.conflicts.length)
                throw new Error('另一设备更新了同一条记录，请重新查看后再编辑。');
            await this.save(merged.backup, restorePoint ? structuredClone(latest) : undefined);
        });
        this.tail = operation.catch(() => {
        });
        return operation;
    }
}
