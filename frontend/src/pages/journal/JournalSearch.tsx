import { useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { Input } from '../../ui/Input';
import { focusRing } from '../../ui/tokens';
import { cn } from '../../ui/cn';

/** Always-mounted field while browsing checks; Escape cancels pending input as well as the applied query. */
export default function JournalSearch({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [local, setLocal] = useState(value);
  const field = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stop = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };
  useEffect(() => {
    stop();
    setLocal(value);
  }, [value]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const clear = () => {
    stop();
    setLocal('');
    onChange('');
  };
  return (
    <Input
      ref={field}
      type="text"
      inputMode="search"
      value={local}
      autoComplete="off"
      spellCheck={false}
      leftIcon={Search}
      placeholder="Клиент, авто, номер чека…"
      aria-label="Поиск по журналу"
      onChange={(event) => {
        const next = event.target.value;
        setLocal(next);
        stop();
        timer.current = setTimeout(() => onChange(next), 300);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          clear();
          field.current?.blur();
        }
      }}
      className="h-11 w-full"
      rightSlot={
        local ? (
          <button
            type="button"
            aria-label="Очистить поиск"
            onClick={() => {
              clear();
              field.current?.focus();
            }}
            className={cn(
              'flex h-8 w-8 items-center justify-center rounded text-ink-3 hover:bg-surface-3 hover:text-ink',
              focusRing,
            )}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : null
      }
    />
  );
}
