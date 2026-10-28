import fs from 'fs';
import path from 'path';
import ts from 'typescript';

type Node = { type: string; props: Record<string, unknown> & { children?: unknown } };
type Item = { id: string; label: string; selected?: boolean; onSelect: () => void };
const file = path.join(__dirname, '../ClientsScreen.tsx');
const source = ts.createSourceFile(
  file,
  fs.readFileSync(file, 'utf8'),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
let island: ts.JsxElement | undefined;
function visit(node: ts.Node) {
  if (ts.isJsxElement(node) && node.openingElement.tagName.getText(source) === 'HeaderIsland') island = node;
  ts.forEachChild(node, visit);
}
visit(source);
if (!island) throw new Error('Missing actual Clients header composition');
const compiled = ts.transpileModule(`const result = (${island.getText(source)});`, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React },
}).outputText;

function nodes(value: unknown): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== 'object' || !('props' in value)) return [];
  const node = value as Node;
  return [node, ...nodes(node.props.children)];
}

/** Evaluate actual presentation JSX; callers' setters/actions remain observable fixtures. */
function render(mode: 'client' | 'plate' = 'client') {
  let filter = 'all';
  let sourceFilter: string | null = null;
  const sourcePicker = jest.fn();
  const add = jest.fn();
  const toggle = jest.fn();
  const search = jest.fn();
  const plateSearch = jest.fn();
  const plateMode = jest.fn();
  const createElement = (type: string, props: Record<string, unknown> | null, ...children: unknown[]) => ({
    type,
    props: { ...props, children },
  });
  const tree = () => {
    const scope = {
      React: { createElement, Fragment: 'Fragment' },
      HeaderIsland: 'HeaderIsland',
      HeaderAction: 'HeaderAction',
      HeaderSearch: 'HeaderSearch',
      ScreenHeaderMenu: 'HeaderMenu',
      View: 'View',
      Text: 'Text',
      PlateModeSwitcher: 'PlateModeSwitcher',
      RussianPlateInput: 'RussianPlateInput',
      styles: new Proxy({}, { get: () => ({}) }),
      palette: { text: { secondary: '#555' } },
      mode,
      search: '',
      setSearch: search,
      plateSearch: 'А123АА77',
      setPlateSearch: plateSearch,
      plateMode: 'ru',
      setPlateMode: plateMode,
      vinEnabled: true,
      filter,
      sourceFilter,
      setFilter: (next: string | ((previous: string) => string)) => {
        filter = typeof next === 'function' ? next(filter) : next;
      },
      setSourceFilter: (value: string | null) => {
        sourceFilter = value;
      },
      setSourceFilterOpen: sourcePicker,
      openCreateModal: add,
      toggleMode: toggle,
      navigation: { goBack: jest.fn() },
      haptic: jest.fn(),
    };
    return Function(...Object.keys(scope), `${compiled}; return result;`)(...Object.values(scope)) as Node;
  };
  const menu = () => nodes(tree()).find((node) => node.type === 'HeaderMenu')!;
  return {
    tree,
    menu,
    select: (id: string) => {
      const item = (menu().props.items as (Item | null | false)[]).find((entry) => entry && entry.id === id);
      if (!item) throw new Error(`Missing filter ${id}`);
      item.onSelect();
    },
    get filter() {
      return filter;
    },
    get sourceFilter() {
      return sourceFilter;
    },
    setSource: (value: string) => {
      filter = 'source';
      sourceFilter = value;
    },
    sourcePicker,
    add,
    toggle,
    search,
    plateSearch,
    plateMode,
  };
}

test('people mode keeps visible search and Add, with all previous filter choices in one labelled menu', () => {
  const h = render();
  const list = nodes(h.tree());
  const input = list.find((node) => node.type === 'HeaderSearch')!;
  expect(input.props.timing).toEqual({ debounceMs: 300 });
  expect(input.props.focusOnClear).toBe(false);
  (input.props.onChange as (value: string) => void)('VIN123');
  expect(h.search).toHaveBeenCalledWith('VIN123');
  const adds = list.filter((node) => node.props.label === 'Добавить клиента');
  expect(adds).toHaveLength(1);
  (adds[0].props.onPress as () => void)();
  expect(h.add).toHaveBeenCalledTimes(1);
  expect(h.menu().props.label).toBe('Фильтры клиентов');
  expect((h.menu().props.items as (Item | null)[]).filter(Boolean).map((item) => item!.id)).toEqual([
    'all',
    'source',
    'regular',
    'new',
    'noplate',
  ]);
});

test('filter selection preserves source-picker handoff, source clearing and no-plate toggle semantics', () => {
  const h = render();
  h.select('source');
  expect(h.sourcePicker).toHaveBeenCalledWith(true);
  expect(h.filter).toBe('all');
  h.setSource('Рекомендация');
  expect(h.menu().props.title).toBe('Источник: Рекомендация');
  h.select('regular');
  expect(h.filter).toBe('regular');
  expect(h.sourceFilter).toBeNull();
  h.select('new');
  expect(h.filter).toBe('new');
  h.select('noplate');
  expect(h.filter).toBe('noplate');
  h.select('noplate');
  expect(h.filter).toBe('all');
  h.setSource('Другое');
  h.select('clear-source');
  expect(h.filter).toBe('all');
  expect(h.sourceFilter).toBeNull();
});

test('plate mode keeps specialized RU/INT inputs and explicit return-to-people control', () => {
  const h = render('plate');
  const list = nodes(h.tree());
  expect(list.some((node) => node.type === 'HeaderSearch' || node.type === 'HeaderMenu')).toBe(false);
  const input = list.find((node) => node.type === 'RussianPlateInput')!;
  expect(input.props.value).toBe('А123АА77');
  expect(input.props.mode).toBe('ru');
  expect(input.props.autoFocus).toBe(false);
  expect(input.props.onChangeText).toBe(h.plateSearch);
  const switcher = list.find((node) => node.type === 'PlateModeSwitcher')!;
  expect(switcher.props.onChange).toBe(h.plateMode);
  const backToPeople = list.find((node) => node.props.label === 'Искать клиентов')!;
  (backToPeople.props.onPress as () => void)();
  expect(h.toggle).toHaveBeenCalledTimes(1);
});
