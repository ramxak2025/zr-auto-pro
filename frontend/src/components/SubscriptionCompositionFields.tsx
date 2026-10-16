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
  employeePresets = false,
}: {
  employees: string;
  points: string;
  minimumEmployees: number;
  minimumPoints: number;
  onEmployeesChange: (value: string) => void;
  onPointsChange: (value: string) => void;
  employeePresets?: boolean;
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
          note: 'Команда учитывается суммарно по филиалам.',
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
            {employeePresets && label === 'Всего сотрудников' && (
              <div role="group" aria-label="Быстрый выбор сотрудников" className="mt-2 flex flex-wrap gap-1.5">
                {[1, 2, 3, 5, 10].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    aria-label={`${preset} сотрудников`}
                    aria-pressed={value === String(preset)}
                    disabled={preset < minimum}
                    onClick={() => onChange(String(preset))}
                    className={`min-h-[44px] min-w-[44px] rounded-lg px-2 text-sm font-medium tabular-nums disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${value === String(preset) ? 'bg-accent text-white' : 'bg-surface-2 text-ink-2 hover:bg-surface-3'}`}
                  >
                    {preset}
                  </button>
                ))}
              </div>
            )}
          </Field>
        );
      })}
    </div>
  );
}
