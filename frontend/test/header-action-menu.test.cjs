const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const React = require('react');
const Renderer = require('react-test-renderer');
const { MemoryRouter } = require('react-router-dom');
const h = React.createElement;
for (const ext of ['.ts', '.tsx'])
  require.extensions[ext] = (module, filename) =>
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
function load(relative, mocks) {
  const filename = path.resolve(__dirname, relative);
  const module = new Module(filename, moduleRoot);
  module.filename = filename;
  module.paths = Module._nodeModulePaths(path.dirname(filename));
  const localRequire = Module.createRequire(filename);
  module.require = (name) => mocks[name] ?? localRequire(name);
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
  return module.exports;
}
const moduleRoot = module;
const DropdownModule = load('../src/ui/DropdownMenu.tsx', { 'react-dom': { createPortal: (node) => node } });
const Dropdown = DropdownModule.DropdownMenu;
const HeaderMenu = load('../src/components/HeaderActionMenu.tsx', { '../ui/DropdownMenu': DropdownModule }).default;

function harness(Component, initialProps, width = 1440) {
  const originals = { window: global.window, document: global.document };
  const events = { document: new Map(), window: new Map() };
  const log = [];
  const mediaListeners = new Set();
  const media = {
    matches: width >= 768,
    addEventListener: (_, fn) => mediaListeners.add(fn),
    removeEventListener: (_, fn) => mediaListeners.delete(fn),
  };
  const target = (owner) => ({
    addEventListener(type, fn) {
      if (!events[owner].has(type)) events[owner].set(type, new Set());
      events[owner].get(type).add(fn);
      log.push(`add:${owner}:${type}`);
    },
    removeEventListener(type, fn) {
      events[owner].get(type)?.delete(fn);
      log.push(`remove:${owner}:${type}`);
    },
  });
  global.window = { ...target('window'), innerWidth: width, innerHeight: 844, matchMedia: () => media };
  global.document = { ...target('document'), body: {}, activeElement: null };
  const trigger = {
    focus() {
      document.activeElement = trigger;
      log.push('trigger:focus');
    },
    contains: (value) => value === trigger,
    getBoundingClientRect: () => ({ left: 100, right: 200, top: 100, bottom: 136, width: 100, height: 36 }),
  };
  const domItems = new Map();
  let tree;
  const nativeItems = () => tree.root.findAll((n) => typeof n.type === 'string' && n.props.role === 'menuitem');
  const eligible = () =>
    nativeItems()
      .filter((n) => !n.props['aria-disabled'])
      .map((n, index) => {
        if (!domItems.has(n))
          domItems.set(n, {
            focus() {
              document.activeElement = this;
              log.push(`item:focus:${index}`);
            },
          });
        return domItems.get(n);
      });
  const menuNode = {
    offsetHeight: 250,
    scrollHeight: 250,
    contains: (value) => [...domItems.values()].includes(value),
    querySelector: () => eligible()[0],
    querySelectorAll: () => eligible(),
  };
  let props = initialProps;
  const render = () =>
    h(MemoryRouter, { future: { v7_startTransition: true, v7_relativeSplatPath: true } }, h(Component, props));
  Renderer.act(() => {
    tree = Renderer.create(render(), { createNodeMock: (node) => (node.props.role === 'menu' ? menuNode : null) });
  });
  const api = {
    log,
    events,
    trigger,
    get tree() {
      return tree;
    },
    get menus() {
      return tree.root.findAll((n) => n.type === 'div' && n.props.role === 'menu');
    },
    get items() {
      return nativeItems();
    },
    get button() {
      return tree.root.findAll((n) => n.type === 'button' && !n.props.role)[0];
    },
    clickTrigger() {
      api.button.props.onClick({ currentTarget: trigger });
    },
    open() {
      Renderer.act(() => api.clickTrigger());
    },
    update(next) {
      props = { ...props, ...next };
      Renderer.act(() => tree.update(render()));
    },
    resize(next) {
      window.innerWidth = next;
      media.matches = next >= 768;
      Renderer.act(() => {
        for (const fn of mediaListeners) fn();
      });
    },
    unmount() {
      if (tree) {
        Renderer.act(() => tree.unmount());
        tree = null;
      }
    },
    close() {
      api.unmount();
      for (const [key, value] of Object.entries(originals)) {
        if (value === undefined) delete global[key];
        else global[key] = value;
      }
    },
  };
  return api;
}
const menuProps = (items) => ({ items, trigger: h('button', null, 'Действия'), responsive: true });

test('immediate file/print actions retain the original browser gesture and run once', () => {
  let inGesture = false;
  let calls = 0;
  const ui = harness(
    Dropdown,
    menuProps([
      {
        key: 'file',
        label: 'Импорт',
        onSelect() {
          assert.equal(inGesture, true);
          calls += 1;
        },
      },
    ]),
  );
  try {
    ui.open();
    Renderer.act(() => {
      inGesture = true;
      ui.items[0].props.onClick();
      inGesture = false;
    });
    assert.equal(calls, 1);
    assert.equal(ui.menus.length, 0);
    assert.equal(document.activeElement, ui.trigger);
  } finally {
    ui.close();
  }
});

test('after-close invokes the successor only after portal removal, cleanup and trigger restoration', () => {
  let calls = 0;
  let ui;
  const successor = {
    focus() {
      document.activeElement = successor;
    },
  };
  ui = harness(
    Dropdown,
    menuProps([
      {
        key: 'edit',
        label: 'Редактировать',
        selectTiming: 'after-close',
        onSelect() {
          calls += 1;
          assert.equal(ui.menus.length, 0);
          assert.equal(
            [...ui.events.document.values()].reduce((n, set) => n + set.size, 0),
            0,
          );
          assert.equal(
            [...ui.events.window.values()].reduce((n, set) => n + set.size, 0),
            0,
          );
          assert.equal(document.activeElement, ui.trigger);
          successor.focus();
        },
      },
    ]),
  );
  try {
    ui.open();
    Renderer.act(() => {
      ui.items[0].props.onClick();
      assert.equal(calls, 0);
    });
    assert.equal(calls, 1);
    assert.equal(document.activeElement, successor);
    ui.update({ 'aria-label': 'Обновлённая подпись' });
    assert.equal(calls, 1);
    assert.equal(document.activeElement, successor);
  } finally {
    ui.close();
  }
});

test('cancel, reopen and unmount clear pending after-close work without stale callbacks', () => {
  let calls = 0;
  const ui = harness(
    Dropdown,
    menuProps([
      {
        key: 'next',
        label: 'Открыть',
        selectTiming: 'after-close',
        onSelect: () => {
          calls += 1;
        },
      },
    ]),
  );
  try {
    ui.open();
    Renderer.act(() => {
      const menu = ui.menus[0];
      ui.items[0].props.onClick();
      menu.props.onKeyDown({ key: 'Escape', preventDefault() {} });
    });
    assert.equal(calls, 0);
    ui.open();
    Renderer.act(() => {
      ui.items[0].props.onClick();
      ui.clickTrigger();
    });
    assert.equal(calls, 0);
    assert.equal(ui.menus.length, 1);
    Renderer.act(() => {
      ui.items[0].props.onClick();
      ui.tree.unmount();
    });
    assert.equal(calls, 0);
  } finally {
    ui.close();
  }
});

test('loading is disabled/aria-busy, stays visible at the header trigger, and does not block other commands', () => {
  let calls = 0;
  const ui = harness(HeaderMenu, {
    label: 'Выгрузить',
    items: [
      {
        key: 'excel',
        label: 'Excel',
        loading: true,
        onSelect: () => {
          calls += 10;
        },
      },
      {
        key: 'pdf',
        label: 'PDF',
        onSelect: () => {
          calls += 1;
        },
      },
    ],
  });
  try {
    assert.equal(ui.button.props['aria-busy'], true);
    assert.ok(!ui.button.props.disabled);
    assert.equal(ui.tree.root.findAllByProps({ role: 'status' }).length, 1);
    ui.open();
    assert.equal(ui.items[0].props['aria-disabled'], true);
    assert.equal(ui.items[0].props['aria-busy'], true);
    Renderer.act(() => ui.items[0].props.onClick());
    assert.equal(calls, 0);
    Renderer.act(() => ui.items[1].props.onClick());
    assert.equal(calls, 1);
    assert.equal(ui.menus.length, 0);
    assert.equal(ui.button.props['aria-busy'], true);
  } finally {
    ui.close();
  }
});

test('navigation uses a real Link and modified activation does not become imperative navigation or select', () => {
  let selected = 0;
  let prevented = false;
  const ui = harness(
    Dropdown,
    menuProps([
      {
        key: 'import',
        label: 'Импорт',
        to: '/clients/import?q=keep',
        onSelect: () => {
          selected += 1;
        },
      },
    ]),
  );
  try {
    ui.open();
    const item = ui.items[0];
    assert.equal(item.type, 'a');
    assert.equal(item.props.href, '/clients/import?q=keep');
    Renderer.act(() =>
      item.props.onClick({
        button: 0,
        metaKey: true,
        defaultPrevented: false,
        preventDefault() {
          prevented = true;
        },
      }),
    );
    assert.equal(prevented, false);
    assert.equal(selected, 0);
    assert.equal(ui.menus.length, 0);
  } finally {
    ui.close();
  }
});

test('header groups keep desktop-only import unavailable on narrow screens and omit truly empty groups', () => {
  const ui = harness(HeaderMenu, {
    items: [
      { key: 'import', label: 'Импорт', to: '/clients/import', desktopOnly: true },
      { key: 'export', label: 'Экспорт CSV', onSelect() {} },
    ],
  });
  try {
    ui.open();
    assert.equal(ui.items.length, 2);
    Renderer.act(() => ui.menus[0].props.onKeyDown({ key: 'Escape', preventDefault() {} }));
    ui.resize(390);
    ui.open();
    assert.equal(ui.items.length, 1);
    assert.equal(ui.items[0].type, 'button');
    Renderer.act(() => ui.menus[0].props.onKeyDown({ key: 'Escape', preventDefault() {} }));
    ui.update({ items: [{ key: 'import', label: 'Импорт', to: '/clients/import', desktopOnly: true }] });
    assert.equal(ui.button, undefined);
    ui.update({ items: [] });
    assert.equal(ui.button, undefined);
  } finally {
    ui.close();
  }
});

test('menu keyboard skips disabled entries and Escape returns focus', () => {
  const ui = harness(
    Dropdown,
    menuProps([
      { key: 'blocked', label: 'Заблокировано', disabled: true },
      { key: 'a', label: 'А' },
      { key: 'b', label: 'Б' },
    ]),
  );
  try {
    Renderer.act(() => ui.button.props.onKeyDown({ key: 'ArrowDown', currentTarget: ui.trigger, preventDefault() {} }));
    const first = document.activeElement;
    Renderer.act(() => ui.menus[0].props.onKeyDown({ key: 'End', preventDefault() {} }));
    assert.notEqual(document.activeElement, first);
    Renderer.act(() => ui.menus[0].props.onKeyDown({ key: 'Home', preventDefault() {} }));
    assert.equal(document.activeElement, first);
    Renderer.act(() => ui.menus[0].props.onKeyDown({ key: 'Escape', preventDefault() {} }));
    assert.equal(document.activeElement, ui.trigger);
    assert.equal(ui.menus.length, 0);
  } finally {
    ui.close();
  }
});
