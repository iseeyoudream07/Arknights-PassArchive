# 验收已运行的 Web 容器：静态资源、缓存清单、响应头和路由回退。
# 需要先启动待验收容器；本工具不负责创建或发布容器。

"""Check an isolated frontend container against a verified dist directory."""
import argparse
import hashlib
import json
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import quote, urlparse
from urllib.request import urlopen


# 读取本地构建清单并逐项比对容器响应，核对静态资源与页面回退行为。
def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', default='http://127.0.0.1:18083')
    parser.add_argument('--dist', type=Path, default=Path('web/dist'))
    args = parser.parse_args()
    assert urlparse(args.url).hostname in {'127.0.0.1', 'localhost', '::1'}, 'Use an isolated loopback endpoint.'
    base = args.url.rstrip('/')
    manifest = json.loads((args.dist / 'app-cache.json').read_text())
    paths = {'index.html', 'terminal.html', 'login.html', 'credits.html', 'admin.html', 'sw.js',
             'app-cache.json', 'LICENSE', 'THIRD_PARTY_NOTICES.md',
             'licenses/CC-BY-NC-4.0.txt'}
    paths.update(p.lstrip('/') for p in manifest['resources'])
    paths.add(next(args.dist.glob('assets/images/*')).relative_to(args.dist).as_posix())
    for name in sorted(paths):
        with urlopen(base + '/' + quote(name), timeout=15) as response:
            assert response.status == 200, name
            assert response.headers.get('X-PassArchive-Runtime') == 'docker', name
            content = response.read()
            expected = (args.dist / name).read_bytes()
            assert hashlib.sha256(content).digest() == hashlib.sha256(expected).digest(), name
            mime = response.headers.get_content_type()
            if name.endswith('.html'):
                assert mime == 'text/html', (name, mime)
                assert 'no-cache' in response.headers.get('Cache-Control', ''), name
            elif name.endswith('.css'):
                assert mime == 'text/css', (name, mime)
            elif name.endswith('.js'):
                assert mime in {'application/javascript', 'text/javascript'}, (name, mime)
    with urlopen(base + '/healthz', timeout=5) as response:
        assert response.status == 200 and response.read() == b'ok\n'
    for path, status in [('/assets/not-a-bundle.js', 404), ('/rhine/not-a-model.glb', 404),
                         ('/not-a-page.html', 404), ('/.env', 403), ('/api/v1/health/', 404)]:
        try:
            urlopen(base + path, timeout=5)
        except HTTPError as error:
            assert error.code == status, (path, error.code)
        else:
            raise AssertionError('Unexpected SPA fallback: ' + path)
    with urlopen(base + '/a-client-side-route', timeout=5) as response:
        assert response.read() == (args.dist / 'index.html').read_bytes()
    print(json.dumps({'version': manifest['version'], 'files_verified': len(paths),
                      'health': 'ok', 'routes': 'ok', 'runtime': 'docker'}))


if __name__ == '__main__':
    main()
