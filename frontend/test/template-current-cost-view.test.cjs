const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const ts = require('typescript');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
for (const extension of ['.ts', '.tsx'])
  require.extensions[extension] = (module, filename) =>
    module._compile(
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
const React = require('react');
const Renderer = require('react-test-renderer');
let templates = [];
let refetches = 0;
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === '@tanstack/react-query')
    return {
      useQuery: ({ queryKey }) => ({
        data: queryKey[0] === 'check-templates' ? templates : [],
        isLoading: false,
        isError: false,
        isFetching: false,
        refetch: () => {
          refetches++;
        },
      }),
      useQueryClient: () => ({ invalidateQueries() {} }),
      useMutation: () => ({ isPending: false, mutate() {} }),
    };
  if (parent?.filename.endsWith('CheckTemplatesModals.tsx')) {
    if (request === '../contexts/AuthContext') return { useAuth: () => ({ hasPermission: () => false }) };
    if (request === '../api/services') return { checkTemplatesApi: {} };
    if (request === './Modal')
      return {
        __esModule: true,
        default: ({ isOpen, title, children }) =>
          isOpen ? React.createElement('section', { 'aria-label': title }, children) : null,
      };
    if (request === './ConfirmDialog') return { __esModule: true, default: () => null };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const { TemplatePickerModal } = require('../src/components/CheckTemplatesModals');
function openTemplate(template) {
  templates = [template];
  let tree;
  Renderer.act(() => {
    tree = Renderer.create(
      React.createElement(TemplatePickerModal, {
        isOpen: true,
        onClose() {},
        onApply() {
          throw Error('Viewing must not apply a check');
        },
      }),
    );
  });
  const view = tree.root
    .findAllByType('button')
    .find((button) => button.props['aria-label'] === 'Посмотреть шаблон: ТО');
  assert.ok(view);
  Renderer.act(() => view.props.onClick());
  return tree;
}
const base = {
  id: 't',
  name: 'ТО',
  isShared: true,
  services: [{ name: 'Работа', price: 700, quantity: 1 }],
  products: [{ name: 'Товар', sellPrice: 250, quantity: 2 }],
};
const texts = (tree) => JSON.stringify(tree.toJSON());
test('existing template opens a real readonly view with current per-product cost and total, without applying a check', () => {
  const tree = openTemplate({
    ...base,
    costStatus: 'known',
    productCostTotal: 120,
    products: [{ ...base.products[0], costStatus: 'known', costPrice: 60 }],
  });
  assert.ok(texts(tree).includes('Себестоимость шаблона'));
  assert.ok(texts(tree).includes('60 ₽ × 2 = 120 ₽'));
  assert.ok(refetches > 0);
  Renderer.act(() => tree.unmount());
});
test('unknown current cost is displayed as missing data rather than zero', () => {
  const tree = openTemplate({
    ...base,
    costStatus: 'unknown',
    products: [{ ...base.products[0], costStatus: 'unknown', catalogStatus: 'unavailable' }],
  });
  assert.ok(texts(tree).includes('Нет данных'));
  assert.ok(texts(tree).includes('цена не подтверждена'));
  assert.equal(texts(tree).includes('undefined ₽'), false);
  Renderer.act(() => tree.unmount());
});
test('staff response contains no cost UI or subtotal', () => {
  const tree = openTemplate(base);
  assert.equal(texts(tree).includes('Себестоимость'), false);
  Renderer.act(() => tree.unmount());
});
