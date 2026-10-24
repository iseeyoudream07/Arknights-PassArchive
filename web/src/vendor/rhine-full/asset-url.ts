/*
 * 模块导读：集中生成三维静态资源 URL；变更资源根目录时优先从这里检查。
 * 此目录基于 RhineLabUI；原版权与来源见 NOTICE.md，具体调用关系见 docs/code-guide-zh.md。
 */

/** Same-origin, versioned release resources. Model geometry stays unmodified. */
export const assetUrl = (path: string) => `/rhine/${path.replace(/^\//,'')}`;
