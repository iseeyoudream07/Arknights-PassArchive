# 三维终端与动效

运行代码位于 `web/src/vendor/rhine-full/`，基于 LBEILC/RhineLabUI 固定提交 `12cc5e4013acb9408f753ff71de6b8492299b7c8`。制作流程参考 RhineLabUI-Workflow `632bb9588076521ff70b43c986d1710d56e4b037`。所用源文件和资源的原 Git blob 清单见 `references/rhine-files.json`；可用 `tools/fetch_rhine.py` 重建未修改的参考快照，日常构建无需下载它。

## 页面与生命周期

`terminal.html` 在同源 iframe 中运行开屏、玻璃档案阵列、抽取解密和模型查看器。宿主的二维目录与 IndexedDB/账号业务独立运行。消息桥校验 origin 和 iframe 来源后处理目录、收藏、统计、设置及关注系列操作。

进入二维管理前暂停三维绘制；隐藏时不按零尺寸重建镜头，返回等待可见后恢复绘制并保留选档。主题、账号身份和关注系列由宿主同步。开屏未登录显示 DOCTOR，登录后显示 DR.用户名，属于界面身份展示，实际权限仍由 Django 会话校验。

原 25fps 开屏时间轴、逐字图形、标志、扫描、欢迎与白底退出保留；随后进入三维阵列与解密流程。可跳过、关闭或重播，声音默认关闭。14 项动画设置和系统减少动态效果偏好均被保留。

## 目录与交互

106 个真实系列映射到终端各列，显示编号与业务稳定 ID 独立。不等长列保留独立选择索引，避免无限循环中的槽位越界。干员名字展示可去重，但精一、精二收藏条目保持独立。

二维列表通过稳定 ID 复用条目和头像，收藏与价格保存不会替换整个结果列表。连续保存依次合并；多标签页、账号切换和云端冲突保护见 `accounts.md`。

## 开发与资源

```bash
cd web
npm ci --ignore-scripts
npm run dev
```

开发构建可用 `/?terminal-scene=archive` 或 `detail` 直接检查场景，`?terminal-time=8.6` 检查定帧开屏；正式构建忽略这些调试参数。predev/prebuild 自动应用 Rolling Number 文字测量补丁。

资源位于 `web/public/rhine/`，包含两个模型、MiSans 按需分片、配乐和来源说明。固定文字使用上游描边图形，不分发 Novecento 字体。MiSans、文字图形、短音和游戏标志不按本项目 MIT 重新授权，完整范围见 `THIRD_PARTY_NOTICES.md`。

离线缓存由宿主 `sw.js` 统一管理，预缓存真实构建包、目录、两个模型及四个 ASCII 字体分片；其他资源按访问缓存。所有私人账号接口排除缓存，IndexedDB 收藏与静态缓存分开。
