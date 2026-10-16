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
let quoteResponder = null;
let monthlyTotal = 5490;
let actualEmployees = 6;
let authToken = 'session-A';
function preview(period, params = {}) {
  const employees = params.employees ?? actualEmployees,
    points = params.points ?? 1;
  const selectedTotal = monthlyTotal + (employees - actualEmployees) * 500;
  return {
    planId: 'pro',
    pricing: { code: 'pro', includedEmployees: 5, includedPoints: null },
    usage: { employees: actualEmployees, activePoints: 1, billablePoints: 1 },
    quoteToken: `${monthlyTotal}-${period}`,
    quote: {
      period,
      employees,
      points,
      serviceMonths: period === 'yearly' ? 12 : 1,
      chargedMonths: period === 'yearly' ? 10 : 1,
      includedEmployees: 5,
      extraEmployees: 1,
      includedPoints: null,
      extraPoints: 0,
      baseMonthlyAmount: 4990,
      employeesMonthlyAmount: selectedTotal - 4990,
      pointsMonthlyAmount: 0,
      monthlyTotal: selectedTotal,
      total: selectedTotal * (period === 'yearly' ? 10 : 1),
    },
  };
}
const endpoint = (mode) => async (id, params) => {
  apiCalls.push({ mode, id, params });
  if (quoteResponder) return quoteResponder(params);
  if (failQuote) throw failQuote;
  if (params.employees !== undefined && params.employees < actualEmployees)
    throw {
      response: {
        status: 400,
        data: { code: 'COUNT_BELOW_USAGE', minimumEmployees: actualEmployees, minimumPoints: 1 },
      },
    };
  return { data: preview(params.period, params) };
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
    if (name === '../../contexts/AuthContext') return { useAuth: () => ({ token: authToken }) };
    if (name === '../../api/axios') return { createSessionBoundClient: (token) => ({ token }) };
    if (name === '../../utils/sessionToken') return { readStoredToken: () => authToken };
    if (name === '../../utils/subscriptionPricingText')
      return {
        parseSubscriptionCount: (value) =>
          /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) >= 1 ? Number(value) : undefined,
      };
    if (name === '../../../../shared/api/createServices')
      return {
        createManagerCabinetApi: () => ({ getSubscriptionQuote: endpoint('manager') }),
        createTenantsApi: () => ({ getSubscriptionQuote: endpoint('superadmin') }),
      };
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
  employees: state.employeesCount,
  points: state.pointsCount,
});
test.beforeEach(() => {
  sequence = 0;
  apiCalls.length = 0;
  failQuote = null;
  quoteResponder = null;
  monthlyTotal = 5490;
  actualEmployees = 6;
  authToken = 'session-A';
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
      form.state().changeEmployees('99');
      form.state().changePoints('99');
    });
    assert.equal(form.state().employees, '6');
    assert.equal(form.state().points, '1');
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
test('legacy plans offer manual date flow and preserve legacy/free request shape', async () => {
  for (const code of ['LEGACY_PLAN']) {
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
const pricingHelper = compileLocal('../../shared/utils/subscriptionPricing.ts', {});
const pricingText = compileLocal('utils/subscriptionPricingText.ts', {
  '../../../shared/utils/subscriptionPricing': pricingHelper,
});
const Breakdown = compileLocal('components/SubscriptionQuoteBreakdown.tsx', {
  '../utils/subscriptionPricingText': pricingText,
});
const Composition = compileLocal('components/SubscriptionCompositionFields.tsx', {
  '../ui/Field': { Field: host('Field') },
  '../ui/Input': { Input: host('Input') },
  '../utils/subscriptionPricingText': pricingText,
});
const Form = compileLocal('components/admin/ExtendModal.tsx', {
  './useSubscriptionRenewal': { useSubscriptionRenewal },
  '../SubscriptionQuoteBreakdown': Breakdown,
  '../SubscriptionCompositionFields': Composition,
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

test('count forecast sends selected composition separately from actual usage; invalid input hides quote readiness', async () => {
  const calls = [];
  const form = mount(async (request) => calls.push(request));
  try {
    await settle(() => form.state().quoteReady);
    Renderer.act(() => form.state().changeEmployees('8'));
    await settle(() => form.state().quoteReady && form.state().amount === '6490');
    assert.equal(form.state().quoteQuery.data.usage.employees, 6);
    assert.equal(form.state().quoteQuery.data.quote.employees, 8);
    assert.equal(apiCalls.at(-1).params.employees, 8);
    Renderer.act(() => form.state().changeAmount('6000'));
    Renderer.act(() => form.state().setPeriod('yearly'));
    await settle(() => form.state().amount === '64900');
    assert.equal(form.state().amountHint, 'Сумма обновлена по расчёту');
    await Renderer.act(async () => form.state().send(paid(form.state())));
    assert.equal(calls[0].employees, 8);
    assert.equal(calls[0].points, 1);
    assert.equal(calls[0].amount, 64900);
    for (const invalid of ['', '0', '-1', '1.5', '9007199254740992', '5']) {
      Renderer.act(() => form.state().changeEmployees(invalid));
      assert.equal(form.state().quoteReady, false, invalid);
    }
  } finally {
    form.close();
  }
});
test('normal count change replaces manual received amount; stale usage growth recovers minima and preserves money', async () => {
  const form = mount(async () => {
    actualEmployees = 7;
    monthlyTotal = 5990;
    throw { response: { status: 409, data: { code: 'QUOTE_CHANGED' } } };
  });
  try {
    await settle(() => form.state().quoteReady);
    Renderer.act(() => form.state().changeAmount('5000'));
    Renderer.act(() => form.state().changeEmployees('7'));
    await settle(() => form.state().amount === '5990' && form.state().quoteReady);
    Renderer.act(() => form.state().changeEmployees('6'));
    await settle(() => form.state().amount === '5490' && form.state().quoteReady);
    Renderer.act(() => form.state().changeAmount('5000'));
    await Renderer.act(async () => form.state().send(paid(form.state())));
    await settle(
      () => form.state().employees === '7' && !form.state().quoteQuery.isFetching && !!form.state().quoteQuery.data,
    );
    assert.equal(form.state().amount, '5000');
    assert.equal(form.state().changed, true);
    assert.equal(form.state().minimumEmployees, 7);
    Renderer.act(() => form.state().acknowledgeChange());
    assert.equal(form.state().quoteReady, true);
  } finally {
    form.close();
  }
});
test('UNPRICED_POINTS keeps editable counts and requires an explicit recovery choice', async () => {
  failQuote = { response: { status: 400, data: { code: 'UNPRICED_POINTS' } } };
  const form = mount(async () => {});
  try {
    await settle(() => form.state().quoteQuery.isError);
    assert.equal(form.state().period, 'monthly');
    assert.equal(form.state().locked, false);
    Renderer.act(() => form.state().setPeriod('custom'));
    assert.equal(form.state().period, 'custom');
  } finally {
    form.close();
  }
});

test('late count forecast cannot replace a newer composition or its received amount', async () => {
  const form = mount(async () => {});
  try {
    await settle(() => form.state().quoteReady);
    const pending = new Map();
    quoteResponder = (params) => new Promise((resolve) => pending.set(params.employees, { params, resolve }));
    Renderer.act(() => form.state().changeEmployees('7'));
    await settle(() => pending.has(7));
    Renderer.act(() => form.state().changeEmployees('8'));
    await settle(() => pending.has(8));
    await Renderer.act(async () => pending.get(8).resolve({ data: preview('monthly', pending.get(8).params) }));
    await settle(() => form.state().amount === '6490' && form.state().quoteReady);
    await Renderer.act(async () => pending.get(7).resolve({ data: preview('monthly', pending.get(7).params) }));
    assert.equal(form.state().employees, '8');
    assert.equal(form.state().amount, '6490');
    assert.equal(form.state().quoteQuery.data.quote.employees, 8);
  } finally {
    form.close();
  }
});

test('timeout followed by access or rate-limit failure preserves the first financial intent and UUID', async () => {
  for (const status of [403, 404, 429]) {
    const calls = [];
    const form = mount(async (request) => {
      calls.push(request);
      if (calls.length === 1) throw new Error('timeout');
      if (calls.length === 2) throw { response: { status, data: { message: 'Access or rate limit' } } };
    });
    try {
      await settle(() => form.state().quoteReady);
      Renderer.act(() => form.state().changeAmount('5000'));
      await Renderer.act(async () => form.state().send(paid(form.state())));
      assert.equal(form.state().uncertain, true);
      await Renderer.act(async () => form.state().send({ type: 'paid', amount: 1 }));
      assert.equal(form.state().uncertain, true);
      assert.equal(form.state().locked, true);
      assert.equal(form.state().canClose(), false);
      Renderer.act(() => {
        form.state().changeAmount('1');
        form.state().changeEmployees('99');
        form.state().setPeriod('yearly');
      });
      assert.equal(form.state().amount, '5000');
      assert.equal(form.state().employees, '6');
      assert.equal(form.state().period, 'monthly');
      await Renderer.act(async () => form.state().send({ type: 'paid', amount: 2 }));
      assert.equal(calls.length, 3);
      assert.equal(calls[0], calls[1]);
      assert.equal(calls[1], calls[2]);
      assert.equal(form.state().canClose(), true);
    } finally {
      form.close();
    }
  }
});
test('request ID reuse never creates a new financial intent automatically', async () => {
  const calls = [];
  const form = mount(async (request) => {
    calls.push(request);
    throw { response: { status: 409, data: { code: 'REQUEST_ID_REUSED' } } };
  });
  try {
    await settle(() => form.state().quoteReady);
    await Renderer.act(async () => form.state().send(paid(form.state())));
    assert.equal(form.state().uncertain, true);
    await Renderer.act(async () => form.state().send({ type: 'paid', amount: 1 }));
    assert.equal(calls[0], calls[1]);
    assert.equal(form.state().canClose(), false);
  } finally {
    form.close();
  }
});
