import { InputHTMLAttributes } from 'react';

interface PhoneInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> {
  value: string;
  onChange: (value: string) => void;
}

function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');

  if (digits.length === 0) return '';

  // Format as +998 (XX) XXX-XX-XX for Uzbek numbers or generic formatting
  if (digits.length <= 3) return `+${digits}`;
  if (digits.length <= 5) return `+${digits.slice(0, 3)} (${digits.slice(3)}`;
  if (digits.length <= 8)
    return `+${digits.slice(0, 3)} (${digits.slice(3, 5)}) ${digits.slice(5)}`;
  if (digits.length <= 10)
    return `+${digits.slice(0, 3)} (${digits.slice(3, 5)}) ${digits.slice(5, 8)}-${digits.slice(8)}`;

  return `+${digits.slice(0, 3)} (${digits.slice(3, 5)}) ${digits.slice(5, 8)}-${digits.slice(8, 10)}-${digits.slice(10, 12)}`;
}

export default function PhoneInput({
  value,
  onChange,
  ...rest
}: PhoneInputProps) {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    const digits = raw.replace(/\D/g, '');
    onChange(formatPhone(digits));
  };

  return (
    <input
      type="tel"
      value={value}
      onChange={handleChange}
      className="input"
      {...rest}
    />
  );
}
