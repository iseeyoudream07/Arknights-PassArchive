"""Run the native HTTP client against disposable loopback Django + SQLite.

Never loads deployment env files. The temporary database and test users are
removed when the process exits. --serve keeps this isolated API for Simulator QA.
"""
import argparse
import fcntl
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys
import tempfile
import time
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parent.parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=0)
    parser.add_argument("--serve", action="store_true")
    parser.add_argument("--ui-device", help="Run XCUITest on this dedicated Simulator UUID (requires --port 18084).")
    args = parser.parse_args()
    if args.ui_device and args.port != 18084:
        parser.error("UI tests use the isolated loopback port 18084; add --port 18084.")
    output = ROOT / "artifacts"
    output.mkdir(exist_ok=True)
    # 同一工程一次只运行一个验收，防止端口争用和日志被两个进程同时覆盖。
    lock = (output / "ios-validation.lock").open("w")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        raise SystemExit("已有 iOS 隔离验收在运行，请待其结束后再执行。")
    python = ROOT / ".venv/bin/python"
    if not python.exists():
        raise SystemExit("先按 README 安装 backend/requirements.txt。")
    port = args.port
    with socket.socket() as probe:
        try:
            probe.bind(("127.0.0.1", port))
        except OSError:
            raise SystemExit(f"本机端口 {port} 已被占用，未启动测试或连接该服务。")
        port = probe.getsockname()[1]
    base = f"http://127.0.0.1:{port}"
    with tempfile.TemporaryDirectory(prefix="passarchive-ios-") as temporary:
        # 只在测试路由中提供本机图片，模拟真实同源部署，不改应用后端。
        Path(temporary, "ios_validation_settings.py").write_text(
            "from config.settings import *\nROOT_URLCONF = 'ios_validation_urls'\n")
        Path(temporary, "ios_validation_urls.py").write_text(
            "from config.urls import urlpatterns as api_patterns\n"
            "from django.urls import re_path\nfrom django.views.static import serve\n"
            f"urlpatterns = api_patterns + [re_path(r'^assets/(?P<path>.*)$', serve, {{'document_root': {str(ROOT / 'web/public/assets')!r}}})]\n")
        # 清除继承的生产数据库/密钥配置，再显式指定临时 SQLite。
        env = {key: value for key, value in os.environ.items()
               if not key.startswith(("DB_", "DJANGO_", "CSRF_", "CATALOG_"))}
        env.update({
            "DJANGO_DEBUG": "true", "DJANGO_ALLOWED_HOSTS": "127.0.0.1,localhost",
            "DJANGO_SECRET_KEY": secrets.token_urlsafe(48),
            "DEV_DB_PATH": str(Path(temporary) / "ios-test.sqlite3"),
            "CSRF_TRUSTED_ORIGINS": base,
            "PASSARCHIVE_TEST_API": base, "PASSARCHIVE_TEST_EXPORT_DIR": temporary,
            "DJANGO_SETTINGS_MODULE": "ios_validation_settings",
            "PYTHONPATH": str(temporary) + os.pathsep + str(ROOT / "backend"),
        })
        with (output / "ios-api-server.log").open("w") as log:
            subprocess.run([str(python), "backend/manage.py", "migrate", "--noinput"],
                           cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT, check=True)
            server = subprocess.Popen([str(python), "backend/manage.py", "runserver", f"127.0.0.1:{port}", "--noreload"],
                                      cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT)
            try:
                ready = False
                for _ in range(100):
                    if server.poll() is not None:
                        raise RuntimeError("隔离 API 启动失败，查看 artifacts/ios-api-server.log。")
                    try:
                        with urlopen(base + "/api/v1/health/", timeout=1) as response:
                            ready = response.status == 200
                    except OSError:
                        pass
                    if ready:
                        break
                    time.sleep(0.2)
                if not ready:
                    raise RuntimeError("隔离 API 启动超时。")
                print(f"Isolated API: {base}", flush=True)
                if args.serve:
                    print("Disposable SQLite; stop with Ctrl-C after Simulator QA.", flush=True)
                    server.wait()
                    return
                command = ["swift", "test", "--package-path", "ios", "--scratch-path", "artifacts/ios-swift-tests",
                           "--cache-path", "artifacts/ios-swift-cache", "--filter", "APIIntegrationTests"]
                with (output / "ios-api-tests.log").open("w") as tests:
                    result = subprocess.run(command, cwd=ROOT, env=env, stdout=tests, stderr=subprocess.STDOUT)
                if result.returncode:
                    raise RuntimeError("原生 HTTP 验收失败，查看 artifacts/ios-api-tests.log。")
                # 使用实际 Web 规则读取 iOS 导出，核对浏览器/原生/后端三方结果。
                script = """
                    import fs from 'node:fs';
                    import assert from 'node:assert/strict';
                    import {normalizeBackup, calculateStats} from './src/core.ts';
                    const plain = value => JSON.parse(JSON.stringify(value));
                    const folder = process.env.PASSARCHIVE_TEST_EXPORT_DIR;
                    const catalog = JSON.parse(fs.readFileSync('../data/catalog.json', 'utf8'));
                    const native = JSON.parse(fs.readFileSync(folder + '/native-backup.json', 'utf8'));
                    const expected = JSON.parse(fs.readFileSync(folder + '/native-stats.json', 'utf8'));
                    const normalized = normalizeBackup(native, catalog).backup;
                    assert.deepEqual(calculateStats(catalog, normalized.collection), expected);
                    assert.deepEqual(plain(normalized.unmapped), native.unmapped);
                    assert.deepEqual(normalized.followed_series, native.followed_series);
                    const response = await fetch(process.env.PASSARCHIVE_TEST_API + '/api/v1/backups/validate/', {
                        method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(native)
                    });
                    assert.equal(response.status, 200);
                    const validated = await response.json();
                    assert.deepEqual(validated.stats, expected);
                    assert.deepEqual(validated.backup.collection, plain(normalized.collection));
                    assert.deepEqual(validated.backup.unmapped, plain(normalized.unmapped));
                    console.log('Swift / Web / Django backup and statistics agree.');
                """
                result = subprocess.run(["node", "--import", "./tests/register-typescript.mjs", "--input-type=module", "-e", script],
                                        cwd=ROOT / "web", env=env, capture_output=True, text=True)
                (output / "ios-web-roundtrip.log").write_text(result.stdout + result.stderr)
                if result.returncode:
                    raise RuntimeError("跨端备份验收失败，查看 artifacts/ios-web-roundtrip.log。")
                if args.ui_device:
                    results = output / ("ios-ui-" + time.strftime("%Y%m%d-%H%M%S") + ".xcresult")
                    with (output / "ios-ui-tests.log").open("w") as ui_log:
                        ui_result = subprocess.run([
                            "xcodebuild", "-project", "ios/PassArchive.xcodeproj", "-scheme", "PassArchive",
                            "-configuration", "Debug", "-destination", f"platform=iOS Simulator,id={args.ui_device}",
                            "-derivedDataPath", "artifacts/ios-build", "-resultBundlePath", str(results),
                            "-parallel-testing-enabled", "NO", "-collect-test-diagnostics", "never",
                            "CODE_SIGNING_ALLOWED=NO", "test"
                        ], cwd=ROOT, env=env, stdout=ui_log, stderr=subprocess.STDOUT)
                    if ui_result.returncode:
                        raise RuntimeError("模拟器 UI 验收失败，查看 artifacts/ios-ui-tests.log。")
                report = {"native_http": "passed", "web_backup_roundtrip": "passed", "statistics_three_way": "passed",
                          "database": "temporary SQLite", "production_data_accessed": False}
                if args.ui_device:
                    report["simulator_ui"] = "passed"
                    report["xcresult"] = str(results.relative_to(ROOT))
                (output / "ios-api-verification.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
                print(result.stdout.strip())
            finally:
                server.terminate()
                try:
                    server.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    server.kill()
                    server.wait()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(0)
