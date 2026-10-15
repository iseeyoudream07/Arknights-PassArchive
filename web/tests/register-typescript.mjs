import * as module from 'node:module';
import {load} from './typescript-loader.mjs';
if(typeof module.registerHooks==='function')module.registerHooks({load});
else module.register('./typescript-loader.mjs',import.meta.url);
