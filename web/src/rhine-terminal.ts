import './rhine-host.css';
import type {Catalog} from './types.ts';
import {SurfaceTransition} from './vendor/rhine-full/ui-transitions.ts';
import type {MotionPreferences} from './vendor/rhine-full/motion-preferences.ts';

export class RhineTerminal {
  private root = document.createElement('section');
  private frame = document.createElement('iframe');
  private surface: SurfaceTransition;
  private catalog?: Catalog;
  private mounted = false;
  private shown = false;
  private failed = false;
  private pendingReplay = false;
  private resumeFrame = 0;
  private authenticated = false;
  private username:string|null=null;
  private followed: string[] = [];
  private reduced = matchMedia('(prefers-reduced-motion: reduce)');
  private motion?: MotionPreferences;
  onBusiness: (page: string, seriesId?: string) => void = () => {};
  onFailure: (message: string) => void = () => {};
  onPreferences: (motion: MotionPreferences) => void = () => {};
  onFollowed: (ids:string[]) => void = () => {};

  constructor(private app: HTMLElement) {
    this.root.id='rhine-terminal';
    this.root.hidden=true;
    this.root.setAttribute('aria-label','通行认证三维终端');
    this.frame.title='通行认证档案三维终端';
    this.frame.allow='fullscreen';
    this.root.append(this.frame);
    document.body.append(this.root);
    this.surface=new SurfaceTransition(this.root,undefined,300,200);
    window.addEventListener('message',this.receive);
  }
  get enabled() { try {return localStorage.getItem('pass-archive-opening')!=='off';}catch{return true;} }
  get reducedMotion() {
    if(this.motion)return Object.values(this.motion).every(value=>!value);
    try {
      const stored=JSON.parse(localStorage.getItem('pass-archive-rhine-settings')??'null');
      if(stored?.motion&&Object.values(stored.motion).every(value=>typeof value==='boolean'))return Object.values(stored.motion).every(value=>!value);
    }catch{}
    return this.reduced.matches;
  }
  get visible() {return this.shown;}
  setEnabled(value: boolean) {
    try {localStorage.setItem('pass-archive-opening',value?'on':'off');return true;}catch{return false;}
  }
  start(replay=false) {
    if (this.failed) return;
    this.shown=true;
    this.pendingReplay ||= replay;
    if (!this.catalog) return;
    this.app.inert=true;
    document.body.classList.add('rhine-terminal-active');
    this.surface.show(!this.animate('surfaceTransitions'));
    if (!this.mounted) this.mount();
    else {
      cancelAnimationFrame(this.resumeFrame);
      // The iframe needs a visible viewport before it can restore its camera.
      this.resumeFrame=requestAnimationFrame(()=>{
        if(!this.shown)return;
        this.send('resume');
        if(replay)this.send('replay');
      });
    }
    this.frame.focus();
  }
  ready(catalog: Catalog) {this.catalog=catalog;if(this.shown)this.start(this.pendingReplay);}
  abort() {this.failed=true;this.dismiss();}
  dismiss(after:()=>void=()=>{}) {
    this.shown=false;
    cancelAnimationFrame(this.resumeFrame);
    this.send('pause');
    this.surface.hide(!this.animate('surfaceTransitions'),()=>{
      this.app.inert=false;
      document.body.classList.remove('rhine-terminal-active');
      after();
      const heading=this.app.querySelector<HTMLElement>('h1');
      if(heading){heading.tabIndex=-1;heading.focus({preventScroll:true});}
    });
  }
  animate(key: keyof MotionPreferences) {return this.motion?this.motion[key]:!this.reduced.matches;}
  syncTheme() {this.send('theme',{theme:document.documentElement.dataset.theme==='dark'?'dark':'light'});}
  syncAccount(authenticated:boolean,followed:string[],username:string|null=null) {
    if(this.authenticated===authenticated&&this.username===username&&this.followed.length===followed.length&&this.followed.every((id,index)=>id===followed[index]))return;
    this.authenticated=authenticated;this.username=authenticated?username:null;this.followed=[...followed];this.send('account',{authenticated,username:this.username,followed_series:followed});
  }
  notify(message:string) {this.send('notice',{message});}
  private mount() {
    this.mounted=true;
    this.frame.addEventListener('load',()=>{
      this.send('initialize',{context:{catalog:this.catalog,playOpening:(this.enabled||this.pendingReplay)&&!this.reducedMotion,theme:document.documentElement.dataset.theme==='dark'?'dark':'light',authenticated:this.authenticated,username:this.username,followed_series:this.followed}});
      this.pendingReplay=false;
    });
    // A development-only direct scene entry keeps QA separate from normal startup.
    const scene=import.meta.env.DEV?new URLSearchParams(location.search).get('terminal-scene'):null;
    const time=import.meta.env.DEV?new URLSearchParams(location.search).get('terminal-time'):null;
    this.frame.src=time!==null&&Number.isFinite(Number(time))&&Number(time)>=0&&Number(time)<=27?`/terminal.html?time=${Number(time)}&review=1&freeze=1`:scene==='archive'||scene==='detail'?`/terminal.html?scene=${scene}`:'/terminal.html';
  }
  private send(type:string,value:Record<string,unknown>={}) {
    this.frame.contentWindow?.postMessage({channel:'pass-archive-terminal',type,...value},location.origin);
  }
  private receive=(event:MessageEvent)=>{
    if(event.origin!==location.origin||event.source!==this.frame.contentWindow||event.data?.channel!=='pass-archive-terminal')return;
    const message=event.data;
    if(message.type==='business') {
      if(!['catalog','collection','stats','settings','series','account'].includes(message.page))return;
      const id=typeof message.seriesId==='string'&&this.catalog?.series.some(series=>series.id===message.seriesId)?message.seriesId:undefined;
      if(message.page==='series'&&!id)return;
      this.onBusiness(message.page,id);
      this.dismiss();
    } else if(message.type==='followed') {
      if(Array.isArray(message.ids)&&message.ids.length<=106&&message.ids.every((id:unknown)=>typeof id==='string'&&this.catalog?.series.some(series=>series.id===id)))this.onFollowed([...new Set<string>(message.ids)].sort());
    } else if(message.type==='preferences') {
      if(message.theme==='light'||message.theme==='dark') {
        document.documentElement.dataset.theme=message.theme;
        try{localStorage.setItem('pass-archive-theme',message.theme);}catch{}
      }
      if(message.motion&&typeof message.motion==='object') {
        const keys=['boot','selectionWave','idleWave','pointerParallax','dragMomentum','selectionTransition','detailTransition','modelDecryption','documentReveal','rollingText','rollingNumbers','surfaceTransitions','viewerNavigation','viewerModelTransition'];
        if(keys.every(key=>typeof message.motion[key]==='boolean')) {
          this.motion={...message.motion};this.onPreferences(this.motion!);
        }
      }
    } else if(message.type==='failure') {
      this.failed=true;
      this.dismiss(()=>this.onFailure('三维终端暂不可用，已打开通行证目录。'));
    }
  };
}
