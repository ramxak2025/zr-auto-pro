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
        mockStates[index] = next;
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
import { useSubscriptionRenewal } from '../useSubscriptionRenewal';
function preview(period: 'monthly' | 'yearly' = 'monthly', monthlyTotal = 20500) {
  return {
    planId: 'max',
    pricing: { code: 'max' },
    usage: { employees: 51, activePoints: 2, billablePoints: 2 },
    quoteToken: `${monthlyTotal}-${period}`,
    quote: { period, total: monthlyTotal * (period === 'yearly' ? 10 : 1), monthlyTotal },
  };
}
function mount(onSubmit: (request: unknown) => Promise<unknown>, mode: 'manager' | 'superadmin' = 'superadmin') {
  function NativeForm() {
    return useSubscriptionRenewal({ open: true, tenantId: 'tenant', mode, legacyPrice: 15000, onSubmit });
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
  expect(mockGetManager).toHaveBeenCalledWith('tenant', { period: 'yearly' });
  expect(mockGetTenant).not.toHaveBeenCalled();
});
it('stale quote requires review and preserves the actual operator amount after refreshed composition', async () => {
  const submit = jest.fn(async () => {
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
  render().acknowledgeChange();
  expect(render().quoteReady).toBe(true);
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
  expect(submit.mock.calls[1][0]).toEqual({ ...request, requestId: 'request-1' });
  expect(render().canClose()).toBe(true);
});
it.each(['LEGACY_PLAN', 'UNPRICED_POINTS'])(
  'supports manual date and free days when %s has no composition quote',
  async (code) => {
    mockQuote.data = undefined;
    mockQuote.isError = true;
    mockQuote.error = { response: { status: 400, data: { code } } };
    const submit = jest.fn(async () => undefined);
    const render = mount(submit);
    expect(render().period).toBe('custom');
    expect(render().fallback).not.toBe('');
    await render().send({ type: 'free', days: 14 });
    expect(submit).toHaveBeenLastCalledWith({ type: 'free', days: 14, requestId: 'request-1' });
    await render().send({ type: 'paid', amount: 1234, until: '2027-01-01' });
    expect(submit).toHaveBeenLastCalledWith({
      type: 'paid',
      amount: 1234,
      until: '2027-01-01',
      requestId: 'request-2',
    });
  },
);
