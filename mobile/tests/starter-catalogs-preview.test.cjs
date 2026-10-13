const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const React = require('react');
let states, hookIndex, response, requests, failInstall;
const filename = path.resolve(__dirname, '../src/components/StarterCatalogsSection.tsx');
const componentModule = new Module(filename, module);
componentModule.filename = filename;
componentModule.paths = Module._nodeModulePaths(path.dirname(filename));
const baseRequire = componentModule.require.bind(componentModule);
componentModule.require = (name) => {
  if (name === 'react')
    return {
      ...React,
      useState: (initial) => {
        const index = hookIndex++;
        if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial;
        return [
          states[index],
          (value) => {
            states[index] = typeof value === 'function' ? value(states[index]) : value;
          },
        ];
      },
    };
  if (name === 'react-native')
    return { View: 'View', Text: 'Text', TouchableOpacity: 'TouchableOpacity', Linking: { openURL: async () => {} } };
  if (name === '@expo/vector-icons') return { Ionicons: 'Icon' };
  if (name === '@tanstack/react-query')
    return {
      useQuery: () => ({ data: [{ id: 'main', kind: 'main', name: 'Main' }] }),
      useQueryClient: () => ({ invalidateQueries: async () => {} }),
    };
  if (name === '../contexts/AuthContext') return { useAuth: () => ({ user: { role: 'director' } }) };
  if (name === '../contexts/ThemeContext')
    return {
      useColors: () => ({
        bg: { card: '#fff' },
        text: { primary: '#111', secondary: '#444' },
        accent: { primary: '#2563eb' },
        border: { subtle: '#ddd' },
      }),
    };
  if (name === '../api/services')
    return {
      warehousesApi: {},
      starterCatalogsApi: {
        preview: async () => ({ data: response }),
        install: async (request) => {
          requests.push(request);
          if (failInstall) {
            failInstall = false;
            throw Error('Retry this installation');
          }
          return { data: { added: 1, reused: 0, skipped: 0, restored: 1 } };
        },
      },
    };
  if (name === '../../../shared/utils/apiError') return { apiErrorMessage: (error) => error.message };
  if (name === './Button') return { Button: 'Button' };
  if (name === './StarterDirectionsPicker') return { __esModule: true, default: 'DirectionPicker' };
  return baseRequire(name);
};
componentModule._compile(
  ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText,
  filename,
);
const Section = componentModule.exports.default;
const item = (kind, key, status = 'add') => ({
  kind,
  key,
  status,
  name: 'Entry ' + key,
  category: 'Folder',
  candidates: [],
  note: 'Note ' + key,
});
const fixture = () => ({
  id: 'preview-1',
  version: 'v1',
  warehouseId: 'main',
  items: [
    ...Array.from({ length: 64 }, (_, i) => item('services', 'service' + i)),
    { ...item('products', 'product', 'deleted'), sourceUrl: 'https://manufacturer.example/product' },
    item('templates', 'template', 'blocked'),
    item('productFolders', 'goods-folder'),
    item('serviceFolders', 'service-folder'),
    item('templateFolders', 'template-folder'),
  ],
});
const render = () => {
  hookIndex = 0;
  return Section();
};
function nodes(tree, type) {
  const found = [];
  const visit = (value) => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== 'object') return;
    if (value.type === type) found.push(value);
    visit(value.props?.children);
  };
  visit(tree);
  return found;
}
const button = (tree, label) => nodes(tree, 'Button').find((node) => node.props.title === label);
const group = (tree, label) =>
  nodes(tree, 'TouchableOpacity').find(
    (node) => node.props.accessibilityRole === 'button' && node.props.accessibilityLabel === label,
  );
const text = (tree) => {
  const found = [];
  const visit = (value) => {
    if (typeof value === 'string' || typeof value === 'number') {
      found.push(String(value));
      return;
    }
    if (Array.isArray(value)) return value.forEach(visit);
    if (value?.props) visit(value.props.children);
  };
  visit(tree);
  return found.join(' ');
};
async function openPreview(data) {
  states = [];
  requests = [];
  failInstall = false;
  response = data;
  let tree = render();
  button(tree, 'Выбрать направления').props.onPress();
  tree = render();
  nodes(tree, 'DirectionPicker')[0].props.onChange(['lpg']);
  tree = render();
  await button(tree, 'Посмотреть состав').props.onPress();
  return render();
}
test('native compact preview exposes full details on demand and retains restored choices across collapse/retry', async () => {
  let tree = await openPreview(fixture());
  const headers = nodes(tree, 'TouchableOpacity').filter((node) => node.props.accessibilityRole === 'button');
  assert.equal(headers.length, 6);
  assert.ok(headers.every((node) => !node.props.accessibilityState.expanded && node.props.style.minHeight >= 44));
  assert.ok(!text(tree).includes('Entry service63'));
  assert.equal(button(tree, 'Установить выбранное').props.disabled, false);
  assert.ok(text(tree).includes('Удалено: 1'));
  assert.ok(text(tree).includes('Недоступно: 1'));
  group(tree, 'Товары · 1').props.onPress();
  tree = render();
  assert.ok(text(tree).includes('Note product'));
  assert.ok(nodes(tree, 'TouchableOpacity').some((node) => node.props.accessibilityRole === 'link'));
  nodes(tree, 'TouchableOpacity')
    .find((node) => node.props.accessibilityLabel === 'Восстановить эту позицию')
    .props.onPress();
  tree = render();
  group(tree, 'Товары · 1').props.onPress();
  tree = render();
  assert.ok(!text(tree).includes('Note product'));
  group(tree, 'Товары · 1').props.onPress();
  tree = render();
  assert.equal(
    nodes(tree, 'TouchableOpacity').find((node) => node.props.accessibilityLabel === 'Восстановить эту позицию').props
      .accessibilityState.checked,
    true,
  );
  failInstall = true;
  await button(tree, 'Установить выбранное').props.onPress();
  tree = render();
  assert.ok(text(tree).includes('Retry this installation'));
  await button(tree, 'Установить выбранное').props.onPress();
  tree = render();
  assert.deepEqual(requests, [
    { previewId: 'preview-1', resolutions: { product: { action: 'restore' } } },
    { previewId: 'preview-1', resolutions: { product: { action: 'restore' } } },
  ]);
  assert.ok(text(tree).includes('Каталоги установлены'));
});
test('native automatically opens unresolved collision group and requires its choice before installation', async () => {
  const data = fixture();
  data.items = data.items.filter((i) => i.kind !== 'services');
  data.items.push({
    ...item('services', 'collision', 'ambiguous'),
    candidates: [{ id: 'existing', name: 'Owner service' }],
  });
  let tree = await openPreview(data);
  assert.equal(group(tree, 'Услуги · 1').props.accessibilityState.expanded, true);
  assert.equal(group(tree, 'Услуги · 1').props.disabled, true);
  assert.equal(group(tree, 'Товары · 1').props.accessibilityState.expanded, false);
  assert.equal(button(tree, 'Установить выбранное').props.disabled, true);
  nodes(tree, 'TouchableOpacity')
    .find((node) => node.props.accessibilityLabel === 'Использовать: Owner service · existing')
    .props.onPress();
  tree = render();
  assert.equal(button(tree, 'Установить выбранное').props.disabled, false);
  assert.equal(group(tree, 'Услуги · 1').props.accessibilityState.expanded, true);
  group(tree, 'Услуги · 1').props.onPress();
  tree = render();
  await button(tree, 'Установить выбранное').props.onPress();
  assert.deepEqual(requests[0].resolutions, { collision: { action: 'reuse', resourceId: 'existing' } });
});
