import { cn } from '../../ui/cn';
import { initialsOf } from '../dashboard/shared';

const sizeCls = {
  sm: 'h-8 w-8 text-xs',
  md: 'h-10 w-10 text-sm',
  lg: 'h-16 w-16 text-xl',
} as const;

const sizePx = { sm: 32, md: 40, lg: 64 } as const;

/**
 * Аватар сотрудника: фото или инициалы на акцентном тинте. Декоративен —
 * имя всегда стоит рядом текстом, поэтому картинка без alt-текста.
 */
export default function UserAvatar({
  name,
  src,
  size = 'md',
  className,
}: {
  name: string;
  src?: string | null;
  size?: keyof typeof sizeCls;
  className?: string;
}) {
  if (src) {
    return (
      <img
        src={src}
        alt=""
        width={sizePx[size]}
        height={sizePx[size]}
        className={cn('flex-shrink-0 rounded-full object-cover', sizeCls[size], className)}
        loading="lazy"
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex flex-shrink-0 items-center justify-center rounded-full bg-accent-soft font-semibold text-accent-text',
        sizeCls[size],
        className,
      )}
    >
      {initialsOf(name)}
    </span>
  );
}
