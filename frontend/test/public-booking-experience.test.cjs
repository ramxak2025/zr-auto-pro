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
function harness(options = {}) {
  let tree;
  const changes = [];
  function Wrapper() {
    const [selected, onSelected] = React.useState([]);
    const [resourceKey, setResource] = React.useState('');
    const [selectedSlot, onSlot] = React.useState(null);
    const [consented, onConsent] = React.useState(false);
    const [name, onName] = React.useState('Клиент');
    const [phone, onPhone] = React.useState('+79991112233');
    const [comment, onComment] = React.useState('');
    return React.createElement(Experience, {
      landing: options.landing || landing,
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
      name,
      phone,
      comment,
      busy: false,
      blocked: false,
      onName,
      onPhone,
      onComment,
      onDate(value) {
        changes.push(value);
      },
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
        .findAllByType('input')
        .find((input) => input.props.type === 'checkbox')
        .props.onChange({ target: { checked: true } }),
    );
  return { tree, changes, button, click, selectService, rerender: () => tree.update(React.createElement(Wrapper)) };
}
test('master-first preserves actual chosen resource through service/time/contact flow; manual consent is the last field before submit', () => {
  const h = harness();
  h.click('Мастера');
  assert.equal(h.tree.root.findByProps({ id: 'pb-heading' }).children[0], 'Выберите мастера');
  assert.equal(h.button('Выбрать услуги').props.disabled, false);
  Renderer.act(() => h.tree.root.findByProps({ className: 'pb-master' }).props.onClick());
  assert.deepEqual(h.changes, ['a'.repeat(32)]);
  h.click('Выбрать услуги');
  h.selectService();
  h.click('Продолжить');
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
  h.click('Продолжить');
  h.click('Изменить');
  assert.equal(h.button('Любой свободный мастер').props['aria-pressed'], true);
  Renderer.act(() => h.tree.root.findByProps({ className: 'pb-times' }).findByType('button').props.onClick());
  assert.equal(h.button('Указать контакты').props.disabled, false);
  Renderer.act(() => h.tree.root.findByProps({ className: 'pb-master' }).props.onClick());
  assert.equal(h.button('Указать контакты').props.disabled, true);
});

test('system Back restores the previous step while contacts, phone, comment and selected master survive', () => {
  const listeners = new Map();
  const stack = [{}];
  let index = 0;
  global.window = {
    innerHeight: 700,
    history: {
      get state() {
        return stack[index];
      },
      replaceState(state) {
        stack[index] = state;
      },
      pushState(state) {
        stack.splice(index + 1);
        stack.push(state);
        index++;
      },
      back() {
        index = Math.max(0, index - 1);
        listeners.get('popstate')?.({ state: stack[index] });
      },
    },
    addEventListener(name, fn) {
      listeners.set(name, fn);
    },
    removeEventListener(name) {
      listeners.delete(name);
    },
  };
  try {
    const h = harness();
    h.selectService();
    h.click('Продолжить');
    Renderer.act(() => h.tree.root.findByProps({ className: 'pb-times' }).findByType('button').props.onClick());
    h.click('Указать контакты');
    Renderer.act(() => {
      h.tree.root.findByProps({ autoComplete: 'name' }).props.onChange({ target: { value: 'Алексей' } });
      h.tree.root.findByType('textarea').props.onChange({ target: { value: 'Автомобиль' } });
    });
    Renderer.act(() => window.history.back());
    assert.equal(h.tree.root.findByProps({ id: 'pb-heading' }).children[0], 'Когда вам удобно?');
    h.click('Указать контакты');
    assert.equal(h.tree.root.findByProps({ autoComplete: 'name' }).props.value, 'Алексей');
    assert.equal(h.tree.root.findByType('textarea').props.value, 'Автомобиль');
    assert.equal(h.tree.root.findByProps({ type: 'tel' }).props.value, '+79991112233');
    assert.equal(h.tree.root.findByProps({ className: 'pb-consent' }).findByType('input').props.checked, false);
    Renderer.act(() => h.tree.unmount());
    assert.equal(listeners.size, 0);
  } finally {
    delete global.window;
  }
});

test('visible service segment is active after returning from master selection and preserves that master', () => {
  const h = harness();
  h.click('Мастера');
  Renderer.act(() => h.tree.root.findByProps({ className: 'pb-master' }).props.onClick());
  h.click('Выбрать услуги');
  const segments = h.tree.root.findByProps({ className: 'pb-paths' }).findAllByType('button');
  assert.equal(segments[0].props['aria-pressed'], true);
  assert.equal(segments[1].props['aria-pressed'], false);
  Renderer.act(() => segments[0].props.onClick());
  assert.deepEqual(h.changes, ['a'.repeat(32)]);
  Renderer.act(() => h.tree.unmount());
});

test('any free master can continue from the master pane without selecting a named resource', () => {
  const h = harness();
  h.click('Мастера');
  assert.equal(h.button('Любой свободный мастер').props['aria-pressed'], true);
  assert.equal(h.button('Выбрать услуги').props.disabled, false);
  h.click('Выбрать услуги');
  assert.equal(h.tree.root.findByProps({ id: 'pb-heading' }).children[0], 'Выберите услуги');
  assert.deepEqual(h.changes, []);
  Renderer.act(() => h.tree.unmount());
});

test('tenant images fail to compact identity initials and a new image URL can recover', () => {
  const fixture = { ...landing, logoUrl: '/fixture-logo.png', backgroundImageUrl: '/fixture-cover.webp' };
  const h = harness({ landing: fixture });
  const cover = () => h.tree.root.findAllByType('img').find((image) => image.props.className === 'pb-cover-image');
  const mark = () => h.tree.root.findByProps({ className: 'pb-business-mark' });
  assert.equal(cover().props.src, fixture.backgroundImageUrl);
  Renderer.act(() => cover().props.onError());
  assert.equal(cover(), undefined);
  assert.equal(h.tree.root.findByType('header').props.className.includes('pb-business-cover'), false);
  Renderer.act(() => mark().findByType('img').props.onError());
  assert.equal(mark().findByType('span').children[0], 'Ф');
  fixture.logoUrl = '/replacement-logo.png';
  fixture.backgroundImageUrl = '/replacement-cover.webp';
  Renderer.act(() => h.rerender());
  assert.equal(cover().props.src, '/replacement-cover.webp');
  assert.equal(mark().findByType('img').props.src, '/replacement-logo.png');
  const footer = h.tree.root.findByType('footer');
  assert.equal(footer.findByType('img').props.src, '/logo.png');
  assert.equal(footer.findByType('a').props.href, 'https://autexa.pw');
  Renderer.act(() => h.tree.unmount());
});

test('catalog preserves fixed zero, ranges and unknown prices without preselecting services', () => {
  const fixture = {
    ...landing,
    showPrices: true,
    services: [
      { id: 'zero', name: 'Первичная консультация', durationMinutes: 15, price: 0 },
      { id: 'range', name: 'Ремонт', durationMinutes: 60, priceType: 'range', minPrice: 1000, maxPrice: 2500 },
      { id: 'unknown', name: 'Осмотр', durationMinutes: 30 },
    ],
  };
  const h = harness({ landing: fixture });
  const prices = h.tree.root.findAllByProps({ className: 'pb-service-price' }).map((node) => node.children.join(''));
  assert.deepEqual(prices, ['0 ₽', '1 000–2 500 ₽', 'Цена уточняется']);
  assert.ok(h.tree.root.findAllByProps({ type: 'checkbox' }).every((node) => node.props.checked === false));
  assert.equal(h.button('Продолжить').props.disabled, true);
  h.selectService();
  assert.equal(h.tree.root.findByProps({ className: 'pb-total' }).findByType('strong').children[0], '0 ₽');
  Renderer.act(() => h.tree.unmount());
  const hidden = harness({ landing: { ...fixture, showPrices: false } });
  assert.equal(hidden.tree.root.findAllByProps({ className: 'pb-service-price' }).length, 0);
  hidden.selectService();
  assert.equal(hidden.tree.root.findAllByProps({ className: 'pb-total' }).length, 0);
  Renderer.act(() => hidden.tree.unmount());
});

test('selecting the same date or master preserves the selected slot', () => {
  const h = harness();
  h.selectService();
  h.click('Продолжить');
  h.click('Изменить');
  Renderer.act(() => h.tree.root.findByProps({ className: 'pb-master' }).props.onClick());
  Renderer.act(() => h.tree.root.findByProps({ className: 'pb-times' }).findByType('button').props.onClick());
  h.click('Изменить');
  Renderer.act(() => h.tree.root.findByProps({ className: 'pb-master' }).props.onClick());
  const day = h.tree.root
    .findByProps({ className: 'pb-week' })
    .findAllByType('button')
    .find((b) => b.props['aria-pressed']);
  Renderer.act(() => day.props.onClick());
  assert.deepEqual(h.changes, ['a'.repeat(32)]);
  assert.equal(h.button('Указать контакты').props.disabled, false);
  Renderer.act(() => h.tree.unmount());
});

test('time step starts with a compact master summary and explicit change closes after selection', () => {
  const h = harness();
  h.selectService();
  h.click('Продолжить');
  assert.equal(h.tree.root.findAllByProps({ className: 'pb-resources' }).length, 0);
  assert.equal(h.button('Изменить').props['aria-expanded'], false);
  assert.ok(h.tree.root.findByProps({ className: 'pb-week' }));
  assert.ok(h.tree.root.findByProps({ className: 'pb-times' }));
  h.click('Изменить');
  assert.equal(h.button('Изменить').props['aria-expanded'], true);
  assert.equal(h.button('Любой свободный мастер').props['aria-pressed'], true);
  Renderer.act(() => h.tree.root.findByProps({ className: 'pb-master' }).props.onClick());
  assert.equal(h.tree.root.findAllByProps({ className: 'pb-resources' }).length, 0);
  assert.equal(
    h.tree.root.findByProps({ className: 'pb-master-summary' }).findByType('strong').children[0],
    'Мастер Иван',
  );
  assert.deepEqual(h.changes, ['a'.repeat(32)]);
  Renderer.act(() => h.tree.unmount());
});

test('collapsing and reselecting the same master retains the slot; changing to any clears it', () => {
  const h = harness();
  h.selectService();
  h.click('Продолжить');
  Renderer.act(() => h.tree.root.findByProps({ className: 'pb-times' }).findByType('button').props.onClick());
  h.click('Изменить');
  h.click('Любой свободный мастер');
  assert.equal(h.button('Изменить').props['aria-expanded'], false);
  assert.equal(h.button('Указать контакты').props.disabled, false);
  assert.deepEqual(h.changes, []);
  h.click('Изменить');
  h.click('Изменить');
  assert.equal(h.button('Изменить').props['aria-expanded'], false);
  assert.equal(h.button('Указать контакты').props.disabled, false);
  h.click('Изменить');
  Renderer.act(() => h.tree.root.findByProps({ className: 'pb-master' }).props.onClick());
  assert.equal(h.button('Указать контакты').props.disabled, true);
  Renderer.act(() => h.tree.root.findByProps({ className: 'pb-times' }).findByType('button').props.onClick());
  h.click('Изменить');
  Renderer.act(() => h.tree.root.findByProps({ className: 'pb-master' }).props.onClick());
  assert.equal(h.button('Изменить').props['aria-expanded'], false);
  assert.equal(h.button('Указать контакты').props.disabled, false);
  h.click('Изменить');
  h.click('Любой свободный мастер');
  assert.equal(h.button('Указать контакты').props.disabled, true);
  assert.deepEqual(h.changes, ['a'.repeat(32), '']);
  Renderer.act(() => h.tree.unmount());
});
