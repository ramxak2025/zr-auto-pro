const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const React = require('react');
const Renderer = require('react-test-renderer');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let response, failInstall, requests;
const wrapper =
  (type) =>
  ({ children, ...props }) =>
    React.createElement(type, props, children);
const filename = path.resolve(__dirname, '../src/components/company/StarterCatalogsCard.tsx');
const componentModule = new Module(filename, module);
componentModule.filename = filename;
componentModule.paths = Module._nodeModulePaths(path.dirname(filename));
const baseRequire = componentModule.require.bind(componentModule);
componentModule.require = (name) => {
  if (name === '@tanstack/react-query')
    return {
      useQuery: () => ({ data: [{ id: 'main', kind: 'main', name: 'Main' }] }),
      useQueryClient: () => ({ invalidateQueries: async () => {} }),
    };
  if (name === '../../contexts/AuthContext') return { useAuth: () => ({ user: { role: 'director' } }) };
  if (name === '../../api/services')
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
  if (name === '../../../../shared/utils/apiError') return { apiErrorMessage: (error) => error.message };
  if (name === './StarterDirectionsPicker')
    return { __esModule: true, default: (props) => React.createElement('direction-picker', props) };
  if (name === '../../ui')
    return {
      Card: wrapper('section'),
      CardBody: wrapper('div'),
      CardHeader: () => null,
      Button: wrapper('button'),
      Field: wrapper('label'),
      Select: wrapper('select'),
      Checkbox: ({ label, ...props }) =>
        React.createElement('input', { ...props, type: 'checkbox', 'aria-label': label }),
    };
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
const Card = componentModule.exports.default;
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
const button = (tree, label) => tree.root.findAllByType('button').find((node) => node.props.children === label);
const inlineText = (value) =>
  Array.isArray(value)
    ? value.map(inlineText).join('')
    : typeof value === 'string' || typeof value === 'number'
      ? String(value)
      : value?.props
        ? inlineText(value.props.children)
        : '';
const group = (tree, label) =>
  tree.root.findAllByType('details').find((node) =>
    node
      .findByType('summary')
      .findAllByType('span')
      .some((span) => inlineText(span.props.children) === label),
  );
const rendered = (tree) => JSON.stringify(tree.toJSON());
async function openPreview(data) {
  response = data;
  requests = [];
  failInstall = false;
  let tree;
  await Renderer.act(async () => {
    tree = Renderer.create(React.createElement(Card));
  });
  await Renderer.act(async () => button(tree, 'Выбрать направления').props.onClick());
  await Renderer.act(async () => tree.root.findByType('direction-picker').props.onChange(['lpg']));
  await Renderer.act(async () => button(tree, 'Посмотреть состав').props.onClick());
  return tree;
}
test('web preview stays compact, expands full details, retains restore choices and retries the same request', async () => {
  const tree = await openPreview(fixture());
  assert.equal(tree.root.findAllByType('details').length, 6);
  assert.ok(tree.root.findAllByType('details').every((node) => !node.props.open));
  assert.ok(!rendered(tree).includes('Entry service63'));
  assert.equal(button(tree, 'Установить выбранное').props.disabled, false);
  let products = group(tree, 'Товары · 1');
  await Renderer.act(async () => products.props.onToggle({ currentTarget: { open: true } }));
  assert.ok(rendered(tree).includes('Note product'));
  assert.equal(tree.root.findByType('a').props.href, 'https://manufacturer.example/product');
  await Renderer.act(async () => tree.root.findByType('input').props.onChange({ target: { checked: true } }));
  await Renderer.act(async () => group(tree, 'Товары · 1').props.onToggle({ currentTarget: { open: false } }));
  assert.ok(!rendered(tree).includes('Note product'));
  await Renderer.act(async () => group(tree, 'Товары · 1').props.onToggle({ currentTarget: { open: true } }));
  assert.equal(tree.root.findByType('input').props.checked, true);
  failInstall = true;
  await Renderer.act(async () => button(tree, 'Установить выбранное').props.onClick());
  assert.ok(rendered(tree).includes('Retry this installation'));
  assert.equal(tree.root.findByType('input').props.checked, true);
  await Renderer.act(async () => button(tree, 'Установить выбранное').props.onClick());
  assert.deepEqual(requests, [
    { previewId: 'preview-1', resolutions: { product: { action: 'restore' } } },
    { previewId: 'preview-1', resolutions: { product: { action: 'restore' } } },
  ]);
  assert.ok(rendered(tree).includes('Каталоги установлены'));
  Renderer.act(() => tree.unmount());
});
test('web preview exposes unresolved choices automatically and keeps installation disabled until resolved', async () => {
  const data = fixture();
  data.items = data.items.filter((i) => i.kind !== 'services');
  data.items.push({
    ...item('services', 'collision', 'ambiguous'),
    candidates: [{ id: 'existing', name: 'Owner service' }],
  });
  const tree = await openPreview(data);
  assert.equal(group(tree, 'Услуги · 1').props.open, true);
  assert.equal(group(tree, 'Товары · 1').props.open, false);
  assert.equal(button(tree, 'Установить выбранное').props.disabled, true);
  assert.ok(rendered(tree).includes('Требуют выбора: 1'));
  let prevented = false;
  Renderer.act(() =>
    group(tree, 'Услуги · 1')
      .findByType('summary')
      .props.onClick({
        preventDefault: () => {
          prevented = true;
        },
      }),
  );
  assert.equal(prevented, true);
  await Renderer.act(async () => tree.root.findByType('select').props.onChange({ target: { value: 'existing' } }));
  assert.equal(button(tree, 'Установить выбранное').props.disabled, false);
  assert.equal(group(tree, 'Услуги · 1').props.open, true);
  await Renderer.act(async () => group(tree, 'Услуги · 1').props.onToggle({ currentTarget: { open: false } }));
  await Renderer.act(async () => button(tree, 'Установить выбранное').props.onClick());
  assert.deepEqual(requests[0].resolutions, { collision: { action: 'reuse', resourceId: 'existing' } });
  Renderer.act(() => tree.unmount());
});
