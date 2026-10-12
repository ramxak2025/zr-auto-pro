import { STARTER_DIRECTIONS } from '../../../../shared/constants/starterDirections';
import { Checkbox } from '../../ui/Checkbox';
export default function StarterDirectionsPicker({
  value,
  onChange,
  disabled = false,
}: {
  value: string[];
  onChange: (value: string[]) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset className="space-y-3">
      <legend className="mb-2 text-sm font-medium text-ink">Направления автосервиса</legend>
      <p className="text-xs text-ink-3">
        Необязательно. Стартовые цены — 1 ₽, остатки — 0. Детали и объёмы подбираются по автомобилю.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {STARTER_DIRECTIONS.map((d) => (
          <Checkbox
            key={d.id}
            label={d.name}
            className="min-h-11 items-center"
            checked={value.includes(d.id)}
            disabled={disabled}
            onChange={() => onChange(value.includes(d.id) ? value.filter((id) => id !== d.id) : [...value, d.id])}
          />
        ))}
      </div>
    </fieldset>
  );
}
