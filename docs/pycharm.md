# 使用 PyCharm 编辑和运行

在 PyCharm 中打开包含 `README.md`、`backend/`、`web/`、`tools/` 的项目根目录。项目已经提供源码根目录、索引排除目录和五个共享运行配置，路径使用项目相对位置，可以移动或解压到自己的开发目录。

需要 Python 3.12+ 和 Node.js 22.12+。Python 虚拟环境放在项目的 `.venv/` 中。

## 第一次打开

1. 选择 **File → Open**，打开整个项目根目录。
2. 在 **Settings → Python → Interpreter** 选择项目解释器。如果已有 `.venv`，选择 `.venv/bin/python`；首次下载时，添加一个基于本机 Python 3.12+ 的 Virtualenv，位置设为项目下的 `.venv`。
3. 在顶部运行配置中选择 **01 初始化开发环境**，点击绿色运行按钮。它会安装锁定的 Python/Web 依赖，并初始化本机 SQLite 数据库。
4. 初始化完成后选择 **02 运行整站**，点击运行，打开 <http://127.0.0.1:5173/>。

每台电脑只需选择一次本地解释器。共享文件不包含个人的解释器绝对路径、数据库或 IDE 工作区状态。Windows 的虚拟环境解释器路径为 `.venv\Scripts\python.exe`。

## 运行和调试

| 配置 | 用途 |
| --- | --- |
| 01 初始化开发环境 | 安装依赖、创建本机数据库；依赖变化后可再次运行 |
| 02 运行整站 | 同时启动 Django API 和 Vite；修改前端自动更新，修改 Python 后端自动重载；按停止关闭两个服务 |
| 03 API 断点调试 | 直接调试 Django，在 Python 代码行号旁设置断点后点击调试；后端自动重载关闭，修改后重新启动 |
| 04 Web 热更新 | 单独启动前端，配合“03 API 断点调试”使用 |
| 05 本地检查 | Django 检查和测试，再执行 Web 构建与前端测试 |

日常开发使用 **02**。需要 Python 断点时，先停止 **02**，再启动 **03** 的调试与 **04** 的运行；它们使用相同的 8000/5173 端口，不能与 **02** 同时运行。

这些配置使用普通 Python 运行配置，前端由项目脚本调用 npm。Django 专用运行面板和 JavaScript 的高级 IDE 功能可以按自己的 PyCharm 安装情况启用。iOS 原生工程位于 `ios/`，仍需 Xcode 编译和运行。

## 修改哪个文件

| 想修改的部分 | 文件 |
| --- | --- |
| 二维目录、收藏、统计与设置 | `web/src/main.ts` |
| 二维页面的颜色、排版和移动布局 | `web/src/style.css` |
| 登录与注册界面 | `web/login.html`、`web/src/login-entry.ts`、`web/src/login.css` |
| 三维终端上的业务入口和手机布局 | `web/src/terminal-adaptation.css`、`web/src/vendor/rhine-full/main.ts` |
| 三维动画、模型和镜头 | `web/src/vendor/rhine-full/` |
| 账号与同步接口 | `backend/api/accounts.py` |
| 查询、统计与备份接口 | `backend/api/views.py`、`backend/api/domain.py` |
| 数据模型和数据库迁移 | `backend/api/models.py`、`backend/api/migrations/` |
| 统一目录数据 | `data/catalog.json`；重新构建流程见 `tools/build_catalog.py --help` |

`backend/` 已标记为 Python 源码根目录。`.venv`、`node_modules`、`dist`、`artifacts` 等依赖与生成目录不参与项目索引。共享运行配置保存在 `.run/`；个人 IDE 状态由 `.gitignore` 排除。

## 本机数据与终端用法

开发入口固定使用 `backend/db.sqlite3` 和本机端口。网页收藏保存在对应浏览器的本机存储；本机注册的账号数据进入该 SQLite 文件。开发入口会覆盖继承的 Django/数据库连接设置，不读取部署用的秘密文件。

也可以在 PyCharm 的 Terminal 中操作：

```bash
python3 tools/dev.py setup
python3 tools/dev.py run
```

前端单独运行和执行检查：

```bash
python3 tools/dev.py web
python3 tools/dev.py check
```

端口占用时先停止已有运行配置。找不到 Node.js 时，安装 Node.js 后重新打开 PyCharm；脚本也会查找 macOS 常用的 Homebrew 安装位置。

线上部署继续使用 [Docker 部署流程](deployment-guide.md)。本机运行按钮管理开发服务，发布步骤单独执行。

IDE 操作参考 JetBrains 官方说明：[Python 解释器](https://www.jetbrains.com/help/pycharm/configuring-python-interpreter.html)、[Python 运行配置](https://www.jetbrains.com/help/pycharm/run-debug-configuration-python.html)、[共享运行配置](https://www.jetbrains.com/help/pycharm/run-debug-configuration.html#share-configurations)。
