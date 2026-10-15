import type {Catalog} from './types.ts';
import type {MotionPreferences} from './vendor/rhine-full/motion-preferences.ts';

export interface PassTerminalContext { catalog: Catalog; playOpening: boolean; theme: 'light'|'dark'; authenticated?:boolean; username?:string|null; followed_series?:string[] }
declare global { interface Window { passTerminalContext: PassTerminalContext } }
export const passContext = () => window.passTerminalContext;
export function passToHost(type: string, value: Record<string, unknown> = {}) {
  window.parent.postMessage({channel:'pass-archive-terminal',type,...value}, location.origin);
}
export function passPreferences(theme: 'light'|'dark', motion: MotionPreferences) {
  passToHost('preferences',{theme,motion});
}
