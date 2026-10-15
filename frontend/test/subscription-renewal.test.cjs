const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const Renderer = require('react-test-renderer');
const Query = require('@tanstack/react-query');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let sequence = 0;
const apiCalls = [];
let failQuote = null;
let monthlyTotal = 5490;
function preview(period) {
  return {
    planId: 'pro',
    pricing: { code: 'pro' },
    usage: { employees: 6, activePoints: 1, billablePoints: 1 },
    quoteToken: `${monthlyTotal}-${period}`,
    quote: {
      period,
      includedEmployees: 5,
      extraEmployees: 1,
      includedPoints: null,
      extraPoints: 0,
      baseMonthlyAmount: 4990,
      employeesMonthlyAmount: monthlyTotal - 4990,
      pointsMonthlyAmount: 0,
      monthlyTotal,
      total: monthlyTotal * (period === 'yearly' ? 10 : 1),
    },
  };
}
const endpoint = (mode) => async (id, params) => {
  apiCalls.push({ mode, id, params });
  if (failQuote) throw failQuote;
  return { data: preview(params.period) };
};
const compiled = ts.transpileModule(
  fs.readFileSync(path.join(__dirname, '../src/components/admin/useSubscriptionRenewal.ts'), 'utf8'),
  {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  },
).outputText;
const sandbox = {
  exports: {},
  require: (name) => {
    if (name === 'react') return React;
    if (name === '@tanstack/react-query') return Query;
    if (name === '../../api/services')
      return {
        managerApi: { getSubscriptionQuote: endpoint('manager') },
        tenantsApi: { getSubscriptionQuote: endpoint('superadmin') },
      };
    if (name === '../../utils/uuid')
      return { newUuid: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}` };
    throw new Error(`Unexpected runtime dependency: ${name}`);
  },
};
vm.runInNewContext(compiled, sandbox);
const useSubscriptionRenewal = sandbox.exports.useSubscriptionRenewal;
const settle = async (condition) => {
  for (let n = 0; n < 100 && !condition(); n++)
    await Renderer.act(async () => {
      await new Promise((done) => setTimeout(done, 5));
    });
  assert.ok(condition(), 'form did not settle');
};
function mount(onSubmit, mode = 'superadmin') {
  let state;
  const client = new Query.QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  function Form() {
    state = useSubscriptionRenewal({ open: true, tenantId: 'tenant', mode, legacyPrice: 4990, onSubmit });
    return null;
  }
  let tree;
  Renderer.act(() => {
    tree = Renderer.create(React.createElement(Query.QueryClientProvider, { client }, React.createElement(Form)));
  });
  return {
    state: () => state,
    close: () => {
      Renderer.act(() => tree.unmount());
      client.clear();
    },
  };
}
const paid = (state) => ({
  type: 'paid',
  amount: Number(state.amount),
  period: state.period,
  quoteToken: state.quoteQuery.data.quoteToken,
});
test.beforeEach(() => {
  sequence = 0;
  apiCalls.length = 0;
  failQuote = null;
  monthlyTotal = 5490;
});

test('month/year prefill uses the full server composition; manager reads its scoped endpoint', async () => {
  const form = mount(async () => {}, 'manager');
  try {
    await settle(() => form.state().amount === '5490');
    Renderer.act(() => form.state().setPeriod('yearly'));
    await settle(() => form.state().amount === '54900');
    assert.equal(apiCalls.at(-1).mode, 'manager');
    assert.equal(apiCalls.at(-1).id, 'tenant');
    assert.equal(apiCalls.at(-1).params.period, 'yearly');
  } finally {
    form.close();
  }
});
test('actual collected override is sent, with period/token/request ID and no legacy date fields', async () => {
  const calls = [];
  const form = mount(async (request) => {
    calls.push(request);
  });
  try {
    await settle(() => form.state().quoteReady);
    Renderer.act(() => form.state().changeAmount('5000'));
    await Renderer.act(async () => form.state().send(paid(form.state())));
    assert.equal(calls[0].amount, 5000);
    assert.equal(calls[0].period, 'monthly');
    assert.ok(calls[0].quoteToken && calls[0].requestId);
    assert.equal(calls[0].days, undefined);
    assert.equal(calls[0].until, undefined);
  } finally {
    form.close();
  }
});
test('stale 409 refreshes composition, preserves collected amount, and requires acknowledgment', async () => {
  let calls = 0;
  const form = mount(async () => {
    calls++;
    monthlyTotal = 5990;
    throw { response: { status: 409, data: { code: 'QUOTE_CHANGED' } } };
  });
  try {
    await settle(() => form.state().quoteReady);
    Renderer.act(() => form.state().changeAmount('5000'));
    await Renderer.act(async () => form.state().send(paid(form.state())));
    await settle(() => form.state().quoteQuery.data.quote.monthlyTotal === 5990);
    assert.equal(form.state().amount, '5000');
    assert.equal(form.state().changed, true);
    assert.equal(form.state().quoteReady, false);
    assert.equal(calls, 1);
    for (const period of ['monthly', 'yearly', 'custom']) {
      Renderer.act(() => form.state().setPeriod(period));
      assert.equal(form.state().period, 'monthly');
      assert.equal(form.state().changed, true);
      assert.equal(form.state().quoteReady, false);
      assert.equal(form.state().amount, '5000');
      assert.equal(calls, 1);
    }
    Renderer.act(() => form.state().acknowledgeChange());
    assert.equal(form.state().quoteReady, true);
  } finally {
    form.close();
  }
});
test('unknown response locks editing/close and retries identical body and ID; rapid taps make one request', async () => {
  const calls = [];
  let reject;
  const form = mount((request) => {
    calls.push(request);
    return calls.length === 1
      ? new Promise((_done, fail) => {
          reject = fail;
        })
      : Promise.resolve();
  });
  try {
    await settle(() => form.state().quoteReady);
    let pending;
    Renderer.act(() => {
      pending = form.state().send(paid(form.state()));
      void form.state().send(paid(form.state()));
    });
    assert.equal(calls.length, 1);
    assert.equal(form.state().canClose(), false);
    await Renderer.act(async () => {
      reject(new Error('timeout'));
      await pending;
    });
    assert.equal(form.state().uncertain, true);
    const oldAmount = form.state().amount;
    Renderer.act(() => {
      form.state().changeAmount('1');
      form.state().setPeriod('yearly');
    });
    assert.equal(form.state().amount, oldAmount);
    assert.equal(form.state().period, 'monthly');
    assert.ok(form.state().message.includes('Результат продления пока неизвестен'));
    await Renderer.act(async () => form.state().send({ type: 'paid', amount: 1, period: 'yearly' }));
    assert.equal(calls.length, 2);
    assert.equal(calls[0], calls[1]);
    assert.equal(form.state().canClose(), true);
  } finally {
    form.close();
  }
});
test('legacy/unpriced plans offer manual date flow and preserve legacy/free request shape', async () => {
  for (const code of ['LEGACY_PLAN', 'UNPRICED_POINTS']) {
    failQuote = { response: { status: 400, data: { code } } };
    const calls = [];
    const form = mount(async (request) => {
      calls.push(request);
    });
    try {
      await settle(() => form.state().period === 'custom');
      assert.ok(form.state().fallback);
      await Renderer.act(async () => form.state().send({ type: 'free', days: 14 }));
      assert.equal(calls[0].days, 14);
      assert.equal(calls[0].period, undefined);
      assert.equal(calls[0].quoteToken, undefined);
      await Renderer.act(async () => form.state().send({ type: 'paid', amount: 4990, until: '2027-01-01' }));
      assert.equal(calls[1].until, '2027-01-01');
      assert.equal(calls[1].period, undefined);
    } finally {
      form.close();
    }
  }
});

// Real form + real renewal hook; native DOM primitives remain inspectable hosts.
const host = (name) => (props) => React.createElement(name, props, props.children);
function compileLocal(relative, dependencies) {
  const source = fs.readFileSync(path.join(__dirname, '../src', relative), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText;
  const module = { exports: {}, require: (name) => dependencies[name] ?? require(name) };
  vm.runInNewContext(output, module);
  return module.exports;
}
const numbers = compileLocal('components/admin/numberInput.ts', {});
const money = compileLocal('components/admin/MoneyExact.tsx', {
  '../../../../shared/utils/formatters': { formatMoney: (value) => `${value} ₽` },
  '../../ui/cn': { cn: () => '' },
});
const Breakdown = compileLocal('components/SubscriptionQuoteBreakdown.tsx', {});
const Form = compileLocal('components/admin/ExtendModal.tsx', {
  './useSubscriptionRenewal': { useSubscriptionRenewal },
  '../SubscriptionQuoteBreakdown': Breakdown,
  '../Modal': {
    default: (props) => React.createElement('Modal', props, props.children, props.footer),
    __esModule: true,
  },
  '../SubscriptionPeriodBadge': { default: host('Badge'), __esModule: true },
  ...Object.fromEntries(
    ['Button', 'Checkbox', 'Field', 'Input', 'SegmentedControl'].map((name) => [
      `../../ui/${name}`,
      { [name]: host(name) },
    ]),
  ),
  './adminUi': { ToggleChip: host('ToggleChip') },
  './MoneyExact': money,
  './numberInput': numbers,
}).default;
function mountForm(onSubmit, mode = 'superadmin') {
  const client = new Query.QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  let tree;
  Renderer.act(() => {
    tree = Renderer.create(
      React.createElement(
        Query.QueryClientProvider,
        { client },
        React.createElement(Form, {
          isOpen: true,
          tenantId: 'tenant',
          mode,
          subscriptionEnd: '2027-01-01T00:00:00.000Z',
          planPrice: 4990,
          isPending: false,
          onClose() {},
          onSubmit,
          ownerSharePercent: 20,
        }),
      ),
    );
  });
  return {
    tree,
    close: () => {
      Renderer.act(() => tree.unmount());
      client.clear();
    },
  };
}
const field = (tree) => tree.root.findAllByType('Input').find((input) => input.props.id?.endsWith('ext-amount'));
const periodControl = (tree) =>
  tree.root.findAllByType('SegmentedControl').find((node) => node.props['aria-label'] === 'Период продления');
const submitButton = (tree) =>
  tree.root
    .findAllByType('Button')
    .find(
      (button) =>
        String(button.props.children).startsWith('Продлить') ||
        String(button.props.children).startsWith('Повторить тот же'),
    );

test('actual form yearly choice prefills composition total; manual collected override reaches the financial body', async () => {
  const calls = [];
  const form = mountForm(async (request) => {
    calls.push(request);
  }, 'manager');
  try {
    await settle(() => field(form.tree).props.value === '5490');
    Renderer.act(() => periodControl(form.tree).props.onChange('yearly'));
    await settle(() => field(form.tree).props.value === '54900');
    Renderer.act(() => field(form.tree).props.onChange({ target: { value: '50000' } }));
    await Renderer.act(async () => submitButton(form.tree).props.onClick());
    assert.equal(calls[0].amount, 50000);
    assert.equal(calls[0].period, 'yearly');
    assert.ok(calls[0].requestId && calls[0].quoteToken);
    assert.equal(calls[0].until, undefined);
  } finally {
    form.close();
  }
});
test('actual form disables confirmation during stale review and locks fields/cancel after timeout', async () => {
  const calls = [];
  const form = mountForm(async (request) => {
    calls.push(request);
    if (calls.length === 1) throw { response: { status: 409, data: { code: 'QUOTE_CHANGED' } } };
    throw new Error('timeout');
  });
  try {
    await settle(() => field(form.tree).props.value === '5490');
    Renderer.act(() => field(form.tree).props.onChange({ target: { value: '5000' } }));
    await Renderer.act(async () => submitButton(form.tree).props.onClick());
    for (const period of ['monthly', 'yearly', 'custom']) {
      Renderer.act(() => periodControl(form.tree).props.onChange(period));
      assert.equal(periodControl(form.tree).props.value, 'monthly');
      assert.equal(field(form.tree).props.value, '5000');
      assert.equal(submitButton(form.tree).props.disabled, true);
      await Renderer.act(async () => submitButton(form.tree).props.onClick());
      assert.equal(calls.length, 1);
    }
    const acknowledge = form.tree.root
      .findAllByType('Button')
      .find((button) => button.props.children === 'Расчёт проверен');
    Renderer.act(() => acknowledge.props.onClick());
    await Renderer.act(async () => submitButton(form.tree).props.onClick());
    assert.equal(form.tree.root.findByType('fieldset').props.disabled, true);
    const cancel = form.tree.root.findAllByType('Button').find((button) => button.props.children === 'Отмена');
    assert.equal(cancel.props.disabled, true);
    assert.equal(submitButton(form.tree).props.children, 'Повторить тот же запрос');
    await Renderer.act(async () => submitButton(form.tree).props.onClick());
    assert.equal(calls[1], calls[2]);
  } finally {
    form.close();
  }
});
