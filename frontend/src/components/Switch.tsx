import { cn } from '../ui/cn';

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** REQUIRED accessible name. The old `sr-only peer` checkbox pattern put the
   *  descriptive text in a sibling, so the toggle itself announced nothing. */
  label: string;
  disabled?: boolean;
  id?: string;
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * Accessible toggle (`role="switch"` + `aria-checked` + required `aria-label`).
 * Drop-in replacement for the hand-rolled `sr-only peer` checkbox toggles on
 * Integrations / Notifications / CompanySettings / Admin pages.
 */
export default function Switch({ checked, onChange, label, disabled, id, size = 'md', className = '' }: SwitchProps) {
  const sm = size === 'sm';
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex flex-shrink-0 items-center rounded-full transition-colors duration-150',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2',
        'disabled:cursor-not-allowed disabled:opacity-50',
        sm ? 'h-5 w-9' : 'h-6 w-11',
        checked ? 'bg-accent' : 'bg-line-strong hover:bg-ink-4',
        className,
      )}
    >
      <span
        className={cn(
          'inline-block transform rounded-full bg-white shadow transition-transform duration-150',
          sm ? 'h-4 w-4' : 'h-5 w-5',
          checked ? (sm ? 'translate-x-[18px]' : 'translate-x-[22px]') : 'translate-x-0.5',
        )}
        aria-hidden="true"
      />
    </button>
  );
}
