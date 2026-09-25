/**
 * VIN в карточках и строках (171, 2026-09-25): моноширинно, с группировкой
 * WMI VDS VIS (`formatVin`) и кнопкой «Скопировать VIN».
 *
 * Показывать или нет — решает родитель: только при включённой опции
 * (`useVinEnabled()`) и когда VIN у машины есть. При выключенной опции ни один
 * экран этот компонент не монтирует — UI остаётся байт-в-байт прежним.
 */
import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import toast from 'react-hot-toast';
import { IconButton } from '../../ui/IconButton';
import { cn } from '../../ui/cn';
import { formatVin } from '../../../../shared/utils/vin';
import { copyTextToClipboard } from './vinUi';

interface VinTextProps {
  /** Канонический VIN (normalizeVin). */
  vin: string;
  /** Префикс «VIN » — там, где рядом нет подписи поля. */
  withLabel?: boolean;
  className?: string;
}

/** Только текст: моноширинный, табличные цифры, группировка 3·6·8. */
export function VinText({ vin, withLabel = false, className }: VinTextProps) {
  return (
    <span
      className={cn('font-mono tabular-nums tracking-wide text-ink-2', className)}
      aria-label={`VIN ${vin}`}
      title={vin}
    >
      {withLabel && <span className="mr-1 font-sans text-ink-3">VIN</span>}
      {formatVin(vin)}
    </span>
  );
}

/** Кнопка «Скопировать VIN»: на 1,5 с меняет иконку на галочку + тост. */
export function CopyVinButton({
  vin,
  size = 'sm',
  className,
}: {
  vin: string;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const onCopy = async () => {
    const ok = await copyTextToClipboard(vin);
    if (!ok) {
      toast.error('Не удалось скопировать — выделите VIN вручную');
      return;
    }
    setCopied(true);
    toast.success('VIN скопирован');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1500);
  };

  return (
    <IconButton
      label={copied ? 'VIN скопирован' : 'Скопировать VIN'}
      icon={copied ? Check : Copy}
      size={size}
      variant="ghost"
      onClick={onCopy}
      className={cn(copied && 'text-ok', className)}
    />
  );
}

/** Строка «VIN + копировать» — под маркой в карточках и в ячейках таблиц. */
export function VinLine({ vin, withLabel = false, className }: VinTextProps) {
  return (
    <span className={cn('inline-flex max-w-full items-center gap-0.5', className)}>
      <VinText vin={vin} withLabel={withLabel} className="text-xs" />
      <CopyVinButton vin={vin} />
    </span>
  );
}

export default VinText;
