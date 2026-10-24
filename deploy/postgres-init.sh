#!/bin/sh
# 仅在项目全新的空 PostgreSQL 数据卷初始化时运行。
# 读取挂载的应用密码，创建权限受限的 pass_app 角色；不要在日常调试中手动运行。

# Run only during initialization of the project's new, empty PostgreSQL volume.
set -eu
app_password=$(cat /run/secrets/postgres_app_password)
psql --quiet --set ON_ERROR_STOP=1 --username postgres --dbname passarchive <<SQL
CREATE ROLE pass_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '$app_password';
GRANT CONNECT ON DATABASE passarchive TO pass_app;
ALTER SCHEMA public OWNER TO pass_app;
SQL
unset app_password
