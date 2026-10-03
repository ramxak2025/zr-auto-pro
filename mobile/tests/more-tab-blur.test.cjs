const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { StackRouter, TabRouter, StackActions, TabActions } = require('@react-navigation/routers');

function sourceModule(relativePath) {
  const source = readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(js, { module, exports: module.exports });
  return module.exports;
}

const { getMoreTabBlurAction } = sourceModule('src/navigation/moreTabBlur.ts');
const session = sourceModule('src/utils/productPickerSession.ts');
const stackOptions = (names) => ({ routeNames: names, routeParamList: {}, routeGetIdList: {} });

function fixture() {
  const moreRouter = StackRouter({ initialRouteName: 'MoreHome' });
  const moreOptions = stackOptions(['MoreHome', 'Suppliers', 'SupplierDetail', 'PurchaseOrderCreate']);
  let more = moreRouter.getInitialState(moreOptions);
  for (const screen of ['Suppliers', 'SupplierDetail', 'PurchaseOrderCreate']) {
    more = moreRouter.getStateForAction(more, StackActions.push(screen), moreOptions);
  }
  const tabRouter = TabRouter({ initialRouteName: 'MoreTab' });
  const tabOptions = stackOptions(['Dashboard', 'MoreTab']);
  let tabs = tabRouter.getInitialState(tabOptions);
  tabs = { ...tabs, routes: tabs.routes.map((r) => (r.name === 'MoreTab' ? { ...r, state: more } : r)) };
  const rootRouter = StackRouter({ initialRouteName: 'Main' });
  const rootOptions = stackOptions(['Main', 'ProductPicker']);
  let root = rootRouter.getInitialState(rootOptions);
  const selected = [];
  const owner = {
    current: {
      productLines: selected,
      addProduct(product) {
        selected.push({ productId: product.id, quantity: 1, sellPrice: product.costPrice });
      },
    },
  };
  session.claimProductPickerSession(owner);
  function blur(action = getMoreTabBlurAction(tabs)) {
    if (action) {
      more = moreRouter.getStateForAction(more, action, moreOptions);
      if (!more.routes.some((r) => r.name === 'PurchaseOrderCreate')) {
        session.releaseProductPickerSession(owner); // actual screen's unmount cleanup
      }
    }
    if (!session.getProductPickerSession()) root = rootRouter.getStateForAction(root, StackActions.pop(), rootOptions);
  }
  return {
    get more() {
      return more;
    },
    get root() {
      return root;
    },
    get tabs() {
      return tabs;
    },
    selected,
    owner,
    blur,
    open(path = []) {
      root = rootRouter.getStateForAction(root, StackActions.push('ProductPicker', { folderPath: path }), rootOptions);
    },
    done(depth) {
      root = rootRouter.getStateForAction(root, StackActions.pop(depth + 1), rootOptions);
    },
    switchTab() {
      tabs = tabRouter.getStateForAction(tabs, TabActions.jumpTo('Dashboard'), tabOptions);
    },
  };
}

test('previous unconditional blur reproduces order unmount, null picker session and return to MoreHome', () => {
  const f = fixture();
  f.open();
  f.blur({ ...StackActions.popToTop(), target: f.more.key });
  assert.equal(f.more.routes.at(-1).name, 'MoreHome');
  assert.equal(session.getProductPickerSession(), null);
  assert.equal(f.root.routes.at(-1).name, 'Main');
});

test('root picker and folders preserve the order; Done returns with the selected product', () => {
  const f = fixture();
  const orderKey = f.more.routes.at(-1).key;
  f.open();
  f.blur();
  assert.equal(f.root.routes.at(-1).name, 'ProductPicker');
  assert.equal(f.more.routes.at(-1).key, orderKey);
  f.open(['Баллоны']);
  session.getProductPickerSession().addProduct({ id: 'cylinder', costPrice: 12.5 });
  f.done(1);
  assert.equal(f.root.routes.at(-1).name, 'Main');
  assert.equal(f.more.routes.at(-1).key, orderKey);
  assert.deepEqual(f.selected, [{ productId: 'cylinder', quantity: 1, sellPrice: 12.5 }]);
  session.releaseProductPickerSession(f.owner);
});

test('switching to another tab retains the old pop-to-home behavior without refocusing More', () => {
  const f = fixture();
  f.switchTab();
  const action = getMoreTabBlurAction(f.tabs);
  assert.equal(action.type, 'POP_TO_TOP');
  assert.equal(action.target, f.more.key);
  f.blur(action);
  assert.equal(f.tabs.routes[f.tabs.index].name, 'Dashboard');
  assert.equal(f.more.routes.at(-1).name, 'MoreHome');
  assert.equal(session.getProductPickerSession(), null);
});

test('switching tabs repairs a section-only stack; an overlay preserves it', () => {
  const f = fixture();
  const tabs = {
    ...f.tabs,
    routes: f.tabs.routes.map((r) =>
      r.name === 'MoreTab' ? { ...r, state: { ...f.more, index: 0, routes: [f.more.routes.at(-1)] } } : r,
    ),
  };
  assert.equal(getMoreTabBlurAction(tabs), null);
  const action = getMoreTabBlurAction({ ...tabs, index: 0 });
  assert.equal(action.type, 'RESET');
  assert.equal(action.target, f.more.key);
  assert.equal(action.payload.routes[0].name, 'MoreHome');
  session.releaseProductPickerSession(f.owner);
});
