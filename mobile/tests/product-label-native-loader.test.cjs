const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

test('native label export loads only Platform, without evaluating deprecated React Native module getters', async () => {
  const runtime = { __DEV__: false, __METRO_GLOBAL_PREFIX__: '' };
  runtime.global = runtime;
  vm.runInNewContext(fs.readFileSync(require.resolve('metro-runtime/src/polyfills/require'), 'utf8'), runtime);
  let forbiddenReads = 0;
  const native = { Platform: { OS: 'ios' } };
  Object.defineProperty(native, 'PushNotificationIOS', {
    enumerable: true,
    get() {
      forbiddenReads++;
      throw new Error('NativeEventEmitter requires a non-null native module');
    },
  });
  const printed = [];
  const modules = {
    'react-native': native,
    'expo-print': {
      printToFileAsync: async (options) => {
        printed.push(options);
        return { uri: 'file:///label.pdf' };
      },
    },
    'expo-sharing': { isAvailableAsync: async () => false },
  };
  const ids = new Map(Object.keys(modules).map((name, index) => [name, index + 1]));
  for (const [name, id] of ids)
    runtime.__d(
      (_global, _require, _default, _all, module) => {
        module.exports = modules[name];
      },
      id,
      [],
    );
  const filename = process.env.NOV02_LABEL_LOADER_SOURCE || path.join(__dirname, '../src/utils/productLabelPrint.ts');
  const source = fs.readFileSync(filename, 'utf8');
  // Preserve Metro's actual importAll behavior rather than Node/Jest interop,
  // which can retain lazy getters and hide this native-only crash.
  const dynamicImports = (context) => {
    const visit = (node) =>
      ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword
        ? ts.factory.createCallExpression(ts.factory.createIdentifier('__metroImport'), undefined, node.arguments)
        : ts.visitEachChild(node, visit, context);
    return (node) => ts.visitNode(node, visit);
  };
  const code = ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    transformers: { before: [dynamicImports] },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(
    code,
    {
      module,
      exports: module.exports,
      require(name) {
        if (name === 'jsbarcode') return { default() {} };
        if (name.endsWith('/productLabels')) return { labelPagePoints: () => ({ width: 113.3858, height: 85.0394 }) };
        if (ids.has(name)) return runtime.__r(ids.get(name));
        throw new Error('Unexpected dependency: ' + name);
      },
      __metroImport: async (name) => runtime.__r.importAll(ids.get(name)),
    },
    { filename },
  );
  const result = await module.exports.exportProductLabelsPdf({
    html: '<html>label</html>',
    paper: { widthMm: 40, heightMm: 30 },
  });
  assert.equal(result.uri, 'file:///label.pdf');
  assert.equal(result.shared, false);
  assert.equal(printed.length, 1);
  assert.equal(printed[0].width, 113.3858);
  assert.equal(forbiddenReads, 0);
});
