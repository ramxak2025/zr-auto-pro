import { ReactNode } from 'react';
import { LucideIcon } from 'lucide-react';

interface PageHeaderProps {
  /** Page H1 — always rendered with the shared `.page-title` scale (text-2xl). */
  title: string;
  /** Optional leading icon shown in a primary-tinted chip (matches app header idiom). */
  icon?: LucideIcon;
  /** Optional muted subtitle under the title. */
  subtitle?: string;
  /** Right-aligned actions (buttons, filters). */
  actions?: ReactNode;
  className?: string;
}

/**
 * Canonical page header. Replaces the ~11 hand-rolled headers that drifted to
 * five different title sizes. Uses the existing `.page-header` / `.page-title`
 * tokens so it is a pure structural/className change with zero behavior risk.
 */
export default function PageHeader({ title, icon: Icon, subtitle, actions, className = '' }: PageHeaderProps) {
  return (
    <div className={`page-header ${className}`}>
      <div className="flex items-center gap-3 min-w-0">
        {Icon && (
          <span className="flex-shrink-0 flex items-center justify-center h-10 w-10 rounded-xl bg-primary-50 text-primary-600">
            <Icon className="h-5 w-5" />
          </span>
        )}
        <div className="min-w-0">
          <h1 className="page-title truncate">{title}</h1>
          {subtitle && <p className="text-sm text-gray-500 mt-0.5 truncate">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>}
    </div>
  );
}
