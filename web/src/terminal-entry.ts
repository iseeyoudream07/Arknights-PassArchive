/*
 * 三维页面启动入口：等待宿主初始化上下文，再动态加载三维主模块。
 * 独立打开 terminal.html 时使用静态目录；iframe 中必须校验父窗口消息来源。
 */
import type { PassTerminalContext } from './terminal-context.ts';
import './terminal-adaptation.css';
// iframe 查询参数不提供业务数据或特权动作；业务上下文只接收可信宿主消息。
/**
 * 等待可信宿主的 initialize 消息；独立页面才允许直接加载静态目录。
 */
const context = await new Promise<PassTerminalContext>(resolve => {
    const receive = (event: MessageEvent) => {
        if (event.origin !== location.origin || event.source !== window.parent ||
            event.data?.channel !== 'pass-archive-terminal' || event.data?.type !== 'initialize')
            return;
        const value = event.data.context as PassTerminalContext;
        if (!value?.catalog || !Array.isArray(value.catalog.series) || !value.catalog.series.length)
            return;
        window.removeEventListener('message', receive);
        resolve(value);
    };
    window.addEventListener('message', receive);
    if (window.parent === window) {
        void fetch('/catalog.json').then(response => response.json()).then(catalog => {
            window.removeEventListener('message', receive);
            resolve({ catalog, playOpening: true, theme: 'light' });
        });
    }
});
window.passTerminalContext = context;
await import('./vendor/rhine-full/main.ts');
