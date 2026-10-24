/*
 * 为 Node 测试注册 TypeScript 加载器，兼容不同版本的模块钩子接口。
 */
import * as module from 'node:module';
import { load } from './typescript-loader.mjs';
if (typeof module.registerHooks === 'function')
    module.registerHooks({ load });
else
    module.register('./typescript-loader.mjs', import.meta.url);
