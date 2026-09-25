import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import toast from 'react-hot-toast';
import { cn } from '../../ui/cn';
import { IconButton } from '../../ui/IconButton';
import { formatVin } from '../../../../shared/utils/vin';

interface VinTextProps {
  vin: string;
  /** Кнопка «Скопировать VIN» рядом (карточки авто, деталка чека). */
  copy?: boolean;
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * VIN моноширинным с группировкой «WMI VDS VIS» — так номер сверяется с кузовом
 * и ПТС. Рендерится ТОЛЬКО при включённой опции тенанта (`useVinEnabled()`):
 * решение принимает родитель, компонент об опции не знает.
 */
export default function VinText({ vin, copy = false, size = 'md', className }: VinTextProps) {
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(vin);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('Не удалось скопировать VIN');
    }
  };

  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1', className)}>
      <abbr
        title="VIN"
        className="flex-shrink-0 text-2xs font-semibold uppercase tracking-wide text-ink-3 no-underline"
      >
        VIN
      </abbr>
      <span
        translate="no"
        className={cn('truncate font-mono tabular-nums text-ink-2', size === 'sm' ? 'text-xs' : 'text-sm')}
      >
        {formatVin(vin)}
      </span>
      {copy && (
        <IconButton
          label={copied ? 'VIN скопирован' : 'Скопировать VIN'}
          icon={copied ? Check : Copy}
          size="sm"
          variant="ghost"
          onClick={onCopy}
          className={cn('-my-1 h-7 w-7', copied && 'text-ok')}
        />
      )}
    </span>
  );
}
