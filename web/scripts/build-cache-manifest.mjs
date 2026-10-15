import fs from 'node:fs';
const {version}=JSON.parse(fs.readFileSync('package.json','utf8'));
const assets=fs.readdirSync('dist/assets').filter(name=>/\.(js|css)$/.test(name)).map(name=>`/assets/${name}`);
const models=['/rhine/assets/archive-cassette.glb','/rhine/assets/archive-assembly.glb'];
const fonts=['light','regular','demibold','bold'].map(weight=>`/rhine/fonts/misans-webfont-4.3.1/${weight}/0.woff2`);
fs.writeFileSync('dist/app-cache.json',JSON.stringify({version,resources:['/catalog.json','/icon.svg','/manifest.webmanifest',...assets,...models,...fonts]})+'\n');
console.log(`Offline manifest: ${assets.length} script/style bundles, 2 models, 4 opening font shards.`);
