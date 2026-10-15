"""Fetch pinned public assets, verify Git blob identities, retain source provenance."""
from pathlib import Path
import concurrent.futures, hashlib, json, ssl, urllib.request

ROOT = Path(__file__).resolve().parents[1]
COMMIT = "12cc5e4013acb9408f753ff71de6b8492299b7c8"
DEST = ROOT / "references/rhine-full"
CONTEXT = ssl.create_default_context(cafile="/etc/ssl/cert.pem")

def fetch(entry):
    relative = entry["path"]
    destination = DEST / relative
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
