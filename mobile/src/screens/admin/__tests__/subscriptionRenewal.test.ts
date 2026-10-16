import fs from 'fs';
import path from 'path';
import ts from 'typescript';
const mockStates: unknown[] = [];
const mockRefs: { current: unknown }[] = [];
const mockEffects: { deps?: unknown[] }[] = [];
const mockPending: (() => void)[] = [];
let mockIndex = 0;
let mockOptions: { queryFn: () => Promise<unknown> };
let mockSequence = 0;
const mockGetManager = jest.fn();
const mockGetTenant = jest.fn();
const mockQuote: {
  data?: ReturnType<typeof preview>;
  error?: unknown;
  isError: boolean;
  isFetching: boolean;
  refetch: jest.Mock;
} = {
  data: undefined,
  isError: false,
  isFetching: false,
  refetch: jest.fn(),
};
jest.mock('react', () => ({
  useState: (initial: unknown) => {
    const index = mockIndex++;
    if (!(index in mockStates)) mockStates[index] = initial;
    return [
      mockStates[index],
      (next: unknown) => {
        mockStates[index] =
          typeof next === 'function' ? (next as (mockValue: unknown) => unknown)(mockStates[index]) : next;
      },
    ];
  },
  useRef: (initial: unknown) => {
    const index = mockIndex++;
    return mockRefs[index] ?? (mockRefs[index] = { current: initial });
  },
  useEffect: (effect: () => void, deps?: unknown[]) => {
    const index = mockIndex++;
    const old = mockEffects[index];
    if (!old || !deps || deps.some((value, i) => !Object.is(value, old.deps?.[i]))) {
      mockPending.push(effect);
      mockEffects[index] = { deps };
    }
  },
}));
jest.mock('@tanstack/react-query', () => ({
  useQuery: (options: typeof mockOptions) => {
    mockOptions = options;
    return mockQuote;
  },
}));
jest.mock('../../../api/services', () => ({
  managerApi: { getSubscriptionQuote: (...args: unknown[]) => mockGetManager(...args) },
  tenantsApi: { getSubscriptionQuote: (...args: unknown[]) => mockGetTenant(...args) },
}));
jest.mock('../../../utils/offlineCheckQueue', () => ({ generateClientRequestId: () => `request-${++mockSequence}` }));
jest.mock('../renewalSession', () => ({
  captureRenewalSession: () => {
    const data = jest.requireActual('../../../contexts/dataSession').captureDataSession();
    const epoch = mockAuthEpoch;
    return { data, isCurrent: () => data.isCurrent() && epoch === mockAuthEpoch };
  },
}));
let mockAuthEpoch = 0;
import { setDataSession } from '../../../contexts/dataSession';
import { useSubscriptionRenewal } from '../useSubscriptionRenewal';
function preview(period: 'monthly' | 'yearly' = 'monthly', monthlyTotal = 20500) {
  return {
    planId: 'max',
    pricing: { code: 'max', includedEmployees: 50, includedPoints: 1 },
    usage: { employees: 51, activePoints: 2, billablePoints: 2 },
    quoteToken: `${monthlyTotal}-${period}`,
    quote: { period, employees: 51, points: 2, total: monthlyTotal * (period === 'yearly' ? 10 : 1), monthlyTotal },
  };
}
function mount(
  onSubmit: (request: unknown) => Promise<unknown>,
  mode: 'manager' | 'superadmin' = 'superadmin',
  onConfirmed?: () => void,
) {
  function NativeForm() {
    return useSubscriptionRenewal({ open: true, tenantId: 'tenant', mode, legacyPrice: 15000, onSubmit, onConfirmed });
  }
  const render = () => {
    let state!: ReturnType<typeof useSubscriptionRenewal>;
    for (let pass = 0; pass < 3; pass++) {
      mockIndex = 0;
      state = NativeForm();
      mockPending.splice(0).forEach((effect) => effect());
    }
    return state;
  };
  return render;
}
beforeEach(() => {
  mockAuthEpoch = 0;
  setDataSession({ userId: 'admin', tenantId: null, pointId: null });
  mockStates.length = 0;
  mockRefs.length = 0;
  mockEffects.length = 0;
  mockPending.length = 0;
  mockIndex = 0;
  mockSequence = 0;
  jest.clearAllMocks();
  mockQuote.data = preview();
  mockQuote.error = undefined;
  mockQuote.isError = false;
  mockQuote.isFetching = false;
  mockQuote.refetch.mockResolvedValue({ data: preview() });
});
it('prefills month/year with the full MAX staff/branch total and selects the manager quote endpoint', async () => {
  const render = mount(async () => undefined, 'manager');
  expect(render().amount).toBe('20500');
  render().setPeriod('yearly');
  mockQuote.data = preview('yearly');
  expect(render().amount).toBe('205000');
  mockGetManager.mockResolvedValue({ data: preview('yearly') });
  await mockOptions.queryFn();
  expect(mockGetManager).toHaveBeenCalledWith('tenant', { period: 'yearly', employees: 51, points: 2 });
  expect(mockGetTenant).not.toHaveBeenCalled();
});
it('stale quote requires review and preserves the actual operator amount after refreshed composition', async () => {
  const submit = jest.fn<Promise<unknown>, [unknown]>(async () => {
    throw { response: { status: 409, data: { code: 'QUOTE_CHANGED' } } };
  });
  const render = mount(submit);
  render().changeAmount('20000');
  await render().send({ type: 'paid', amount: 20000, period: 'monthly', quoteToken: 'old' });
  mockQuote.data = preview('monthly', 21000);
  expect(render().amount).toBe('20000');
  expect(render().quoteReady).toBe(false);
  expect(render().changed).toBe(true);
  expect(mockQuote.refetch).toHaveBeenCalledTimes(1);
  for (const period of ['monthly', 'yearly', 'custom'] as const) {
    render().setPeriod(period);
    expect(render().period).toBe('monthly');
    expect(render().changed).toBe(true);
    expect(render().quoteReady).toBe(false);
    expect(render().amount).toBe('20000');
    expect(submit).toHaveBeenCalledTimes(1);
  }
  mockQuote.data = preview('monthly', 21500);
  expect(render().amount).toBe('20000');
  expect(render().changed).toBe(true);
  render().acknowledgeChange();
  expect(render().quoteReady).toBe(true);
  submit.mockResolvedValueOnce(undefined);
  await render().send({ type: 'paid', amount: 20000, period: 'monthly', quoteToken: mockQuote.data.quoteToken });
  expect(submit).toHaveBeenCalledTimes(2);
  expect(submit.mock.calls[1][0]).toMatchObject({
    amount: 20000,
    period: 'monthly',
    quoteToken: mockQuote.data.quoteToken,
  });
});
it('locks a pending or uncertain intent and retries exactly the same amount/token/id after timeout', async () => {
  let reject!: (error: unknown) => void;
  const submit = jest
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        }),
    )
    .mockResolvedValue(undefined);
  const render = mount(submit);
  const request = { type: 'paid' as const, amount: 20000, period: 'yearly' as const, quoteToken: 'snapshot' };
  const pending = render().send(request);
  void render().send(request);
  expect(submit).toHaveBeenCalledTimes(1);
  expect(render().locked).toBe(true);
  expect(render().canClose()).toBe(false);
  reject(new Error('timeout'));
  await pending;
  expect(render().uncertain).toBe(true);
  render().changeAmount('1');
  render().setPeriod('custom');
  expect(render().amount).toBe('20500');
  expect(render().period).toBe('monthly');
  await render().send({ type: 'paid', amount: 1 });
  expect(submit.mock.calls[1][0]).toBe(submit.mock.calls[0][0]);
  expect(submit.mock.calls[1][0]).toEqual({ ...request, employees: 51, points: 2, requestId: 'request-1' });
  expect(render().canClose()).toBe(true);
});
it.each(['LEGACY_PLAN'])('supports manual date and free days when %s has no composition quote', async (code) => {
  mockQuote.data = undefined;
  mockQuote.isError = true;
  mockQuote.error = { response: { status: 400, data: { code } } };
  const submit = jest.fn(async (request: unknown) => request);
  const render = mount(submit);
  expect(render().period).toBe('custom');
  expect(render().fallback).not.toBe('');
  await render().send({ type: 'free', days: 14 });
  expect(submit.mock.calls[submit.mock.calls.length - 1]?.[0]).toEqual({
    type: 'free',
    days: 14,
    requestId: 'request-1',
  });
  await render().send({ type: 'paid', amount: 1234, until: '2027-01-01' });
  expect(submit.mock.calls[submit.mock.calls.length - 1]?.[0]).toEqual({
    type: 'paid',
    amount: 1234,
    until: '2027-01-01',
    requestId: 'request-2',
  });
});

it('normal period and composition changes replace a manual override with the full new invoice and explain it', () => {
  const render = mount(async () => undefined);
  render().changeAmount('123');
  render().setPeriod('yearly');
  mockQuote.data = preview('yearly');
  expect(render().amount).toBe('205000');
  expect(render().message).toBe('Сумма обновлена по расчёту');
  render().changeAmount('999');
  render().changeEmployees('52');
  mockQuote.data = { ...preview('yearly', 21000), quote: { ...preview('yearly', 21000).quote, employees: 52 } };
  expect(render().amount).toBe('210000');
  expect(render().employees).toBe('52');
});
it('usage growth after a stale quote keeps the collected money and lets editable counts recover before explicit review', async () => {
  const submit = jest.fn(async () => {
    throw { response: { status: 409, data: { code: 'QUOTE_CHANGED' } } };
  });
  const render = mount(submit);
  render().changeAmount('20000');
  await render().send({ type: 'paid', amount: 20000, period: 'monthly', quoteToken: 'old' });
  mockQuote.data = undefined;
  mockQuote.isError = true;
  mockQuote.error = {
    response: { status: 400, data: { code: 'COUNT_BELOW_USAGE', minimumEmployees: 52, minimumPoints: 3 } },
  };
  expect(render().locked).toBe(false);
  render().changeEmployees('52');
  render().changePoints('3');
  mockQuote.isError = false;
  mockQuote.error = undefined;
  mockQuote.data = {
    ...preview('monthly', 26000),
    usage: { employees: 52, activePoints: 3, billablePoints: 3 },
    quote: { ...preview('monthly', 26000).quote, employees: 52, points: 3 },
  };
  expect(render().amount).toBe('20000');
  expect(render().quoteReady).toBe(false);
  render().acknowledgeChange();
  expect(render().quoteReady).toBe(true);
});
it('ignores an old paid result and confirmation callback after an account/session change', async () => {
  let resolve!: () => void;
  const submit = jest.fn(
    () =>
      new Promise<void>((done) => {
        resolve = done;
      }),
  );
  const confirmed = jest.fn();
  const render = mount(submit, 'superadmin', confirmed);
  const pending = render().send({ type: 'paid', amount: 20000, period: 'monthly' });
  setDataSession({ userId: 'other', tenantId: null, pointId: null });
  render();
  resolve();
  await pending;
  expect(render().sending).toBe(false);
  expect(render().uncertain).toBe(false);
  expect(confirmed).not.toHaveBeenCalled();
});
it('bearer rotation releases only this form and retains the exact unknown request for a fresh-lease retry', async () => {
  let resolve!: () => void;
  const submit = jest
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    )
    .mockResolvedValue(undefined);
  const render = mount(submit);
  const pending = render().send({ type: 'paid', amount: 20000, period: 'monthly' });
  mockAuthEpoch++;
  resolve();
  await pending;
  expect(render().sending).toBe(false);
  expect(render().uncertain).toBe(true);
  render().changeEmployees('999');
  render().changePoints('999');
  expect(render().employees).toBe('51');
  expect(render().points).toBe('2');
  await render().send({ type: 'paid', amount: 1 });
  expect(submit.mock.calls[1][0]).toBe(submit.mock.calls[0][0]);
});
it.each([401, 403, 404, 429])(
  'an unknown result remains frozen after a retry gets HTTP %s before a receipt',
  async (status) => {
    const submit = jest
      .fn()
      .mockRejectedValueOnce(new Error('timeout'))
      .mockRejectedValueOnce({ response: { status, data: { message: 'Before receipt' } } })
      .mockResolvedValue(undefined);
    const render = mount(submit);
    await render().send({ type: 'paid', amount: 20000, period: 'monthly', quoteToken: 'snapshot' });
    await render().send({ type: 'paid', amount: 1 });
    expect(render().uncertain).toBe(true);
    expect(render().canClose()).toBe(false);
    render().changeAmount('1');
    render().changeEmployees('999');
    render().changePoints('999');
    expect(render().amount).toBe('20500');
    expect(render().employees).toBe('51');
    expect(render().points).toBe('2');
    await render().send({ type: 'paid', amount: 1 });
    expect(submit.mock.calls[2][0]).toBe(submit.mock.calls[0][0]);
  },
);
it('REQUEST_ID_REUSED never generates a replacement UUID or unlocks payment parameters', async () => {
  const submit = jest.fn().mockRejectedValue({ response: { status: 409, data: { code: 'REQUEST_ID_REUSED' } } });
  const render = mount(submit);
  await render().send({ type: 'paid', amount: 20000, period: 'monthly' });
  expect(render().uncertain).toBe(true);
  render().changeAmount('1');
  await render().send({ type: 'paid', amount: 1 });
  expect(submit.mock.calls[1][0]).toBe(submit.mock.calls[0][0]);
});
it('a failed stale-quote refresh preserves actual money and keeps review required without rejecting the handler', async () => {
  const submit = jest.fn().mockRejectedValue({ response: { status: 409, data: { code: 'QUOTE_CHANGED' } } });
  mockQuote.refetch.mockRejectedValueOnce(new Error('offline'));
  const render = mount(submit);
  render().changeAmount('12345');
  await expect(render().send({ type: 'paid', amount: 12345, period: 'monthly' })).resolves.toBeUndefined();
  expect(render().amount).toBe('12345');
  expect(render().changed).toBe(true);
  expect(render().message).toContain('сохранена');
});

function sheetSubmit(scope: Record<string, unknown>) {
  const source = ts.createSourceFile(
    'ExtendSubscriptionSheet.tsx',
    fs.readFileSync(path.join(__dirname, '../ExtendSubscriptionSheet.tsx'), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let expression = '';
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'submit' && node.initializer)
      expression = node.initializer.getText(source);
    ts.forEachChild(node, visit);
  }
  visit(source);
  if (!expression) throw new Error('Missing actual sheet submit');
  const js = ts.transpileModule(`const submit = ${expression};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return Function(...Object.keys(scope), `${js}; return submit;`)(...Object.values(scope)) as () => void;
}
it('UNPRICED_POINTS cannot revive the previous custom date or submit it without explicit manual selection', async () => {
  const submit = jest.fn(async (request: unknown) => request);
  mockQuote.data = {
    ...preview(),
    planId: 'pro',
    pricing: { code: 'pro', includedEmployees: 5, includedPoints: 1 },
    usage: { employees: 5, activePoints: 1, billablePoints: 1 },
    quote: { ...preview().quote, employees: 5, points: 1 },
  };
  const render = mount(submit);
  render().setPeriod('custom');
  const previousUntil = new Date('2027-06-01');
  render().changeAmount('12345');
  render().setPeriod('monthly');
  render().changePoints('2');
  mockQuote.data = undefined;
  mockQuote.isError = true;
  mockQuote.error = { response: { status: 400, data: { code: 'UNPRICED_POINTS' } } };
  const renewal = render();
  sheetSubmit({
    tenant: { id: 'tenant' },
    renewal,
    paid: true,
    amountNum: 12345,
    hasManager: false,
    creditManager: false,
    mode: 'superadmin',
    until: previousUntil,
    endOfDay: (date: Date) => date,
    haptic: jest.fn(),
    Alert: { alert: jest.fn() },
  })();
  await Promise.resolve();
  expect(submit).not.toHaveBeenCalled();
  expect(renewal.period).toBe('monthly');
  expect(renewal.points).toBe('2');
  expect(renewal.quoteReady).toBe(false);
  expect(renewal.locked).toBe(false);
  expect(renewal.fallback).toContain('MAX');
  await renewal.send({ type: 'paid', amount: 12345, until: previousUntil.toISOString() });
  expect(submit).not.toHaveBeenCalled();
  renewal.setPeriod('custom');
  await render().send({ type: 'paid', amount: 12345, until: previousUntil.toISOString() });
  expect(submit).toHaveBeenCalledTimes(1);
});
it('a background UNPRICED_POINTS error cannot block an exact retry of an unknown renewal receipt', async () => {
  const submit = jest.fn().mockRejectedValueOnce(new Error('lost ACK')).mockResolvedValue(undefined);
  const render = mount(submit);
  await render().send({ type: 'paid', amount: 20000, period: 'monthly', quoteToken: 'original' });
  mockQuote.isError = true;
  mockQuote.error = { response: { status: 400, data: { code: 'UNPRICED_POINTS' } } };
  await render().send({ type: 'paid', amount: 1 });
  expect(submit.mock.calls[1][0]).toBe(submit.mock.calls[0][0]);
});
