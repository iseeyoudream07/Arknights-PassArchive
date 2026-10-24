#!/usr/bin/env python3
# PyCharm 与终端共用的本机开发入口：setup 初始化、run 整站、web 前端、check 检查。
# 排查启动问题从 main → local_environment → ready/supervise 跟踪；本脚本固定选择本项目 SQLite。

"""Local PyCharm/terminal entry point: setup, run, web and check."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import socket
import subprocess
import sys
import time
import venv

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / 'backend'
WEB = ROOT / 'web'
PYTHON = ROOT / '.venv' / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')
STATE = ROOT / '.venv/passarchive-dev-setup.json'


# 复制当前进程环境，再移除继承的数据库/Django 配置，构造本机专用设置。
# 返回值传给子进程，不修改父进程环境；macOS 下补充常见 Node.js 安装路径。
def local_environment() -> dict[str, str]:
    env = os.environ.copy()
    # Local development always selects this checkout's SQLite database.
    for key in list(env):
        if key.startswith('DB_') or key.startswith('DJANGO_') or key in {
            'DEV_DB_PATH', 'CATALOG_PATH', 'CSRF_TRUSTED_ORIGINS',
        }:
            env.pop(key)
    env.update({
        'DJANGO_DEBUG': 'true', 'DJANGO_SETTINGS_MODULE': 'config.settings',
        'DJANGO_SECRET_KEY': 'local-development-only-arknights-pass',
        'DJANGO_ALLOWED_HOSTS': '127.0.0.1,localhost,testserver',
        'DEV_DB_PATH': str(BACKEND / 'db.sqlite3'),
        'CATALOG_PATH': str(ROOT / 'data/catalog.json'),
        'CSRF_TRUSTED_ORIGINS': 'http://127.0.0.1:5173,http://localhost:5173',
        'PYTHONUNBUFFERED': '1',
    })
    # macOS GUI apps may start without Homebrew's bin directory in PATH.
    bins = [str(p) for p in [Path('/opt/homebrew/bin'), Path('/usr/local/bin')] if p.is_dir()]
    env['PATH'] = os.pathsep.join([*bins, env.get('PATH', '')])
    return env


# 打印当前步骤并同步执行子命令；非零退出码会中止后续步骤。
def command(label: str, args: list[str], cwd: Path, env: dict[str, str]) -> None:
    print(f'\n{label}', flush=True)
    subprocess.run(args, cwd=cwd, env=env, check=True)


# 定位 Node.js/npm 并检查最低版本；返回 npm 的可执行路径。
def npm_runtime(env: dict[str, str]) -> str:
    node = shutil.which('node', path=env['PATH'])
    npm = shutil.which('npm', path=env['PATH'])
    if not node or not npm:
        raise RuntimeError('需要安装 Node.js 22.12+，安装后重新打开 PyCharm。')
    result = subprocess.check_output([node, '--version'], env=env, text=True).strip()
    match = re.match(r'v(\d+)\.(\d+)', result)
    if not match or tuple(map(int, match.groups())) < (22, 12):
        raise RuntimeError(f'当前 Node.js 为 {result}，需要 22.12+。')
    return npm


# 按依赖文件摘要判断是否安装 Python/Web 依赖，然后迁移本机 SQLite。
# 安装状态写入 .venv/passarchive-dev-setup.json，避免每次重复安装。
def setup(env: dict[str, str]) -> None:
    if sys.version_info < (3, 12):
        raise RuntimeError('请使用 Python 3.12+ 创建项目解释器。')
    npm = npm_runtime(env)
    if not PYTHON.is_file():
        print('创建项目 .venv…', flush=True)
        venv.EnvBuilder(with_pip=True).create(ROOT / '.venv')
    state = json.loads(STATE.read_text()) if STATE.is_file() else {}
    requirements = hashlib.sha256((ROOT / 'requirements.txt').read_bytes() +
                                  (BACKEND / 'requirements.txt').read_bytes()).hexdigest()
    lock = hashlib.sha256((WEB / 'package-lock.json').read_bytes()).hexdigest()
    imports = subprocess.run([str(PYTHON), '-c', 'import django, rest_framework, psycopg'],
                             env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if state.get('requirements') != requirements or imports.returncode:
        command('安装 Python 依赖…', [str(PYTHON), '-m', 'pip', 'install', '-r', str(ROOT / 'requirements.txt')], ROOT, env)
    if state.get('npm_lock') != lock or not (WEB / 'node_modules/vite/bin/vite.js').is_file():
        command('安装 Web 依赖…', [npm, 'ci', '--ignore-scripts'], WEB, env)
    command('初始化本地数据库…', [str(PYTHON), 'manage.py', 'migrate', '--noinput'], BACKEND, env)
    STATE.write_text(json.dumps({'requirements': requirements, 'npm_lock': lock}, indent=2) + '\n')
    print('\n初始化完成。PyCharm 解释器选择 .venv，然后运行「02 运行整站」。', flush=True)


# 确认虚拟环境和前端依赖已初始化，再检查 Node.js/npm 是否可用。
def ready(env: dict[str, str]) -> str:
    if not PYTHON.is_file() or not (WEB / 'node_modules/vite/bin/vite.js').is_file():
        raise RuntimeError('请先运行「01 初始化开发环境」或 python3 tools/dev.py setup。')
    return npm_runtime(env)


# 尝试绑定本机端口；若端口被占用，提示先停止已有开发服务。
def available(port: int) -> None:
    with socket.socket() as sock:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            sock.bind(('127.0.0.1', port))
        except OSError as error:
            raise RuntimeError(f'本机 {port} 端口已被使用，请先停止已有的开发服务。') from error


# 启动并监控开发子进程；任一进程退出后统一回收整组进程。
# 处理 PyCharm 停止按钮和 Ctrl+C，避免留下占用 8000/5173 端口的进程。
def supervise(jobs: list[tuple[list[str], Path]], env: dict[str, str]) -> int:
    children: list[subprocess.Popen] = []

    # 把终止信号转换为 KeyboardInterrupt，使统一清理逻辑能够执行。
    def interrupted(_signum, _frame):
        raise KeyboardInterrupt

    previous = signal.signal(signal.SIGTERM, interrupted)
    try:
        for args, cwd in jobs:
            options = {'start_new_session': True} if os.name != 'nt' else {
                'creationflags': subprocess.CREATE_NEW_PROCESS_GROUP,
            }
            children.append(subprocess.Popen(args, cwd=cwd, env=env, **options))
        while True:
            for child in children:
                result = child.poll()
                if result is not None:
                    return result or (1 if len(children) > 1 else 0)
            time.sleep(0.2)
    except KeyboardInterrupt:
        return 0
    # 即使启动失败或收到停止信号，也会进入清理，先温和终止，超时再强制回收。
    finally:
        signal.signal(signal.SIGTERM, previous)
        for child in reversed(children):
            try:
                if os.name == 'nt':
                    subprocess.run(['taskkill', '/PID', str(child.pid), '/T', '/F'],
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                else:
                    os.killpg(child.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
        for child in children:
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                if os.name != 'nt':
                    try:
                        os.killpg(child.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                else:
                    child.kill()
                child.wait()


# 解析 setup/run/web/check 操作并分派；默认 run 同时启动 API 与前端。
def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', nargs='?', default='run', choices=['setup', 'run', 'web', 'check'])
    args = parser.parse_args()
    env = local_environment()
    if args.action == 'setup':
        setup(env)
        return 0
    npm = ready(env)
    if args.action == 'check':
        command('检查 Django…', [str(PYTHON), 'manage.py', 'check'], BACKEND, env)
        command('运行后端测试…', [str(PYTHON), 'manage.py', 'test', 'api', '--noinput'], BACKEND, env)
        command('构建 Web…', [npm, 'run', 'build'], WEB, env)
        command('运行前端测试…', [npm, 'test'], WEB, env)
        return 0
    # 整站和前端独立配置共用 5173，先检查占用；后端断点配置另占用 8000。
    available(5173)
    web_job = ([npm, 'run', 'dev', '--', '--port', '5173', '--strictPort'], WEB)
    if args.action == 'web':
        return supervise([web_job], env)
    available(8000)
    command('更新本地数据库…', [str(PYTHON), 'manage.py', 'migrate', '--noinput'], BACKEND, env)
    print('\n本地页面：http://127.0.0.1:5173/\nAPI：http://127.0.0.1:8000/api/v1/health/\n在 PyCharm 按停止，或在终端按 Ctrl+C，关闭两个服务。\n', flush=True)
    return supervise([([str(PYTHON), 'manage.py', 'runserver', '127.0.0.1:8000'], BACKEND), web_job], env)


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (RuntimeError, OSError) as error:
        print(f'\n无法启动：{error}', file=sys.stderr)
        raise SystemExit(1)
    except subprocess.CalledProcessError as error:
        print(f'\n步骤执行失败，退出码 {error.returncode}。请检查上方输出。', file=sys.stderr)
        raise SystemExit(error.returncode)
    except KeyboardInterrupt:
        raise SystemExit(130)
