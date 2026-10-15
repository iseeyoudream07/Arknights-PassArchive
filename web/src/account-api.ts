export interface AccountUser {id:number;username:string}
export interface AccountSession {authenticated:boolean;user:AccountUser|null;csrf_token:string}
export class ApiError extends Error {constructor(message:string,readonly status:number,readonly data:Record<string,unknown>){super(message);}}
export class AccountApi {
  private csrf='';
  async session():Promise<AccountSession> {
    const result=await this.request<AccountSession>('/api/v1/auth/session/');
    this.csrf=result.csrf_token;
    return result;
  }
  async request<T>(path:string,method='GET',value?:unknown):Promise<T> {
    if(method!=='GET'&&!this.csrf)await this.session();
    let response:Response;
    try {
      response=await fetch(path,{method,credentials:'same-origin',cache:'no-store',headers:{...(value===undefined?{}:{'Content-Type':'application/json'}),...(method==='GET'?{}:{'X-CSRFToken':this.csrf})},body:value===undefined?undefined:JSON.stringify(value),signal:AbortSignal.timeout(10000)});
    } catch {throw new ApiError('网络暂不可用，本机记录已保留。',0,{});}
    const data=await response.json().catch(()=>({detail:'服务暂不可用，请稍后再试。'}));
    if(typeof data.csrf_token==='string')this.csrf=data.csrf_token;
    if(!response.ok)throw new ApiError(typeof data.detail==='string'?data.detail:'请求未完成。',response.status,data);
    return data as T;
  }
}
