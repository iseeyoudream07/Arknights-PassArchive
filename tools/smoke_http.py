"""Read-only public acceptance plus synthetic stateless API requests."""
import argparse
import json
import urllib.request
import urllib.error
import ssl
from pathlib import Path
from datetime import datetime, timezone

p = argparse.ArgumentParser()
p.add_argument('--base', default='https://arknights.yukkuri.win')
p.add_argument('--output', default='docs/http-verification.json')
p.add_argument('--cafile', default=None)
args = p.parse_args()
tls_context = ssl.create_default_context(cafile=args.cafile)
root = Path(__file__).resolve().parent.parent
results = []
def request(path, payload=None, expected=200):
    data = json.dumps(payload).encode() if payload is not None else None
    headers = {'Content-Type': 'application/json'} if data is not None else {}
    req = urllib.request.Request(args.base+path, data=data, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=15, context=tls_context) as response:
            status, body, response_headers = response.status, response.read(), dict(response.headers)
    except urllib.error.HTTPError as e:
        status, body, response_headers = e.code, e.read(), dict(e.headers)
    assert status == expected, (path, status, expected)
    results.append({'path': path, 'method': 'POST' if payload is not None else 'GET', 'status': status})
    return body, response_headers

index, headers = request('/')
assert b'PASS ARCHIVE' in index
assert 'Content-Security-Policy' in headers
health, _ = request('/api/v1/health/')
health = json.loads(health)
body, _ = request('/api/v1/catalog/')
catalog = json.loads(body)
local = json.loads((root/'data/catalog.json').read_text())
assert catalog == local
assert health['catalog_version'] == catalog['version']
body, _ = request('/api/v1/passes/?q=6978899534309')
found = json.loads(body)
assert found['count'] == 14
assert all(p['series_name'].endswith('52.0') for p in found['results'])
first = catalog['series'][0]['passes'][0]
request(first['avatar'])
request(catalog['series'][0]['image'])
collection = {first['id']: {'owned': True, 'market': '30.10', 'lots': [{'cost': '20.05', 'qty': 3}]}}
body, response_headers = request('/api/v1/stats/', {'collection': collection})
stats = json.loads(body)
assert (stats['owned'],stats['cost'],stats['market'],stats['profit']) == (1,'60.15','90.30','30.15')
assert response_headers['Cache-Control'] == 'no-store'
legacy = {'collection': {catalog['series'][0]['name']: {'ownedChars': {first['label']: True}, 'prices': {first['label']: {'cost': '12.50','market': '31'}}}}}
body, _ = request('/api/v1/backups/validate/', legacy)
backup = json.loads(body)['backup']
assert backup['collection'][first['id']]['lots'] == [{'cost': '12.50', 'qty': 1}]
request('/api/v1/stats/', {'collection': {'invalid-pass': {'owned': True}}}, 400)
request('/api/v1/stats/', [], 400)
request('/.env', expected=403)
request('/credits.html')
request('/sw.js')
out = {'checked_at': datetime.now(timezone.utc).isoformat(), 'base_url': args.base,
       'strict_tls_validation': True, 'catalog_version': catalog['version'],
       'counts': catalog['counts'], 'checks': results, 'result': 'passed'}
(root/args.output).write_text(json.dumps(out, ensure_ascii=False, indent=2)+'\n')
print(json.dumps({'result':'passed','checks':len(results),'counts':catalog['counts']},ensure_ascii=False))
