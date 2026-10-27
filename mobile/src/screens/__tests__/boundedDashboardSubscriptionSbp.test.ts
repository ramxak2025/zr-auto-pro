import fs from 'fs';
import path from 'path';
import ts from 'typescript';
import { applyWidgetOrder, isWidgetVisible } from '../dashboard/dashboardWidgets';
const source = (file: string) =>
  ts.createSourceFile(
    file,
    fs.readFileSync(path.join(process.env.BOUNDED_BASELINE_DIR ?? path.join(__dirname, '..'), file), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
function find(file: ts.SourceFile, predicate: (node: ts.Node) => boolean): ts.Node {
  let found: ts.Node | undefined;
  const visit = (node: ts.Node) => {
    if (!found && predicate(node)) found = node;
    ts.forEachChild(node, visit);
  };
  visit(file);
  if (!found) throw new Error('Actual source expression not found');
  return found;
}
function evaluate<T>(expression: string, scope: Record<string, unknown>): T {
  const js = ts.transpileModule(`const result = ${expression};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React },
  }).outputText;
  return Function(...Object.keys(scope), `${js}; return result`)(...Object.values(scope)) as T;
}
type Element = {
  type: string;
  props: { children?: unknown; accessibilityState: { checked: boolean }; onPress: () => void; name?: string };
};
const nodes = (value: unknown): Element[] =>
  Array.isArray(value)
    ? value.flatMap(nodes)
    : value && typeof value === 'object' && 'props' in value
      ? [value as Element, ...nodes((value as Element).props.children)]
      : [];
const React = {
  createElement: (type: unknown, props: unknown, ...children: unknown[]) => ({
    type,
    props: { ...(props as object), children },
  }),
};
test('actual tariff rows move the white check with the selected radio in both themes', () => {
  const file = source('SubscriptionScreen.tsx');
  const map = find(
    file,
    (n) => ts.isCallExpression(n) && n.expression.getText(file) === 'choices.map',
  ) as ts.CallExpression;
  const choices = [
    { id: 'a', name: 'Очень длинное название тарифа для автосервиса' },
    { id: 'b', name: 'Второй' },
  ];
  for (const mode of ['light', 'dark']) {
    let selected = 'a';
    const palette = {
      border: { subtle: 'gray' },
      bg: { muted: mode, card: mode },
      accent: { primary: 'blue' },
      text: { primary: 'text', secondary: 'secondary' },
    };
    const render = () =>
      evaluate<Element[]>(map.getText(file), {
        React,
        choices,
        calc: {
          planId: selected,
          setPlan: (id: string) => {
            selected = id;
          },
        },
        palette,
        styles: { planChoice: {}, flex: {}, label: {}, caption: {}, planIndicator: {} },
        planIncludedLabel: () => 'included',
        TouchableOpacity: 'TouchableOpacity',
        View: 'View',
        Text: 'Text',
        Ionicons: 'Ionicons',
      });
    let rows = render();
    expect(rows.map((r) => r.props.accessibilityState.checked)).toEqual([true, false]);
    expect(nodes(rows[0]).find((n) => n.type === 'Ionicons')?.props).toMatchObject({
      name: 'checkmark',
      color: '#FFFFFF',
    });
    expect(nodes(rows[1]).filter((n) => n.type === 'Ionicons')).toHaveLength(0);
    rows[1].props.onPress();
    rows = render();
    expect(rows.map((r) => r.props.accessibilityState.checked)).toEqual([false, true]);
    expect(nodes(rows[1]).find((n) => n.type === 'Ionicons')?.props.name).toBe('checkmark');
  }
});
test('actual SBP offer and handler allow only card; confirmed payment still commits', () => {
  const file = source('CheckCreateScreen.tsx');
  const candidates: ts.JsxExpression[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isJsxExpression(n) && n.expression?.getText(file).includes('onPress={openSbpPayment}')) candidates.push(n);
    ts.forEachChild(n, visit);
  };
  visit(file);
  const gate = candidates.sort((a, b) => a.getText(file).length - b.getText(file).length)[0];
  const expr = gate.expression as ts.BinaryExpression;
  const callback = (name: string) =>
    (
      find(file, (n) => ts.isVariableDeclaration(n) && n.name.getText(file) === name) as ts.VariableDeclaration
    ).initializer!.getText(file);
  for (const paymentMethod of ['cash', 'cash_card', 'warranty', 'installment', '', 'card']) {
    const visible = evaluate<boolean>(expr.left.getText(file), {
      paymentMethod,
      isDeferred: false,
      total: 10,
      serviceLines: [{}],
      productLines: [],
    });
    expect(visible).toBe(paymentMethod === 'card');
    if (paymentMethod !== 'card') {
      const alert = jest.fn();
      const handler = evaluate<() => void>(callback('openSbpPayment'), {
        paymentMethod,
        isDeferred: false,
        submittingRef: { current: false },
        createMutation: { isPending: false },
        serviceLines: [],
        productLines: [],
        haptic: jest.fn(),
        Alert: { alert },
      });
      handler();
      expect(alert).not.toHaveBeenCalled();
    }
  }
  const submit = jest.fn();
  const succeeded = evaluate<() => void>(callback('handleSbpSucceeded'), {
    setShowSbp: jest.fn(),
    setPaymentMethod: jest.fn(),
    handleSubmit: submit,
  });
  succeeded();
  expect(submit).toHaveBeenCalledWith(false, 'card', { preValidated: true });
});
test('stale SBP press for deferred card does not start prevalidation or open payment', () => {
  const file = source('CheckCreateScreen.tsx');
  const callback = (
    find(
      file,
      (n) => ts.isVariableDeclaration(n) && n.name.getText(file) === 'openSbpPayment',
    ) as ts.VariableDeclaration
  ).initializer!.getText(file);
  const alert = jest.fn();
  const open = jest.fn();
  const handler = evaluate<() => void>(callback, {
    paymentMethod: 'card',
    isDeferred: true,
    submittingRef: { current: false },
    createMutation: { isPending: false },
    serviceLines: [],
    productLines: [],
    haptic: jest.fn(),
    Alert: { alert },
    setShowSbp: open,
  });
  handler();
  expect(alert).not.toHaveBeenCalled();
  expect(open).not.toHaveBeenCalled();
});
test('actual registry filters attention before applying saved order and visibility', () => {
  const file = source('DashboardScreen.tsx');
  const declaration = find(
    file,
    (n) => ts.isVariableDeclaration(n) && n.name.getText(file) === 'orderedWidgets',
  ) as ts.VariableDeclaration;
  const memo = declaration.initializer as ts.CallExpression;
  const factory = memo.arguments[0].getText(file);
  const defs = ['attention', 'today-earnings'].map((id) => ({ id, label: id, Component: () => null }));
  for (const role of ['director', 'admin', 'master', 'superadmin', 'custom']) {
    const get = evaluate<() => typeof defs>(factory, {
      applyWidgetOrder,
      DASHBOARD_WIDGETS: defs,
      order: ['attention', 'today-earnings'],
      user: { role },
    });
    const visible = get().filter((w) => isWidgetVisible({ attention: true }, w.id));
    expect(visible.map((w) => w.id)).toEqual(
      role === 'director' ? ['attention', 'today-earnings'] : ['today-earnings'],
    );
  }
});
