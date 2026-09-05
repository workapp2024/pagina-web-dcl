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
    if (name === 'next/server') return { NextResponse: { json: (body, init) => Response.json(body, init) } };
    if (name.startsWith('@/')) return module.exports(name.slice(2) + '.ts', mocks, globals);
    if (name.startsWith('.')) return module.exports(path.resolve(path.dirname(filename), name) + '.ts', mocks, globals);
    return require(name);
  };
  vm.runInNewContext(code, { exports, require: localRequire, Request, Response, URL, Headers, console,
    process: { env: { NODE_ENV: 'test' } }, fetch: async () => { throw new Error('Network forbidden in tests'); },
    setTimeout, clearTimeout, AbortController, ...globals }, { filename });
  return exports;
};
