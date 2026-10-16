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
  subscriptionContactText,
  subscriptionMoney,
} from '../../../utils/subscriptionPricingText';
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
function preview() {
  const result = calculateSubscriptionQuote(SUBSCRIPTION_PLAN_PRICING.max, {
    employees: 51,
    points: 2,
    period: 'yearly',
  });
  if (!result.ok) throw new Error('fixture');
  return {
    planId: 'max',
    pricing: SUBSCRIPTION_PLAN_PRICING.max,
    quote: result.quote,
    usage: { employees: 51, activePoints: 2, billablePoints: 2 },
    quoteToken: 'token',
  };
}
const palette = {
  text: { primary: 'black', secondary: 'gray' },
  border: { subtle: 'gray' },
  bg: { card: 'white', canvas: 'white', muted: 'white' },
  accent: { primary: 'blue', primaryText: 'blue', primarySoft: 'blue' },
};
it('renders the exact annual invoice and annual components, with a rounded approximate monthly headline', () => {
  const render = sourceExpression<(props: { preview: SubscriptionQuotePreview }) => Element>(
    '../../../components/SubscriptionQuoteBreakdown.tsx',
    'SubscriptionQuoteBreakdown',
    {
      React: { createElement },
      View: 'View',
      Text: 'Text',
      useColors: () => palette,
      spacing: { 2: 8, 3: 12 },
      fontSize: { sm: 14, base: 17 },
      money: subscriptionMoney,
      getSubscriptionMonthlyDisplay,
    },
  );
  const result = text(render({ preview: preview() }));
  expect(result).toContain('≈ 17');
  expect(result).toContain('083,33');
  expect(result).toContain('в месяц при оплате за год');
  expect(result).toContain('К оплате сразу за 12 месяцев: 205');
  expect(result).toContain('150');
  expect(result).toContain('50');
  expect(result).toContain('За 12 месяцев');
  expect(preview().quote.total).toBe(205000);
  expect(getSubscriptionMonthlyDisplay(preview().quote).amount * 12).not.toBe(205000);
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
it.each(['ios', 'android'])(
  'actual SubscriptionScreen exposes calculation but purchase CTAs only on Android (%s)',
  (os) => {
    const sub = {
      planId: 'pro',
      planName: 'PRO',
      tenantName: 'Сервис',
      currentUsers: 2,
      plans: [
        { id: 'pro', name: 'PRO' },
        { id: 'max', name: 'MAX', features: [] },
      ],
    };
    const calc = {
      planId: 'max',
      name: 'MAX',
      employees: '51',
      points: '2',
      period: 'yearly',
      actualEmployees: 2,
      actualPoints: 1,
      quote: { data: preview(), isFetching: false, isError: false },
      ready: true,
      plan: sub.plans[1],
    };
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
    const dismissKeyboard = jest.fn();
    const render = sourceExpression<() => Element>('../../SubscriptionScreen.tsx', 'SubscriptionScreen', {
      ...components,
      React: { createElement, useState: (initial: unknown) => [initial, jest.fn()] },
      Platform: { OS: os },
      useNavigation: () => ({ goBack: jest.fn() }),
      useQueryClient: () => ({}),
      useColors: () => palette,
      useAuth: () => ({ hasPermission: () => true }),
      useQuery: () => ({ data: sub, isLoading: false, isError: false }),
      useSubscriptionCalculator: () => calc,
      styles: {},
      planCompositionLabel: () => 'Включено 50',
      spacing: {},
      fontSize: {},
      ALL_FEATURES: [],
      subscriptionContactText,
      WHATSAPP_PHONE: 'phone',
      Linking: { openURL: jest.fn() },
      Keyboard: { dismiss: dismissKeyboard },
    });
    const result = render(),
      copy = text(result);
    expect(copy).toContain('Расчёт стоимости');
    expect(copy).not.toContain('веб-версии');
    expect(nodes(result).some((node) => node.type === 'SubscriptionCompositionFields')).toBe(true);
    expect(copy.includes('Связаться для оплаты')).toBe(os === 'android');
    expect(copy.includes('Подключить')).toBe(os === 'android');
    const scroll = nodes(result).find((node) => node.type === 'KeyboardAwareScroll');
    expect(scroll?.props.extraKeyboardBottomOffset).toBe(48);
    expect(scroll?.props.reserveTabBar).not.toBe(false);
    const fields = nodes(result).find((node) => node.type === 'SubscriptionCompositionFields');
    const accessory = nodes(result).find((node) => node.type === 'InputAccessoryView');
    if (os === 'ios') {
      expect(fields?.props.inputAccessoryViewID).toBe(accessory?.props.nativeID);
      expect(accessory?.props.nativeID).toBe('subscription-calculator-done');
      const done = nodes(result).find((node) => node.props.accessibilityLabel === 'Скрыть клавиатуру');
      (done?.props.onPress as () => void)();
      expect(dismissKeyboard).toHaveBeenCalledTimes(1);
    } else {
      expect(accessory).toBeUndefined();
    }
  },
);
it('Android draft text carries the selected composition, annual period and full invoice without sending it', () => {
  const copy = subscriptionContactText('MAX', preview());
  expect(copy).toContain('Сотрудники: 51');
  expect(copy).toContain('Филиалы: 2');
  expect(copy).toContain('12 месяцев');
  expect(copy).toContain('205');
});

it('connects both actual numeric fields to the optional iOS accessory while leaving sheet callers unchanged', () => {
  const render = sourceExpression<(props: Record<string, unknown>) => Element>(
    '../../../components/SubscriptionCompositionFields.tsx',
    'SubscriptionCompositionFields',
    {
      React: { createElement },
      View: 'View',
      Text: 'Text',
      TextInput: 'TextInput',
      useColors: () => palette,
      styles: {},
      fontSize: {},
    },
  );
  const props = { employees: '2', points: '1', onEmployees: jest.fn(), onPoints: jest.fn() };
  const inputs = nodes(render({ ...props, inputAccessoryViewID: 'subscription-calculator-done' })).filter(
    (node) => node.type === 'TextInput',
  );
  expect(inputs).toHaveLength(2);
  expect(inputs.every((node) => node.props.inputAccessoryViewID === 'subscription-calculator-done')).toBe(true);
  expect(
    nodes(render(props))
      .filter((node) => node.type === 'TextInput')
      .every((node) => node.props.inputAccessoryViewID === undefined),
  ).toBe(true);
});
it('labels included one without a broken noun ending and identifies monthly addon rates and yearly discounts', () => {
  const copy = planCompositionLabel({
    id: 'baza',
    name: 'BAZA',
    pricing: SUBSCRIPTION_PLAN_PRICING.baza,
  } as import('../../../../../shared/types').Plan);
  expect(copy).toContain('Сотрудников включено: 1');
  expect(copy).toContain('при помесячной оплате');
  expect(copy).toContain('При оплате за год скидка');
});
