const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const ts = require('typescript');
for (const extension of ['.ts', '.tsx']) {
  require.extensions[extension] = (module, filename) => {
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
  };
}
require.extensions['.css'] = () => {};
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = require('react');
const Renderer = require('react-test-renderer');
const Experience = require('../src/components/booking/PublicBookingExperience').default;
const landing = {
  slug: 'fixture',
  displayName: 'Фикстура',
  address: 'Адрес',
  contacts: '+79991112233',
  mode: 'approval',
  timezone: 'Europe/Moscow',
  showPrices: false,
  resources: [{ resourceKey: 'a'.repeat(32), name: 'Мастер Иван', profession: 'Автоэлектрик' }],
  services: [{ id: 'service', name: 'Диагностика', durationMinutes: 60 }],
  operator: { name: 'Фикстура', requisites: '', contact: '' },
  consentText: 'Согласие',
  policyText: 'Политика',
};
function harness() {
  let tree;
  const changes = [];
  function Wrapper() {
    const [selected, onSelected] = React.useState([]);
    const [resourceKey, setResource] = React.useState('');
    const [selectedSlot, onSlot] = React.useState(null);
    const [consented, onConsent] = React.useState(false);
    return React.createElement(Experience, {
      landing,
      selected,
      resourceKey,
      selectedSlot,
      consented,
      onSelected,
      onSlot,
      onConsent,
      onResource: (key) => {
        changes.push(key);
        setResource(key);
        onSlot(null);
      },
      date: '2026-10-12',
      minDate: '2026-10-12',
      maxDate: '2026-11-11',
      slots: { slots: [{ startsAt: '2026-10-12T09:00:00Z' }], nextAfter: null },
      name: 'Клиент',
      phone: '+79991112233',
      comment: '',
      busy: false,
      blocked: false,
      onName() {},
      onPhone() {},
      onComment() {},
      onDate() {},
      onSubmit() {},
      onMoreSlots() {},
      onRetrySlots() {},
      error: '',
      receipt: null,
      recovery: null,
    });
  }
  Renderer.act(() => {
    tree = Renderer.create(React.createElement(Wrapper));
  });
  const text = (node) =>
    (node.children || []).map((child) => (typeof child === 'string' ? child : text(child))).join('');
  const button = (label) => tree.root.findAllByType('button').find((node) => text(node) === label);
  const click = (label) => Renderer.act(() => button(label).props.onClick());
  const selectService = () =>
    Renderer.act(() =>
      tree.root
        .findByProps({ className: 'pb-service-top' })
        .findByType('input')
        .props.onChange({ target: { checked: true } }),
    );
  return { tree, changes, button, click, selectService };
}
test('master-first preserves actual chosen resource through service/time/contact flow; manual consent is the last field before submit', () => {
  const h = harness();
  h.click('Выбрать мастера');
  assert.equal(h.tree.root.findByProps({ id: 'pb-heading' }).children[0], 'Выберите мастера');
  assert.equal(h.button('Выбрать услуги').props.disabled, true);
  Renderer.act(() => h.tree.root.findByProps({ className: 'pb-master' }).props.onClick());
  assert.deepEqual(h.changes, ['a'.repeat(32)]);
  h.click('Выбрать услуги');
  h.selectService();
  h.click('Выбрать время');
  Renderer.act(() => h.tree.root.findByProps({ className: 'pb-times' }).findByType('button').props.onClick());
  h.click('Указать контакты');
  assert.equal(h.button('Отправить заявку').props.disabled, true);
  const consent = h.tree.root.findByProps({ className: 'pb-consent' }).findByType('input');
  assert.equal(consent.props.checked, false);
  Renderer.act(() => consent.props.onChange({ target: { checked: true } }));
  assert.equal(h.button('Отправить заявку').props.disabled, false);
  const action = h.tree.root.findByProps({ className: 'pb-action-area' });
  const children = action.children.filter((c) => typeof c !== 'string');
  assert.equal(children[0].props.className, 'pb-consent');
  assert.equal(children[1].props.type, 'submit');
});
test('service-first permits any free master and changing master invalidates a selected slot', () => {
  const h = harness();
  h.selectService();
  h.click('Выбрать время');
  assert.equal(h.button('Любой свободный мастер').props['aria-pressed'], true);
  Renderer.act(() => h.tree.root.findByProps({ className: 'pb-times' }).findByType('button').props.onClick());
  assert.equal(h.button('Указать контакты').props.disabled, false);
  Renderer.act(() => h.tree.root.findByProps({ className: 'pb-master' }).props.onClick());
  assert.equal(h.button('Указать контакты').props.disabled, true);
});
