import { InputHTMLAttributes } from 'react';

interface PhoneInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> {
  value: string;
  onChange: (value: string) => void;
}

function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');

  if (digits.length === 0) return '';

  // Format as +7 (XXX) XXX-XX-XX for Russian numbers
  if (digits.length <= 1) return `+${digits}`;
  if (digits.length <= 4) return `+${digits.slice(0, 1)} (${digits.slice(1)}`;
  if (digits.length <= 7)
    return `+${digits.slice(0, 1)} (${digits.slice(1, 4)}) ${digits.slice(4)}`;
  if (digits.length <= 9)
    return `+${digits.slice(0, 1)} (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;

  return `+${digits.slice(0, 1)} (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7, 9)}-${digits.slice(9, 11)}`;
}

export default function PhoneInput({
  value,
  onChange,
  ...rest
}: PhoneInputProps) {
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
      value={value}
      onChange={handleChange}
      className="input"
      {...rest}
    />
  );
}
