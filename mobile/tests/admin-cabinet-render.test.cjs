const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const base = path.join(__dirname, '../src');
const hooks = {
  ...React,
  useMemo: (fn) => fn(),
  useCallback: (fn) => fn,
  useEffect: (fn) => fn(),
  useRef: (value) => ({ current: value }),
  useState: (value) => [typeof value === 'function' ? value() : value, () => {}],
};
const palette = {
  bg: { card: '#fff', canvas: '#fff' },
  text: { primary: '#111', secondary: '#444', tertiary: '#666' },
  accent: { primary: '#00f', primaryText: '#00f' },
  border: { subtle: '#eee' },
};
let currentSession = true,
  appStateListener,
  refetchCount = 0;
let os = 'ios',
  nativeAvailable = true,
  role = 'superadmin',
  calls = [],
  queries = [];
const navigationCalls = [];
const all = (node) =>
  node && typeof node === 'object' && node.props
    ? [node, ...React.Children.toArray(node.props.children).flatMap(all)]
    : [];
const session = {
  data: { key: 'operator-A', generation: 1 },
  isCurrent: () => currentSession,
  manager: {
    summary: async () => {
      calls.push('manager.summary');
      return { data: {} };
    },
    analytics: async () => {
      calls.push('manager.analytics');
      return { data: { monthly: [] } };
    },
  },
  tenants: {
    getStats: async () => {
      calls.push('global.stats');
      return { data: {} };
    },
    getAll: async () => {
      calls.push('global.tenants');
      return { data: [] };
    },
  },
  admin: {
    getSubscriptionRevenue: async () => {
      calls.push('global.revenue');
      return { data: {} };
    },
  },
};
function load(relative) {
  const filename =
    relative === 'navigation/AdminShellNavigator.tsx' && process.env.AUTEXA_ADMIN_SHELL_SOURCE_TEST_ONLY
      ? process.env.AUTEXA_ADMIN_SHELL_SOURCE_TEST_ONLY
      : path.join(base, relative);
  const result = { exports: {} };
  const requireMock = (name) => {
    if (name === 'react') return { ...hooks, default: hooks };
    if (name === 'react-native')
      return {
        AppState: {
          addEventListener: (_, fn) => {
            appStateListener = fn;
            return { remove() {} };
          },
        },
        View: 'View',
        Pressable: 'Pressable',
        Platform: { OS: os },
        StyleSheet: { create: (s) => s, absoluteFillObject: {}, hairlineWidth: 0.5 },
      };
    if (name === 'react-native-safe-area-context')
      return { SafeAreaView: 'SafeAreaView', useSafeAreaInsets: () => ({ bottom: 34 }) };
    if (name === '@react-navigation/bottom-tabs')
      return {
        BottomTabBar: 'BottomTabBar',
        createBottomTabNavigator: () => ({ Navigator: 'TabNavigator', Screen: 'TabScreen' }),
      };
    if (name === '@react-navigation/native-stack')
      return { createNativeStackNavigator: () => ({ Navigator: 'StackNavigator', Screen: 'StackScreen' }) };
    if (name === '@react-navigation/native')
      return {
        useNavigation: () => ({ navigate: (...args) => navigationCalls.push(args), goBack() {}, setParams() {} }),
        useRoute: () => ({ params: {} }),
        useFocusEffect: (fn) => fn(),
      };
    if (name === 'autexa-liquid-glass')
      return {
        AutexaLiquidGlassTabBar: 'NativeGlassBar',
        isAutexaNativeTabBarAvailable: () => nativeAvailable,
      };
    if (name.endsWith('/theme'))
      return {
        spacing: Object.fromEntries(Array.from({ length: 17 }, (_, i) => [i / 2, i * 2])),
        borderRadius: { lg: 12, xl: 16, '2xl': 24 },
        colors: { white: '#fff', primary: { 600: '#00f' }, red: { 50: '#fee', 600: '#d00' } },
      };
    if (name.endsWith('/AuthContext'))
      return {
        useAuth: () => ({ user: { id: 'operator-A', role }, token: 'test-only', savedAccounts: [], logout() {} }),
      };
    if (name.endsWith('/Typography')) return { Text: 'Text' };
    if (name.endsWith('/Icon')) return { Icon: 'Icon' };
    if (name.endsWith('/haptics')) return { haptic: () => {} };
    if (name.endsWith('/ThemeContext'))
      return {
        useColors: () => palette,
        useThemeMode: () => ({ mode: 'light', toggle() {} }),
      };
    if (name.endsWith('/iosSurface')) return { useIosSurface: () => ({ card: {}, cardCompact: {} }) };
    if (name.endsWith('/KeyboardAware')) return { KeyboardAwareScroll: 'KeyboardAwareScroll' };
    if (name.endsWith('/ScreenSectionHeader'))
      return { useScreenSectionScroll: () => ({ contentTop: 186, onScroll() {} }) };
    if (name.endsWith('/TabBarScrollable')) return { TabBarScrollView: 'TabBarScrollView' };
    if (name.endsWith('/useAdminTabBarHeight'))
      return {
        ADMIN_BAR_HEIGHT: 60,
        ADMIN_BAR_TOP_LIFT: 6,
        ADMIN_BAR_BOTTOM_LIFT: 8,
        ADMIN_BAR_HORIZONTAL_MARGIN: 14,
        useAdminTabBarScrollInsets: () => ({ contentContainerPaddingBottom: 100 }),
      };
    if (name === './adminTabs') return load('navigation/adminTabs.ts');
    if (name === './accountPickerNavigation') return load('navigation/accountPickerNavigation.ts');
    if (name.endsWith('/adminShared'))
      return {
        useAdminMode: () => role,
        AdminModeProvider: 'ModeProvider',
        formatMoneyExact: String,
        formatDate: String,
        formatMonthShort: String,
      };
    if (name === './usePlatformData')
      return {
        usePlatformSession: () => ({ session, allowed: role === 'manager' || role === 'superadmin', role }),
        usePlatformReminders: () => ({ data: null }),
      };
    if (name === '@tanstack/react-query')
      return {
        useQueryClient: () => ({ invalidateQueries: async () => {} }),
        useInfiniteQuery: (options) => {
          queries.push(options);
          return {
            data: undefined,
            isPending: false,
            isError: false,
            refetch: () => {
              refetchCount++;
              return Promise.resolve({});
            },
          };
        },
        useQuery: (options) => {
          queries.push(options);
          return { data: undefined, isPending: false, isError: false, refetch: () => {} };
        },
      };
    if (name === './platformSession')
      return {
        assertPlatformSession: (_session, authorized = true) => {
          if (!authorized || !currentSession) throw new Error('stale');
        },
      };
    if (name === './AdminUI')
      return {
        adminUIStyles: { input: {} },
        ...Object.fromEntries(
          ['AdminPage', 'AdminAmount', 'AdminGroup', 'AdminRow', 'AdminHeading', 'AdminState', 'AdminAction'].map(
            (n) => [n, n],
          ),
        ),
      };
    return { default: name, screenErrorBoundaryLayout: () => {} };
  };
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.React,
        target: ts.ScriptTarget.ES2020,
        esModuleInterop: true,
      },
    }).outputText,
    { ...result, require: requireMock },
  );
  return result.exports;
}
function renderFunctions(node) {
  if (!node || typeof node !== 'object' || !node.props) return node;
  if (typeof node.type === 'function') return renderFunctions(node.type(node.props));
  return React.cloneElement(node, {}, ...React.Children.toArray(node.props.children).map(renderFunctions));
}
function bar(mode) {
  role = mode;
  const names =
    mode === 'manager'
      ? ['AdminOverview', 'AdminTenants', 'AdminIncome', 'AdminMore']
      : ['AdminOverview', 'AdminTenants', 'AdminAnalytics', 'AdminTeam', 'AdminMore'];
  const emitted = [],
    navigated = [],
    dispatched = [];
  const props = {
    mode,
    state: { index: 0, routes: names.map((name) => ({ name, key: name + '-key' })) },
    descriptors: Object.fromEntries(names.map((n) => [n + '-key', { options: {} }])),
    insets: { bottom: 34 },
    navigation: {
      emit: (e) => {
        emitted.push(e);
        return { defaultPrevented: false };
      },
      navigate: (n) => navigated.push(n),
      dispatch: (a) => dispatched.push(a),
    },
  };
  return { tree: load('navigation/AdminTabBar.tsx').default(props), props, emitted, navigated, dispatched };
}
test('actual iOS bar renders native bridge with 5/4 equal slots, maps taps and preserves active re-taps', () => {
  os = 'ios';
  for (const mode of ['superadmin', 'manager']) {
    const b = bar(mode),
      native = all(b.tree).find((n) => n.type === 'NativeGlassBar');
    assert.equal(native.props.tabCount, mode === 'manager' ? 4 : 5);
    native.props.onTabPress(2);
    native.props.onTabPress(0);
    native.props.onTabPress(99);
    assert.deepEqual(b.navigated, [mode === 'manager' ? 'AdminIncome' : 'AdminAnalytics']);
    assert.equal(b.emitted.length, 2);
    assert.equal(b.emitted[1].canPreventDefault, true);
    b.props.navigation.emit = () => ({ defaultPrevented: true });
    native.props.onTabPress(1);
    assert.equal(b.navigated.length, 1);
    const more = all(b.tree).find((n) => n.type === 'Pressable');
    more.props.onPressIn();
    more.props.onLongPress();
    more.props.onPress();
    assert.equal(more.props.delayLongPress, 360);
    assert.equal(b.dispatched.length, 1);
    assert.equal(b.navigated.length, 1);
  }
});
test('Android uses standard React Navigation BottomTabBar and role labels', () => {
  os = 'android';
  const b = bar('manager');
  assert.equal(b.tree.type, 'BottomTabBar');
  assert.equal(b.tree.props.descriptors['AdminIncome-key'].options.tabBarLabel, 'Доход');
});
test('actual navigator renders exact top-level IA and excludes admin routes from manager stack', () => {
  for (const mode of ['superadmin', 'manager']) {
    role = mode;
    const tree = load('navigation/AdminShellNavigator.tsx').default({ mode });
    const screens = all(tree).filter((n) => n.type === 'TabScreen');
    assert.deepEqual(
      screens.map((s) => s.props.name),
      mode === 'manager'
        ? ['AdminOverview', 'AdminTenants', 'AdminIncome', 'AdminMore']
        : ['AdminOverview', 'AdminTenants', 'AdminAnalytics', 'AdminTeam', 'AdminMore'],
    );
    const stack = renderFunctions(screens[0].props.component({}));
    const routes = all(stack)
      .filter((n) => n.type === 'StackScreen')
      .map((n) => n.props.name);
    assert.ok(routes.includes('AdminReminders'));
    assert.ok(routes.includes('AdminTenantDetail'));
    assert.equal(routes.includes('AdminPlans'), mode === 'superadmin');
    assert.equal(routes.includes('AdminBroadcast'), mode === 'superadmin');
  }
});
test('manager overview and income issue only own-data requests; superadmin analytics never fetches manager summary', async () => {
  for (const [file, mode, expected] of [
    ['AdminOverviewScreen.tsx', 'manager', ['manager.summary']],
    ['AdminIncomeScreen.tsx', 'manager', ['manager.summary', 'manager.analytics']],
    ['AdminAnalyticsScreen.tsx', 'superadmin', ['global.revenue', 'global.stats']],
  ]) {
    role = mode;
    calls = [];
    queries = [];
    renderFunctions(load('screens/admin/' + file).default({}));
    await Promise.all(queries.filter((q) => q.enabled).map((q) => q.queryFn()));
    assert.deepEqual(calls.sort(), expected.sort());
  }
});

test('primary amount stays in its own adaptive row for narrow screens and long currency values', () => {
  const value = '999 999 999 999,99 ₽';
  const tree = load('screens/admin/AdminUI.tsx').AdminAmount({ label: 'Собрано за месяц', value });
  const amount = all(tree).find((node) => node.type === 'Text' && node.props.children === value);
  assert.ok(amount);
  assert.equal(amount.props.adjustsFontSizeToFit, true);
  assert.equal(amount.props.numberOfLines, 1);
  assert.equal(amount.props.style.width, '100%');
  assert.equal(tree.props.style.height, undefined);
});

test('notes page uses offset pagination, refreshes on focus/resume and rejects a response after account switch', async () => {
  role = 'manager';
  os = 'ios';
  currentSession = true;
  queries = [];
  refetchCount = 0;
  let finish;
  session.manager.notes = async (_id, params) => {
    assert.equal(params.limit, 20);
    assert.equal(params.offset, 20);
    return new Promise((resolve) => {
      finish = resolve;
    });
  };
  const component = load('screens/admin/TenantNotes.tsx').default;
  const first = component({ tenantId: 'A' });
  renderFunctions(first);
  assert.equal(refetchCount, 1);
  appStateListener('active');
  assert.equal(refetchCount, 2);
  const query = queries[0];
  assert.equal(query.getNextPageParam({ items: [{}], total: 21 }, [{ items: Array(20).fill({}), total: 21 }]), 20);
  assert.equal(query.getNextPageParam({ items: [], total: 21 }, [{ items: Array(20).fill({}), total: 21 }]), undefined);
  const pending = query.queryFn({ pageParam: 20 });
  currentSession = false;
  finish({ data: { items: [], total: 0, nextContactAt: null } });
  await assert.rejects(pending, /stale/);
  currentSession = true;
  session.data.generation++;
  const next = component({ tenantId: 'A' });
  assert.notEqual(first.key, next.key);
});

test('unauthorized analytics and income routes never dispatch their queries, including explicit refreshes', async () => {
  for (const [file, mode] of [
    ['AdminAnalyticsScreen.tsx', 'manager'],
    ['AdminIncomeScreen.tsx', 'superadmin'],
  ]) {
    role = mode;
    queries = [];
    calls = [];
    currentSession = true;
    renderFunctions(load('screens/admin/' + file).default({}));
    assert.ok(queries.every((query) => query.enabled === false));
    for (const query of queries) await assert.rejects(query.queryFn(), /stale/);
    assert.deepEqual(calls, []);
  }
});

test('an unavailable native bridge retains functional standard role navigation', () => {
  os = 'ios';
  nativeAvailable = false;
  try {
    const b = bar('superadmin');
    assert.equal(b.tree.type, 'BottomTabBar');
    assert.equal(b.tree.props.descriptors['AdminAnalytics-key'].options.tabBarLabel, 'Аналитика');
  } finally {
    nativeAvailable = true;
  }
});

test('registration requests opened from More stay in the same navigation stack', () => {
  role = 'superadmin';
  navigationCalls.length = 0;
  const tree = load('screens/admin/AdminMoreScreen.tsx').default();
  const button = all(tree).find(
    (node) =>
      node.type === 'Pressable' &&
      all(node).some((child) => child.type === 'Text' && child.props.children === 'Заявки на регистрацию'),
  );
  assert.ok(button, 'registration requests action must remain available');
  button.props.onPress();
  assert.deepEqual(navigationCalls, [['AdminRegistrationRequests']]);
});

test('admin pages with editable fields use the common keyboard and tab-bar reservation host', () => {
  const tree = load('screens/admin/AdminUI.tsx').AdminPage({ title: 'Настройки', children: 'fields' });
  const scroller = all(tree).find((node) => node.type === 'KeyboardAwareScroll');
  assert.ok(scroller, 'inputs must be lifted above the keyboard');
  assert.ok(scroller.props.extraKeyboardBottomOffset > 0);
  assert.equal(scroller.props.reserveTabBar, undefined, 'common navigation reservation remains enabled by default');
  assert.equal(
    scroller.props.reserveSafeAreaBottom,
    true,
    'standalone forms keep their bottom safe area inside content',
  );
  assert.equal(scroller.props.contentInsetAdjustmentBehavior, 'never');
  assert.equal(scroller.props.scrollEventThrottle, 16);
  assert.equal(typeof scroller.props.onScroll, 'function');
  assert.equal(
    scroller.props.contentContainerStyle[1].paddingTop,
    202,
    'measured heading and controls reserve content, not the viewport',
  );
});

test('native capability reads actual registration metadata before accepting an Expo wrapper', () => {
  const filename = path.join(__dirname, '../modules/autexa-liquid-glass/src/AutexaLiquidGlassTabBar.tsx');
  for (const item of [
    { metadata: undefined, expected: false },
    { metadata: {}, expected: false },
    { metadata: { AutexaLiquidGlass: {} }, expected: false },
    { metadata: { AutexaLiquidGlassTabBar: {} }, expected: true },
    { metadata: { AutexaLiquidGlassTabBar: {} }, throws: true, expected: false },
  ]) {
    const result = { exports: {} };
    let calls = 0;
    vm.runInNewContext(
      ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          jsx: ts.JsxEmit.React,
          target: ts.ScriptTarget.ES2020,
          esModuleInterop: true,
        },
      }).outputText,
      {
        ...result,
        require(name) {
          if (name === 'react') return React;
          if (name === 'react-native')
            return {
              Platform: { OS: 'ios' },
              NativeModules: { NativeUnimoduleProxy: { viewManagersMetadata: item.metadata } },
            };
          if (name === 'expo-blur') return { BlurView: 'BlurView' };
          if (name === 'expo-modules-core')
            return {
              requireNativeViewManager() {
                calls++;
                if (item.throws) throw new Error('missing native manager');
                // Matches Expo 54: missing native registration need not throw here.
                return function NativeComponent() {};
              },
            };
          throw new Error('Unexpected native capability test dependency');
        },
      },
    );
    assert.equal(result.exports.isAutexaNativeTabBarAvailable(), item.expected);
    if (!item.metadata?.AutexaLiquidGlassTabBar) assert.equal(calls, 0);
  }
});
