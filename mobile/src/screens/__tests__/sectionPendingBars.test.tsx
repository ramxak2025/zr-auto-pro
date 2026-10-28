import fs from 'fs';
import path from 'path';
import ts from 'typescript';

type Element = { type: unknown; props: Record<string, unknown> & { children?: unknown } };
const repository = path.resolve(__dirname, '../../../..');

function renderPendingBar(screen: string, barStyle: string, pending: Record<string, unknown>) {
  const relative = `mobile/src/screens/${screen}.tsx`;
  const snapshot = process.env.AUTEXA_SECTION_REPAIR_BASELINE;
  const candidate = snapshot ? path.join(snapshot, relative) : undefined;
  const filename = candidate && fs.existsSync(candidate) ? candidate : path.join(repository, relative);
  const source = ts.createSourceFile(
    filename,
    fs.readFileSync(filename, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let bar: ts.JsxElement | undefined;
  function visit(node: ts.Node) {
    if (
      ts.isJsxElement(node) &&
      node.openingElement.tagName.getText(source) === 'View' &&
      node.openingElement.attributes.properties.some(
        (attribute) =>
          ts.isJsxAttribute(attribute) &&
          attribute.name.getText(source) === 'style' &&
          attribute.initializer?.getText(source).includes(`styles.${barStyle}`),
      )
    )
      bar = node;
    ts.forEachChild(node, visit);
  }
  visit(source);
  if (!bar) throw new Error(`Missing actual ${screen} ${barStyle}`);
  const onScroll = jest.fn();
  const scope = {
    React: {
      createElement: (type: unknown, props: Record<string, unknown> | null, ...children: unknown[]) => ({
        type,
        props: { ...props, children },
      }),
    },
    View: 'View',
    Text: 'Text',
    ActivityIndicator: 'ActivityIndicator',
    ScreenSectionScrollView: 'ScreenSectionScrollView',
    styles: new Proxy({}, { get: () => ({}) }),
    palette: { bg: { card: '#fff' }, border: { subtle: '#ddd' }, text: { primary: '#111', tertiary: '#777' } },
    colors: { primary: { 600: '#2563eb' } },
    spacing: new Proxy({}, { get: (_target, key) => Number(key) * 4 }),
    section: { contentTop: 186, onScroll },
    tabBarHeight: 90,
    invoiceTotal: 42,
    formatMoney: String,
    ...pending,
  };
  const compiled = ts.transpileModule(`const actual = (${bar.getText(source)});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React },
  }).outputText;
  return Function(...Object.keys(scope), `${compiled}; return actual;`)(...Object.values(scope)) as Element;
}

function elements(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(elements);
  if (!value || typeof value !== 'object' || !('props' in value)) return [];
  const node = value as Element;
  return [node, ...elements(node.props.children)];
}

test.each([
  ['SupplyReceiveScreen', 'bottomBar', { receiveMutation: { isPending: true } }],
  ['PurchaseOrderDetailScreen', 'actionBar', { busy: true }],
] as const)(
  '%s keeps its pending indicator inline, without a second header-driving scroll viewport',
  (screen, style, pending) => {
    const bar = renderPendingBar(screen, style, pending);
    const nodes = elements(bar);
    expect(nodes.filter((node) => node.type === 'ActivityIndicator')).toHaveLength(1);
    expect(nodes.filter((node) => typeof node.props.onScroll === 'function')).toHaveLength(0);
    expect(nodes.some((node) => node.type === 'ScreenSectionScrollView')).toBe(false);
  },
);
