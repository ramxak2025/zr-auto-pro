import { ButtonHTMLAttributes, forwardRef } from 'react';
import { LucideIcon } from 'lucide-react';

type Variant = 'ghost' | 'secondary' | 'danger' | 'primary';
type Size = 'sm' | 'md';

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> {
  /** REQUIRED accessible name → becomes both `aria-label` and `title`. This is
   *  the whole point of the component: icon-only buttons across ~12 pages
   *  announced as a bare "button" to screen readers. */
  label: string;
  icon: LucideIcon;
  variant?: Variant;
  size?: Size;
}

const sizeCls: Record<Size, string> = { sm: 'h-8 w-8', md: 'h-10 w-10' };
const iconCls: Record<Size, string> = { sm: 'h-4 w-4', md: 'h-5 w-5' };
const variantCls: Record<Variant, string> = {
  ghost: 'text-gray-600 hover:bg-gray-100 hover:text-gray-900',
  secondary: 'text-gray-700 bg-white border border-gray-300 hover:bg-gray-50',
  danger: 'text-red-600 hover:bg-red-50',
  primary: 'text-white bg-primary-600 hover:bg-primary-700',
};

/** Accessible icon-only button. `label` is mandatory and drives aria-label + title. */
const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon: Icon, variant = 'ghost', size = 'md', className = '', type, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      aria-label={label}
      title={label}
      className={`inline-flex items-center justify-center rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed ${sizeCls[size]} ${variantCls[variant]} ${className}`}
      {...rest}
    >
      <Icon className={iconCls[size]} aria-hidden="true" />
    </button>
  );
});

export default IconButton;
