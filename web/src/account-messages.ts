/* 账号表单的常见输入提示；服务器仍负责完整的密码强度校验。 */
export function newPasswordMessage(password: string, confirmation: string): string | null {
    const length = [...password].length;
    if (length < 10) return '密码至少需要 10 个字符，请设置更长的密码。';
    if (length > 128) return '密码最多支持 128 个字符，请缩短后重试。';
    if (/^\p{Decimal_Number}+$/u.test(password)) return '密码不能只包含数字，请加入字母或其他字符。';
    if (password !== confirmation) return '两次输入的密码不一致，请重新确认。';
    return null;
}

export function accountErrorMessage(detail: unknown, status: number): string {
    const text = typeof detail === 'string' ? detail : '';
    // 兼容旧服务器的密码报错，界面只显示一条清楚的中文建议。
    if (text.includes('This password is too short')) return '密码至少需要 10 个字符，请设置更长的密码。';
    if (text.includes('This password is entirely numeric') || text.includes('密码只包含数字')) return '密码不能只包含数字，请加入字母或其他字符。';
    if (text.includes('This password is too common')) return '这个密码很容易被猜到，请换一个不常用的密码。';
    if (text.includes('The password is too similar') || text.includes('密码跟')) return '密码与用户名过于相似，请换一个差别更大的密码。';
    if (text && /\p{Script=Han}/u.test(text)) return text.slice(0, 400);
    if (status === 401) return '登录已过期，请重新登录后再试。';
    if (status === 403) return '登录验证未通过，请重新登录后再试。';
    if (status === 429) return '尝试次数较多，请稍后再试。';
    return '暂时无法完成操作，请稍后重试。';
}

export function userMessage(error: unknown, fallback = '操作未完成，请稍后重试。'): string {
    if (error instanceof Error) {
        if (error.name === 'QuotaExceededError') return '设备存储空间不足，收藏未能保存。请释放空间后重试。';
        if (error.name === 'SecurityError' || error.name === 'NotAllowedError') return '浏览器暂不允许保存数据，请检查存储权限或改用普通浏览模式。';
        if (/\p{Script=Han}/u.test(error.message)) return error.message.slice(0, 400);
    }
    return fallback;
}
