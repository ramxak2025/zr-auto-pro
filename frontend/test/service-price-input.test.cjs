const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const ts = require('typescript');

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Load the production TSX component as CommonJS for Node's built-in test runner.
// The frontend package already owns React 18 and react-test-renderer 18.
for (const extension of ['.ts', '.tsx']) {
  require.extensions[extension] = (module, filename) => {
    const source = fs.readFileSync(filename, 'utf8');
    const { outputText } = ts.transpileModule(source, {
      fileName: filename,
      compilerOptions: {
        target: ts.ScriptTarget.ES2020,
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
    });
    module._compile(outputText, filename);
  };
}

const React = require('react');
const TestRenderer = require('react-test-renderer');
const CheckServicePriceInput = require('../src/components/checks/CheckServicePriceInput').default;
const { applyServicePriceInput } = require('../../shared/utils/servicePrices');

function renderPriceInput({ value = 500, onPriceChange }) {
  let tree;
  TestRenderer.act(() => {
    tree = TestRenderer.create(
      React.createElement(CheckServicePriceInput, {
        'aria-label': 'Цена услуги',
        value,
        onPriceChange,
        placeholder: 'Укажите цену',
      }),
    );
  });
  return tree.root.findByType('input');
}

test('production input confirms explicit zero and out-of-range prices without clamping', () => {
  const changes = [];
  let line = { price: 500, priceConfirmed: false };
  const input = renderPriceInput({
    onPriceChange: (price, explicitlyEntered) => {
      line = applyServicePriceInput(line, price, explicitlyEntered);
      changes.push({ ...line });
    },
  });

  for (const text of ['0', '200', '1000']) {
    TestRenderer.act(() => input.props.onChange({ target: { value: text } }));
  }

  assert.deepEqual(changes, [
    { price: 0, priceConfirmed: true },
    { price: 200, priceConfirmed: true },
    { price: 1000, priceConfirmed: true },
  ]);
});

test('clearing a range entry resets amount and removes confirmation', () => {
  const changes = [];
  let line = { price: 700, priceConfirmed: true };
  const input = renderPriceInput({
    value: 700,
    onPriceChange: (price, explicitlyEntered) => {
      line = applyServicePriceInput(line, price, explicitlyEntered);
      changes.push({ ...line });
    },
  });

  TestRenderer.act(() => input.props.onChange({ target: { value: '' } }));

  assert.deepEqual(changes, [{ price: 0, priceConfirmed: false }]);
});

test('clearing a fixed price commits zero instead of retaining the previous amount', () => {
  const changes = [];
  let line = { price: 100, priceConfirmed: true };
  const input = renderPriceInput({
    value: 100,
    onPriceChange: (price, explicitlyEntered) => {
      line = applyServicePriceInput(line, price, explicitlyEntered);
      changes.push({ ...line });
    },
  });

  TestRenderer.act(() => input.props.onChange({ target: { value: '' } }));

  assert.deepEqual(changes, [{ price: 0, priceConfirmed: false }]);
});
