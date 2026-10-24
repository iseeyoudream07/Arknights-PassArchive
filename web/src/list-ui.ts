/*
 * 列表增量更新：按稳定 ID 复用卡片，只改价格、状态和必要的顺序。
 * 保留头像节点与键盘焦点，避免保存或同步后整页重新创建。
 */
import type { RecordEntry } from './types.ts';
/**
 * 仅在 HTML 不同的时候更新节点，避免重复创建子元素。
 */
function html(node: Element | null, value: string) {
    if (node && node.innerHTML !== value)
        node.innerHTML = value;
}
/**
 * 生成市价和购买数量摘要；未拥有、未填市价和数量为零分别显示。
 */
export function passPriceHtml(record?: RecordEntry) {
    const count = record?.lots.reduce((total, lot) => total + lot.qty, 0) ?? 0;
    const market = record?.market?.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return `${record?.owned ? (market !== undefined ? `市价 ¥${market}` : '市价未录入') : '未收藏'}${count > 0 ? ` <span>×${count}</span>` : ''}`;
}
/**
 * 生成拥有状态按钮文字，实际状态保存由页面层完成。
 */
export function passToggleHtml(owned: boolean) {
    return `<span>${owned ? '✓' : '+'}</span> ${owned ? '已拥有' : '标记拥有'}`;
}
/**
 * 只更新卡片拥有样式、价格和无障碍按钮信息，保留头像与卡片主体。
 */
export function patchPassCard(card: HTMLElement, record: RecordEntry | undefined, label: string) {
    const owned = !!record?.owned;
    if (card.classList.contains('is-owned') !== owned)
        card.classList.toggle('is-owned', owned);
    html(card.querySelector('.pass-price'), passPriceHtml(record));
    const button = card.querySelector<HTMLButtonElement>('[data-toggle]');
    if (button) {
        if (button.getAttribute('aria-pressed') !== String(owned))
            button.setAttribute('aria-pressed', String(owned));
        const ariaLabel = `${owned ? '取消拥有' : '标记拥有'}${label}`;
        if (button.getAttribute('aria-label') !== ariaLabel)
            button.setAttribute('aria-label', ariaLabel);
        html(button, passToggleHtml(owned));
    }
}
/** 保留仍在结果中的卡片、头像和按钮，仅增删实际变化的 ID。 */
/**
 * 按 key 复用已有卡片，只增删或移动必要节点，并恢复键盘焦点。
 * 返回新建节点数和焦点所在卡片是否被移除，供页面处理空结果状态。
 */
export function reconcileCards<T>(grid: HTMLElement, items: readonly T[], key: (item: T) => string, create: (item: T, index: number) => HTMLElement, update: (card: HTMLElement, item: T, index: number) => void, focusSelector = 'button') {
    const old = Array.from(grid.children) as HTMLElement[];
    const existing = new Map(old.map(card => [card.dataset.cardId!, card]));
    const desired = new Set(items.map(key));
    const focused = grid.ownerDocument.activeElement as HTMLElement | null;
    const focusedCard = focused && grid.contains(focused) ? focused.closest<HTMLElement>('[data-card-id]') : null;
    const focusIndex = focusedCard ? old.indexOf(focusedCard) : -1;
    for (const card of old)
        if (!desired.has(card.dataset.cardId!))
            card.remove();
    let cursor = grid.firstElementChild;
    let created = 0;
    for (const [index, item] of items.entries()) {
        const id = key(item);
        let card = existing.get(id);
        if (!card) {
            card = create(item, index);
            card.dataset.cardId = id;
            created++;
        }
        update(card, item, index);
        if (card === cursor)
            cursor = cursor.nextElementSibling;
        else
            grid.insertBefore(card, cursor);
    }
    const focusRemoved = focusIndex >= 0 && !focusedCard!.isConnected;
    if (focusRemoved && grid.children.length) {
        grid.children[Math.min(focusIndex, grid.children.length - 1)]
            .querySelector<HTMLElement>(focusSelector)?.focus({ preventScroll: true });
    }
    else if (focusedCard?.isConnected && focused?.isConnected && grid.ownerDocument.activeElement !== focused) {
        focused.focus({ preventScroll: true });
    }
    return { created, focusRemoved };
}
