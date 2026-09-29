import { useMemo } from 'react';
import { Field, Select } from '../../ui';
import { monthLabel, payoutMonthOptions } from './salaryMonths';

interface PayoutMonthFieldProps {
  id: string;
  /** Месяц, за который выдаётся выплата: 'YYYY-MM'. */
  value: string;
  /** Текущий месяц автосервиса ('YYYY-MM') — верхняя граница списка. */
  currentMonth: string;
  onChange: (month: string) => void;
}

/**
 * «За какой месяц» — выплата уходит из кассы сегодня, а в отчётах и на экране
 * зарплаты считается за выбранный месяц. Список: текущий и 12 предыдущих.
 */
export function PayoutMonthField({ id, value, currentMonth, onChange }: PayoutMonthFieldProps) {
  // Выбранный месяц всегда в списке: долг мог накопиться раньше, чем 12 месяцев назад.
  const options = useMemo(() => payoutMonthOptions(currentMonth, [value]), [currentMonth, value]);
  return (
    <Field
      label="За какой месяц"
      htmlFor={id}
      hint={value !== currentMonth ? `Выдаётся сегодня, учитывается за ${monthLabel(value)}` : undefined}
    >
      <Select id={id} value={value} options={options} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

export default PayoutMonthField;
