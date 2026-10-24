# 旧打包命令的兼容入口，实际转交 build_release.py 生成仅源码发布包。

"""Compatibility entry point for the public, committed source distribution."""
from pathlib import Path
import subprocess
import sys

if __name__ == '__main__':
    subprocess.run([sys.executable, str(Path(__file__).with_name('build_release.py')), '--source-only'], check=True)
