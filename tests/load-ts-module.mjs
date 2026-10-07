import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

/**
 * Loads a small TypeScript module for node:test without a build step. Imports
 * are resolved only through the `modules` map, so tests state every dependency.
 */
export async function loadTsModule(filePath, modules = {}) {
    const source = await fs.readFile(filePath, "utf8");
    const { outputText } = ts.transpileModule(source, {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2020,
            esModuleInterop: true,
            jsx: ts.JsxEmit.React,
        },
        fileName: path.basename(filePath),
    });
    const loaded = { exports: {} };
    const require = (specifier) => {
        if (!(specifier in modules)) {
            throw new Error(
                `${path.basename(filePath)} imports ${specifier}, which the test did not provide.`,
            );
        }
        return modules[specifier];
    };
    // Run in this realm so arrays and objects compare with deepStrictEqual.
    vm.runInThisContext(
        `(function (exports, require, module) {${outputText}\n})`,
        { filename: filePath },
    )(loaded.exports, require, loaded);
    return loaded.exports;
}
