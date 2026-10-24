/*
 * 把通过校验的登录用户名转换成终端显示身份；访客使用默认 DOCTOR。
 */
/**
 * 已登录且用户名格式有效时显示 DR.<用户名>，否则使用通用访客身份。
 */
export function doctorIdentity(authenticated: boolean, username: unknown) {
    return authenticated && typeof username === 'string' && /^[a-z0-9_]{3,32}$/i.test(username)
        ? `DR.${username}` : 'DOCTOR';
}
