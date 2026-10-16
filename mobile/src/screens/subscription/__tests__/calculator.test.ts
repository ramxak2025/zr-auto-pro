const mockStates: unknown[] = [],
  mockPending: (() => void)[] = [];
const mockEffects: { deps?: unknown[] }[] = [];
let mockIndex = 0;
let mockOptions: { queryFn: () => Promise<unknown>; queryKey: unknown[]; enabled: boolean };
const mockQuoteApi = jest.fn();
const mockQuote: {
  data?: import('../../../../../shared/types').SubscriptionQuotePreview;
  error?: unknown;
  isFetching: boolean;
  isError: boolean;
  refetch: jest.Mock;
} = {
  isFetching: false,
  isError: false,
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
  subscriptionApi: { quote: (...args: unknown[]) => mockQuoteApi(...args) },
}));
import { useSubscriptionCalculator } from '../useSubscriptionCalculator';
import { SUBSCRIPTION_PLAN_PRICING } from '../../../../../shared/utils/subscriptionPricing';
import type { Plan, SubscriptionInfo, SubscriptionQuotePreview } from '../../../../../shared/types';
const plans = Object.values(SUBSCRIPTION_PLAN_PRICING).map((pricing) => ({
  id: pricing.code,
  name: pricing.name,
  pricing,
  maxUsers: pricing.includedEmployees,
  isActive: true,
})) as Plan[];
function subscription(actual = 2, points = 1) {
  return {
    planId: 'pro',
    plans,
    currentUsers: actual,
    usage: { employees: actual, activePoints: points, billablePoints: points },
  } as SubscriptionInfo;
}
const render = (sub = subscription()) => {
  function NativeCalculator() {
    return useSubscriptionCalculator(sub, true);
  }
  let result!: ReturnType<typeof useSubscriptionCalculator>;
  for (let i = 0; i < 3; i++) {
    mockIndex = 0;
    result = NativeCalculator();
    mockPending.splice(0).forEach((effect) => effect());
  }
  return result;
};
beforeEach(() => {
  mockStates.length = 0;
  mockEffects.length = 0;
  mockPending.length = 0;
  mockIndex = 0;
  jest.clearAllMocks();
  mockQuoteApi.mockResolvedValue({ data: {} });
  mockQuote.data = undefined;
  mockQuote.error = undefined;
  mockQuote.isError = false;
  mockQuote.isFetching = false;
});
it('uses server presets and actual minima, then preserves explicit selections below included when comparing', async () => {
  expect(render().employees).toBe('5');
  render().setPlan('max');
  expect(render().employees).toBe('50');
  render().setEmployees('3');
  render().setPoints('2');
  render().setPlan('baza');
  expect(render().employees).toBe('3');
  expect(render().points).toBe('2');
  render().setPeriod('yearly');
  render();
  await mockOptions.queryFn();
  expect(mockQuoteApi).toHaveBeenCalledWith({ planId: 'baza', period: 'yearly', employees: 3, points: 2 });
  expect(mockOptions.queryKey).toEqual(['subscription-quote', 'baza', 'yearly', 3, 2]);
});
it('never resets two actual branches to one and gives the MAX explanation', () => {
  const sub = subscription(2, 2);
  render(sub).setPlan('baza');
  expect(render(sub).points).toBe('2');
  mockQuote.isError = true;
  mockQuote.error = { response: { status: 400, data: { code: 'UNPRICED_POINTS' } } };
  expect(render(sub).message).toContain('MAX');
  expect(render(sub).points).toBe('2');
});
it('keeps invalid and below-usage inputs editable; a server usage increase cannot deadlock recovery', () => {
  render().setEmployees('1');
  expect(render().valid).toBe(false);
  expect(mockOptions.enabled).toBe(false);
  render().setEmployees('7');
  expect(render().valid).toBe(true);
  mockQuote.isError = true;
  mockQuote.error = {
    response: { status: 400, data: { code: 'COUNT_BELOW_USAGE', minimumEmployees: 8, minimumPoints: 2 } },
  };
  expect(render().actualEmployees).toBe(8);
  expect(render().valid).toBe(false);
  render().setEmployees('8');
  render().setPoints('2');
  expect(render().valid).toBe(true);
});
it('obtains inactive current-plan metadata from its quote without inventing features', () => {
  const sub = { ...subscription(1), planId: 'disabled', planName: 'Прежний MAX', plans: [] };
  mockQuote.data = {
    planId: 'disabled',
    pricing: { ...SUBSCRIPTION_PLAN_PRICING.max, name: 'Прежний MAX' },
    usage: { employees: 1, activePoints: 1, billablePoints: 1 },
    quote: { period: 'monthly', employees: 1, points: 1 },
  } as SubscriptionQuotePreview;
  expect(render(sub).employees).toBe('50');
  expect(render(sub).name).toBe('Прежний MAX');
  expect(render(sub).plan).toBeUndefined();
  expect(render(sub).ready).toBe(false);
});
