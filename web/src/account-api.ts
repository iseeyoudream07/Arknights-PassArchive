/*
 * 账号 HTTP 客户端：携带同源会话 Cookie，自动准备和更新 CSRF 令牌。
 * 网络错误、401/403 和 409 的含义由 ApiError 保留，交给同步或页面层处理。
 */
import { accountErrorMessage } from './account-messages.ts';
/**
 * 前端允许持有的最小用户信息：数据库 ID 和规范化用户名。
 */
export interface AccountUser {
    id: number;
    username: string;
    can_manage_catalog?: boolean;
}
/**
 * 会话查询结果；csrf_token 随登录/退出等操作更新。
 */
export interface AccountSession {
    authenticated: boolean;
    user: AccountUser | null;
    csrf_token: string;
}
/**
 * 保留 HTTP 状态及后端错误码；status=0 表示网络请求未得到有效响应。
 */
export class ApiError extends Error {
    /**
     * 构造可由页面和同步器识别的 API 异常。
     */
    constructor(message: string, readonly status: number, readonly data: Record<string, unknown>) {
        super(message);
    }
}
/**
 * 统一账号请求入口；每个实例在内存中维护当前 CSRF 令牌。
 */
export class AccountApi {
    private csrf = '';
    /**
     * 读取会话并刷新令牌；不依赖 JavaScript 读取 HttpOnly Cookie。
     */
    async session(): Promise<AccountSession> {
        const result = await this.request<AccountSession>('/api/v1/auth/session/');
        if (typeof result.authenticated !== 'boolean' || typeof result.csrf_token !== 'string' ||
            (result.authenticated ? !result.user || !Number.isInteger(result.user.id) || typeof result.user.username !== 'string' : result.user !== null))
            throw new ApiError('登录状态暂时无法读取，请稍后重试。', 502, {});
        this.csrf = result.csrf_token;
        return result;
    }
    /**
     * 发送同源 JSON 请求；写操作补充 CSRF，十秒超时后保留明确的网络错误。
     * 返回体中的新 csrf_token 会替换旧令牌；非成功状态抛出 ApiError。
     */
    async request<T>(path: string, method = 'GET', value?: unknown): Promise<T> {
        if (method !== 'GET' && !this.csrf)
            await this.session();
        let response: Response;
        try {
            response = await fetch(path, { method, credentials: 'same-origin', cache: 'no-store', redirect: 'error', headers: { ...(value === undefined ? {} : { 'Content-Type': 'application/json' }), ...(method === 'GET' ? {} : { 'X-CSRFToken': this.csrf }) }, body: value === undefined ? undefined : JSON.stringify(value), signal: AbortSignal.timeout(10000) });
        }
        catch {
            throw new ApiError('网络暂不可用，本机记录已保留。', 0, {});
        }
        if (response.status === 403) this.csrf = '';
        const data = await response.json().catch(() => null);
        if (!data || typeof data !== 'object' || Array.isArray(data))
            throw new ApiError('服务返回的数据暂时无法读取，请稍后重试。', response.ok ? 502 : response.status, {});
        if (typeof data.csrf_token === 'string')
            this.csrf = data.csrf_token;
        if (!response.ok) {
            throw new ApiError(accountErrorMessage(data.detail, response.status), response.status, data);
        }
        return data as T;
    }
}
