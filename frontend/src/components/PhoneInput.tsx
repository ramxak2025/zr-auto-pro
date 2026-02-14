import { useCallback } from 'react';

function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  // Remove leading 8 or 7, we always show +7
  let d = digits;
  if (d.startsWith('8') && d.length > 1) d = '7' + d.slice(1);
  if (d.startsWith('7')) d = d.slice(1);
  if (d.length > 10) d = d.slice(0, 10);

  let result = '+7';
  if (d.length > 0) result += ' (' + d.slice(0, 3);
  if (d.length >= 3) result += ') ';
  if (d.length > 3) result += d.slice(3, 6);
  if (d.length > 6) result += '-' + d.slice(6, 8);
  if (d.length > 8) result += '-' + d.slice(8, 10);
  return result;
}

function getDigits(formatted: string): string {
  return formatted.replace(/\D/g, '');
}

export function isPhoneComplete(value: string): boolean {
  const digits = value.replace(/\D/g, '');
  return digits.length === 11; // 7 + 10 digits
}

export function getPhoneRaw(formatted: string): string {
  const digits = formatted.replace(/\D/g, '');
  if (digits.startsWith('7') && digits.length === 11) return '+' + digits;
  return formatted;
}

interface PhoneInputProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  placeholder?: string;
  required?: boolean;
}

export default function PhoneInput({ value, onChange, className, placeholder, required }: PhoneInputProps) {
  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target.value;
    if (input === '' || input === '+') {
      onChange('');
      return;
    }
    onChange(formatPhone(input));
  }, [onChange]);

  const handleFocus = useCallback(() => {
    if (!value) {
      onChange('+7');
    }
  }, [value, onChange]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    // Allow only digits, backspace, delete, arrows, tab
    if (
      e.key.length === 1 &&
      !/\d/.test(e.key) &&
      !e.ctrlKey && !e.metaKey
    ) {
      e.preventDefault();
    }
  }, []);

  const digits = getDigits(value);
  const isValid = digits.length === 0 || digits.length === 11;

  return (
    <input
      type="tel"
      inputMode="tel"
      value={value}
      onChange={handleChange}
      onFocus={handleFocus}
      onKeyDown={handleKeyDown}
      placeholder={placeholder || '+7 (___) ___-__-__'}
      required={required}
      className={`${className || ''} ${!isValid && digits.length > 1 ? 'border-yellow-400 focus:border-yellow-500 focus:ring-yellow-500/20' : ''}`}
    />
  );
}
