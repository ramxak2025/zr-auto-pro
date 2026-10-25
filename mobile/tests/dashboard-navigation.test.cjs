const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { TabRouter, StackRouter } = require('@react-navigation/routers');
const root = path.join(__dirname, '..');
function moduleSource(relative) {
  const m = { exports: {} };
  vm.runInNewContext(
    ts.transpileModule(readFileSync(path.join(root, relative), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText,
    { module: m, exports: m.exports },
  );
  return m.exports;
}
const navSource = ts.createSourceFile(
  'AppNavigator.tsx',
  readFileSync(path.join(root, 'src/navigation/AppNavigator.tsx'), 'utf8'),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
function routes(tag) {
  const found = [];
  const visit = (n) => {
    if (ts.isJsxSelfClosingElement(n) && n.tagName.getText(navSource) === tag) {
      const a = n.attributes.properties.find((a) => a.name?.getText(navSource) === 'name');
      if (a?.initializer && ts.isStringLiteral(a.initializer)) found.push(a.initializer.text);
    }
    ts.forEachChild(n, visit);
  };
  visit(navSource);
  return found;
}
const options = (names) => ({ routeNames: names, routeParamList: {}, routeGetIdList: {} });
const { openAttention } = moduleSource('src/screens/dashboard/attentionNavigation.ts');
test('all attention actions resolve against actual registered tabs/stacks; More destinations preserve the section back stack', () => {
  const tabs = TabRouter({ initialRouteName: 'Dashboard' }),
    tabOptions = options(routes('Tab.Screen'));
  const initial = tabs.getInitialState(tabOptions);
  const calls = [];
  const navigation = { navigate: (name, params) => calls.push({ name, params }) };
  for (const id of ['bookings', 'purchase-orders', 'installments', 'deferred', 'low-stock'])
    openAttention(navigation, id, 'self');
  assert.equal(calls.length, 5);
  for (const call of calls) {
    const target = tabs.getStateForAction(initial, { type: 'NAVIGATE', payload: call }, tabOptions);
    assert.ok(target, `${call.name} must be registered`);
    const tag =
      call.name === 'MoreTab'
        ? 'MoreStack.Screen'
        : call.name === 'Checks'
          ? 'ChecksStack.Screen'
          : 'ProductsStack.Screen';
    const names = routes(tag);
    assert.ok(names.includes(call.params.screen));
    const stack = StackRouter({ initialRouteName: names[0] }),
      so = options(names);
    let state = stack.getInitialState(so);
    assert.equal(call.params.initial, false, 'keep normal section root beneath nested destination');
    state = stack.getStateForAction(
      state,
      { type: 'NAVIGATE', payload: { name: call.params.screen, params: call.params.params } },
      so,
    );
    assert.ok(state);
    assert.equal(state.routes[state.index].name, call.params.screen);
    if (call.name === 'MoreTab') {
      assert.equal(state.routes[0].name, 'MoreHome');
      assert.equal(stack.getStateForAction(state, { type: 'GO_BACK' }, so).routes[0].name, 'MoreHome');
    }
  }
});
function warehouseEntry(state, setParams) {
  const source = ts.createSourceFile(
    'ProductsScreen.tsx',
    readFileSync(path.join(root, 'src/screens/ProductsScreen.tsx'), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const fn = source.statements.find((n) => ts.isFunctionDeclaration(n) && n.name?.text === 'ProductsScreen');
  const js = ts.transpileModule(`(${fn.getText(source).replace('export default ', '')})`, {
    compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const component = vm.runInNewContext(js, {
    React,
    useRoute: () => state.routes[state.index],
    useNavigation: () => ({ setParams }),
    LowStockView: 'LowStockView',
    ProductsScreenContents: 'ProductsScreenContents',
  });
  return component();
}
test('lowstock root and existing folder/detail flows have a real clear-mode escape and can be opened again', () => {
  const router = StackRouter({ initialRouteName: 'ProductsHome' }),
    so = options(routes('ProductsStack.Screen'));
  for (const previous of [false, true]) {
    let state = router.getInitialState(so);
    if (previous)
      state = router.getStateForAction(
        state,
        {
          type: 'PUSH',
          payload: { name: 'ProductsHome', params: { activePath: ['Масла'], warehouseId: 'warehouse-A' } },
        },
        so,
      );
    const actions = [];
    openAttention({ navigate: (name, params) => actions.push({ name, params }) }, 'low-stock');
    const entry = actions[0].params;
    state = router.getStateForAction(
      state,
      { type: 'NAVIGATE', payload: { name: entry.screen, params: entry.params } },
      so,
    );
    const clear = (params) => {
      state = router.getStateForAction(
        state,
        { type: 'SET_PARAMS', payload: { params }, source: state.routes[state.index].key },
        so,
      );
    };
    const low = warehouseEntry(state, clear);
    assert.equal(low.type, 'LowStockView');
    assert.equal(typeof low.props.onExit, 'function');
    state = router.getStateForAction(
      state,
      { type: 'PUSH', payload: { name: 'ProductDetail', params: { productId: 'product-A' } } },
      so,
    );
    state = router.getStateForAction(state, { type: 'GO_BACK' }, so);
    assert.equal(warehouseEntry(state, clear).type, 'LowStockView');
    warehouseEntry(state, clear).props.onExit();
    assert.equal(warehouseEntry(state, clear).type, 'ProductsScreenContents');
    if (previous) assert.equal(state.routes.length, 2, 'existing warehouse history remains available');
    state = router.getStateForAction(
      state,
      { type: 'SET_PARAMS', payload: { params: { lowStock: true } }, source: state.routes[state.index].key },
      so,
    );
    assert.equal(warehouseEntry(state, clear).type, 'LowStockView');
  }
  const view = readFileSync(path.join(root, 'src/screens/dashboard/LowStockView.tsx'), 'utf8');
  assert.ok(view.includes('onBack={onExit}'));
  assert.ok(view.includes('onPress={onExit}'));
});
