import { ElementType, HTMLAttributes, ReactNode, forwardRef } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from './cn';
import { toneChip, type Tone } from './tokens';

export interface CardProps extends HTMLAttributes<HTMLElement> {
  /** Тег контейнера: section (по умолчанию), article, div… */
  as?: ElementType;
  /** Внутренний отступ всего контейнера. `none` — когда внутри CardHeader/CardBody/таблица. */
  padding?: 'none' | 'sm' | 'md';
  /** Кликабельная карточка: hover-подъём границы и тени (сам обработчик — на потомке-ссылке/кнопке). */
  interactive?: boolean;
}

const paddingCls = { none: '', sm: 'p-4', md: 'p-5' } as const;

/**
 * Базовая поверхность: белая, hairline-граница, радиус 12 px, едва заметная тень.
 * Никаких градиентов и цветных фонов — карточка нейтральна, смысл несёт контент.
 */
export const Card = forwardRef<HTMLElement, CardProps>(function Card(
  { as: Tag = 'section', padding = 'none', interactive = false, className, children, ...rest },
  ref,
) {
  return (
    <Tag
      ref={ref}
      className={cn(
        'rounded-xl border border-line bg-surface shadow-card',
        interactive &&
          'transition-[border-color,box-shadow] duration-150 ease-out hover:border-line-strong hover:shadow-pop focus-within:border-line-strong',
        paddingCls[padding],
        className,
      )}
      {...rest}
    >
      {children}
    </Tag>
  );
});

export interface CardHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: LucideIcon;
  iconTone?: Tone;
  /** Правый слот: кнопки, SegmentedControl, ссылка «Все →». */
  actions?: ReactNode;
  /** Плотный вариант (виджеты в боковой колонке). */
  dense?: boolean;
  /** Разделитель под шапкой; выключайте, когда сразу идёт таблица со своим фоном. */
  divider?: boolean;
  /** Уровень заголовка: h2 внутри страницы (по умолчанию), h3 — внутри секции. */
  as?: 'h2' | 'h3';
  className?: string;
}

/** Шапка карточки: иконка-чип 36 px, заголовок 15/600, подзаголовок 12, действия справа. */
export function CardHeader({
  title,
  subtitle,
  icon: Icon,
  iconTone = 'accent',
  actions,
  dense = false,
  divider = true,
  as: Heading = 'h2',
  className,
}: CardHeaderProps) {
  return (
    <div
      className={cn(
        // flex-wrap: на узком экране действия (сегмент-контрол, кнопки) уходят
        // на вторую строку, а не отжимают заголовок до одной буквы.
        'flex flex-wrap items-center gap-x-3 gap-y-2',
        dense ? 'px-4 py-3' : 'px-5 py-4',
        divider && 'border-b border-line',
        className,
      )}
    >
      {Icon && (
        <span
          className={cn(
            'flex flex-shrink-0 items-center justify-center rounded-lg',
            dense ? 'h-8 w-8' : 'h-9 w-9',
            toneChip[iconTone],
          )}
        >
          <Icon className={dense ? 'h-4 w-4' : 'h-[18px] w-[18px]'} aria-hidden="true" />
        </span>
      )}
      <div className="min-w-0 flex-1 basis-40">
        <Heading className={cn('truncate font-semibold text-ink', dense ? 'text-sm' : 'text-md')}>{title}</Heading>
        {subtitle && <div className="mt-0.5 truncate text-xs text-ink-3">{subtitle}</div>}
      </div>
      {actions && <div className="ml-auto flex flex-shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export interface CardBodyProps extends HTMLAttributes<HTMLDivElement> {
  padding?: 'none' | 'sm' | 'md';
}

export function CardBody({ padding = 'md', className, ...rest }: CardBodyProps) {
  return <div className={cn(paddingCls[padding], className)} {...rest} />;
}

export function CardFooter({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-3 rounded-b-xl border-t border-line bg-surface-2 px-5 py-3',
        className,
      )}
      {...rest}
    />
  );
}

export default Card;
