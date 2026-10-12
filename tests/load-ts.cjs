/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Explicit import mocks and a forbidden network by default. Never loads .env.
module.exports = function loadTs(file, mocks = {}, globals = {}) {
  const filename = path.resolve(file);
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const localRequire = name => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    if (name === 'server-only') return {}; // Build-time boundary marker, not executable in this VM.
    if (name === 'next/server') return { NextResponse: { json: (body, init) => Response.json(body, init) } };
    if (name.startsWith('@/') || name.startsWith('.')) {
      const base = path.resolve(name.startsWith('@/') ? process.cwd() : path.dirname(filename), name.startsWith('@/') ? name.slice(2) : name);
      const candidates = path.extname(base)
        ? [base]
        : ['.ts', '.tsx', '.js', '.jsx', '.cjs', '.json'].map(extension => base + extension).concat(['index.ts', 'index.tsx', 'index.js', 'index.cjs'].map(index => path.join(base, index)));
      const resolved = candidates.find(candidate => fs.existsSync(candidate));
      if (!resolved) throw new Error(`Cannot resolve test module ${name} imported by ${filename}`);
      if (/\.(?:cjs|js|json)$/.test(resolved)) return require(resolved);
      return module.exports(resolved, mocks, globals);
    }
    return require(name);
  };
  vm.runInNewContext(code, { exports, require: localRequire, Request, Response, URL, Headers, console,
    process: { env: { NODE_ENV: 'test' } }, fetch: async () => { throw new Error('Network forbidden in tests'); },
    setTimeout, clearTimeout, AbortController, AbortSignal, ...globals }, { filename });
  return exports;
};
