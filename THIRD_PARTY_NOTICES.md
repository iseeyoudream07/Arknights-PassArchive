# 来源、版权与许可范围

根目录 `LICENSE` 仅授权本项目新增原创代码。保留的第三方代码及资源按其原授权和权利范围处理；MIT 不替代下列独立许可，也不赋予对游戏美术、商标或字体的额外权利。

## 主体目录与规则

- 来源：[SpectMercyRE/Arknights-pass-statistics](https://github.com/SpectMercyRE/Arknights-pass-statistics)。
- 固定提交：`1f31daf9edc7c0afb3ddc6744cd5809ca911957f`。
- 代码版权：Copyright (c) 2026 虚瞑 (SpectMercyRE)，MIT；全文保留在 `upstream/LICENSE` 及 `web/public/licenses/upstream-MIT.txt`。
- 原作者的额外素材说明和非商业使用声明保留在 `upstream/DISCLAIMER.md` 及 `web/public/licenses/upstream-DISCLAIMER.txt`。原 MIT 代码许可与该声明的不同表述均予保留，不声称代码 MIT 可以覆盖第三方素材。
- 原资料署名：Bilibili @燎冬谣、小红书 @KJCJS、PRTS wiki / 森空岛 wiki，按上游已有声明保留。
- 本项目修改：规范化稳定 ID，转换为共享 JSON，移植统计与旧备份规则，补充来源、条码和日期映射；原始冲突值保留。

## 盒号、条码与日期补充

- 来源：[awadwd/ArknightsAuthorization_Series-mirror](https://github.com/awadwd/ArknightsAuthorization_Series-mirror)，方舟通行证谷子查询工具静态资料库；输入为 `ArknightsAuthorization_Series-main.zip`。
- 原资料声明采用 [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/)；全文在 `licenses/CC-BY-NC-4.0.txt` 和 `web/public/licenses/CC-BY-NC-4.0.txt`。
- 本项目仅按可信系列映射提取盒号、条码、首发及复刻日期，转换字段和格式；不导入预测盒或资料库市场价。
- 来源文件摘要、原声明摘要和差异记录在 `docs/data-audit.json`。组合目录的数据范围另见 `data/LICENSE.md`；这部分不按本项目 MIT 重新授权。

## RhineLabUI 终端与动效

- 来源：[LBEILC/RhineLabUI](https://github.com/LBEILC/RhineLabUI)，固定提交 `12cc5e4013acb9408f753ff71de6b8492299b7c8`。
- Copyright (c) 2026 LBEILC。其原创代码、原创模型和程序编配配乐按 MIT；全文在 `web/public/licenses/rhine-full-MIT.txt`，源目录说明在 `web/src/vendor/rhine-full/NOTICE.md`。
- 修改包括真实通行认证目录、同源父页导航、账号身份、关注系列、生命周期暂停与恢复、独立服务工作器、移动布局及拥有状态桥接。
- 制作参考：[RhineLabUI-Workflow](https://github.com/LBEILC/RhineLabUI-Workflow)，固定提交 `632bb9588076521ff70b43c986d1710d56e4b037`。`references/rhine-files.json` 保留所用源文件与资源的原 Git blob 校验。

## 字体、文字图形与依赖

- **MiSans**：小米 / Beijing Xiaomi Mobile Software Co., Ltd.。分片来自 `misans-webfont@4.3.1`，字体 Version 4.003，分片未修改；CSS 家族名、映射和路径有所调整。字体许可在 `web/public/rhine/fonts/MiSans-license.pdf`，来源和原署名在同目录 `NOTICE.txt` 与分片目录的 `source.json` / `UPSTREAM-README.md`。
- **Novecento Sans Wide 固定文字图形**：Jan Tonellato / Synthview Type Design。使用上游已经制作的描边图形，不分发桌面字体或专有 Webfont。说明与来源许可链接在 `web/public/licenses/rhine-opening-lettering.txt`。修改图形所用文字前须自行取得相应字体授权。
- **Three.js 0.183.2**：MIT，全文在 `web/public/licenses/three-MIT.txt`。
- **Rolling Number 0.4.1**：MIT，全文在 `web/public/rhine/licenses/rolling-number.txt`。文字测量补丁保留在 `web/scripts/patch-rolling-number.mjs`。
- Django、Django REST framework、psycopg、Vite 等构建或运行依赖保留各自包内许可；锁定依赖见 `backend/requirements.txt` 和 `web/package-lock.json`。

## 游戏美术、标志、截图与短音

游戏名称、干员角色、头像、整盒图、相关标志和原片音效的权利归其原权利人所有，包括上海鹰角网络科技有限公司及相关权利主体。这些内容不包含在本项目或上游原创代码的 MIT 授权中。

`web/public/assets/images/` 的 948 个运行图片来自项目提供的 `images.zip`；上传包没有单独的图片再分发许可证。本仓库保留来源与权利说明，不声称获得独立商业或再授权权利。`docs/images/` 为本项目功能展示截图，画面中的游戏素材保留同样的权利归属。

三个约 38ms 的输入短音来自《明日方舟》特别映像“莱茵生命：访问”；处理与来源说明保留在 `web/public/rhine/audio/README.md` 和 `typing-source.json`。它们不属于上游三轨原创配乐的 MIT 范围。

本项目为非官方、非商业学习交流项目，不代表游戏或任何上游作者的官方认可。权利问题可通过本仓库 Issues 联系维护者。
