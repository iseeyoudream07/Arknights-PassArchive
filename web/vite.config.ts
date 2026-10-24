/*
 * 前端开发和构建入口：/api 请求代理至本机 Django，五个 HTML 页面分别打包。
 * 后端断点调试时，先启动「03 API 断点调试」，再启动「04 Web 热更新」。
 */
import { defineConfig } from 'vite';
export default defineConfig({ define: { __RHINE_NOVECENTO__: 'false' }, server: { proxy: { '/api': 'http://127.0.0.1:8000' } }, build: { target: 'es2022', rollupOptions: { input: { archive: 'index.html', terminal: 'terminal.html', credits: 'credits.html', login: 'login.html', admin: 'admin.html' } } } });
