/**
 * VinInput — поле VIN-кода автомобиля для веба (171, 2026-09-25).
 *
 * Единственная реализация для Кассы (быстрое создание клиента/авто), карточки
 * клиента и списка «Автомобили». Рендерится ТОЛЬКО при включённой опции
 * тенанта (`useVinEnabled()`): родитель сам не монтирует поле, когда опция
 * выключена, — формы остаются прежними.
 *
 * Что делает само:
 *   • нормализует ввод на лету: верхний регистр, кириллические двойники →
 *     латиница, I/O/Q → 1/0/0, всё вне алфавита VIN отбрасывается
 *     (`normalizeVin`), длина ≤ 17. Наверх (`onChange`) уходит канонический VIN;
 *   • пока поле в фокусе — показывает «сырые» 17 символов (курсор не прыгает),
 *     после — с группировкой WMI VDS VIS (`formatVin`), как номер читается с
 *     кузова и сверяется с ПТС; шрифт моноширинный;
 *   • справа — счётчик «12/17», при 17 валидных символах галочка (или
 *     предупреждение о контрольной цифре для североамериканских VIN);
 *   • при 17 валидных символах (debounce 400 мс) — `vinApi.decode`: поле
 *     «Марка и модель» пусто → подставляет `makeModel` молча (`onMakeModel`);
 *     заполнено — чип «По VIN: Kia Rio · Заменить». Подпись-источник под
 *     полем: «Определено по VIN» / «Марка по справочнику, модель допишите».
 *     Сбой сети → подпись + кнопка «Повторить». Результаты кэшируются по VIN
 *     на время сессии (расшифровка неизменна);
 *   • `error` — текст ошибки сервера (409 VIN_DUPLICATE с именем клиента),
 *     `errorAction` — ссылка/кнопка рядом с ним («Открыть карточку клиента»);
 *   • `label` — обернуть в `Field` с подписью (когда родитель не делает этого сам).
 *
 * Зеркало mobile/src/components/VinInput.tsx — поведение и тексты общие.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { AlertCircle, CheckCircle2, Loader2, RefreshCw, Sparkles } from 'lucide-react';
import { vinApi } from '../../api/services';
import { Button } from '../../ui/Button';
import { Field } from '../../ui/Field';
import { Input, type ControlSize } from '../../ui/Input';
import { cn } from '../../ui/cn';
import { focusRing } from '../../ui/tokens';
import type { VinDecodeResult } from '../../../../shared/types';
import { VIN_LENGTH, formatVin, isValidVin, normalizeVin } from '../../../../shared/utils/vin';
import { shouldAutofillMakeModel, vinCheckDigitWarning, vinCounter, vinDecodeCaption, vinSuggestion } from './vinUi';

/** Расшифровка неизменна — один VIN не расшифровываем дважды за сессию. */
const decodeCache = new Map<string, VinDecodeResult>();

/**
 * Сырые символы ввода, пережившие нормализацию (регистр — как набрали, чтобы
 * курсор не прыгал в контролируемом поле), не больше 17 значащих.
 */
function keepTypedChars(raw: string): string {
  let out = '';
  let count = 0;
  for (const ch of raw) {
    if (normalizeVin(ch).length === 0) continue;
    if (count >= VIN_LENGTH) break;
    out += ch;
    count++;
  }
  return out;
}

export interface VinInputProps {
  id?: string;
  /** Канонический VIN (normalizeVin), ≤ 17 символов. */
  value: string;
  onChange: (vin: string) => void;
  /** Текущее значение «Марка и модель» — решает: подставить молча или предложить чип «Заменить». */
  makeModel?: string;
  /** Подставить марку/модель из расшифровки (молча в пустое поле или по чипу «Заменить»). */
  onMakeModel?: (makeModel: string) => void;
  /** Полный результат расшифровки — если экрану нужно больше (год, кузов). */
  onDecoded?: (result: VinDecodeResult) => void;
  /** Расшифровывать через vinApi.decode при 17 валидных символах. По умолчанию true. */
  decode?: boolean;
  /** Ошибка под полем — 409 VIN_DUPLICATE с именем клиента и т. п. */
  error?: ReactNode | null;
  /** Действие рядом с ошибкой (ссылка «Открыть карточку клиента»). */
  errorAction?: ReactNode;
  /** Подпись поля: компонент сам оборачивается в `Field`. Без неё — только контрол. */
  label?: ReactNode;
  disabled?: boolean;
  autoFocus?: boolean;
  placeholder?: string;
  size?: ControlSize;
  name?: string;
  className?: string;
}

type CaptionTone = 'error' | 'warning' | 'success' | 'info';

const captionTone: Record<CaptionTone, string> = {
  error: 'text-bad-text',
  warning: 'text-warn-text',
  success: 'text-ok-text',
  info: 'text-ink-3',
};

export default function VinInput({
  id,
  value,
  onChange,
  makeModel,
  onMakeModel,
  onDecoded,
  decode = true,
  error,
  errorAction,
  label,
  disabled = false,
  autoFocus = false,
  placeholder = 'XTA 219010 K0123456',
  size = 'md',
  name = 'vin',
  className,
}: VinInputProps) {
  const autoId = useId();
  const inputId = id ?? `vin-${autoId}`;
  const captionId = `${inputId}-caption`;

  // ── Буфер набора: в фокусе показываем то, что набрали (≤ 17 значащих) ─────
  const [focused, setFocused] = useState(false);
  const [text, setText] = useState<string>(value);
  useEffect(() => {
    // Внешнее изменение (открыли форму с сохранённой машиной, очистили) —
    // синхронизируем буфер; эхо собственных эмитов нормализуется в то же value.
    if (normalizeVin(text) !== value) setText(value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const handleChange = (raw: string) => {
    const kept = keepTypedChars(raw);
    setText(kept);
    onChange(normalizeVin(kept));
  };

  // ── Расшифровка ──────────────────────────────────────────────────────────
  const makeModelRef = useRef(makeModel);
  makeModelRef.current = makeModel;
  const onMakeModelRef = useRef(onMakeModel);
  onMakeModelRef.current = onMakeModel;
  const onDecodedRef = useRef(onDecoded);
  onDecodedRef.current = onDecoded;

  const [decoding, setDecoding] = useState(false);
  const [decoded, setDecoded] = useState<VinDecodeResult | null>(null);
  const [decodeFailed, setDecodeFailed] = useState(false);
  // «Повторить» после сбоя сети: перезапускает эффект расшифровки для того же VIN.
  const [retryTick, setRetryTick] = useState(0);
  const decodedVinRef = useRef<string | null>(null);

  useEffect(() => {
    if (!decode) return;
    if (!isValidVin(value)) {
      if (decodedVinRef.current !== null) {
        decodedVinRef.current = null;
        setDecoded(null);
      }
      setDecodeFailed(false);
      setDecoding(false);
      return;
    }
    if (decodedVinRef.current === value) return;
    if (decodedVinRef.current !== null) {
      decodedVinRef.current = null;
      setDecoded(null);
    }

    let cancelled = false;
    const apply = (res: VinDecodeResult) => {
      decodedVinRef.current = value;
      setDecoded(res);
      setDecodeFailed(false);
      onDecodedRef.current?.(res);
      if (shouldAutofillMakeModel(makeModelRef.current, res) && res.makeModel) {
        onMakeModelRef.current?.(res.makeModel);
      }
    };

    const cached = decodeCache.get(value);
    if (cached) {
      apply(cached);
      return;
    }

    setDecodeFailed(false);
    const timer = window.setTimeout(async () => {
      setDecoding(true);
      try {
        const res = (await vinApi.decode(value)).data;
        if (cancelled) return;
        decodeCache.set(value, res);
        apply(res);
      } catch {
        // Сеть/сервер — марку и модель человек допишет руками; VIN сохраняется как есть.
        if (!cancelled) setDecodeFailed(true);
      } finally {
        if (!cancelled) setDecoding(false);
      }
    }, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [value, decode, retryTick]);

  // ── Что показать под полем ───────────────────────────────────────────────
  const valid = isValidVin(value);
  const partial = value.length > 0 && value.length < VIN_LENGTH;
  const suggestion = decode && onMakeModel ? vinSuggestion(makeModel, decoded) : null;
  const checkDigitWarning = valid ? vinCheckDigitWarning(value) : null;

  let caption: { text: ReactNode; tone: CaptionTone } | null = null;
  if (error) caption = { text: error, tone: 'error' };
  else if (decoding) caption = { text: 'Определяем марку и модель…', tone: 'info' };
  else if (decodeFailed)
    caption = { text: 'Не удалось расшифровать VIN — марку и модель заполните вручную', tone: 'warning' };
  else if (checkDigitWarning) caption = { text: checkDigitWarning, tone: 'warning' };
  else if (decode && decoded) {
    const t = vinDecodeCaption(decoded);
    if (t) caption = { text: t, tone: decoded.make && decoded.model ? 'success' : 'info' };
  } else if (partial)
    caption = { text: `Ещё ${VIN_LENGTH - value.length} симв. — латиница и цифры без I, O, Q`, tone: 'info' };

  const showRetry = !error && decodeFailed && !decoding;

  // Слот справа ВСЕГДА присутствует (пусть и пустой): ui/Input оборачивает
  // поле в <div> только при наличии rightSlot, и появление счётчика после
  // первого символа перемонтировало бы <input> — с потерей фокуса.
  const indicator = decoding ? (
    <Loader2 className="h-4 w-4 animate-spin text-accent" aria-hidden="true" />
  ) : valid ? (
    checkDigitWarning ? (
      <AlertCircle className="h-4 w-4 text-warn" aria-hidden="true" />
    ) : (
      <CheckCircle2 className="h-4 w-4 text-ok" aria-hidden="true" />
    )
  ) : value.length > 0 ? (
    <span className="text-2xs font-semibold tabular-nums text-ink-3" aria-hidden="true">
      {vinCounter(value)}
    </span>
  ) : null;
  const rightSlot = <span className="flex min-w-[2.25rem] items-center justify-end">{indicator}</span>;

  const control = (
    <>
      <Input
        id={inputId}
        name={name}
        type="text"
        value={focused ? text : formatVin(value)}
        onChange={(e) => handleChange(e.target.value)}
        onFocus={() => {
          setText(value);
          setFocused(true);
        }}
        onBlur={() => setFocused(false)}
        placeholder={placeholder}
        autoComplete="off"
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
        autoFocus={autoFocus}
        disabled={disabled}
        size={size}
        invalid={!!error}
        aria-describedby={caption ? captionId : undefined}
        className="font-mono uppercase tracking-wider placeholder:normal-case placeholder:tracking-normal"
        rightSlot={rightSlot}
      />

      {caption && (
        <p
          id={captionId}
          role={caption.tone === 'error' ? 'alert' : undefined}
          aria-live={caption.tone === 'error' ? undefined : 'polite'}
          className={cn('mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs', captionTone[caption.tone])}
        >
          <span>{caption.text}</span>
          {caption.tone === 'error' && errorAction}
          {showRetry && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              icon={RefreshCw}
              className="-my-1 h-6 px-1.5"
              onClick={() => setRetryTick((t) => t + 1)}
            >
              Повторить
            </Button>
          )}
        </p>
      )}

      {suggestion && onMakeModel && (
        <button
          type="button"
          onClick={() => onMakeModel(suggestion)}
          className={cn(
            'mt-2 inline-flex max-w-full items-center gap-1.5 rounded-full border border-accent/30 bg-accent-soft px-3 py-1 text-xs font-medium text-accent-text',
            'transition-[background-color,border-color] duration-150 hover:bg-accent-soft-2',
            focusRing,
          )}
          aria-label={`Заменить марку и модель на ${suggestion}`}
        >
          <Sparkles className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
          <span className="truncate">По VIN: {suggestion}</span>
          <span className="flex-shrink-0 font-semibold">· Заменить</span>
        </button>
      )}
    </>
  );

  if (label) {
    return (
      <Field label={label} htmlFor={inputId} className={className}>
        {control}
      </Field>
    );
  }
  return <div className={cn('min-w-0', className)}>{control}</div>;
}
