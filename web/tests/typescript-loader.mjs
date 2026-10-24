/*
 * 测试专用加载器：使用项目 TypeScript 编译器转换真实 .ts 源码。
 * 这样测试可覆盖含构造函数参数属性的三维类，而非另一份简化实现。
 */
import { readFileSync } from 'node:fs';
import ts from 'typescript';
// Use the project's compiler so tests can import real scene classes with
// parameter properties, even on Node versions that only strip erasable types.
/**
 * 对 .ts 文件做内存转译，其余模块交给后续 Node 加载器。
 */
export function load(url, context, nextLoad) {
    if (!url.endsWith('.ts'))
        return nextLoad(url, context);
    const source = readFileSync(new URL(url), 'utf8');
    return { format: 'module', shortCircuit: true, source: ts.transpileModule(source, {
            compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
        }).outputText };
}
