interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** REQUIRED accessible name. The old `sr-only peer` checkbox pattern put the
   *  descriptive text in a sibling, so the toggle itself announced nothing. */
  label: string;
  disabled?: boolean;
  id?: string;
  className?: string;
}

/**
 * Accessible toggle (`role="switch"` + `aria-checked` + required `aria-label`).
 * Drop-in replacement for the hand-rolled `sr-only peer` checkbox toggles on
 * Integrations / Notifications / CompanySettings / Admin pages.
 */
export default function Switch({ checked, onChange, label, disabled, id, className = '' }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed ${checked ? 'bg-primary-600' : 'bg-gray-300'} ${className}`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : 'translate-x-0.5'}`}
        aria-hidden="true"
      />
    </button>
  );
}
