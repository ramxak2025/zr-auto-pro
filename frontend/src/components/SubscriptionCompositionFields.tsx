import { Field } from '../ui/Field';
import { Input } from '../ui/Input';
import { parseSubscriptionCount } from '../utils/subscriptionPricingText';

export default function SubscriptionCompositionFields({
  employees,
  points,
  minimumEmployees,
  minimumPoints,
  onEmployeesChange,
  onPointsChange,
}: {
  employees: string;
  points: string;
  minimumEmployees: number;
  minimumPoints: number;
  onEmployeesChange: (value: string) => void;
  onPointsChange: (value: string) => void;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {[
        {
          label: 'Всего сотрудников',
          value: employees,
          minimum: minimumEmployees,
          onChange: onEmployeesChange,
          note: 'Включая владельца; человек на нескольких филиалах считается один раз.',
        },
        {
          label: 'Всего филиалов',
          value: points,
          minimum: minimumPoints,
          onChange: onPointsChange,
          note: '50 сотрудников MAX включены суммарно на все филиалы.',
        },
      ].map(({ label, value, minimum, onChange, note }) => {
        const count = parseSubscriptionCount(value);
        const error =
          count === undefined
            ? 'Укажите целое число от 1.'
            : count < minimum
              ? `Уже используется ${minimum}. Укажите не меньше.`
              : undefined;
        return (
          <Field key={label} label={label} error={error} hint={note}>
            <Input
              aria-label={label}
              inputMode="numeric"
              value={value}
              onChange={(event) => onChange(event.target.value)}
              invalid={!!error}
              aria-invalid={!!error}
            />
          </Field>
        );
      })}
    </div>
  );
}
