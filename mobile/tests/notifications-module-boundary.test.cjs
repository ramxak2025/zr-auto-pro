const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const mobile = path.resolve(__dirname, '..');
const facadeFile = path.join(mobile, 'src/utils/notifications.ts');
const consumers = [
  'App.tsx',
  'src/contexts/AuthContext.tsx',
  'src/contexts/BroadcastNotificationContext.tsx',
  'src/contexts/SalaryNotificationContext.tsx',
  'src/navigation/PlatformReminderNotificationRouter.tsx',
  'src/screens/CashierPaymentScreen.tsx',
  'src/screens/NotificationSettingsScreen.tsx',
  'src/screens/admin/AdminReminderSettingsScreen.tsx',
];
function evaluate(filename, requireModule) {
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, require: requireModule }, { filename });
  return module.exports;
}
function loadFacade(internal, sdkFactory) {
  const cache = new Map();
  let sdkLoads = 0;
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename);
    const result = evaluate(filename, (name) => {
      if (name === './runtimeEnvironment') return load(path.join(mobile, 'src/utils/runtimeEnvironment.ts'));
      if (name === 'expo-constants')
        return { default: { expoConfig: { extra: { inventoryInternal: internal ? 'ios-v1' : undefined } } } };
      if (name === 'expo-notifications' || name.startsWith('expo-notifications/')) {
        sdkLoads++;
        return sdkFactory();
      }
      throw new Error('Unexpected facade dependency: ' + name);
    });
    cache.set(filename, result);
    return result;
  }
  return { load: () => load(facadeFile), sdkLoads: () => sdkLoads };
}

test('actual internal facade and all exports never evaluate the SDK or touch production native registration', async () => {
  const nativeCalls = { readRegistration: 0, getDeviceToken: 0, updateRegistration: 0, clearResponse: 0 };
  const loader = loadFacade(true, () => {
    nativeCalls.readRegistration++;
    throw new Error('SDK evaluated: persisted production registration would be read');
  });
  const api = loader.load();
  assert.equal(loader.load(), api);
  api.setNotificationHandler({ handleNotification: async () => ({}) });
  let delivered = 0;
  api.addNotificationReceivedListener(() => delivered++).remove();
  api.addNotificationResponseReceivedListener(() => delivered++).remove();
  assert.equal(await api.getLastNotificationResponseAsync(), null);
  await api.clearLastNotificationResponseAsync();
  for (const operation of [
    () => api.getPermissionsAsync(),
    () => api.requestPermissionsAsync(),
    () => api.getExpoPushTokenAsync({ projectId: 'must-not-register' }),
    () => api.setNotificationChannelAsync('default', { name: 'Default', importance: 7 }),
    () => api.scheduleNotificationAsync({ content: { title: 'must-not-schedule' }, trigger: null }),
  ]) {
    await assert.rejects(operation, { code: 'ERR_INVENTORY_INTERNAL_NOTIFICATIONS_DISABLED' });
  }
  assert.equal(api.IosAuthorizationStatus.PROVISIONAL, 3);
  assert.equal(api.AndroidImportance.MAX, 7);
  assert.equal(delivered, 0);
  assert.equal(loader.sdkLoads(), 0);
  assert.deepEqual(nativeCalls, { readRegistration: 0, getDeviceToken: 0, updateRegistration: 0, clearResponse: 0 });
});

test('ordinary facade loads SDK once and preserves exact references, synchronous throws, returns and disposal', async () => {
  const calls = [];
  const removed = [];
  const response = { notification: { request: { identifier: 'ordinary-response' } } };
  const permissions = Promise.resolve({ status: 'granted' });
  const token = Promise.resolve({ type: 'expo', data: 'original-token' });
  const scheduled = Promise.resolve('original-id');
  const channel = Promise.resolve({ id: 'default' });
  const failure = new Error('original SDK error');
  const sdk = {
    setNotificationHandler: (...args) => calls.push(['handler', ...args]),
    getPermissionsAsync: () => permissions,
    requestPermissionsAsync: () => {
      throw failure;
    },
    getExpoPushTokenAsync: () => token,
    setNotificationChannelAsync: () => channel,
    scheduleNotificationAsync: () => scheduled,
    addNotificationReceivedListener: (callback) => ({ remove: () => removed.push(callback) }),
    addNotificationResponseReceivedListener: (callback) => ({ remove: () => removed.push(callback) }),
    getLastNotificationResponseAsync: () => Promise.resolve(response),
    clearLastNotificationResponseAsync: () => Promise.reject(failure),
    IosAuthorizationStatus: { PROVISIONAL: 3 },
    AndroidImportance: { MAX: 7 },
  };
  const loader = loadFacade(false, () => sdk);
  const api = loader.load();
  assert.equal(loader.load(), api);
  assert.equal(loader.sdkLoads(), 1);
  assert.deepEqual(Object.keys(api).sort(), Object.keys(sdk).sort());
  for (const key of Object.keys(sdk)) assert.equal(api[key], sdk[key], key);
  const handler = {};
  api.setNotificationHandler(handler);
  assert.equal(calls[0][1], handler);
  assert.equal(api.getPermissionsAsync(), permissions);
  assert.throws(
    () => api.requestPermissionsAsync(),
    (error) => error === failure,
  );
  assert.equal(api.getExpoPushTokenAsync(), token);
  assert.equal(api.setNotificationChannelAsync(), channel);
  assert.equal(api.scheduleNotificationAsync(), scheduled);
  assert.equal(await api.getLastNotificationResponseAsync(), response);
  await assert.rejects(api.clearLastNotificationResponseAsync(), (error) => error === failure);
  const receive = () => {};
  const respond = () => {};
  api.addNotificationReceivedListener(receive).remove();
  api.addNotificationResponseReceivedListener(respond).remove();
  assert.deepEqual(removed, [receive, respond]);
});

test('all eight consumers use the facade and app runtime has no other SDK imports, exports or requires', () => {
  for (const file of consumers) {
    const text = fs.readFileSync(path.join(mobile, file), 'utf8');
    assert.match(text, /import \* as Notifications from '[^']*utils\/notifications';/, file);
  }
  function scan(filename) {
    if (fs.statSync(filename).isDirectory()) {
      if (!['__tests__', 'node_modules'].includes(path.basename(filename)))
        for (const child of fs.readdirSync(filename)) scan(path.join(filename, child));
      return;
    }
    if (!/\.tsx?$/.test(filename) || filename === facadeFile) return;
    const ast = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true);
    function visit(node) {
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier &&
        /^expo-notifications(?:\/|$)/.test(node.moduleSpecifier.text)
      ) {
        const typeOnly = ts.isImportDeclaration(node) ? node.importClause?.isTypeOnly : node.isTypeOnly;
        assert.equal(typeOnly, true, 'Runtime SDK import/export outside facade: ' + filename);
      }
      if (ts.isCallExpression(node) && node.arguments[0] && ts.isStringLiteral(node.arguments[0]))
        assert.doesNotMatch(node.arguments[0].text, /^expo-notifications(?:\/|$)/, filename);
      ts.forEachChild(node, visit);
    }
    visit(ast);
  }
  scan(path.join(mobile, 'App.tsx'));
  scan(path.join(mobile, 'src'));
});

test('both actual internal settings screens render an unavailable state without permission, push, query or OS actions', () => {
  const palette = { bg: { canvas: '#fff' }, text: { primary: '#111', secondary: '#444' } };
  const forbidden = (name) => () => {
    throw new Error('Internal settings accessed ' + name);
  };
  const shade = new Proxy({}, { get: () => '#444' });
  const theme = {
    colors: new Proxy({}, { get: (_target, key) => (key === 'white' ? '#fff' : shade) }),
    spacing: shade,
    borderRadius: shade,
    fontSize: shade,
    fontWeight: shade,
  };
  for (const file of [
    'src/screens/NotificationSettingsScreen.tsx',
    'src/screens/admin/AdminReminderSettingsScreen.tsx',
  ]) {
    const screen = evaluate(path.join(mobile, file), (name) => {
      if (name === 'react') return { ...React, default: React };
      if (name === 'react-native')
        return {
          View: 'View',
          Platform: { OS: 'ios' },
          StyleSheet: { create: (styles) => styles },
          Linking: { openSettings: forbidden('OS Settings') },
          AppState: { addEventListener: forbidden('OS listener') },
        };
      if (name.endsWith('/runtimeEnvironment')) return { inventoryInternal: true };
      if (name.endsWith('/notifications')) return loadFacade(true, forbidden('SDK evaluation')).load();
      if (name === '@expo/vector-icons') return { Ionicons: 'Icon' };
      if (name === '@react-navigation/native')
        return { useNavigation: () => ({ goBack() {} }), useFocusEffect: forbidden('permission focus effect') };
      if (name === '@tanstack/react-query')
        return {
          useQuery: forbidden('query'),
          useMutation: forbidden('mutation'),
          useQueryClient: forbidden('query client'),
        };
      if (name.endsWith('/ThemeContext')) return { useColors: () => palette };
      if (name.endsWith('/Typography')) return { Text: 'Text' };
      if (name.endsWith('/IosScreenHeader')) return { default: 'Header' };
      if (name.endsWith('/theme')) return theme;
      if (name === './AdminUI') return { AdminPage: 'AdminPage', AdminGroup: 'AdminGroup', AdminRow: 'AdminRow' };
      if (name === './usePlatformData') return { usePlatformSession: forbidden('platform session/query') };
      return {};
    }).default;
    function render(node) {
      if (!React.isValidElement(node)) return [node];
      if (typeof node.type === 'function') return render(node.type(node.props));
      return [node, ...React.Children.toArray(node.props.children).flatMap(render)];
    }
    const tree = render(React.createElement(screen));
    const text = tree.filter((node) => typeof node === 'string').join(' ');
    assert.match(text, /внутренней сборке склада/);
    assert.match(text, /недоступны/);
    for (const node of tree.filter(React.isValidElement)) {
      assert.equal(node.props.onPress, undefined, file);
      assert.equal(node.props.onValueChange, undefined, file);
      assert.equal(node.props.onRefresh, undefined, file);
    }
  }
});
