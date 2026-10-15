# 部署 Web 与 PostgreSQL 账号服务

本文用于新的 Linux VPS 部署。开发用 SQLite 不适用于正式账号存储。服务器需要 Docker Compose、Nginx、可用域名和 HTTPS 证书；仓库不包含任何生产密码、证书私钥、账号存档或数据库备份。

## 1. 准备目录与静态站点

示例假定源码在 `/srv/passarchive`：

```bash
git clone https://github.com/iseeyoudream07/Arknights-PassArchive.git /srv/passarchive
cd /srv/passarchive
cd web
npm ci --ignore-scripts
npm run build
cd ..
cp deploy/.env.example deploy/.env
```

也可把 Release 的 Web 包解压到 `/srv/passarchive/web/dist`。编辑 `deploy/.env`，配置自己的域名、HTTPS origin 和秘密文件目录。不要把 `deploy/.env` 或 secrets 加入 Git。

## 2. 为新实例生成密钥

仅在**新的空实例**执行以下命令。若任何目标文件已经存在，脚本会停止；更新已有实例时保留原来的密钥与数据库卷。

```bash
sudo python3 - <<'PY'
import os, secrets
from pathlib import Path
folder = Path('/srv/passarchive/secrets')
specs = [('postgres-admin-password', 70, 70, 0o400),
         ('postgres-app-password', 10001, 70, 0o440),
         ('django-secret-key', 10001, 10001, 0o400)]
if any((folder / name).exists() for name, *_ in specs):
    raise SystemExit('Secret file already exists; preserve existing credentials.')
folder.mkdir(parents=True, exist_ok=True, mode=0o700)
folder.chmod(0o700)
for name, uid, gid, mode in specs:
    fd = os.open(folder / name, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as handle:
        handle.write(secrets.token_hex(32) + '\n')
    os.chown(folder / name, uid, gid)
    os.chmod(folder / name, mode)
PY
```

UID 70 对应模板中的 PostgreSQL Alpine 用户，UID 10001 对应 API 容器；生成的应用密码为十六进制，符合初始化脚本约定。密钥只通过只读文件挂载，不写入镜像或命令参数。

## 3. 构建、迁移和启动

```bash
docker compose --env-file deploy/.env -p passarchive -f deploy/compose.release.yml build api
docker compose --env-file deploy/.env -p passarchive -f deploy/compose.release.yml up -d postgres
docker compose --env-file deploy/.env -p passarchive -f deploy/compose.release.yml run --rm api python manage.py migrate --noinput
docker compose --env-file deploy/.env -p passarchive -f deploy/compose.release.yml up -d api
```

PostgreSQL 不发布公网端口；API 仅监听本机 `127.0.0.1:18082`。应用角色 `pass_app` 无超级用户、创建角色或创建数据库权限。模板的网络与卷按 Compose 项目隔离，勿对保存用户数据的实例执行 `down -v`。

## 4. Nginx 与 HTTPS

以 `deploy/nginx.example.conf` 为起点，替换 `passarchive.example`、证书路径和静态文件目录；若改了 API 端口，也同步修改反向代理端口。先配置有效证书，再启用该 HTTPS 配置。

站点根目录指向 `web/dist`，`/api/` 代理到本机 API。`terminal.html` 必须允许同源 iframe，其他页面继续禁止被嵌入；保留模板中的安全响应头。正式环境的会话 Cookie 使用 Secure，因此账号功能需要 HTTPS 和同源访问。

## 5. 检查与更新

- `/api/v1/health/` 应返回 `storage: postgresql` 与 `accounts: true`。
- 在独立测试账号验证注册、登录、收藏、重新登录恢复，以及另一浏览器同步；不要导入真实用户数据做演示。
- 更新前备份数据库；构建新的镜像与静态目录，完成隔离检查后切换。需要迁移时仅对本站数据库运行对应迁移，保留旧镜像、静态目录和可恢复备份。
- 私人接口不得进入 CDN 或服务工作器缓存；新增规则时保留账号与 CSRF 隔离。

备份示例（在私有目录运行，文件不属于网站静态目录）：

```bash
umask 077
mkdir -p backups
docker compose --env-file deploy/.env -p passarchive -f deploy/compose.release.yml exec -T --user postgres postgres pg_dump -U postgres -d passarchive -Fc > backups/passarchive.dump
```

备份应另行保存到服务器以外的位置。恢复先在隔离数据库检查，再安排停写切换；不要把恢复验证覆盖到正在使用的数据库。账号协议与并发检查见 [accounts.md](accounts.md)。
