import fs from 'fs';
import path from 'path';
import ts from 'typescript';
import {
  getSubscriptionMonthlyDisplay,
  calculateSubscriptionQuote,
  SUBSCRIPTION_PLAN_PRICING,
} from '../../../../../shared/utils/subscriptionPricing';
import {
  planCompositionLabel,
  planIncludedLabel,
  subscriptionContactText,
  subscriptionMoney,
} from '../../../utils/subscriptionPricingText';
import { assignedSubscriptionPlan, subscriptionOffers } from '../../../../../shared/utils/subscriptionPresentation';
import type { SubscriptionQuotePreview } from '../../../../../shared/types';
type Element = { type: unknown; props: Record<string, unknown> & { children?: unknown[] } };
const createElement = (type: unknown, props: Record<string, unknown> | null, ...children: unknown[]) => ({
  type,
  props: { ...props, children },
});
function sourceExpression<T>(file: string, name: string, scope: Record<string, unknown>): T {
  const source = ts.createSourceFile(
    file,
    fs.readFileSync(
      process.env.SUBSCRIPTION_BASELINE_DIR
        ? path.join(process.env.SUBSCRIPTION_BASELINE_DIR, path.basename(file))
        : path.join(__dirname, file),
      'utf8',
    ),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let expression = '';
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name)
      expression = `function ${name}${node.getText(source).split(name).slice(1).join(name)}`;
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name && node.initializer)
      expression = node.initializer.getText(source);
    if (
      name === 'SubscriptionMenu' &&
      ts.isObjectLiteralExpression(node) &&
      node.properties.some(
        (p) =>
          ts.isPropertyAssignment(p) &&
          p.name.getText(source) === 'screen' &&
          p.initializer.getText(source) === "'Subscription'",
      )
    )
      expression = node.getText(source);
    ts.forEachChild(node, visit);
  }
  visit(source);
  if (!expression) throw new Error('Missing actual source ' + name);
  const js = ts.transpileModule(`const actual = ${expression};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText;
  return Function(...Object.keys(scope), `${js}; return actual;`)(...Object.values(scope)) as T;
}
function nodes(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== 'object' || !('props' in value)) return [];
  const element = value as Element;
  return [element, ...nodes(element.props.children)];
}
function text(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(text).join('');
  return value && typeof value === 'object' && 'props' in value ? text((value as Element).props.children) : '';
}
function preview(
  code: keyof typeof SUBSCRIPTION_PLAN_PRICING = 'max',
  employees = 51,
  points = 2,
  period: 'monthly' | 'yearly' = 'yearly',
) {
  const pricing = SUBSCRIPTION_PLAN_PRICING[code];
  const result = calculateSubscriptionQuote(pricing, { employees, points, period });
  if (!result.ok) throw new Error('fixture');
  return {
    planId: code,
    pricing,
    quote: result.quote,
    usage: { employees: Math.min(2, employees), activePoints: points, billablePoints: points },
    quoteToken: 'token',
  };
}
const palette = {
  text: { primary: 'black', secondary: 'gray' },
  border: { subtle: 'gray' },
  bg: { card: 'white', canvas: 'white', muted: 'white' },
  accent: { primary: 'blue', primaryText: 'blue', primarySoft: 'blue' },
};
function quoteRenderer() {
  let expanded = false;
  const render = sourceExpression<(props: { preview: SubscriptionQuotePreview; compact?: boolean }) => Element>(
    '../../../components/SubscriptionQuoteBreakdown.tsx',
    'SubscriptionQuoteBreakdown',
    {
      React: {
        createElement,
        useState: () => [
          expanded,
          (next: boolean | ((previous: boolean) => boolean)) => {
            expanded = typeof next === 'function' ? next(expanded) : next;
          },
        ],
      },
      View: 'View',
      Text: 'Text',
      TouchableOpacity: 'TouchableOpacity',
      useColors: () => palette,
      spacing: { 1: 4, 2: 8, 3: 12 },
      fontSize: { sm: 14, base: 17 },
      money: subscriptionMoney,
      getSubscriptionMonthlyDisplay,
    },
  );
  return render;
}
it.each<[keyof typeof SUBSCRIPTION_PLAN_PRICING, number, number, number, number, number, boolean]>([
  ['max', 50, 2, 18000, 180000, 15000, false],
  ['max', 51, 2, 18500, 185000, 15416.67, true],
  ['baza', 1, 1, 990, 9900, 825, false],
  ['pro', 6, 1, 5490, 54900, 4575, false],
])(
  'shows %s team %s branches %s with one monthly headline and exact annual invoice',
  (code, employees, points, monthly, annual, equivalent, approximate) => {
    const render = quoteRenderer();
    const month = preview(code, employees, points, 'monthly'),
      year = preview(code, employees, points, 'yearly');
    expect(month.quote.total).toBe(monthly);
    expect(year.quote.total).toBe(annual);
    expect(getSubscriptionMonthlyDisplay(year.quote)).toEqual({ amount: equivalent, approximate });
    expect(text(render({ preview: month, compact: true }))).toContain(subscriptionMoney(monthly) + '/мес');
    const collapsed = render({ preview: year, compact: true });
    expect(text(collapsed)).toContain(subscriptionMoney(equivalent) + '/мес');
    expect(text(collapsed)).toContain('в месяц при оплате за год');
    expect(text(collapsed)).toContain('К оплате сразу за 12 месяцев: ' + subscriptionMoney(annual));
    expect(text(collapsed)).not.toContain('За 12 месяцев: база');
    const details = nodes(collapsed).find((node) => node.props.accessibilityLabel === 'Детали расчёта')!;
    (details.props.onPress as () => void)();
    expect(text(render({ preview: year, compact: true }))).toContain('За 12 месяцев: база');
  },
);
it('keeps rubles attached to their price and full operator breakdown available by default', () => {
  expect(subscriptionMoney(185000)).toMatch(/\u00a0₽$/);
  expect(text(quoteRenderer()({ preview: preview() }))).toContain('За 12 месяцев: база');
});
it.each(['ios', 'android'])('actual More menu entry uses company permission on %s', (os) => {
  const colors = new Proxy({}, { get: () => new Proxy({}, { get: () => 'blue' }) });
  const item = sourceExpression<{ permission: string }>('../../MoreScreen.tsx', 'SubscriptionMenu', { colors });
  expect(item.permission).toBe('company_manage');
  const filter = (allowed: boolean) =>
    sourceExpression<(value: unknown) => boolean>('../../MoreScreen.tsx', 'filterItem', {
      Platform: { OS: os },
      hasPermission: () => allowed,
      user: { role: 'admin' },
      multiPoint: false,
    });
  expect(filter(true)(item)).toBe(true);
  expect(filter(false)(item)).toBe(false);
});
function screen(
  os = 'ios',
  overrides: Record<string, unknown> = {},
  subscriptionOverrides: Record<string, unknown> = {},
  runtime: Record<string, unknown> = {},
) {
  const plans = Object.values(SUBSCRIPTION_PLAN_PRICING).map((pricing) => ({
    id: pricing.code,
    name: pricing.name,
    pricing,
    isActive: true,
    features: [] as string[],
  }));
  const sub = {
    planId: 'pro',
    planName: 'PRO',
    tenantName: 'Сервис',
    currentUsers: 2,
    features: ['private'],
    usage: { employees: 2, activePoints: 1, billablePoints: 1 },
    plans,
    ...subscriptionOverrides,
  };
  const choose = jest.fn(),
    dismissKeyboard = jest.fn(),
    link = jest.fn();
  const calc = {
    planId: 'max',
    name: 'MAX',
    employees: '2',
    points: '1',
    period: 'monthly',
    actualEmployees: 2,
    actualPoints: 1,
    setEmployees: jest.fn(),
    setPoints: jest.fn(),
    setPlan: choose,
    setPeriod: jest.fn(),
    quote: { data: preview('max', 2, 1, 'monthly'), isFetching: false, isError: false, refetch: jest.fn() },
    ready: true,
    valid: true,
    message: '',
    unsupportedPoints: false,
    maxPlan: plans[2],
    plan: plans[2],
    ...overrides,
  };
  const flags = [false, false, false];
  let stateIndex = 0;
  const components = Object.fromEntries(
    [
      'View',
      'Text',
      'TouchableOpacity',
      'RefreshControl',
      'KeyboardAwareScroll',
      'InputAccessoryView',
      'IosScreenHeader',
      'SubscriptionQuoteBreakdown',
      'SubscriptionCompositionFields',
      'LoadingSpinner',
      'Ionicons',
    ].map((name) => [name, name]),
  );
  const component = sourceExpression<() => Element>('../../SubscriptionScreen.tsx', 'SubscriptionScreen', {
    ...components,
    React: {
      createElement,
      useState: (initial: boolean) => {
        const index = stateIndex++;
        return [
          flags[index] ?? initial,
          (next: boolean | ((previous: boolean) => boolean)) => {
            flags[index] = typeof next === 'function' ? next(flags[index]) : next;
          },
        ];
      },
    },
    Platform: { OS: os },
    useNavigation: () => ({ goBack: jest.fn() }),
    useQueryClient: () => ({}),
    useColors: () => palette,
    useAuth: () => ({ hasPermission: () => runtime.allowed !== false }),
    useQuery: () => ({ data: sub, isLoading: false, isError: false, refetch: jest.fn(), ...runtime }),
    useSubscriptionCalculator: () => calc,
    styles: {},
    planCompositionLabel,
    planIncludedLabel,
    assignedSubscriptionPlan,
    subscriptionOffers,
    subscriptionMoney,
    spacing: {},
    fontSize: {},
    fontWeight: { semibold: '600', normal: '400' },
    ALL_FEATURES: [{ key: 'private', label: 'Индивидуальная возможность' }],
    subscriptionContactText,
    WHATSAPP_PHONE: 'phone',
    Linking: { openURL: link },
    Keyboard: { dismiss: dismissKeyboard },
  });
  return {
    render: () => {
      stateIndex = 0;
      return component();
    },
    choose,
    dismissKeyboard,
    calc,
    sub,
    link,
  };
}
it.each(['ios', 'android'])(
  'current plan precedes a separate new constructor, with read-only iOS and keyboard affordances (%s)',
  (os) => {
    const h = screen(os),
      result = h.render(),
      list = nodes(result),
      copy = text(result);
    expect(copy).toContain('Текущая подписка');
    expect(copy).toContain('Соберите новый тариф');
    expect(copy).not.toContain('веб-версии');
    const employeePosition = list.findIndex((node) => node.type === 'SubscriptionCompositionFields');
    const planPosition = list.findIndex((node) => String(node.props.accessibilityLabel ?? '').startsWith('Тариф '));
    expect(planPosition).toBeLessThan(employeePosition);
    expect(list[employeePosition].props.employeePresets).toBe(true);
    expect(list.find((node) => node.type === 'SubscriptionQuoteBreakdown')?.props.compact).toBe(true);
    expect(copy.includes('Подключить')).toBe(false);
    expect(copy.includes('Обсудить этот расчёт')).toBe(os === 'android');
    expect(list.find((node) => node.type === 'SubscriptionQuoteBreakdown')?.props.informational).toBe(os === 'ios');
    const scroll = list.find((node) => node.type === 'KeyboardAwareScroll');
    expect(scroll?.props.extraKeyboardBottomOffset).toBe(48);
    expect(scroll?.props.reserveTabBar).not.toBe(false);
    const fields = list[employeePosition],
      accessory = list.find((node) => node.type === 'InputAccessoryView');
    if (os === 'ios') {
      expect(fields.props.inputAccessoryViewID).toBe(accessory?.props.nativeID);
      (list.find((node) => node.props.accessibilityLabel === 'Скрыть клавиатуру')!.props.onPress as () => void)();
      expect(h.dismissKeyboard).toHaveBeenCalledTimes(1);
    } else {
      expect(accessory).toBeUndefined();
    }
    expect(h.choose).not.toHaveBeenCalled();
    expect(h.sub.planId).toBe('pro');
  },
);
it('unsupported branch recovery is an explicit local MAX action and preserves selected raw counts', () => {
  const h = screen('ios', {
    planId: 'baza',
    employees: '003',
    points: '02',
    ready: false,
    unsupportedPoints: true,
    message: 'Для нескольких филиалов выберите MAX.',
  });
  const result = h.render();
  expect(h.choose).not.toHaveBeenCalled();
  const action = nodes(result).find(
    (node) => node.type === 'TouchableOpacity' && text(node.props.children) === 'Рассчитать MAX',
  )!;
  (action.props.onPress as () => void)();
  expect(h.choose).toHaveBeenCalledWith('max');
  expect(h.calc.employees).toBe('003');
  expect(h.calc.points).toBe('02');
  expect(h.sub.planId).toBe('pro');
  expect(nodes(result).some((node) => node.type === 'SubscriptionQuoteBreakdown')).toBe(false);
});
it.each([
  { ready: false, valid: false, message: 'Проверьте число' },
  { ready: false, quote: { data: preview(), isFetching: true, isError: false } },
  { ready: false, message: 'Расчёт недоступен', quote: { data: preview(), isFetching: false, isError: true } },
])('does not show stale pricing while a selection is invalid, loading or unknown', (state) => {
  expect(nodes(screen('ios', state).render()).some((node) => node.type === 'SubscriptionQuoteBreakdown')).toBe(false);
});
it('current assigned archive and its features stay separate from selected custom plan conditions', () => {
  const custom = {
    id: 'max',
    name: 'Индивидуальный',
    isActive: true,
    features: ['selected'],
    pricing: { ...SUBSCRIPTION_PLAN_PRICING.max, includedEmployees: 9, extraEmployeeMonthlyPrice: 123 },
  };
  const h = screen(
    'ios',
    { plan: custom, pricing: custom.pricing },
    {
      currentPlan: { ...custom, id: 'pro', isActive: false },
      features: ['private'],
      monthlyPrice: 0,
      maxUsers: 7,
      subscriptionEnd: null,
    },
  );
  expect(text(h.render())).toContain('Архивный тариф');
  expect(text(h.render())).toContain('Без ограничения срока');
  expect(text(h.render())).toContain(subscriptionMoney(0));
  const currentAction = nodes(h.render()).find(
    (node) => node.props.accessibilityLabel === 'Возможности текущего тарифа',
  )!;
  (currentAction.props.onPress as () => void)();
  expect(text(h.render())).toContain('Индивидуальная возможность');
  const selectedAction = nodes(h.render()).find(
    (node) => node.props.accessibilityLabel === 'Условия выбранного тарифа',
  )!;
  (selectedAction.props.onPress as () => void)();
  expect(text(h.render())).toContain(subscriptionMoney(123));
  expect(text(h.render())).toContain('Сотрудников включено: 9');
  expect(h.sub.planId).toBe('pro');
});
it('legacy current plan receives no reused invoice or guessed archive while new offers remain available', () => {
  const h = screen(
    'ios',
    { ready: false, plan: undefined, pricing: undefined, planId: undefined, period: 'yearly', message: '' },
    { planId: 'legacy', planName: 'Прежний', currentPlan: undefined },
  );
  const tree = h.render();
  expect(nodes(tree).some((node) => node.type === 'SubscriptionQuoteBreakdown')).toBe(false);
  expect(text(tree)).not.toContain('Архивный тариф');
  expect(text(tree)).toContain('Выберите тариф');
});
it('Android draft text carries selected composition and exact annual invoice without sending it', () => {
  const copy = subscriptionContactText('MAX', preview());
  expect(copy).toContain('Сотрудники: 51');
  expect(copy).toContain('Филиалы: 2');
  expect(copy).toContain('12 месяцев');
  expect(copy).toContain(subscriptionMoney(185000));
});
it('actual employee presets and manual fields remain keyboard-accessible, while admin callers keep their existing layout', () => {
  const render = sourceExpression<(props: Record<string, unknown>) => Element>(
    '../../../components/SubscriptionCompositionFields.tsx',
    'SubscriptionCompositionFields',
    {
      React: { createElement },
      View: 'View',
      Text: 'Text',
      TextInput: 'TextInput',
      TouchableOpacity: 'TouchableOpacity',
      useColors: () => palette,
      styles: {},
      fontSize: {},
    },
  );
  const choose = jest.fn(),
    props = { employees: '2', points: '1', onEmployees: choose, onPoints: jest.fn() };
  const tree = render({
    ...props,
    employeePresets: true,
    minimumEmployees: 2,
    inputAccessoryViewID: 'subscription-calculator-done',
  });
  const inputs = nodes(tree).filter((node) => node.type === 'TextInput');
  expect(inputs).toHaveLength(2);
  expect(inputs.every((node) => node.props.inputAccessoryViewID === 'subscription-calculator-done')).toBe(true);
  const one = nodes(tree).find((node) => node.props.accessibilityLabel === 'Сотрудников: 1')!;
  expect(one.props.disabled).toBe(true);
  const three = nodes(tree).find((node) => node.props.accessibilityLabel === 'Сотрудников: 3')!;
  (three.props.onPress as () => void)();
  expect(choose).toHaveBeenCalledWith('3');
  expect(nodes(render(props)).filter((node) => node.type === 'TouchableOpacity')).toHaveLength(0);
});
it('uses server allowances and monthly addon rates in details without declaring a minimum team', () => {
  expect(planIncludedLabel({ pricing: { ...SUBSCRIPTION_PLAN_PRICING.pro, includedEmployees: 17 } })).toContain('17');
  const copy = planCompositionLabel({ pricing: SUBSCRIPTION_PLAN_PRICING.baza });
  expect(copy).toContain('Сотрудников включено: 1');
  expect(copy).toContain('при помесячной оплате');
});
it.each(['ios', 'android'])('empty and unassigned state cannot send an incomplete quote on %s', (os) => {
  for (const empty of [false, true]) {
    const h = screen(
      os,
      { planId: undefined, name: undefined, plan: undefined, ready: false },
      { planId: null, planName: null, ...(empty ? { plans: [] } : {}) },
    );
    const actions = nodes(h.render()).filter(
      (node) => node.type === 'TouchableOpacity' && text(node.props.children) === 'Обсудить этот расчёт',
    );
    expect(actions).toHaveLength(os === 'android' && !empty ? 1 : 0);
    if (actions[0]) {
      expect(actions[0].props.disabled).toBe(true);
      (actions[0].props.onPress as () => void)();
    }
    expect(h.link).not.toHaveBeenCalled();
    expect(h.choose).not.toHaveBeenCalled();
  }
});
it.each([true, false])('Android contact uses exact selected quote only when ready=%s', (ready) => {
  const h = screen('android', { ready });
  const action = nodes(h.render()).find(
    (node) => node.type === 'TouchableOpacity' && text(node.props.children) === 'Обсудить этот расчёт',
  )!;
  expect(action.props.disabled).toBe(!ready);
  (action.props.onPress as () => void)();
  if (ready) {
    const copy = new URL(h.link.mock.calls[0][0] as string).searchParams.get('text')!;
    expect(copy).toContain('тариф "MAX"');
    expect(copy).toContain('Сотрудники: 2');
    expect(copy).toContain('К оплате:');
  } else expect(h.link).not.toHaveBeenCalled();
  expect(h.choose).not.toHaveBeenCalled();
});
it.each([
  [{}, {}, {}],
  [{ ready: false, plan: undefined }, { planId: 'legacy', currentPlan: undefined }, {}],
  [{ ready: false }, { plans: [] }, {}],
  [
    { ready: false, message: 'Ошибка расчёта', quote: { isError: true, isFetching: false, refetch: jest.fn() } },
    {},
    {},
  ],
  [{ ready: false, quote: { isError: false, isFetching: true } }, {}, {}],
  [{}, {}, { isError: true }],
  [{}, {}, { allowed: false }],
])(
  'iOS never offers an external purchase action in normal, legacy, empty, loading, error or denied state',
  (calc, sub, runtime) => {
    const h = screen('ios', calc, sub, runtime);
    const copy = text(h.render());
    expect(copy).not.toMatch(/WhatsApp|Связаться|Обсудить этот расчёт|оплатить|Подключить/);
    for (const action of nodes(h.render()).filter((node) => typeof node.props.onPress === 'function'))
      (action.props.onPress as () => void)();
    expect(h.link).not.toHaveBeenCalled();
  },
);
it('unknown end, explicit custom active and mismatched current metadata never imply archive', () => {
  for (const metadata of [undefined, { id: 'pro', isActive: true }, { id: 'another', isActive: false }]) {
    const h = screen('ios', {}, { currentPlan: metadata, subscriptionEnd: undefined });
    expect(text(h.render())).not.toContain('Архивный тариф');
    expect(text(h.render())).toContain('Срок не указан');
  }
});
it('iOS annual breakdown labels a calculation instead of a payable invoice', () => {
  const render = quoteRenderer();
  const tree = render({ preview: preview(), informational: true } as Parameters<typeof render>[0]);
  expect(text(tree)).toContain('Расчёт за 12 месяцев');
  expect(text(tree)).not.toContain('К оплате');
});
