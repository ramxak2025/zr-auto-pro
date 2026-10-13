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
const React = require('react');
const Renderer = require('react-test-renderer');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
global.localStorage = {
  getItem() {
    return null;
  },
};
const landing = {
  slug: 'fixture',
  timezone: 'Europe/Moscow',
  serverAt: '2026-10-13T09:00:00Z',
  consentVersion: 'legal-one',
};
const pending = [];
const originalLoad = Module._load;
Module._load = function (name, parent, isMain) {
  if (name === '../components/booking/PublicBookingExperience')
    return { __esModule: true, default: (props) => React.createElement('experience', props) };
  if (name === 'react-router-dom') return { useParams: () => ({ slug: 'fixture' }) };
  if (name === '../api/publicBookings')
    return {
      publicBookingsApi: {
        landing: async () => ({ data: landing }),
        slots: (_slug, params) => new Promise((resolve) => pending.push({ params, resolve })),
      },
    };
  return originalLoad.call(this, name, parent, isMain);
};
const Page = require('../src/pages/PublicBookingPage').default;
Module._load = originalLoad;
const slot = (startsAt) => ({
  timezone: 'Europe/Moscow',
  serverAt: landing.serverAt,
  slots: [{ startsAt, endsAt: '2026-10-13T13:00:00Z' }],
  nextAfter: null,
});
test('unchanged date/master keeps selected time; late responses after a genuine change cannot restore stale slots', async () => {
  let tree;
  await Renderer.act(async () => {
    tree = Renderer.create(React.createElement(Page));
  });
  const experience = () => tree.root.findByType('experience').props;
  Renderer.act(() => experience().onSelected(['service-A']));
  assert.equal(pending.length, 1);
  await Renderer.act(async () => pending[0].resolve({ data: slot('2026-10-13T10:00:00Z') }));
  Renderer.act(() => experience().onSlot('2026-10-13T10:00:00Z'));
  Renderer.act(() => {
    experience().onDate(experience().date);
    experience().onResource('');
  });
  assert.equal(experience().selectedSlot, '2026-10-13T10:00:00Z');
  assert.equal(experience().slots.slots.length, 1);
  assert.equal(pending.length, 1);
  Renderer.act(() => experience().onResource('master-A'));
  assert.equal(experience().selectedSlot, null);
  assert.equal(experience().slots, null);
  Renderer.act(() => experience().onSelected(['service-B']));
  assert.equal(pending.length, 3);
  await Renderer.act(async () => pending[1].resolve({ data: slot('2026-10-13T11:00:00Z') }));
  assert.equal(experience().slots, null);
  assert.equal(experience().selectedSlot, null);
  await Renderer.act(async () => pending[2].resolve({ data: slot('2026-10-13T12:00:00Z') }));
  assert.equal(experience().slots.slots[0].startsAt, '2026-10-13T12:00:00Z');
  assert.equal(experience().selectedSlot, null);
  Renderer.act(() => tree.unmount());
});
