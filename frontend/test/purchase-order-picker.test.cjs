const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const ts = require('typescript');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const baselineFiles = new Set([
  'frontend/src/components/checks/ProductPickerDrawer.tsx',
  'frontend/src/components/warehouse/ProductPickerDrawer.tsx',
  'frontend/src/components/purchaseOrders/PurchaseOrderLineEditor.tsx',
  'frontend/src/pages/SupplierDetailPage.tsx',
]);
function sourceFor(filename) {
  const relative = path.relative(path.resolve(__dirname, '../..'), filename);
  const baseline =
    process.env.PROCUREMENT_REPAIR_BASELINE === '1'
      ? 'ffb7f46394a993b71ad6334e4e1a452e5d989f86'
      : process.env.PROCUREMENT_BASELINE === '1'
        ? '6666a11db7084ca460fc4111a9c318fed31ffd16'
        : null;
  return baseline && baselineFiles.has(relative)
    ? execFileSync('git', ['show', `${baseline}:${relative}`], { encoding: 'utf8' })
    : fs.readFileSync(filename, 'utf8');
}
for (const extension of ['.ts', '.tsx'])
  require.extensions[extension] = (module, filename) =>
    module._compile(
      ts.transpileModule(sourceFor(filename), {
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
let directMode = false;
const recoveryCalls = [];
let recoveryPending = [];
let recoveryOwned = true;
const directRecovery = {
  get pending() {
    return recoveryPending;
  },
  loading: false,
  error: null,
  busy: false,
  isCurrent: () => recoveryOwned,
  owns: () => recoveryOwned,
  execute: async (target, payload) => {
    recoveryCalls.push({ target, payload });
    if (failSave) throw new Error('fixture offline');
    return { data: { id: 'delivery' } };
  },
};
const secondProduct = { ...product, id: 'product2', name: 'Масло' };

let existing;
const toastErrors = [];
const api = {
  purchaseOrdersApi: {
    create: async (payload) => {
      requests.push(payload);
      if (failSave) throw new Error('fixture offline');
      return { data: { id: 'b47fa84f-9795-4a1b-8068-b807c44e4c7e' } };
    },
    update: async (_id, payload) => {
      requests.push(payload);
      return { data: { id: 'b47fa84f-9795-4a1b-8068-b807c44e4c7e' } };
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
  Badge: (p) => React.createElement('span', {}, p.children),
  TabPanel: (p) => React.createElement('div', {}, p.children),
  Tabs: () => null,
  Toolbar: (p) => React.createElement('div', {}, p.children, p.end),
  StatCard: () => null,
  cn: (...classes) => classes.filter(Boolean).join(' '),
  focusRing: '',
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
  Modal: (p) => (p.isOpen ? React.createElement('section', {}, p.children, p.footer) : null),
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
    return {
      Drawer: (p) =>
        p.open ? React.createElement('aside', { 'aria-label': p.title, onClose: p.onClose }, p.children) : null,
    };
  if (name === '../api/services' || name === '../../api/services') return api;
  if (name === '../hooks/useProcurementRecovery') return { useProcurementRecovery: () => directRecovery };
  if (name === '../hooks/useTenantTimezone')
    return { useTenantCalendar: () => ({ today: '2026-10-22', month: '2026-10' }) };
  if (name === '../components/warehouse/useUrlParams') return { useUrlParams: () => [new URLSearchParams(), () => {}] };
  if (name === '../contexts/AuthContext') return { useAuth: () => ({ hasPermission: can }) };
  if (name === 'react-router-dom')
    return { useNavigate: () => nav, useParams: () => ({ id: directMode ? 'supplier' : existing?.id }) };
  if (name === 'react-hot-toast')
    return { __esModule: true, default: Object.assign(() => {}, { error: (v) => toastErrors.push(v), success() {} }) };
  if (name === '@tanstack/react-query')
    return {
      useQueryClient: () => qc,
      useQuery: ({ queryKey, enabled }) => ({
        data:
          enabled === false
            ? undefined
            : queryKey[0] === 'supplier'
              ? { id: 'supplier', name: 'Поставщик', kind: 'regular', currentDebt: 0, totalPurchases: 0, totalPaid: 0 }
              : queryKey[0] === 'products'
                ? [product, secondProduct]
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
        mutate: async (variables) => {
          try {
            const result = await options.mutationFn(variables);
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
const SupplierPage = require('../src/pages/SupplierDetailPage').default;
const Drawer = require('../src/components/checks/ProductPickerDrawer').default;
const Editor = require('../src/components/purchaseOrders/PurchaseOrderLineEditor').default;
const WarehouseDrawer = require('../src/components/warehouse/ProductPickerDrawer').default;
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
  directMode = false;
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
    assert.ok(
      tree.root.findAllByType('input').some((node) => node.props['aria-label'] === 'Поиск товара'),
      'catalogue search stays visible with inline editor',
    );
    assert.ok(
      tree.root.findAllByType('button').some((node) => text(node).includes(product.name)),
      'catalogue row stays visible',
    );
    // Same event batch: confirmation must consume the latest fields, not a blur or stale render.
    const confirm = button(tree, 'Добавить');
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
    await click(tree, 'Сохранить');
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
      await click(tree, 'Добавить');
      assert.equal(tree.root.findByType(Drawer).props.purchaseOrder.lines.length, 0);
      assert.equal(input(tree, 'po-picker-cost').props.value, cost);
      assert.ok(tree.root.findAllByProps({ role: 'alert' }).length);
    }
    Renderer.act(() => {
      setInput(input(tree, 'po-picker-quantity'), '0,001');
      setInput(input(tree, 'po-picker-cost'), '0');
    });
    await click(tree, 'Добавить');
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
    id: 'b47fa84f-9795-4a1b-8068-b807c44e4c7e',
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
    await click(tree, 'Сохранить');
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

test('procurement totals pre-round backend cents even on an Intl host with bankers rounding', () => {
  const originalFormat = Intl.NumberFormat;
  const received = [];
  Intl.NumberFormat = function () {
    return {
      format(value) {
        received.push(value);
        const scaled = value * 100;
        const floor = Math.floor(scaled);
        const cents = scaled - floor === 0.5 ? floor + (floor % 2) : Math.round(scaled);
        return (cents / 100).toFixed(2);
      },
    };
  };
  try {
    const { formatPurchaseOrderMoney } = require('../../shared/utils/purchaseOrderInput');
    const outputs = [formatPurchaseOrderMoney(2.5 * 650.25), formatPurchaseOrderMoney(2.5 * 123.45)];
    assert.deepEqual(received, [1625.63, 308.63]);
    assert.deepEqual(outputs, ['1625.63', '308.63']);
  } finally {
    Intl.NumberFormat = originalFormat;
  }
});

test('web direct supply inline absolute upsert, zero price, omitted retail, and per-line rounded total', async () => {
  directMode = true;
  failSave = false;
  recoveryOwned = true;
  recoveryPending = [];
  recoveryCalls.length = 0;
  let tree;
  Renderer.act(() => {
    tree = Renderer.create(React.createElement(SupplierPage));
  });
  try {
    await click(tree, 'Новая поставка');
    await click(tree, 'Добавить товар');
    selectProduct(tree);
    assert.ok(tree.root.findAllByType('input').some((node) => node.props['aria-label'] === 'Поиск товара'));
    Renderer.act(() => {
      setInput(input(tree, 'po-picker-quantity'), '2,5');
      setInput(input(tree, 'po-picker-cost'), '123,45');
    });
    await click(tree, 'Добавить');
    Renderer.act(() =>
      tree.root
        .findAllByType('button')
        .find((node) => text(node).includes(secondProduct.name))
        .props.onClick(),
    );
    Renderer.act(() => {
      setInput(input(tree, 'po-picker-quantity'), '2,5');
      setInput(input(tree, 'po-picker-cost'), '123,45');
    });
    await click(tree, 'Добавить');
    assert.ok(text(tree.toJSON()).includes('617,26'), 'receipt sums rounded line cents');
    selectProduct(tree);
    assert.equal(input(tree, 'po-picker-quantity').props.value, '2.5');
    Renderer.act(() => setInput(input(tree, 'po-picker-cost'), '0'));
    await click(tree, 'Сохранить');
    const drawer = tree.root.findByType(Drawer);
    Renderer.act(() => drawer.props.onClose());
    const form = tree.root.findAllByType('form').find((node) => node.props.id === 'delivery-form');
    await Renderer.act(async () => {
      form.props.onSubmit({ preventDefault() {} });
    });
    assert.deepEqual(recoveryCalls[0], {
      target: { operation: 'delivery-create', sourceId: 'supplier', contextId: 'supplier' },
      payload: {
        supplierId: 'supplier',
        date: '2026-10-22',
        comment: '',
        items: [
          { productId: 'product', quantity: 2.5, price: 0 },
          { productId: 'product2', quantity: 2.5, price: 123.45 },
        ],
      },
    });
  } finally {
    Renderer.act(() => tree.unmount());
    directMode = false;
  }
});

test('inline raw drafts survive switching/search; stale toolbar cannot confirm successor and absent-row cancel releases close', async () => {
  let confirmed = [];
  let closed = 0;
  let tree;
  const props = {
    open: true,
    products: [product, secondProduct],
    onClose: () => closed++,
    onSelectProduct: () => {},
    purchaseOrder: { lines: [], onConfirm: (p, value) => confirmed.push({ p, value }) },
  };
  Renderer.act(() => {
    tree = Renderer.create(React.createElement(Drawer, props));
  });
  try {
    selectProduct(tree);
    const oldConfirm = button(tree, 'Добавить').props.onClick;
    Renderer.act(() => setInput(input(tree, 'po-picker-quantity'), '12,5'));
    Renderer.act(() =>
      tree.root
        .findAllByType('button')
        .find((node) => text(node).includes(secondProduct.name))
        .props.onClick(),
    );
    Renderer.act(() => oldConfirm());
    assert.equal(confirmed.length, 0);
    selectProduct(tree);
    assert.equal(input(tree, 'po-picker-quantity').props.value, '12,5');
    Renderer.act(() => tree.update(React.createElement(Drawer, { ...props, products: [], isError: true })));
    // Calling Drawer component props would bypass its guarded native Drawer; invoke actual overlay onClose.
    const aside = tree.root.findAllByType('aside')[0];
    Renderer.act(() => aside.props.onClose());
    assert.equal(closed, 0);
    await click(tree, 'Отменить изменения позиции');
    Renderer.act(() => aside.props.onClose()); // second pending product still must be cancelled explicitly
    await click(tree, 'Отменить изменения позиции');
    Renderer.act(() => aside.props.onClose());
    assert.equal(closed, 1);
    assert.equal(confirmed.length, 0);
  } finally {
    Renderer.act(() => tree.unmount());
  }
});

function createDirectPage() {
  directMode = true;
  failSave = false;
  recoveryOwned = true;
  recoveryPending = [];
  recoveryCalls.length = 0;
  directRecovery.error = null;
  toastErrors.length = 0;
  let tree;
  Renderer.act(() => {
    tree = Renderer.create(React.createElement(SupplierPage));
  });
  return tree;
}
function labelledInput(tree, label) {
  return tree.root.findAllByType('input').find((node) => node.props['aria-label'] === label);
}
async function submitDirect(tree) {
  await Renderer.act(async () => {
    tree.root
      .findAllByType('form')
      .find((node) => node.props.id === 'delivery-form')
      .props.onSubmit({ preventDefault() {} });
  });
}

test('web direct invalid ENTIRE form blocks dispatch; explicit retail zero and failed-save draft remain exact', async () => {
  const tree = createDirectPage();
  try {
    await click(tree, 'Новая поставка');
    await click(tree, 'Добавить товар');
    const config = tree.root.findAllByType(WarehouseDrawer).find((node) => node.props.title === 'Товар в поставку')
      .props.purchaseOrder;
    Renderer.act(() => {
      config.onConfirm(product, { quantity: 2.5, costPrice: 123.45 });
      config.onConfirm(secondProduct, { quantity: 1, costPrice: 0 });
    });
    Renderer.act(() => tree.root.findByType(Drawer).props.onClose());
    Renderer.act(() => setInput(labelledInput(tree, `Цена за единицу — ${product.name}`), '12abc'));
    await submitDirect(tree);
    assert.equal(recoveryCalls.length, 0, 'a valid second row must not be posted while another row is invalid');
    assert.equal(labelledInput(tree, `Цена за единицу — ${product.name}`).props.value, '12abc');
    assert.ok(toastErrors.some((message) => /все позиции/.test(message)));
    Renderer.act(() => {
      setInput(labelledInput(tree, `Цена за единицу — ${product.name}`), '0');
      setInput(labelledInput(tree, `Розничная цена — ${product.name}`), '0');
    });
    failSave = true;
    await submitDirect(tree);
    assert.equal(recoveryCalls.length, 1);
    assert.deepEqual(recoveryCalls[0].payload.items, [
      { productId: 'product', quantity: 2.5, price: 0, sellPrice: 0 },
      { productId: 'product2', quantity: 1, price: 0 },
    ]);
    assert.equal(labelledInput(tree, `Цена за единицу — ${product.name}`).props.value, '0');
    assert.equal(labelledInput(tree, `Розничная цена — ${product.name}`).props.value, '0');
    const failedPayload = recoveryCalls[0].payload;
    for (const gate of ['pending', 'storage', 'owner']) {
      recoveryPending =
        gate === 'pending'
          ? [{ requestId: 'pending', createdAt: '2026-10-22T00:00:00Z', target: { operation: 'delivery-create' } }]
          : [];
      directRecovery.error = gate === 'storage' ? 'fixture storage failure' : null;
      recoveryOwned = gate !== 'owner';
      Renderer.act(() => tree.update(React.createElement(SupplierPage)));
      await submitDirect(tree);
      assert.equal(recoveryCalls.length, 1, `${gate} must prevent a replacement send`);
    }
    assert.deepEqual(recoveryCalls[0].payload, failedPayload);
  } finally {
    Renderer.act(() => tree.unmount());
    directMode = false;
    recoveryPending = [];
    directRecovery.error = null;
    recoveryOwned = true;
    failSave = false;
  }
});

test('baseline proof: inline catalogue remains visible while editing the chosen row', async () => {
  const tree = createPage();
  try {
    await click(tree, 'Добавить товар');
    selectProduct(tree);
    assert.ok(
      tree.root.findAllByType('input').some((node) => node.props['aria-label'] === 'Поиск товара'),
      'catalogue search must remain visible beside inline edit',
    );
  } finally {
    Renderer.act(() => tree.unmount());
  }
});

test('baseline proof: direct selection is absolute and zero-price rows are posted', async () => {
  const tree = createDirectPage();
  try {
    await click(tree, 'Новая поставка');
    await click(tree, 'Добавить товар');
    const picker = tree.root.findAllByType(WarehouseDrawer).find((node) => node.props.title === 'Товар в поставку');
    // The immutable baseline exposes only onSelect; exercise its public selection contract as well.
    Renderer.act(() => {
      for (let i = 0; i < 2; i++) {
        if (picker.props.purchaseOrder) picker.props.purchaseOrder.onConfirm(product, { quantity: 2.5, costPrice: 0 });
        else picker.props.onSelect(product);
      }
    });
    const group = tree.root.findAll(
      (node) => node.props['aria-label'] === `Количество — ${product.name}` && node.props.role === 'group',
    )[0];
    const quantity = text(group);
    Renderer.act(() => setInput(labelledInput(tree, `Цена за единицу — ${product.name}`), '0'));
    await submitDirect(tree);
    assert.deepEqual(
      { quantity, sent: recoveryCalls.length, items: recoveryCalls[0]?.payload.items },
      { quantity: '2.5', sent: 1, items: [{ productId: 'product', quantity: 2.5, price: 0 }] },
    );
  } finally {
    Renderer.act(() => tree.unmount());
    directMode = false;
  }
});

test('repair proof: close restores exact cached SKU beyond duplicate-name cap after warehouse filter reset', () => {
  const duplicates = Array.from({ length: 240 }, (_, index) => ({
    ...product,
    id: `duplicate-${index}`,
    barcode: `sku-${index}`,
    name: 'Одинаковый товар',
    category: 'Каталог / Масло',
    warehouseId: 'warehouse-a',
  }));
  const target = duplicates[239];
  let tree;
  let selectedWarehouse = 'warehouse-a';
  let closed = 0;
  const context = { lines: [], onConfirm: () => assert.fail('closing must not confirm a draft') };
  const make = () =>
    React.createElement(Drawer, {
      open: true,
      products: selectedWarehouse === 'warehouse-a' ? duplicates : [],
      purchaseOrder: context,
      onSelectProduct: () => {},
      onClose: () => closed++,
      selectedWarehouseId: selectedWarehouse,
      onSelectWarehouse: (id) => {
        selectedWarehouse = id;
        tree.update(make());
      },
    });
  Renderer.act(() => {
    tree = Renderer.create(make());
  });
  try {
    const search = () => tree.root.findAllByType('input').find((node) => node.props['aria-label'] === 'Поиск товара');
    Renderer.act(() => setInput(search(), target.barcode));
    Renderer.act(() =>
      tree.root
        .findAllByType('button')
        .find((node) => text(node).includes(target.name))
        .props.onClick(),
    );
    Renderer.act(() => {
      setInput(input(tree, 'po-picker-quantity'), '12,5');
      setInput(input(tree, 'po-picker-cost'), '0');
    });
    Renderer.act(() => {
      selectedWarehouse = 'warehouse-b';
      tree.update(make());
    });
    assert.equal(tree.root.findAllByType(Editor).length, 0, 'warehouse B hides A pending SKU');
    Renderer.act(() => tree.root.findAllByType('aside')[0].props.onClose());
    assert.equal(selectedWarehouse, 'warehouse-a');
    assert.equal(closed, 0);
    const restored = tree.root.findAllByType(Editor);
    assert.equal(restored.length, 1, 'exact SKU must restore even beyond first200 duplicates');
    assert.equal(restored[0].props.product.id, target.id);
    assert.equal(input(tree, 'po-picker-quantity').props.value, '12,5');
    assert.equal(input(tree, 'po-picker-cost').props.value, '0');
    assert.ok(tree.root.findAllByType('input').some((node) => node.props['aria-label'] === 'Поиск товара'));
  } finally {
    Renderer.act(() => tree.unmount());
  }
});

test('repair proof: same-name restore prioritizes exact cached SKU while query is missing and cancel stays available', async () => {
  const duplicates = Array.from({ length: 240 }, (_, index) => ({
    ...product,
    id: `item-${index}`,
    barcode: `barcode-${index}`,
    name: 'Дубликат',
    warehouseId: 'main',
  }));
  const target = duplicates[239];
  let closed = 0;
  let tree;
  const make = (products, isError = false) =>
    React.createElement(Drawer, {
      open: true,
      products,
      isError,
      onSelectProduct: () => {},
      onClose: () => closed++,
      purchaseOrder: { lines: [], onConfirm: () => assert.fail('no implicit commit') },
    });
  Renderer.act(() => {
    tree = Renderer.create(make(duplicates));
  });
  try {
    const search = tree.root.findAllByType('input').find((node) => node.props['aria-label'] === 'Поиск товара');
    Renderer.act(() => setInput(search, target.barcode));
    Renderer.act(() =>
      tree.root
        .findAllByType('button')
        .find((node) => text(node).includes(target.name))
        .props.onClick(),
    );
    Renderer.act(() => setInput(input(tree, 'po-picker-quantity'), '4,25'));
    Renderer.act(() => tree.root.findAllByType('aside')[0].props.onClose());
    assert.equal(tree.root.findAllByType(Editor).length, 1, 'name-only search must not hide cached SKU at index239');
    assert.equal(tree.root.findByType(Editor).props.product.id, target.id);
    Renderer.act(() => tree.update(make([], true)));
    assert.equal(tree.root.findAllByType(Editor).length, 1, 'cached draft remains editable when query data disappears');
    assert.equal(input(tree, 'po-picker-quantity').props.value, '4,25');
    await click(tree, 'Отменить изменения позиции');
    Renderer.act(() => tree.root.findAllByType('aside')[0].props.onClose());
    assert.equal(closed, 1);
  } finally {
    Renderer.act(() => tree.unmount());
  }
});

test('visual: compact price label shares quantity row and accessible price name retains the unit', () => {
  let tree;
  Renderer.act(() => {
    tree = Renderer.create(React.createElement(Editor, { product, onConfirm() {}, onCancel() {} }));
  });
  try {
    const fields = tree.root.findAllByType(Field);
    const quantity = fields.find((node) => node.props.htmlFor === 'po-picker-quantity');
    const price = fields.find((node) => node.props.htmlFor === 'po-picker-cost');
    assert.equal(price.props.label, 'Цена закупки, ₽');
    assert.equal(price.parent, quantity.parent);
    assert.match(price.parent.props.className, /grid-cols-2/);
    assert.equal(input(tree, 'po-picker-cost').props['aria-label'], 'Закупочная цена за м, ₽');
    assert.equal(
      tree.root
        .findAllByType('label')
        .find((node) => node.props.htmlFor === 'po-picker-cost')
        .children.join(''),
      'Цена закупки, ₽',
    );
  } finally {
    Renderer.act(() => tree.unmount());
  }
});
