import fs from 'fs';
import path from 'path';
import vm from 'vm';
import ts from 'typescript';

type Element = { type: unknown; props: Record<string, unknown> & { children?: unknown } };
type Section = {
  scrollY: { value: number };
  progress: { readonly value: number };
  onScroll: (event: { nativeEvent: { contentOffset: { y: number } } }) => void;
};
type MemoSlot<T> = { deps: unknown[]; value: T };
type EffectSlot = { deps: unknown[]; cleanup?: () => void };
const repository = path.resolve(__dirname, '../../../..');

function sourcePath(relative: string) {
  const snapshot = process.env.AUTEXA_SECTION_REPAIR_BASELINE;
  const candidate = snapshot ? path.join(snapshot, relative) : undefined;
  return candidate && fs.existsSync(candidate) ? candidate : path.join(repository, relative);
}

function elements(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(elements);
  if (!value || typeof value !== 'object' || !('props' in value)) return [];
  const node = value as Element;
  return [node, ...elements(node.props.children)];
}

function words(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(words).join('');
  return value && typeof value === 'object' && 'props' in value ? words((value as Element).props.children) : '';
}

/** Actual screen and actual scroll hook; native hosts/API are inert, as in the independent QA probe. */
function harness() {
  let index = 0;
  const slots: unknown[] = [];
  const pending: (() => void)[] = [];
  let rows: { id: string; name: string }[] | undefined = [{ id: 'supplier-1', name: 'Supplier' }];
  let loading = false;
  let section: Section | undefined;
  const same = (a: unknown[] | undefined, b: unknown[]) =>
    !!a && a.length === b.length && a.every((value, offset) => Object.is(value, b[offset]));
  function state<T>(initial: T | (() => T)): [T, (next: T | ((previous: T) => T)) => void] {
    const slot = index++;
    if (!(slot in slots)) slots[slot] = typeof initial === 'function' ? (initial as () => T)() : initial;
    return [
      slots[slot] as T,
      (next) => {
        slots[slot] = typeof next === 'function' ? (next as (previous: T) => T)(slots[slot] as T) : next;
      },
    ];
  }
  function memo<T>(factory: () => T, deps: unknown[]): T {
    const slot = index++;
    const previous = slots[slot] as MemoSlot<T> | undefined;
    if (!previous || !same(previous.deps, deps)) slots[slot] = { deps, value: factory() };
    return (slots[slot] as MemoSlot<T>).value;
  }
  function effect(callback: () => void | (() => void), deps: unknown[]) {
    const slot = index++;
    const previous = slots[slot] as EffectSlot | undefined;
    if (!previous || !same(previous.deps, deps)) {
      pending.push(() => {
        previous?.cleanup?.();
        slots[slot] = { deps, cleanup: callback() };
      });
    }
  }
  const React = {
    createElement: (type: unknown, props: Record<string, unknown> | null, ...children: unknown[]) => ({
      type,
      props: { ...props, children: children.length === 1 ? children[0] : children },
    }),
    memo: (component: unknown) => component,
    Fragment: 'Fragment',
    useState: state,
    useRef: <T,>(initial: T) => memo(() => ({ current: initial }), []),
    useMemo: memo,
    useCallback: <T,>(callback: T, deps: unknown[]) => memo(() => callback, deps),
    useEffect: effect,
    useLayoutEffect: effect,
    Children: { toArray: (value: unknown) => [value].flat().filter((child) => child !== false && child != null) },
  };
  const palette = {
    mode: 'light',
    bg: { canvas: '#fff', card: '#fff', muted: '#eee', elevated: '#fff' },
    border: { subtle: '#ddd', strong: '#bbb' },
    text: { primary: '#111', secondary: '#555', tertiary: '#888' },
    accent: { primary: '#36c' },
  };
  const cache = new Map<string, { exports: Record<string, unknown> }>();
  function load(filename: string): Record<string, unknown> {
    const previous = cache.get(filename);
    if (previous) return previous.exports;
    const module = { exports: {} };
    cache.set(filename, module);
    const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: {
        jsx: ts.JsxEmit.React,
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        esModuleInterop: true,
      },
    }).outputText;
    const evaluate = vm.runInNewContext(`(function(require,module,exports){${compiled}\n})`, {
      console,
      setTimeout,
      clearTimeout,
    }) as (require: (name: string) => unknown, module: object, exports: object) => void;
    evaluate((name) => requireModule(name, filename), module, module.exports);
    return module.exports;
  }
  function requireModule(name: string, from: string): unknown {
    if (name === 'react') return { ...React, __esModule: true, default: React };
    if (name === 'react-native')
      return {
        Platform: { OS: 'ios' },
        StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
        useWindowDimensions: () => ({ width: 402, height: 874, fontScale: 1 }),
        View: 'View',
        Text: 'Text',
        Pressable: 'Pressable',
        TouchableOpacity: 'TouchableOpacity',
        TextInput: 'TextInput',
        RefreshControl: 'RefreshControl',
        ActivityIndicator: 'ActivityIndicator',
        Alert: { alert: jest.fn() },
      };
    if (name === 'react-native-reanimated')
      return {
        __esModule: true,
        default: { View: 'Animated.View' },
        useSharedValue: <T,>(initial: T) => React.useRef({ value: initial }).current,
        useDerivedValue: (derive: () => unknown) => ({
          get value() {
            return derive();
          },
        }),
        useAnimatedScrollHandler: (handler: (event: unknown) => void) =>
          React.useCallback((event: { nativeEvent?: unknown }) => handler(event.nativeEvent ?? event), []),
        useAnimatedReaction: jest.fn(),
        useAnimatedStyle: (style: () => unknown) => style(),
        runOnJS: (callback: unknown) => callback,
      };
    if (name === 'react-native-safe-area-context')
      return { useSafeAreaInsets: () => ({ top: 62, bottom: 34, left: 0, right: 0 }) };
    if (name.includes('ThemeContext')) return { useColors: () => palette };
    if (name.includes('screenSectionGeometry')) return load(path.resolve(path.dirname(from), name) + '.ts');
    if (name.includes('ScreenSectionHeader')) {
      const module = load(sourcePath('mobile/src/components/ScreenSectionHeader.tsx'));
      return {
        ...module,
        useScreenSectionScroll: (...args: unknown[]) => {
          section = (module.useScreenSectionScroll as (...input: unknown[]) => Section)(...args);
          return section;
        },
      };
    }
    if (name.includes('ScreenSectionScrollable'))
      return { ScreenSectionScrollView: 'ScreenSectionScrollView', ScreenSectionFlashList: 'ScreenSectionFlashList' };
    if (name.includes('ScreenHeaderControls'))
      return {
        HeaderIsland: 'HeaderIsland',
        HeaderAction: 'HeaderAction',
        HeaderSearch: 'HeaderSearch',
        headerTouchSize: 44,
      };
    if (name === '@tanstack/react-query')
      return {
        useQuery: () => ({ data: rows, isLoading: loading, isFetching: false, dataUpdatedAt: 1 }),
        useMutation: () => ({ isPending: false }),
        useQueryClient: () => ({}),
      };
    if (name === '@react-navigation/native')
      return { useNavigation: () => ({ goBack: jest.fn(), navigate: jest.fn() }) };
    if (name.includes('AuthContext')) return { useAuth: () => ({ hasPermission: () => true }) };
    if (name.includes('/platform/haptics')) return { haptic: jest.fn() };
    if (name.includes('useTabBarHeight')) return { useTabBarHeight: () => 90 };
    if (name.endsWith('/theme'))
      return {
        colors: new Proxy({}, { get: () => new Proxy({}, { get: () => '#999' }) }),
        fontSize: { sm: 13, base: 16 },
        fontWeight: { semibold: '600' },
        borderRadius: { lg: 12 },
        spacing: new Proxy({}, { get: (_target, key) => Number(key) * 4 }),
        softTint: () => '#eee',
      };
    return new Proxy<Record<string, unknown>>(
      { __esModule: true, default: name },
      { get: (object, key) => object[String(key)] ?? String(key) },
    );
  }
  const Screen = load(sourcePath('mobile/src/screens/SuppliersScreen.tsx')).default as () => Element;
  return {
    render: () => {
      index = 0;
      const tree = Screen();
      pending.splice(0).forEach((run) => run());
      return tree;
    },
    setRows: (value: typeof rows, isLoading = false) => {
      rows = value;
      loading = isLoading;
    },
    get section() {
      if (!section) throw new Error('Actual screen did not create a section controller');
      return section;
    },
    header: (props: Record<string, unknown>) => {
      const Header = load(sourcePath('mobile/src/components/IosScreenHeader.tsx')).default as (
        input: Record<string, unknown>,
      ) => Element;
      return Header(props);
    },
  };
}

const at = (tree: unknown, type: string) => {
  const node = elements(tree).find((element) => element.type === type);
  if (!node) throw new Error(`Missing actual rendered ${type}`);
  return node;
};
const scroll = (node: Element, y: number) =>
  (node.props.onScroll as Section['onScroll'])({ nativeEvent: { contentOffset: { y } } });

test('replacing a populated supplier FlashList with an empty native ScrollView resets actual header offset 400 to 0', () => {
  const h = harness();
  scroll(at(h.render(), 'ScreenSectionFlashList'), 400);
  expect(h.section.scrollY.value).toBe(400);
  h.setRows([]);
  at(h.render(), 'ScreenSectionScrollView');
  expect(h.section.scrollY.value).toBe(0);
  expect(h.section.progress.value).toBe(0);
});

test('search and ordinary data refresh preserve offset while the existing FlashList remains mounted', () => {
  const h = harness();
  const tree = h.render();
  scroll(at(tree, 'ScreenSectionFlashList'), 400);
  (at(tree, 'HeaderSearch').props.onChange as (value: string) => void)('second');
  h.setRows([{ id: 'supplier-2', name: 'Second supplier' }]);
  at(h.render(), 'ScreenSectionFlashList');
  expect(h.section.scrollY.value).toBe(400);
});

test('changing state content without replacing its native ScrollView preserves its offset', () => {
  const h = harness();
  h.setRows(undefined, true);
  scroll(at(h.render(), 'ScreenSectionScrollView'), 140);
  h.setRows([]);
  at(h.render(), 'ScreenSectionScrollView');
  expect(h.section.scrollY.value).toBe(140);
});

test('background supplier data cannot reset the active embedded order controller', () => {
  const h = harness();
  const tree = h.render();
  scroll(at(tree, 'ScreenSectionFlashList'), 400);
  const orders = elements(tree).find((node) => node.type === 'TouchableOpacity' && words(node) === 'Заказы');
  expect(orders).toBeDefined();
  (orders!.props.onPress as () => void)();
  const embedded = at(h.render(), './PurchaseOrdersScreen');
  expect(embedded.props.sectionController).toBe(h.section);
  expect(h.section.scrollY.value).toBe(0);
  h.section.onScroll({ nativeEvent: { contentOffset: { y: 260 } } });
  h.setRows([]);
  h.render();
  expect(h.section.scrollY.value).toBe(260);
});

test('a scrolling Back-only island uses intrinsic width and preserves the original Back handler', () => {
  const h = harness();
  h.render();
  const onBack = jest.fn();
  const tree = h.header({ title: 'Form', scroll: h.section, onBack });
  expect(at(tree, 'HeaderIsland').props.style).toEqual({ alignSelf: 'flex-start' });
  expect(at(tree, 'HeaderAction').props.onPress).toBe(onBack);
});

test.each([{ leading: 'custom leading' }, { trailing: 'save' }, { sectionVariant: 'static' }])(
  'compound/static islands keep their existing layout: %j',
  (variant) => {
    const h = harness();
    h.render();
    const tree = h.header({ title: 'Form', scroll: h.section, onBack: jest.fn(), ...variant });
    expect(at(tree, 'HeaderIsland').props.style).toBeUndefined();
  },
);

test('the legacy non-scrolling header does not gain the section island', () => {
  const h = harness();
  expect(elements(h.header({ title: 'Legacy', onBack: jest.fn() })).some((node) => node.type === 'HeaderIsland')).toBe(
    false,
  );
});
