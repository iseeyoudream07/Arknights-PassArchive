# PassArchive Web 构建包

将本压缩包全部内容解压到 Web 服务器根目录，首页为 index.html；完整保留 assets、rhine、licenses 和字体许可文件。

本包包含目录、三维终端、二维收藏、登录界面、图片和字体等静态资源。访客收藏与价格保存在当前浏览器 IndexedDB，可导出 JSON 备份。账号与跨设备同步需要同源 Django API 和 PostgreSQL，本静态包不包含数据库或后台进程。

完整源码、部署步骤与更新：
https://github.com/iseeyoudream07/Arknights-PassArchive
https://github.com/iseeyoudream07/Arknights-PassArchive/blob/main/docs/deployment-guide.md

仅本机预览可在解压目录运行 `python3 -m http.server 8080 --bind 127.0.0.1`，再访问 http://127.0.0.1:8080/?view=catalog 。账号功能仍需要后台，生产部署请使用 HTTPS。

本项目新增原创代码为 MIT，第三方数据、字体、游戏美术和短音按各自声明。请保留 LICENSE、THIRD_PARTY_NOTICES.md、licenses 与 rhine 内的许可文件。整包作为非官方、非商业学习交流项目提供。
