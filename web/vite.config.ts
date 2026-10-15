import { defineConfig } from 'vite';
export default defineConfig({define: {__RHINE_NOVECENTO__: 'false'}, server: {proxy: {'/api': 'http://127.0.0.1:8000'}}, build: {target: 'es2022',rollupOptions:{input:{archive:'index.html',terminal:'terminal.html',credits:'credits.html',login:'login.html'}}}});
