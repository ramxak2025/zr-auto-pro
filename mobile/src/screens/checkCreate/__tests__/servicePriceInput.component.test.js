global.IS_REACT_ACT_ENVIRONMENT = true;
const React = require('../../../../../frontend/node_modules/react');
const TestRenderer = require('../../../../../frontend/node_modules/react-test-renderer');
const CheckServicePriceInput = require('../../../../../frontend/src/components/checks/CheckServicePriceInput').default;
const { applyServicePriceInput } = require('../../../../../shared/utils/servicePrices');

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

describe('CheckServicePriceInput production component', () => {
  it('marks explicitly entered zero, below-min and above-max values as confirmed without clamping to catalog bounds', () => {
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
    expect(changes).toEqual([
      { price: 0, priceConfirmed: true },
      { price: 200, priceConfirmed: true },
      { price: 1000, priceConfirmed: true },
    ]);
  });

  it('clearing a range entry sets amount to zero and removes confirmation', () => {
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
    expect(changes).toEqual([{ price: 0, priceConfirmed: false }]);
  });

  it('clearing a fixed price commits zero instead of keeping the previous amount', () => {
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
    expect(changes).toEqual([{ price: 0, priceConfirmed: false }]);
  });
});
