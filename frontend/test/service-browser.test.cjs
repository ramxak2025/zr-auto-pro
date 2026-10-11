const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) =>
  module._compile(
    ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText,
    filename,
  );
const { serviceBrowserLevel } = require('../../shared/utils/serviceBrowser');
const services = [
  { id: '1', name: 'Замена масла', category: 'ТО / Масло' },
  { id: '2', name: 'Диагностика двигателя', category: 'Диагностика/Двигатель' },
  { id: '3', name: 'Ручная', category: undefined },
];
test('global search escapes current folder and finds matching full path, including returning from search', () => {
  assert.deepEqual(
    serviceBrowserLevel(services, [], ['ТО'], 'диагностика').currentServices.map((s) => s.id),
    ['2'],
  );
  assert.deepEqual(serviceBrowserLevel(services, [], ['ТО'], '').folders, [['Масло', 1]]);
  assert.deepEqual(
    serviceBrowserLevel(services, [], [], 'двигатель').currentServices.map((s) => s.id),
    ['2'],
  );
});
test('empty folders, normalized legacy categories and uncategorized services retain their hierarchy', () => {
  const level = serviceBrowserLevel(services, [{ path: 'Пустая', name: 'Пустая', parentPath: null }], [], '');
  assert.deepEqual(level.folders, [
    ['Диагностика', 1],
    ['Пустая', 0],
    ['ТО', 1],
  ]);
  assert.equal(level.currentServices[0].id, '3');
  assert.deepEqual(
    serviceBrowserLevel(services, [{ path: 'ТО/Новая', name: 'Новая', parentPath: 'ТО' }], ['ТО'], '').folders,
    [
      ['Масло', 1],
      ['Новая', 0],
    ],
  );
});
