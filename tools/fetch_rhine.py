# 下载固定提交的 RhineLabUI 参考文件，并逐一核对 Git blob SHA-1。
# 下载目标是 references/rhine-full，不是运行时业务目录；已有且校验正确的文件直接复用。

"""Fetch pinned public assets, verify Git blob identities, retain source provenance."""
from pathlib import Path
import concurrent.futures, hashlib, json, ssl, urllib.request

ROOT = Path(__file__).resolve().parents[1]
COMMIT = "12cc5e4013acb9408f753ff71de6b8492299b7c8"
DEST = ROOT / "references/rhine-full"
CONTEXT = ssl.create_default_context(cafile="/etc/ssl/cert.pem")

# 按清单下载单个固定版本文件；无论复用还是新下载，都校验 Git blob 身份。
def fetch(entry):
    relative = entry["path"]
    destination = DEST / relative
    # 按 Git 对象格式计算 SHA-1，而非直接对文件内容做普通 SHA-1。
    def valid(data):
        return hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest() == entry["sha"]
    if destination.exists() and valid(destination.read_bytes()):
        return len(destination.read_bytes())
    url = f"https://raw.githubusercontent.com/LBEILC/RhineLabUI/{COMMIT}/{relative}"
    with urllib.request.urlopen(url, context=CONTEXT, timeout=45) as response:
        data = response.read()
    if not valid(data):
        raise ValueError(f"Git blob verification failed: {relative}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(data)
    return len(data)

if __name__ == "__main__":
    entries = json.loads((ROOT / "references/rhine-files.json").read_text())
    with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
        sizes = list(pool.map(fetch, entries))
    print(json.dumps({"commit": COMMIT, "files": len(sizes), "bytes": sum(sizes), "verification": "all Git blob SHA1 values matched"}))
