import './vendor/rhine-full/fonts.css';
import './login.css';
import {paintTheme} from './vendor/rhine-full/theme-ui.ts';
import {ContentTransition} from './vendor/rhine-full/ui-transitions.ts';
import {AccountApi,type AccountSession} from './account-api.ts';
import {loadAccountCache,clearAccountCache} from './storage.ts';
import {sameBackup} from './sync-merge.ts';

const api=new AccountApi(),content=document.querySelector<HTMLElement>('#auth-content')!;
const transition=new ContentTransition();
const esc=(value:unknown)=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
let animate=!matchMedia('(prefers-reduced-motion: reduce)').matches;
let mode:'login'|'register'='login',session:AccountSession|null=null,dark=matchMedia('(prefers-color-scheme: dark)').matches;
try{const theme=localStorage.getItem('pass-archive-theme');if(theme)dark=theme==='dark';const prefs=JSON.parse(localStorage.getItem('pass-archive-rhine-settings')??'null');if(typeof prefs?.motion?.surfaceTransitions==='boolean')animate=prefs.motion.surfaceTransitions;}catch{}
paintTheme(dark?1:0);
document.querySelector<HTMLButtonElement>('#auth-theme')!.onclick=()=>{dark=!dark;paintTheme(dark?1:0);try{localStorage.setItem('pass-archive-theme',dark?'dark':'light');}catch{}};
const error=(text:string)=>{document.querySelector<HTMLElement>('#auth-error')!.textContent=text;document.querySelector('#access-state')!.textContent=text?'CHECK INPUT':'READY';};
function field(name:string,label:string,type='text',hint='',autocomplete=name){return `<div class="auth-field"><label for="auth-${name}">${label}</label><input id="auth-${name}" name="${name}" type="${type}" autocomplete="${autocomplete}" required maxlength="${name==='username'?32:128}" ${hint?`aria-describedby="auth-${name}-hint"`:''} ${name==='username'?'minlength="3" pattern="[A-Za-z0-9_]{3,32}" autocapitalize="none" spellcheck="false"':type==='password'&&autocomplete==='new-password'?'minlength="10"':''}>${hint?`<small id="auth-${name}-hint">${hint}</small>`:''}</div>`;}
function reveal(){transition.reveal(content,!animate);}
function render(){
  if(session?.authenticated){
    content.innerHTML=`<div class="auth-signed-in"><p>ACCOUNT / 已登录</p><h2>${esc(session.user!.username)}</h2><p>你的账号已就绪。回到档案查看收藏和同步状态。</p><a class="auth-primary-link" href="/?view=settings">进入我的档案<span>→</span></a><button class="auth-secondary" id="auth-password">修改密码 ↗</button><br><button class="auth-secondary" id="auth-logout">退出登录</button></div><p id="auth-error" class="auth-error" role="alert"></p>`;
    document.querySelector<HTMLButtonElement>('#auth-password')!.onclick=passwordForm;
    document.querySelector<HTMLButtonElement>('#auth-logout')!.onclick=()=>void(async()=>{
      const button=document.querySelector<HTMLButtonElement>('#auth-logout')!;button.disabled=true;
      try{
        const cached=await loadAccountCache(session!.user!.id);
        if(cached&&!sameBackup(cached.backup,cached.base))throw new Error('本机还有未同步记录，请返回档案完成同步或导出备份后再退出。');
        await api.request('/api/v1/auth/logout/','POST',{expected_user_id:session!.user!.id});await clearAccountCache(session!.user!.id);session=null;render();
      }catch(e){error(e instanceof Error?e.message:'退出未完成。');button.disabled=false;}
    })();
  }else{
    content.innerHTML=`<div class="auth-tabs" role="tablist" aria-label="账号访问方式"><button role="tab" data-mode="login" aria-selected="${mode==='login'}">登录</button><button role="tab" data-mode="register" aria-selected="${mode==='register'}">创建账号</button></div><form id="auth-form" aria-label="${mode==='register'?'创建账号':'登录账号'}">${field('username','用户名','text',mode==='register'?'3–32 位英文字母、数字或下划线':'','username')}${field('password','密码','password',mode==='register'?'至少 10 位，避免常见或纯数字密码':'',mode==='register'?'new-password':'current-password')}${mode==='register'?field('password_confirm','确认密码','password','','new-password'):''}<label class="auth-remember"><input name="remember" type="checkbox" checked> 在此设备保持登录 14 天</label><button class="auth-submit" type="submit">${mode==='register'?'创建收藏账号':'登录我的档案'}<span>→</span></button><p id="auth-error" class="auth-error" role="alert"></p></form>`;
    content.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(button=>button.onclick=()=>{mode=button.dataset.mode as typeof mode;render();});
    document.querySelector<HTMLFormElement>('#auth-form')!.onsubmit=event=>{event.preventDefault();void(async()=>{
      const form=event.currentTarget as HTMLFormElement,values=new FormData(form),button=form.querySelector<HTMLButtonElement>('[type="submit"]')!;
      button.disabled=true;error('');document.querySelector('#access-state')!.textContent='AUTHENTICATING';
      try{session=await api.request<AccountSession>(`/api/v1/auth/${mode==='register'?'register':'login'}/`,'POST',{username:values.get('username'),password:values.get('password'),password_confirm:values.get('password_confirm'),remember:values.get('remember')==='on'});form.reset();location.assign('/?view=settings');}
      catch(e){error(e instanceof Error?e.message:'登录未完成。');button.disabled=false;}
    })();};
  }
  reveal();
}
function passwordForm(){
  content.innerHTML=`<div class="auth-password"><button id="auth-back" class="auth-secondary">← 返回账号</button><h2>修改密码</h2><form id="password-form">${field('current_password','当前密码','password','','current-password')}${field('password','新密码','password','至少 10 位','new-password')}${field('password_confirm','确认新密码','password','','new-password')}<button type="submit" class="auth-submit">保存新密码<span>→</span></button><p id="auth-error" class="auth-error" role="alert"></p></form></div>`;
  document.querySelector<HTMLButtonElement>('#auth-back')!.onclick=render;
  document.querySelector<HTMLFormElement>('#password-form')!.onsubmit=event=>{event.preventDefault();void(async()=>{
    const form=event.currentTarget as HTMLFormElement,button=form.querySelector<HTMLButtonElement>('[type="submit"]')!,values=new FormData(form);button.disabled=true;
    try{await api.request('/api/v1/auth/password/','POST',{...Object.fromEntries(values),expected_user_id:session!.user!.id});form.reset();render();error('密码已更新，其他设备需要重新登录。');}catch(e){error(e instanceof Error?e.message:'密码未更新。');button.disabled=false;}
  })();};reveal();
}
render();void api.session().then(value=>{session=value;if(value.authenticated)render();}).catch(e=>error(e instanceof Error?e.message:'暂时无法连接账号服务。'));
