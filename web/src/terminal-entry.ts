import type {PassTerminalContext} from './terminal-context.ts';
import './terminal-adaptation.css';

// No iframe query parameter supplies data or privileged host actions.
const context = await new Promise<PassTerminalContext>(resolve => {
  const receive = (event: MessageEvent) => {
    if (event.origin !== location.origin || event.source !== window.parent ||
        event.data?.channel !== 'pass-archive-terminal' || event.data?.type !== 'initialize') return;
    const value = event.data.context as PassTerminalContext;
    if (!value?.catalog || !Array.isArray(value.catalog.series) || !value.catalog.series.length) return;
    window.removeEventListener('message', receive);
    resolve(value);
  };
  window.addEventListener('message',receive);
  if (window.parent === window) {
    void fetch('/catalog.json').then(response=>response.json()).then(catalog=>{
      window.removeEventListener('message',receive);
      resolve({catalog,playOpening:true,theme:'light'});
    });
  }
});
window.passTerminalContext = context;
await import('./vendor/rhine-full/main.ts');
