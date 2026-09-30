import { Badge } from '../../ui/Badge';
import { cn } from '../../ui/cn';

interface StorageCellBadgeProps {
  code: string;
  /** Подпись ячейки — уходит во всплывающую подсказку. */
  name?: string | null;
  size?: 'sm' | 'md';
  /** Слово перед кодом: «Ячейка A-01-03» (карточка товара); в таблице — только код. */
  withLabel?: boolean;
  className?: string;
}

/** Компактная плашка адреса товара на складе: код моноширинным шрифтом, чтобы «A-1-2» и «A-1-12» читались ровно. */
export default function StorageCellBadge({
  code,
  name,
  size = 'sm',
  withLabel = false,
  className,
}: StorageCellBadgeProps) {
  const title = name ? `Ячейка ${code} — ${name}` : `Ячейка ${code}`;
  return (
    <Badge outline size={size} title={title} className={cn('font-mono tabular-nums', className)}>
      {withLabel ? `Ячейка ${code}` : code}
    </Badge>
  );
}
