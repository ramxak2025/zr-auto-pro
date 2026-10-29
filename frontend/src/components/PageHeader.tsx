import { ReactNode } from 'react';
import { ArrowLeft, LucideIcon } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { cn } from '../ui/cn';
import { IconButton } from '../ui/IconButton';

interface PageHeaderProps {
  /** H1 страницы — всегда в шкале `.page-title` (22/600). */
  title: string;
  /** Иконка раздела в акцентном чипе 40 px. */
  icon?: LucideIcon;
  /** Приглушённая строка под заголовком: счётчик, период, пояснение. */
  subtitle?: string;
  /** Действия справа: одна primary-кнопка + secondary/ghost. На узких экранах переносятся под заголовок. */
  actions?: ReactNode;
  /**
   * Кнопка «Назад» слева от заголовка: путь (`/clients`) или обработчик.
   * Для детальных страниц вместо ручных `btn-ghost` + `navigate(-1)`.
   */
  backTo?: string | (() => void);
  /** Метки рядом с заголовком (статус, бейдж филиала). */
  meta?: ReactNode;
  className?: string;
}

/**
 * Канонический заголовок страницы. Один на страницу, первым элементом.
 * Структура страницы: PageHeader → Toolbar → контент (см. DESIGN_SYSTEM.md).
 */
export default function PageHeader({
  title,
  icon: Icon,
  subtitle,
  actions,
  backTo,
  meta,
  className = '',
}: PageHeaderProps) {
  const navigate = useNavigate();
  const onBack = typeof backTo === 'function' ? backTo : backTo ? () => navigate(backTo) : undefined;

  return (
    <div className={cn('page-header flex-col items-stretch sm:flex-row sm:items-center', className)}>
      <div className="flex min-w-0 items-center gap-3">
        {onBack && (
          <IconButton label="Назад" icon={ArrowLeft} variant="ghost" onClick={onBack} className="-ml-2 flex-shrink-0" />
        )}
        {Icon && (
          <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
            <Icon className="h-5 w-5" aria-hidden="true" />
          </span>
        )}
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="page-title break-words sm:truncate">{title}</h1>
            {meta && <div className="flex flex-shrink-0 items-center gap-1.5">{meta}</div>}
          </div>
          {subtitle && <p className="mt-0.5 break-words text-sm text-ink-3 sm:truncate">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 sm:flex-shrink-0 sm:justify-end">{actions}</div>}
    </div>
  );
}
