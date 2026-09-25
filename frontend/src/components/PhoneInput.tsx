import { InputHTMLAttributes } from 'react';
import { cn } from '../ui/cn';
import { controlBase, controlSize } from '../ui/Input';

interface PhoneInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> {
  value: string;
  onChange: (value: string) => void;
}

function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');

  if (digits.length === 0) return '';

  // Format as +7 (XXX) XXX-XX-XX for Russian numbers
  if (digits.length <= 1) return `+${digits}`;
  if (digits.length <= 4) return `+${digits.slice(0, 1)} (${digits.slice(1)}`;
  if (digits.length <= 7) return `+${digits.slice(0, 1)} (${digits.slice(1, 4)}) ${digits.slice(4)}`;
  if (digits.length <= 9)
    return `+${digits.slice(0, 1)} (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;

  return `+${digits.slice(0, 1)} (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7, 9)}-${digits.slice(9, 11)}`;
}

/**
 * Поле телефона с маской +7 (XXX) XXX-XX-XX. Публичный API (value/onChange +
 * атрибуты input) не меняется — компонент используют Клиенты, Касса,
 * Поставщики и Пользователи. Вид — тот же контрол, что `ui/Input`
 * (36 px, табличные цифры); `className` потребителя добавляется последним.
 */
export default function PhoneInput({ value, onChange, className, ...rest }: PhoneInputProps) {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    let digits = raw.replace(/\D/g, '');
    // Normalize: replace leading 8 with 7 for Russian numbers
    if (digits.length > 0 && digits[0] === '8') {
      digits = '7' + digits.slice(1);
    }
    onChange(formatPhone(digits));
  };

  return (
    <input
      type="tel"
      inputMode="tel"
      autoComplete="tel"
      value={value}
      onChange={handleChange}
      // Как и раньше: className потребителя ЗАМЕНЯЕТ стиль целиком (Касса и
      // поставщики передают свои классы) — иначе конфликтовали бы высоты.
      className={className ?? cn(controlBase, controlSize.md, 'tabular-nums')}
      {...rest}
    />
  );
}
