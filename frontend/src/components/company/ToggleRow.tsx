import { ReactNode, useId } from 'react';
import Switch from '../Switch';
import { cn } from '../../ui/cn';

/**
 * Строка настройки «подпись + пояснение ‖ переключатель». Подпись связана с
 * переключателем через htmlFor (кнопка role=switch — labelable-элемент), так
 * что клик по тексту тоже переключает, а скринридер читает имя один раз.
 */
export default function ToggleRow({
  label,
  description,
  checked,
  onChange,
  disabled,
  className,
}: {
  label: string;
  description?: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={cn('flex items-start justify-between gap-4', className)}>
      <div className="min-w-0">
        <label htmlFor={id} className="block cursor-pointer text-sm font-medium text-ink">
          {label}
        </label>
        {description && <div className="mt-0.5 text-xs leading-relaxed text-ink-3">{description}</div>}
      </div>
      <Switch id={id} label={label} checked={checked} onChange={onChange} disabled={disabled} className="mt-0.5" />
    </div>
  );
}
