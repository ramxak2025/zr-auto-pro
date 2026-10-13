import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { editBookingPhone, formatBookingPhoneInput } from '../../utils/bookingPhone';

export default function BookingPhoneInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const caret = useRef<number | null>(null);
  const apply = useCallback(
    (result: { value: string; caret: number }) => {
      caret.current = result.caret;
      onChange(result.value);
      // A separator edit can leave the value identical, so React need not render.
      input.current?.setSelectionRange(result.caret, result.caret);
    },
    [onChange],
  );
  useEffect(() => {
    const element = input.current;
    if (!element) return;
    const before = (event: InputEvent) => {
      if (event.inputType !== 'deleteContentBackward' && event.inputType !== 'deleteContentForward') return;
      event.preventDefault();
      apply(
        editBookingPhone(
          value,
          element.selectionStart ?? value.length,
          element.selectionEnd ?? value.length,
          '',
          event.inputType === 'deleteContentBackward' ? 'backspace' : 'delete',
        ),
      );
    };
    element.addEventListener('beforeinput', before);
    return () => element.removeEventListener('beforeinput', before);
  }, [value, apply]);
  useLayoutEffect(() => {
    if (caret.current !== null) input.current?.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  }, [value]);
  return (
    <input
      ref={input}
      id="pb-phone"
      required
      type="tel"
      inputMode="tel"
      autoComplete="tel"
      maxLength={32}
      placeholder="+7 (988) 444-44-36"
      value={value}
      onChange={(event) =>
        apply(formatBookingPhoneInput(event.target.value, event.target.selectionStart ?? event.target.value.length))
      }
      onKeyDown={(event) => {
        if (event.key !== 'Backspace' && event.key !== 'Delete') return;
        event.preventDefault();
        apply(
          editBookingPhone(
            value,
            event.currentTarget.selectionStart ?? value.length,
            event.currentTarget.selectionEnd ?? value.length,
            '',
            event.key === 'Backspace' ? 'backspace' : 'delete',
          ),
        );
      }}
      onPaste={(event) => {
        event.preventDefault();
        apply(
          editBookingPhone(
            value,
            event.currentTarget.selectionStart ?? value.length,
            event.currentTarget.selectionEnd ?? value.length,
            event.clipboardData.getData('text'),
          ),
        );
      }}
    />
  );
}
