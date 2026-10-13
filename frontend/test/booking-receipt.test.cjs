const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const Module = require('node:module');
const ts = require('typescript');
for (const extension of ['.ts', '.tsx'])
  require.extensions[extension] = (module, filename) =>
    module._compile(
      ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
        fileName: filename,
        compilerOptions: {
          target: ts.ScriptTarget.ES2020,
          module: ts.ModuleKind.CommonJS,
          jsx: ts.JsxEmit.ReactJSX,
          esModuleInterop: true,
        },
      }).outputText,
      filename,
    );
require.extensions['.css'] = () => {};
const originalLoad = Module._load;
let reduced = false;
Module._load = function (name, parent, isMain) {
  if (name === 'framer-motion') return { useReducedMotion: () => reduced, motion: { path: 'path' } };
  if (name === '../api/publicBookings') return { publicBookingsApi: {} };
  if (name === '../utils/publicBookingIntent') return {};
  return originalLoad.call(this, name, parent, isMain);
};
const React = require('react');
const Renderer = require('react-test-renderer');
const { ReceiptPanel } = require('../src/pages/PublicBookingPage');
Module._load = originalLoad;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const receipt = (status) => ({
  requestId: `receipt-${status}`,
  status,
  startsAt: '2026-10-13T10:00:00Z',
  endsAt: '2026-10-13T11:00:00Z',
  services: [],
});
let timerCount = 0,
  clearCount = 0,
  timer;
global.window = {
  setTimeout(fn) {
    timerCount++;
    timer = fn;
    return timerCount;
  },
  clearTimeout() {
    clearCount++;
  },
};
function mount(status, celebrate = false) {
  let tree;
  Renderer.act(() => {
    tree = Renderer.create(
      React.createElement(ReceiptPanel, {
        receipt: receipt(status),
        celebrate,
        onRefresh() {},
        onNew() {},
        busy: false,
      }),
    );
  });
  return tree;
}
test('receipt copy is authoritative and rejected/cancelled receipts never celebrate', () => {
  for (const [status, title] of [
    ['confirmed', 'Запись подтверждена'],
    ['pending', 'Заявка отправлена'],
    ['rejected', 'Заявка отклонена'],
    ['cancelled', 'Запись отменена'],
  ]) {
    const tree = mount(status, status === 'rejected' || status === 'cancelled');
    assert.equal(tree.root.findByType('h2').children.join(''), title);
    assert.equal(tree.root.findAllByProps({ className: 'pb-fireworks' }).length, 0);
    Renderer.act(() => tree.unmount());
  }
  assert.equal(timerCount, 0);
});
test('a fresh submitted pending receipt has one short burst, status rerender/remount cannot replay it', () => {
  const tree = mount('pending', true);
  assert.equal(tree.root.findByProps({ className: 'pb-fireworks' }).findAllByType('i').length, 24);
  assert.equal(timerCount, 1);
  Renderer.act(() => timer());
  assert.equal(tree.root.findAllByProps({ className: 'pb-fireworks' }).length, 0);
  Renderer.act(() => tree.unmount());
  assert.equal(clearCount, 1);
  const remount = mount('pending', true);
  assert.equal(remount.root.findAllByProps({ className: 'pb-fireworks' }).length, 0);
  assert.equal(timerCount, 1);
  Renderer.act(() => remount.unmount());
});
test('reduced motion retains a static confirmed receipt without creating animation timers', () => {
  reduced = true;
  const tree = mount('confirmed', true);
  assert.equal(tree.root.findAllByProps({ className: 'pb-fireworks' }).length, 0);
  assert.equal(tree.root.findByType('h2').children.join(''), 'Запись подтверждена');
  assert.equal(timerCount, 1);
  Renderer.act(() => tree.unmount());
});
