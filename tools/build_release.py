#!/usr/bin/env python3
# 从干净且已提交的 Git 工作区制作公开源码包和 Web 静态包。
# 执行会构建并写入 artifacts/releases/；普通本机调试使用 tools/dev.py。

"""Build source and static Web distributions from a clean, committed checkout."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[1]
FORBIDDEN = {".git", ".venv", "node_modules", "__pycache__", "artifacts", "sources", "secrets", ".secrets", "backups", "xcuserdata"}
SECRET = re.compile(rb"(?:-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|AKIA[A-Z0-9]{16})")


# 在项目根目录执行 Git 并返回原始字节；避免依赖调用者的工作目录。
def git(*args: str) -> bytes:
    return subprocess.check_output(["git", *args], cwd=ROOT)


# 检查公开包路径，排除依赖、数据库、密钥文件及现场发布脚本。
def validate_public_path(name: str) -> None:
    path = Path(name)
    assert not path.is_absolute() and ".." not in path.parts, name
    assert not FORBIDDEN.intersection(path.parts), name
    assert path.name == ".env.example" or not path.name.startswith(".env"), name
    assert path.suffix.lower() not in {".sqlite3", ".db", ".dump", ".key", ".pem", ".p8", ".p12", ".mobileprovision"}, name
    assert not (path.parts[0] == "deploy" and path.name.startswith(("publish-", "prepare-", "finalize-"))), name


# 检查 Git 跟踪文件的路径、体积与已知凭据特征，返回可打包文件清单。
def audit_sources() -> list[str]:
    names = git("ls-files", "-z").decode().rstrip("\0").split("\0")
    for name in names:
        validate_public_path(name)
        data = (ROOT / name).read_bytes()
        assert not data.startswith(b"SQLite format 3"), name
        assert not SECRET.search(data), f"Possible credential in {name}"
        assert len(data) < 100 * 1024 * 1024, f"GitHub file limit: {name}"
    return names


# 要求工作区干净，确保发布包能追溯到明确提交。
def clean_checkout() -> None:
    if git("status", "--porcelain").strip():
        raise SystemExit("Commit or remove public working-tree changes before creating a release.")


# 流式计算成品 SHA-256，供发布校验清单使用。
def digest(path: Path) -> str:
    with path.open("rb") as handle:
        return hashlib.file_digest(handle, "sha256").hexdigest()


# 读取版本并审核源码，按参数构建/复用静态产物，最后打包与生成校验和。
def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-only", action="store_true", help="Only archive the committed source tree")
    parser.add_argument("--skip-build", action="store_true", help="Use the already built web/dist after verifying its version")
    args = parser.parse_args()
    version = json.loads((ROOT / "web/package.json").read_text())["version"]
    assert re.fullmatch(r"\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?", version)
    clean_checkout()
    names = audit_sources()
    commit = git("rev-parse", "HEAD").decode().strip()
    output = ROOT / "artifacts/releases" / f"v{version}"
    output.mkdir(parents=True, exist_ok=True)
    source = output / f"PassArchive-source-v{version}.zip"
    git("archive", "--format=zip", f"--prefix=Arknights-PassArchive-v{version}/", "--output", str(source), "HEAD")
    with zipfile.ZipFile(source) as archive:
        assert archive.testzip() is None
        expected = {f"Arknights-PassArchive-v{version}/{name}" for name in names}
        assert {n for n in archive.namelist() if not n.endswith("/")} == expected
    packages = [source]

    if not args.source_only:
        if not args.skip_build:
            subprocess.run(["npm", "run", "build"], cwd=ROOT / "web", check=True)
        clean_checkout()
        dist = ROOT / "web/dist"
        manifest = json.loads((dist / "app-cache.json").read_text())
        assert manifest["version"] == version
        required = ["index.html", "terminal.html", "credits.html", "login.html", "admin.html", "catalog.json", "sw.js",
                    "LICENSE", "THIRD_PARTY_NOTICES.md", "licenses/CC-BY-NC-4.0.txt",
                    "rhine/assets/archive-cassette.glb", "rhine/assets/archive-assembly.glb",
                    "rhine/fonts/MiSans-license.pdf"]
        assert all((dist / name).is_file() for name in required)
        stamp = datetime.fromtimestamp(int(git("show", "-s", "--format=%ct", "HEAD")), timezone.utc).timetuple()[:6]
        web = output / f"PassArchive-web-v{version}.zip"
        with zipfile.ZipFile(web, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
            for path in sorted(dist.rglob("*")):
                if not path.is_file():
                    continue
                name = path.relative_to(dist).as_posix()
                validate_public_path(name)
                data = path.read_bytes()
                assert not SECRET.search(data), name
                info = zipfile.ZipInfo(name, stamp)
                info.external_attr = 0o100644 << 16
                info.compress_type = zipfile.ZIP_DEFLATED
                archive.writestr(info, data)
            info = zipfile.ZipInfo("README.md", stamp)
            info.external_attr = 0o100644 << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, (ROOT / "docs/web-release.md").read_bytes())
        with zipfile.ZipFile(web) as archive:
            assert archive.testzip() is None
            assert all(name in archive.namelist() for name in required)
            assert all(archive.read(name) == (dist / name).read_bytes() for name in archive.namelist() if name != "README.md")
        packages.append(web)
    checksums = output / "SHA256SUMS.txt"
    checksums.write_text("".join(f"{digest(path)}  {path.name}\n" for path in packages))
    print(json.dumps({"version": version, "commit": commit, "source_files": len(names),
                      "packages": [{"path": str(path), "bytes": path.stat().st_size, "sha256": digest(path)} for path in packages],
                      "checksums": str(checksums)}, indent=2))


if __name__ == "__main__":
    main()
