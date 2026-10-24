/*
 * 构建后生成离线资源清单：脚本、样式、目录、模型及开屏必要字体。
 * 资源路径需要与 public/ 和 sw.js 的缓存策略保持一致。
 */
import fs from 'node:fs';
const { version } = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const assets = fs.readdirSync('dist/assets').filter(name => /\.(js|css)$/.test(name)).map(name => `/assets/${name}`);
const models = ['/rhine/assets/archive-cassette.glb', '/rhine/assets/archive-assembly.glb'];
const fonts = ['light', 'regular', 'demibold', 'bold'].map(weight => `/rhine/fonts/misans-webfont-4.3.1/${weight}/0.woff2`);
fs.writeFileSync('dist/app-cache.json', JSON.stringify({ version, resources: ['/catalog.json', '/icon.svg', '/manifest.webmanifest', ...assets, ...models, ...fonts] }) + '\n');
console.log(`Offline manifest: ${assets.length} script/style bundles, 2 models, 4 opening font shards.`);
