import { ReactNode } from 'react';
import { cn } from './cn';

export interface FieldProps {
  label?: ReactNode;
  /** id контрола — делает подпись кликабельной (`htmlFor`). */
  htmlFor?: string;
  hint?: ReactNode;
  /** Текст ошибки; выводится под полем красным и объявляется скринридеру. */
  error?: ReactNode;
  required?: boolean;
  /** Подпись слева от поля (плотные формы настроек). */
  inline?: boolean;
  className?: string;
  children: ReactNode;
}

/**
 * Обёртка поля формы: подпись 13/500 → контрол → подсказка/ошибка 12 px.
 * Контролу передайте `id={htmlFor}` и `invalid={!!error}`; для связи с текстом
 * ошибки — `aria-describedby={`${htmlFor}-error`}`.
 */
export function Field({ label, htmlFor, hint, error, required, inline = false, className, children }: FieldProps) {
  const hintId = htmlFor ? `${htmlFor}-hint` : undefined;
  const errorId = htmlFor ? `${htmlFor}-error` : undefined;
  return (
    <div
      className={cn(
        inline ? 'grid grid-cols-[minmax(0,160px)_1fr] items-start gap-x-4 gap-y-1' : 'flex flex-col',
        className,
      )}
    >
      {label && (
        <label htmlFor={htmlFor} className={cn('text-sm font-medium text-ink-2', inline ? 'pt-2' : 'mb-1.5')}>
          {label}
          {required && (
            <span className="ml-0.5 text-bad" aria-hidden="true">
              *
            </span>
          )}
        </label>
      )}
      <div className="min-w-0">
        {children}
        {error ? (
          <p id={errorId} role="alert" className="mt-1.5 text-xs text-bad-text">
            {error}
          </p>
        ) : hint ? (
          <p id={hintId} className="mt-1.5 text-xs text-ink-3">
            {hint}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export default Field;
