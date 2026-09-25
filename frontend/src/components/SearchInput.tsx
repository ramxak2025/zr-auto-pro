import { useState, useEffect, useRef } from 'react';
import { Search, X } from 'lucide-react';
import { Input, type ControlSize } from '../ui/Input';
import { cn } from '../ui/cn';
import { focusRing } from '../ui/tokens';

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Доступное имя поля; по умолчанию — placeholder. */
  'aria-label'?: string;
  size?: ControlSize;
  className?: string;
}

/**
 * Поле поиска с дебаунсом 300 мс и кнопкой очистки. В тулбаре — первым
 * элементом, ширина `w-64`…`max-w-md`; на телефоне растягивается.
 */
export default function SearchInput({
  value,
  onChange,
  placeholder = 'Поиск…',
  'aria-label': ariaLabel,
  size = 'md',
  className,
}: SearchInputProps) {
  const [localValue, setLocalValue] = useState(value);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setLocalValue(newValue);

    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    timerRef.current = setTimeout(() => {
      onChange(newValue);
    }, 300);
  };

  const clear = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setLocalValue('');
    onChange('');
  };

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  return (
    <Input
      type="text"
      inputMode="search"
      autoComplete="off"
      spellCheck={false}
      value={localValue}
      onChange={handleChange}
      placeholder={placeholder}
      aria-label={ariaLabel ?? placeholder}
      size={size}
      leftIcon={Search}
      className={className}
      rightSlot={
        localValue ? (
          <button
            type="button"
            onClick={clear}
            aria-label="Очистить поиск"
            className={cn(
              'flex h-6 w-6 items-center justify-center rounded text-ink-3 hover:bg-surface-3 hover:text-ink',
              focusRing,
            )}
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        ) : undefined
      }
    />
  );
}
