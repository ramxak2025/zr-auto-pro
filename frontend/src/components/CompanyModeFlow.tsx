import { Fragment } from 'react';
import { ChevronRight } from 'lucide-react';
export default function CompanyModeFlow({ steps }: { steps: readonly string[] }) {
  return (
    <div aria-label={steps.join(' → ')} className="mt-3 flex items-center gap-2 rounded-xl bg-surface-2 px-3 py-3">
      {steps.map((step, index) => (
        <Fragment key={step}>
          {index > 0 && <ChevronRight className="h-3 w-3 shrink-0 text-ink-3" aria-hidden="true" />}
          <span className="min-w-0 flex-1 text-center text-xs font-medium leading-5 text-ink-2">{step}</span>
        </Fragment>
      ))}
    </div>
  );
}
