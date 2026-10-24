/*
 * 模块导读：壁纸启动时间与详情显示阶段的边界判断。
 * 此目录基于 RhineLabUI；原版权与来源见 NOTICE.md，具体调用关系见 docs/code-guide-zh.md。
 */

// Original-video seconds minus five, immediately before the standalone extraction.
export const ARRAY_OPENING_END = 25.9;
export function openingShowsDetail(value: unknown, workbench: boolean) {
  return value === "show" || (value !== "skip" && !workbench);
}
