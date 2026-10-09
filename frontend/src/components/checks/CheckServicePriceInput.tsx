import MoneyInput, { type MoneyInputProps } from './MoneyInput';

type CheckServicePriceInputProps = Omit<MoneyInputProps, 'onCommit' | 'onEmpty'> & {
  onPriceChange: (price: number, explicitlyEntered: boolean) => void;
};

/** Keep the amount and explicit-entry flag in sync for fixed and range catalog lines. */
export default function CheckServicePriceInput({ onPriceChange, ...props }: CheckServicePriceInputProps) {
  return (
    <MoneyInput {...props} onCommit={(price) => onPriceChange(price, true)} onEmpty={() => onPriceChange(0, false)} />
  );
}
