const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const ts = require('typescript');
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
const { Button } = require('../src/ui/Button');
const { Input } = require('../src/ui/Input');
const { Field } = require('../src/ui/Field');
const { Select } = require('../src/ui/Select');
const sourcePrice = 25.5;
const product = {
  id: 'product',
  name: 'Шланг',
  unit: 'm',
  costPrice: sourcePrice,
  sellPrice: 50,
  stock: 10,
  minStock: 0,
  warehouseId: 'main',
};
const requests = [];
let failSave = false;
let existing;
const toastErrors = [];
const api = {
  purchaseOrdersApi: {
    create: async (payload) => {
      requests.push(payload);
      if (failSave) throw new Error('fixture offline');
      return { data: { id: 'saved' } };
    },
    update: async (_id, payload) => {
      requests.push(payload);
      return { data: { id: 'saved' } };
    },
  },
};
const qc = { invalidateQueries() {} };
const can = () => true;
const nav = () => {};
const ui = {
  Button,
  Input,
  Field,
  Select,
  Card: (p) => React.createElement('section', p, p.children),
  CardBody: (p) => React.createElement('div', p, p.children),
  CardHeader: (p) => React.createElement('header', {}, p.title, p.actions),
  PageHeader: (p) => React.createElement('header', {}, p.title, p.actions),
  DataTable: ({ rows, columns }) =>
    React.createElement(
      'div',
      {},
      rows.map((row, index) =>
        React.createElement(
          'section',
          { key: row.productId },
          columns.map((col) => React.createElement('div', { key: col.key }, col.render?.(row, index))),
        ),
      ),
    ),
  IconButton: ({ label, icon, ...p }) => React.createElement('button', { ...p, 'aria-label': label }),
  Modal: () => null,
  EmptyState: () => null,
  QueryState: (p) => p.children,
  SkeletonCard: () => null,
  Textarea: (p) => React.createElement('textarea', p),
  Money: ({ value }) => React.createElement('span', {}, String(value)),
};
const originalLoad = Module._load;
Module._load = function (name, parent, main) {
  if (name === '../ui' || name === '../../ui') return ui;
  if (name === '../../ui/Drawer')
    return { Drawer: (p) => (p.open ? React.createElement('aside', { 'aria-label': p.title }, p.children) : null) };
  if (name === '../api/services' || name === '../../api/services') return api;
  if (name === '../contexts/AuthContext') return { useAuth: () => ({ hasPermission: can }) };
  if (name === 'react-router-dom') return { useNavigate: () => nav, useParams: () => ({ id: existing?.id }) };
  if (name === 'react-hot-toast')
    return { __esModule: true, default: Object.assign(() => {}, { error: (v) => toastErrors.push(v), success() {} }) };
  if (name === '@tanstack/react-query')
    return {
      useQueryClient: () => qc,
      useQuery: ({ queryKey, enabled }) => ({
        data:
          enabled === false
            ? undefined
            : queryKey[0] === 'suppliers'
              ? [{ id: 'supplier', name: 'Поставщик' }]
              : queryKey[0] === 'products-all'
                ? [product]
                : queryKey[0] === 'warehouses'
                  ? [{ id: 'main', name: 'Основной', kind: 'main' }]
                  : queryKey[0] === 'purchase-order'
                    ? existing
                    : [],
      }),
      useMutation: (options) => ({
        isPending: false,
        mutate: async () => {
          try {
            const result = await options.mutationFn();
            options.onSuccess?.(result);
          } catch (error) {
            options.onError?.(error);
          }
        },
      }),
    };
  return originalLoad.call(this, name, parent, main);
};
const Page = require('../src/pages/PurchaseOrderEditPage').default;
const Drawer = require('../src/components/checks/ProductPickerDrawer').default;
const Editor = require('../src/components/purchaseOrders/PurchaseOrderLineEditor').default;
Module._load = originalLoad;
const text = (node) => (node.children ?? []).map((v) => (typeof v === 'string' ? v : text(v))).join('');
const button = (tree, label) => tree.root.findAllByType('button').find((node) => text(node) === label);
const click = async (tree, label) => {
  const found = button(tree, label);
  assert.ok(found, label);
  await Renderer.act(async () => {
    await found.props.onClick();
  });
};
const input = (tree, id) => tree.root.findAllByType('input').find((node) => node.props.id === id);
const setInput = (node, value) => node.props.onChange({ target: { value } });
function createPage(order) {
  existing = order;
  failSave = false;
  requests.length = 0;
  toastErrors.length = 0;
  let tree;
  Renderer.act(() => {
    tree = Renderer.create(React.createElement(Page));
  });
  if (!order)
    Renderer.act(() =>
      tree.root
        .findAllByType('select')
        .find((n) => n.props.id === 'po-supplier')
        .props.onChange({ target: { value: 'supplier' } }),
    );
  return tree;
}
function selectProduct(tree) {
  Renderer.act(() =>
    tree.root
      .findAllByType('button')
      .find((node) => text(node).includes(product.name))
      .props.onClick(),
  );
}

test('supplier picker confirms current keyboard quantity/price, reopens snapshots, supports comma/zero and preserves draft on save error', async () => {
  const tree = createPage();
  try {
    await click(tree, 'Добавить товар');
    const catalogueRow = tree.root.findAllByType('button').find((node) => text(node).includes(product.name));
    assert.match(text(catalogueRow), /25,50/, 'unselected procurement cost keeps cents');
    selectProduct(tree);
    assert.equal(tree.root.findAllByType(Editor).length, 1);
    // Same event batch: confirmation must consume the latest fields, not a blur or stale render.
    const confirm = button(tree, 'Добавить в заказ');
    Renderer.act(() => {
      setInput(input(tree, 'po-picker-quantity'), '125,5');
      setInput(input(tree, 'po-picker-cost'), '12,25');
      confirm.props.onClick();
    });
    assert.equal(tree.root.findByType(Drawer).props.purchaseOrder.lines[0].quantityText, '125.5');
    assert.equal(tree.root.findByType(Drawer).props.purchaseOrder.lines[0].costPriceText, '12.25');
    assert.match(
      text(tree.root.findAllByType('button').find((node) => text(node).includes(product.name))),
      /12,25/,
      'selected procurement snapshot keeps cents',
    );
    selectProduct(tree);
    assert.equal(input(tree, 'po-picker-quantity').props.value, '125.5');
    Renderer.act(() => setInput(input(tree, 'po-picker-cost'), '0'));
    await click(tree, 'Сохранить позицию');
    assert.equal(tree.root.findByType(Drawer).props.purchaseOrder.lines[0].costPriceText, '0');
    await click(tree, 'Сохранить черновик');
    assert.deepEqual(requests[0].items, [{ productId: 'product', quantity: 125.5, costPrice: 0 }]);
    assert.equal(product.costPrice, sourcePrice);
    assert.equal(product.stock, 10);
    failSave = true;
    await click(tree, 'Сохранить черновик');
    assert.equal(tree.root.findByType(Drawer).props.purchaseOrder.lines[0].quantityText, '125.5');
  } finally {
    Renderer.act(() => tree.unmount());
  }
});
test('cancel and invalid price/quantity do not mutate an order; validation keeps the entered draft', async () => {
  const tree = createPage();
  try {
    await click(tree, 'Добавить товар');
    selectProduct(tree);
    Renderer.act(() => {
      setInput(input(tree, 'po-picker-quantity'), '2,5');
      setInput(input(tree, 'po-picker-cost'), '10');
    });
    await click(tree, 'Отмена');
    assert.equal(tree.root.findByType(Drawer).props.purchaseOrder.lines.length, 0);
    selectProduct(tree);
    for (const [qty, cost] of [
      ['12abc', '10'],
      ['1,2,3', '10'],
      ['0', '0'],
      ['1.0001', '1'],
      ['1', ''],
      ['1', '-2'],
      ['1', '1.234'],
    ]) {
      Renderer.act(() => {
        setInput(input(tree, 'po-picker-quantity'), qty);
        setInput(input(tree, 'po-picker-cost'), cost);
      });
      await click(tree, 'Добавить в заказ');
      assert.equal(tree.root.findByType(Drawer).props.purchaseOrder.lines.length, 0);
      assert.equal(input(tree, 'po-picker-cost').props.value, cost);
      assert.ok(tree.root.findAllByProps({ role: 'alert' }).length);
    }
    Renderer.act(() => {
      setInput(input(tree, 'po-picker-quantity'), '0,001');
      setInput(input(tree, 'po-picker-cost'), '0');
    });
    await click(tree, 'Добавить в заказ');
    // Main form price validation also rejects garbage instead of converting it to zero.
    Renderer.act(() =>
      tree.root
        .findAllByType('input')
        .find((n) => n.props['aria-label'] === `Цена закупки — ${product.name}`)
        .props.onChange({ target: { value: '12abc' } }),
    );
    await click(tree, 'Сохранить черновик');
    assert.equal(requests.length, 0);
  } finally {
    Renderer.act(() => tree.unmount());
  }
});
test('received quantity minimum and deletion guard remain in force', async () => {
  const tree = createPage({
    id: 'order',
    status: 'draft',
    supplierId: 'supplier',
    items: [{ productId: 'product', name: product.name, quantity: 4, costPrice: 2, receivedQuantity: 3 }],
  });
  try {
    assert.equal(
      tree.root.findAllByType('button').find((b) => b.props['aria-label'] === `Убрать ${product.name}`).props.disabled,
      true,
    );
    await click(tree, 'Добавить товар');
    selectProduct(tree);
    Renderer.act(() => setInput(input(tree, 'po-picker-quantity'), '2'));
    await click(tree, 'Сохранить позицию');
    assert.equal(input(tree, 'po-picker-quantity').props.value, '2');
    assert.equal(tree.root.findByType(Drawer).props.purchaseOrder.lines[0].quantityText, '4');
  } finally {
    Renderer.act(() => tree.unmount());
  }
});
test('cash/default drawer retains immediate add+close and selected-item disabling without procurement opt-in', () => {
  let picked = 0;
  let closed = 0;
  let tree;
  Renderer.act(() => {
    tree = Renderer.create(
      React.createElement(Drawer, {
        open: true,
        products: [product],
        onClose: () => closed++,
        onSelectProduct: () => picked++,
      }),
    );
  });
  Renderer.act(() =>
    tree.root
      .findAllByType('button')
      .find((b) => text(b).includes(product.name))
      .props.onClick(),
  );
  assert.equal(picked, 1);
  assert.equal(closed, 1);
  assert.equal(tree.root.findAllByType(Editor).length, 0);
  Renderer.act(() =>
    tree.update(
      React.createElement(Drawer, {
        open: true,
        products: [product],
        selectedIds: ['product'],
        onClose: () => {},
        onSelectProduct: () => {},
      }),
    ),
  );
  assert.equal(tree.root.findAllByType('button').find((b) => text(b).includes(product.name)).props.disabled, true);
  Renderer.act(() => tree.unmount());
});
