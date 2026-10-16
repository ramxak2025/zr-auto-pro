import fs from 'fs';
import path from 'path';
import ts from 'typescript';
import type { Product } from '../../../../../shared/types';
import {
  inventoryRows,
  inventorySummary,
  reconcileInventoryDrafts,
  parseInventoryQuantity,
  type InventoryDrafts,
  type InventoryStockRequest,
} from '../model';
import { inventoryError } from '../model';

const sourceText = fs.readFileSync(path.join(__dirname, '../../InventoryScreen.tsx'), 'utf8');
function callback<T>(name: string, scope: Record<string, unknown>, text = sourceText): T {
  const source = ts.createSourceFile('InventoryScreen.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression: ts.Expression | undefined;
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name && node.initializer) {
      expression =
        ts.isCallExpression(node.initializer) && node.initializer.expression.getText(source) === 'useCallback'
          ? node.initializer.arguments[0]
          : node.initializer;
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  if (!expression) throw new Error(`Missing actual InventoryScreen callback ${name}`);
  const js = ts.transpileModule(`const actual = ${expression.getText(source)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText;
  return Function(...Object.keys(scope), `${js}; return actual;`)(...Object.values(scope)) as T;
}
const product = (id: string, stock = 2, category = '') =>
  ({
    id,
    name: `Товар ${id}`,
    stock,
    category,
    barcode: `barcode-${id}`,
    storageCellCode: ' A-01 ',
    warehouseId: 'A',
    unit: 'l',
    costPrice: 100,
    minStock: 0,
  }) as Product;
const a = product('a'),
  b = product('b');
interface Entry {
  id: string;
  body: InventoryStockRequest;
}
interface Operation {
  session: { updateStock: jest.Mock; loadProducts: jest.Mock };
  warehouseId: string;
  isCurrent: () => boolean;
  started: boolean;
}
function harness(products = [a, b]) {
  let epoch = 0,
    dataEpoch = 0,
    sequence = 0;
  let buttons: { text: string; onPress: () => void }[] = [];
  const requests: Entry[] = [];
  const scope: Record<string, unknown> = {
    draftsRef: { current: {} },
    warehouseRef: { current: 'A' },
    mountedRef: { current: true },
    busyRef: { current: false },
    activeOperationRef: { current: null },
    canWriteRef: { current: true },
    setDraftsByWarehouse: jest.fn(),
    setBusy: jest.fn(),
    setProgress: jest.fn(),
    setNotice: jest.fn(),
    Keyboard: { dismiss: jest.fn() },
    inventorySummary,
    reconcileInventoryDrafts,
    parseInventoryQuantity,
    inventoryError,
    catalog: { isFetching: false, isError: false },
    warehouseQuery: { isError: false },
    allProducts: products,
    randomUUID: () => `request-${++sequence}`,
    haptic: jest.fn(),
    queryClient: { invalidateQueries: jest.fn(async () => {}), setQueryData: jest.fn() },
    Alert: {
      alert: jest.fn((_title: string, _message: string, actions: typeof buttons) => {
        buttons = actions;
      }),
    },
    setSelectedWarehouseId: jest.fn(),
    setFolderPath: jest.fn(),
    setSearch: jest.fn(),
    setScanFeedback: jest.fn(),
    setWarehouseMenu: jest.fn(),
    setShowScanner: jest.fn(),
    scannerScope: { current: null },
    focusId: { current: null },
    scrollTimer: { current: null },
    scrollToFocused: jest.fn(),
    productFolderParts: (p: string) => p.split('/').filter(Boolean),
    formatQty: String,
    unitLabel: () => 'л',
    setTimeout: jest.fn(),
  };
  const transport = jest.fn(async (id: string, body: InventoryStockRequest) => {
    requests.push({ id, body });
    return { data: { requestId: body.requestId, stock: body.quantity } };
  });
  const loadProducts = jest.fn(async () => products);
  scope.captureInventorySession = () => {
    const captured = epoch,
      capturedData = dataEpoch;
    return {
      data: { isCurrent: () => capturedData === dataEpoch },
      isCurrent: () => captured === epoch && capturedData === dataEpoch,
      updateStock: transport,
      loadProducts,
    };
  };
  for (const name of [
    'updateDrafts',
    'setCount',
    'finish',
    'commit',
    'handleApply',
    'chooseWarehouse',
    'handleScanned',
    'refresh',
  ]) {
    scope[name] = callback(name, scope);
  }
  return {
    scope,
    requests,
    transport,
    loadProducts,
    get drafts() {
      return (scope.draftsRef as { current: Record<string, InventoryDrafts> }).current;
    },
    count: scope.setCount as (p: Product, raw: string) => void,
    apply: scope.handleApply as () => void,
    choose: scope.chooseWarehouse as (id: string) => void,
    scan: scope.handleScanned as (code: string) => void,
    commit: scope.commit as (entries: Entry[], operation: Operation) => Promise<void>,
    get buttons() {
      return buttons;
    },
    newEpoch: () => {
      epoch++;
      dataEpoch++;
    },
    refreshBearer: () => {
      epoch++;
    },
    session: () => (scope.captureInventorySession as () => Operation['session'] & { isCurrent: () => boolean })(),
  };
}
async function settle() {
  for (let i = 0; i < 50; i++) await Promise.resolve();
}
function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { resolve, promise };
}

it.each(['0,5', '0.5', '0.001', '.5', '1,', '0', '999999999.999'])('keeps valid fact %s precise', (raw) => {
  const h = harness();
  h.count(a, raw);
  expect(h.drafts.A.a.raw).toBe(raw);
  expect(parseInventoryQuantity(raw)).toBe(Number(raw.replace(',', '.')));
});
it.each(['', 'abc', '1a', '-1', '1.2345', '1,2.3', '1e3', 'NaN', ' 0 ', '1000000000'])(
  'does not turn %s into a count',
  (raw) => {
    expect(parseInventoryQuantity(raw)).toBeNull();
  },
);
it('blank is uncounted; explicit zero and unchanged quantities are both counted and submitted', async () => {
  const h = harness();
  h.count(a, '0');
  h.count(b, '2');
  expect(inventorySummary(h.drafts.A, [a, b])).toEqual({ counted: 2, changed: 1, invalid: 0, review: 0 });
  h.apply();
  h.buttons[1].onPress();
  await settle();
  expect(h.requests.map((r) => [r.id, r.body.quantity])).toEqual([
    ['a', 0],
    ['b', 2],
  ]);
  expect(h.drafts.A).toEqual({});
});
it('drills through normalized nested and empty API folders; search spans the whole warehouse', () => {
  const products = [product('root'), product('nested', 2, ' Масла / Моторные / 5W30 '), product('other', 1, 'Другое')];
  const folders = [{ path: 'Масла/Пустая/Глубже', sort_order: 2 }];
  expect(inventoryRows(products, [], '', folders).map((r) => r.key)).toEqual(['folder:Другое', 'folder:Масла', 'root']);
  expect(inventoryRows(products, ['Масла'], '', folders).map((r) => r.key)).toEqual([
    'folder:Моторные',
    'folder:Пустая',
  ]);
  expect(inventoryRows(products, ['Масла', 'Пустая'], '', folders).map((r) => r.key)).toEqual(['folder:Глубже']);
  expect(inventoryRows(products, ['Масла', 'Моторные', '5W30'], '', folders).map((r) => r.key)).toEqual(['nested']);
  expect(inventoryRows(products, ['Масла'], 'barcode-other', folders).map((r) => r.key)).toEqual(['other']);
  expect(inventoryRows(products, ['Масла'], ' a-01 ', folders).length).toBe(3);
});
it('warehouse drafts stay isolated and survive switching and filtering', () => {
  const h = harness();
  h.count(a, '0,5');
  h.choose('B');
  h.count({ ...a, warehouseId: 'B' }, '3');
  h.choose('A');
  expect(h.drafts).toMatchObject({ A: { a: { raw: '0,5' } }, B: { a: { raw: '3' } } });
  expect(h.scope.setSearch).toHaveBeenCalledWith('');
});
it('invalid facts block all writes instead of silently sending zero', () => {
  const h = harness();
  h.count(a, 'garbage');
  h.apply();
  expect((h.scope.Alert as { alert: jest.Mock }).alert).not.toHaveBeenCalled();
});
it('confirmation holds a synchronous reentry lock and captures the session before its callback', async () => {
  const h = harness();
  h.count(a, '0.5');
  h.apply();
  h.apply();
  expect((h.scope.Alert as { alert: jest.Mock }).alert).toHaveBeenCalledTimes(1);
  h.newEpoch();
  h.buttons[1].onPress();
  await settle();
  expect(h.transport).not.toHaveBeenCalled();
});
it('pressing the same confirm callback twice sends one batch', async () => {
  const h = harness();
  h.count(a, '0.5');
  h.apply();
  const confirm = h.buttons[1].onPress;
  confirm();
  confirm();
  await settle();
  expect(h.transport).toHaveBeenCalledTimes(1);
});
it.each(['account', 'point', 'unmount', 'warehouse'] as const)(
  'stops after in-flight ACK across %s boundary without alerts/cache writes',
  async (boundary) => {
    const h = harness();
    h.count(a, '0.5');
    h.count(b, '4');
    const first = gate();
    h.transport.mockImplementationOnce(async (_id, body) => {
      await first.promise;
      return { data: { requestId: body.requestId, stock: body.quantity } };
    });
    h.apply();
    h.buttons[1].onPress();
    if (boundary === 'account' || boundary === 'point') h.newEpoch();
    if (boundary === 'unmount') (h.scope.mountedRef as { current: boolean }).current = false;
    if (boundary === 'warehouse') (h.scope.warehouseRef as { current: string }).current = 'B';
    const before = (h.scope.setNotice as jest.Mock).mock.calls.length;
    first.resolve();
    await settle();
    expect(h.transport).toHaveBeenCalledTimes(1);
    expect(h.scope.queryClient).toMatchObject({ invalidateQueries: expect.any(Function) });
    expect((h.scope.queryClient as { invalidateQueries: jest.Mock }).invalidateQueries).not.toHaveBeenCalled();
    expect((h.scope.setNotice as jest.Mock).mock.calls.length).toBe(before);
  },
);
it.each(['network', 'missingAck', 'wrongStock'] as const)(
  'partial %s retry retains exact body/UUID and skips acknowledged successes',
  async (failure) => {
    const h = harness();
    h.count(a, '0.5');
    h.count(b, '4');
    h.transport.mockImplementationOnce(async (_id, body) => ({
      data: { requestId: body.requestId, stock: body.quantity },
    }));
    h.transport.mockImplementationOnce(async (_id, body) => {
      if (failure === 'network') throw new Error('lost ACK');
      return {
        data: {
          requestId: failure === 'missingAck' ? '' : body.requestId,
          stock: failure === 'wrongStock' ? 99 : body.quantity,
        },
      };
    });
    h.apply();
    h.buttons[1].onPress();
    await settle();
    expect(h.drafts.A.a).toBeUndefined();
    const pending = h.drafts.A.b.pending;
    expect(pending).toBeDefined();
    h.count(b, '999');
    expect(h.drafts.A.b.raw).toBe('4');
    h.apply();
    h.buttons[1].onPress();
    await settle();
    expect(h.transport.mock.calls.map((args) => args[0])).toEqual(['a', 'b', 'b']);
    expect(h.transport.mock.calls[2][1]).toBe(pending);
    expect((h.scope.queryClient as { setQueryData: jest.Mock }).setQueryData).not.toHaveBeenCalled();
  },
);
it('stock conflict refreshes baseline and blocks automatic replay until explicit review', async () => {
  const h = harness();
  h.count(a, '0.5');
  h.transport.mockRejectedValueOnce({ response: { status: 409, data: { code: 'INVENTORY_STOCK_CONFLICT' } } });
  h.loadProducts.mockResolvedValueOnce([product('a', 9), b]);
  h.apply();
  h.buttons[1].onPress();
  await settle();
  expect(h.drafts.A.a).toMatchObject({ raw: '0.5', expectedStock: 9, needsReview: true, reviewReady: true });
  expect(h.drafts.A.a.pending).toBeUndefined();
  h.apply();
  expect(h.transport).toHaveBeenCalledTimes(1);
});
it('request conflict never replaces the UUID or clears the uncertain operation', async () => {
  const h = harness();
  h.count(a, '0.5');
  h.transport.mockRejectedValueOnce({ response: { status: 409, data: { code: 'INVENTORY_REQUEST_CONFLICT' } } });
  h.apply();
  h.buttons[1].onPress();
  await settle();
  expect(h.drafts.A.a.pending?.requestId).toBe('request-1');
  expect(h.loadProducts).not.toHaveBeenCalled();
});
it('scanner uses the current ref, preserves fractional counts, and consumes each scan callback once', () => {
  const h = harness();
  h.count(a, '0,5');
  const scanner = h.scope.scannerScope as { current: unknown };
  scanner.current = { session: h.session(), warehouseId: 'A' };
  h.scan('barcode-a');
  h.scan('barcode-a');
  expect(h.drafts.A.a.raw).toBe('1.5');
  scanner.current = { session: h.session(), warehouseId: 'A' };
  h.scan('barcode-a');
  expect(h.drafts.A.a.raw).toBe('2.5');
});
it('read-only permissions and a pending warehouse cannot dispatch writes', () => {
  const h = harness();
  h.count(a, '0.5');
  (h.scope.canWriteRef as { current: boolean }).current = false;
  h.apply();
  expect((h.scope.Alert as { alert: jest.Mock }).alert).not.toHaveBeenCalled();
  (h.scope.canWriteRef as { current: boolean }).current = true;
  (h.scope.catalog as { isFetching: boolean }).isFetching = true;
  h.apply();
  expect((h.scope.Alert as { alert: jest.Mock }).alert).not.toHaveBeenCalled();
});
it('viewport has a single safe area, bounded field geometry, and a keyboard dismissal action', () => {
  expect(sourceText).not.toContain('SafeAreaView');
  expect(sourceText).toContain('reserveBottomNavigation={!keyboardVisible}');
  expect(sourceText).toContain('keyboardType="decimal-pad"');
  expect(sourceText).toContain('accessibilityLabel="Скрыть клавиатуру"');
  expect(sourceText).toMatch(/viewport:\s*\{\s*flex:\s*1/);
  expect(sourceText).toMatch(/input:\s*\{\s*width:\s*86,\s*minHeight:\s*48/);
});

it('an unconfirmed body can still be retried after the product disappears from a refreshed list', async () => {
  const h = harness();
  h.count(a, '0.5');
  h.transport.mockRejectedValueOnce(new Error('lost ACK'));
  h.apply();
  h.buttons[1].onPress();
  await settle();
  const body = h.drafts.A.a.pending;
  const apply = callback<() => void>('handleApply', { ...h.scope, allProducts: [] });
  expect(inventorySummary(h.drafts.A, [])).toMatchObject({ counted: 1, invalid: 0 });
  apply();
  h.buttons[1].onPress();
  await settle();
  expect(h.transport.mock.calls[1][1]).toBe(body);
  expect(h.drafts.A.a).toBeUndefined();
});
it('only a known stock conflict plus a full successful refresh marks a missing draft as removable', async () => {
  const h = harness();
  h.count(a, '0.5');
  h.transport.mockRejectedValueOnce({ response: { status: 409, data: { code: 'INVENTORY_STOCK_CONFLICT' } } });
  h.loadProducts.mockResolvedValueOnce([b]);
  h.apply();
  h.buttons[1].onPress();
  await settle();
  expect(h.drafts.A.a).toMatchObject({ name: a.name, needsReview: true, reviewReady: true, unavailable: true });
  expect(h.drafts.A.a.pending).toBeUndefined();
  const untouched = {
    ...h.drafts.A.a,
    needsReview: false,
    pending: {
      type: 'inventory' as const,
      quantity: 0.5,
      reason: 'Инвентаризация',
      requestId: 'keep-original',
      expectedStock: 2,
      expectedWarehouseId: 'A',
    },
  };
  expect(reconcileInventoryDrafts({ a: untouched }, []).a).toBe(untouched);
});
it.each([404, 401, 403, 500])(
  'HTTP %s stops the queue and preserves the original unconfirmed operation',
  async (status) => {
    const h = harness();
    h.count(a, '0.5');
    h.count(b, '4');
    h.transport.mockRejectedValueOnce({ response: { status, data: { message: 'Unavailable' } } });
    h.apply();
    h.buttons[1].onPress();
    await settle();
    expect(h.transport).toHaveBeenCalledTimes(1);
    expect(h.drafts.A.a.pending?.requestId).toBe('request-1');
    expect(h.drafts.A.a.needsReview).toBeUndefined();
    expect(h.drafts.A.b.pending).toBeUndefined();
  },
);
it('the actual conflict-row confirmation unlocks a new UUID against the refreshed baseline', async () => {
  const h = harness();
  h.count(a, '0.5');
  h.transport.mockRejectedValueOnce({ response: { status: 409, data: { code: 'INVENTORY_STOCK_CONFLICT' } } });
  h.loadProducts.mockResolvedValueOnce([product('a', 9), b]);
  h.apply();
  h.buttons[1].onPress();
  await settle();
  type Element = { type: string; props: { children?: Element[]; accessibilityLabel?: string; onPress?: () => void } };
  const mockElement = (type: string, props: Record<string, unknown> | null, ...children: unknown[]) => ({
    type,
    props: { ...props, children },
  });
  const token = {
    primary: 'black',
    secondary: 'gray',
    subtle: 'gray',
    card: 'white',
    muted: 'white',
    primarySoft: 'blue',
    primaryText: 'blue',
  };
  const render = callback<(value: { item: { type: string; product: Product } }) => Element>('renderItem', {
    ...h.scope,
    React: { createElement: mockElement },
    drafts: h.drafts.A,
    busy: false,
    keyboardVisible: false,
    warehouseId: 'A',
    palette: { mode: 'light', bg: token, text: token, border: token, accent: token },
    colors: { red: { 400: 'red', 700: 'red' } },
    styles: new Proxy({}, { get: () => ({}) }),
    getImageUrl: () => null,
    ...Object.fromEntries(
      ['View', 'Text', 'TouchableOpacity', 'Ionicons', 'CachedImage', 'StorageCellChip', 'TextInput'].map((name) => [
        name,
        name,
      ]),
    ),
  });
  const row = render({ item: { type: 'product', product: a } });
  const review = row.props.children?.find((child) =>
    child?.props?.accessibilityLabel?.startsWith('Подтвердить сверенный факт'),
  );
  expect(review?.props.onPress).toBeDefined();
  review?.props.onPress?.();
  h.apply();
  h.buttons[1].onPress();
  await settle();
  expect(h.transport.mock.calls[1][1]).toMatchObject({ requestId: 'request-2', expectedStock: 9, quantity: 0.5 });
});
it('late row input from a previous warehouse cannot create a draft in the next warehouse', () => {
  const h = harness();
  h.choose('B');
  h.count(a, '4');
  expect(h.drafts.B).toBeUndefined();
});

type NativeElement = {
  type: string;
  props: { children?: unknown[]; accessibilityLabel?: string; onPress?: () => void };
};
function missingDraftElements(h: ReturnType<typeof harness>, products: Product[]) {
  const missingDrafts = callback<[string, import('../model').InventoryDraft][]>('missingDrafts', {
    drafts: h.drafts.A,
    allProducts: products,
  });
  const element = callback<NativeElement>('missingContent', {
    ...h.scope,
    missingDrafts,
    warehouseId: 'A',
    React: {
      createElement: (type: string, props: object | null, ...children: unknown[]) => ({
        type,
        props: { ...props, children },
      }),
    },
    View: 'View',
    Text: 'Text',
    TouchableOpacity: 'TouchableOpacity',
    styles: {},
    palette: { text: { secondary: 'gray' }, accent: { primaryText: 'blue' } },
  });
  function find(value: unknown): NativeElement[] {
    if (Array.isArray(value)) return value.flatMap(find);
    if (!value || typeof value !== 'object' || !('props' in value)) return [];
    const node = value as NativeElement;
    return [node, ...find(node.props.children)];
  }
  return { missingDrafts, elements: find(element) };
}
it('actual refresh exposes a removed unsent draft, whose explicit removal lets the remaining product post', async () => {
  const h = harness();
  h.count(a, '0.5');
  h.count(b, '4');
  h.loadProducts.mockResolvedValueOnce([b]);
  await (h.scope.refresh as () => Promise<void>)();
  const rendered = missingDraftElements(h, [b]);
  expect(rendered.missingDrafts.map(([id]) => id)).toEqual(['a']);
  expect(inventorySummary(h.drafts.A, [b]).invalid).toBe(1);
  const remove = rendered.elements.find((node) => node.props.accessibilityLabel === `Убрать из пересчёта: ${a.name}`);
  expect(remove?.props.onPress).toBeDefined();
  remove?.props.onPress?.();
  const apply = callback<() => void>('handleApply', { ...h.scope, allProducts: [b] });
  apply();
  h.buttons[1].onPress();
  await settle();
  expect(h.transport.mock.calls.map(([id]) => id)).toEqual(['b']);
});
it('actual refresh never exposes a removal action for a missing draft with an unknown ACK', async () => {
  const h = harness();
  h.count(a, '0.5');
  h.transport.mockRejectedValueOnce(new Error('lost ACK'));
  h.apply();
  h.buttons[1].onPress();
  await settle();
  const original = h.drafts.A.a.pending;
  h.loadProducts.mockResolvedValueOnce([b]);
  await (h.scope.refresh as () => Promise<void>)();
  const rendered = missingDraftElements(h, [b]);
  expect(rendered.missingDrafts.map(([id]) => id)).toEqual(['a']);
  expect(rendered.elements.some((node) => node.props.accessibilityLabel?.startsWith('Убрать из пересчёта'))).toBe(
    false,
  );
  expect(h.drafts.A.a.pending).toBe(original);
});
it('ordinary bearer refresh before confirmation unlocks only this data-owner form without sending the old request', async () => {
  const h = harness();
  h.count(a, '0.5');
  h.apply();
  const oldConfirm = h.buttons[1].onPress;
  h.refreshBearer();
  oldConfirm();
  await settle();
  expect(h.transport).not.toHaveBeenCalled();
  expect((h.scope.busyRef as { current: boolean }).current).toBe(false);
  expect(h.drafts.A.a.raw).toBe('0.5');
  h.apply();
  // Replaying an old alert cannot release the new operation's lock.
  oldConfirm();
  expect((h.scope.busyRef as { current: boolean }).current).toBe(true);
  h.buttons[1].onPress();
  await settle();
  expect(h.transport).toHaveBeenCalledTimes(1);
});
it.each(['resolved', 'rejected'])(
  'ordinary bearer refresh during %s ACK stops the batch, releases this form lock, and retains the exact body for a fresh lease',
  async (completion) => {
    const h = harness();
    h.count(a, '0.5');
    h.count(b, '4');
    const waiting = gate();
    h.transport.mockImplementationOnce(async (_id, body) => {
      await waiting.promise;
      if (completion === 'rejected') throw Object.assign(new Error('stale auth lease'), { code: 'ERR_CANCELED' });
      return { data: { requestId: body.requestId, stock: body.quantity } };
    });
    h.apply();
    h.buttons[1].onPress();
    const original = h.drafts.A.a.pending;
    h.refreshBearer();
    waiting.resolve();
    await settle();
    expect(h.transport).toHaveBeenCalledTimes(1);
    expect((h.scope.busyRef as { current: boolean }).current).toBe(false);
    expect(h.drafts.A.a.pending).toBe(original);
    expect((h.scope.queryClient as { setQueryData: jest.Mock }).setQueryData).not.toHaveBeenCalled();
    expect((h.scope.queryClient as { invalidateQueries: jest.Mock }).invalidateQueries).not.toHaveBeenCalled();
    h.apply();
    h.buttons[1].onPress();
    await settle();
    expect(h.transport.mock.calls.map(([id]) => id)).toEqual(['a', 'a', 'b']);
    expect(h.transport.mock.calls[1][1]).toBe(original);
  },
);
