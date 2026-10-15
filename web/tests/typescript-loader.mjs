import {readFileSync} from 'node:fs';
import ts from 'typescript';

// Use the project's compiler so tests can import real scene classes with
// parameter properties, even on Node versions that only strip erasable types.
export function load(url,context,nextLoad) {
  if(!url.endsWith('.ts'))return nextLoad(url,context);
  const source=readFileSync(new URL(url),'utf8');
  return {format:'module',shortCircuit:true,source:ts.transpileModule(source,{
    compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext},
  }).outputText};
}
