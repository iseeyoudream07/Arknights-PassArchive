/*
 * 模块导读：动效偏好的定义、预设、规范化与设置表单；系统减少动态效果作为默认依据。
 * 此目录基于 RhineLabUI；原版权与来源见 NOTICE.md，具体调用关系见 docs/code-guide-zh.md。
 */

export type MotionKey =
  | "boot"
  | "selectionWave"
  | "idleWave"
  | "pointerParallax"
  | "dragMomentum"
  | "selectionTransition"
  | "detailTransition"
  | "modelDecryption"
  | "documentReveal"
  | "rollingText"
  | "rollingNumbers"
  | "surfaceTransitions"
  | "viewerNavigation"
  | "viewerModelTransition";

export type MotionPreferences = Record<MotionKey, boolean>;
export type MotionPreset = "full" | "reduced" | "custom";

export type StoredMotion = Partial<MotionPreferences> & {
  preset?: MotionPreset;
};

export const MOTION_LABELS: Record<
  MotionKey,
  { title: string; description: string; group: string }
> = {
  boot: {
    title: "BOOT SEQUENCE",
    description: "打开应用时播放标志和欢迎动画",
    group: "开场",
  },
  selectionWave: {
    title: "SELECTION WAVE",
    description: "选择系列时，周围模型随之起伏",
    group: "档案阵列",
  },
  idleWave: {
    title: "IDLE MOTION",
    description: "未操作时，模型轻轻起伏",
    group: "档案阵列",
  },
  pointerParallax: {
    title: "POINTER PARALLAX",
    description: "画面随鼠标指针轻微移动",
    group: "档案阵列",
  },
  dragMomentum: {
    title: "DRAG MOMENTUM",
    description: "停止拖动后，模型继续滑动并逐渐停下",
    group: "档案阵列",
  },
  selectionTransition: {
    title: "SELECTION TRANSITION",
    description: "切换分类或系列时平滑移动",
    group: "档案阵列",
  },
  detailTransition: {
    title: "DETAIL TRANSITION",
    description: "打开或关闭系列详情时的模型动画",
    group: "档案详情",
  },
  modelDecryption: {
    title: "MODEL DECRYPTION",
    description: "逐渐显示模型内容的动画",
    group: "档案详情",
  },
  documentReveal: {
    title: "DOCUMENT REVEAL",
    description: "逐渐显示正文的动画",
    group: "档案详情",
  },
  rollingText: {
    title: "ROLLING TEXT",
    description: "切换标题和分类时的文字滚动",
    group: "界面",
  },
  rollingNumbers: {
    title: "ROLLING NUMBERS",
    description: "切换序号和编号时的数字滚动",
    group: "界面",
  },
  surfaceTransitions: {
    title: "SURFACE TRANSITIONS",
    description: "打开详情、搜索、关注和设置时的过渡动画",
    group: "界面",
  },
  viewerNavigation: {
    title: "VIEWER NAVIGATION",
    description: "旋转、平移、缩放和恢复视角时平滑过渡",
    group: "360° 查看器",
  },
  viewerModelTransition: {
    title: "VIEWER MODEL TRANSITION",
    description: "拆解或重组模型时平滑过渡",
    group: "360° 查看器",
  },
};

const FULL: MotionPreferences = {
  boot: true,
  selectionWave: true,
  idleWave: true,
  pointerParallax: true,
  dragMomentum: true,
  selectionTransition: true,
  detailTransition: true,
  modelDecryption: true,
  documentReveal: true,
  rollingText: true,
  rollingNumbers: true,
  surfaceTransitions: true,
  viewerNavigation: true,
  viewerModelTransition: true,
};

const REDUCED: MotionPreferences = {
  boot: false,
  selectionWave: false,
  idleWave: false,
  pointerParallax: false,
  dragMomentum: false,
  selectionTransition: false,
  detailTransition: false,
  modelDecryption: false,
  documentReveal: false,
  rollingText: false,
  rollingNumbers: false,
  surfaceTransitions: false,
  viewerNavigation: false,
  viewerModelTransition: false,
};

export function fullMotion(): MotionPreferences {
  return { ...FULL };
}

export function reducedMotion(): MotionPreferences {
  return { ...REDUCED };
}

export function motionPresetFor(motion: MotionPreferences): MotionPreset {
  if (Object.values(motion).every(Boolean)) return "full";
  if (Object.values(motion).every((value) => !value)) return "reduced";
  return "custom";
}

export function createMotionPreferences(
  stored: StoredMotion | undefined,
  legacyReduced: boolean | undefined,
): MotionPreferences {
  const base =
    stored?.preset === "full"
      ? FULL
      : stored?.preset === "reduced"
        ? REDUCED
        : legacyReduced === true
          ? REDUCED
          : FULL;
  const result = { ...base };
  if (stored) {
    for (const key of Object.keys(FULL) as MotionKey[]) {
      if (typeof stored[key] === "boolean")
        result[key] = stored[key] as boolean;
    }
  }
  return result;
}

export function motionEnabled(motion: MotionPreferences, key: MotionKey) {
  return motion[key];
}

export function motionSummary(motion: MotionPreferences) {
  const enabled = Object.values(motion).filter(Boolean).length;
  if (enabled === Object.keys(motion).length) return "当前使用完整动画。";
  if (enabled === 0) return "当前已关闭动画。";
  const highlights: string[] = [];
  if (!motion.boot) highlights.push("开场已跳过");
  if (!motion.selectionWave && !motion.idleWave)
    highlights.push("阵列波动已关闭");
  if (!motion.rollingText && !motion.rollingNumbers)
    highlights.push("文字滚动已关闭");
  return `当前使用自定义动画（${highlights.slice(0, 2).join("、") || `启用 ${enabled} 项`}）。`;
}

export function motionSettingsMarkup(
  motion: MotionPreferences,
  preset?: MotionPreset,
) {
  const groups = [
    ...new Set(Object.values(MOTION_LABELS).map((entry) => entry.group)),
  ];
  const selected = preset ?? motionPresetFor(motion);
  const presetButton = (value: "full" | "reduced" | "custom", label: string) =>
    `<button type="button" data-action="motion-preset" data-preset="${value}" aria-pressed="${selected === value}"${value === "custom" ? " disabled" : ""}>${label}</button>`;
  return `<section id="motion-settings" class="motion-settings" aria-label="动效设置"><div class="motion-settings-head"><div><strong>ANIMATION CONTROLS</strong><span>可选择全部开启、全部关闭，或逐项调整。启动动画的设置在下次播放时生效。</span></div>${presetButton("full", "完整")}${presetButton("reduced", "关闭")}${presetButton("custom", "自定义")}</div><details class="motion-advanced"><summary>自定义动画 <span>开场 / 阵列 / 详情 / 界面 / 360° 查看器</span></summary><div class="motion-groups">${groups
    .map(
      (group) =>
        `<fieldset><legend>${group}</legend>${(
          Object.keys(MOTION_LABELS) as MotionKey[]
        )
          .filter((key) => MOTION_LABELS[key].group === group)
          .map((key) => {
            const item = MOTION_LABELS[key];
            return `<label class="motion-setting"><div><strong>${item.title}</strong><span>${item.description}</span></div><input type="checkbox" data-motion="${key}" ${motion[key] ? "checked" : ""}/><i class="toggle"></i></label>`;
          })
          .join("")}</fieldset>`,
    )
    .join("")}</div></details></section>`;
}
