import { HTMLAttributes, ReactNode } from 'react';
import { cn } from './cn';

export interface ToolbarProps extends HTMLAttributes<HTMLDivElement> {
  /** Правый край: главное действие страницы, экспорт, переключатель вида. */
  end?: ReactNode;
  /** Липкий тулбар под шапкой страницы при длинных таблицах. */
  sticky?: boolean;
}

/**
 * Строка управления страницей: поиск · фильтры · период — слева, действия —
 * справа. Все контролы внутри — высотой 36 px (h-9). На узких экранах
 * переносится, правый блок уходит на новую строку.
 */
export function Toolbar({ end, sticky = false, className, children, ...rest }: ToolbarProps) {
  return (
    <div
      className={cn(
        'flex min-h-[44px] flex-wrap items-center gap-2',
        sticky &&
          'sticky top-0 z-10 -mx-1 bg-canvas/90 px-1 py-1 backdrop-blur supports-[backdrop-filter]:bg-canvas/75',
        className,
      )}
      {...rest}
    >
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">{children}</div>
      {end && <div className="flex flex-shrink-0 flex-wrap items-center gap-2">{end}</div>}
    </div>
  );
}

/** Группа связанных контролов (например, три пилюли периода + два date-поля). */
export function ToolbarGroup({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-wrap items-center gap-2', className)} {...rest} />;
}

export function ToolbarSeparator({ className }: { className?: string }) {
  return <span className={cn('mx-1 hidden h-5 w-px bg-line-strong sm:block', className)} aria-hidden="true" />;
}

/**
 * Панель фильтров: тот же Toolbar на светлой поверхности с рамкой. Используйте,
 * когда фильтров больше трёх или они многострочные; иначе достаточно Toolbar.
 */
export function FilterBar({ className, ...rest }: ToolbarProps) {
  return (
    <Toolbar className={cn('rounded-xl border border-line bg-surface px-3 py-2 shadow-card', className)} {...rest} />
  );
}

export default Toolbar;
