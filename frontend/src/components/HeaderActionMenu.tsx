import { useEffect, useState } from 'react';
import { ChevronDown, Loader2, MoreHorizontal } from 'lucide-react';
import { Button } from '../ui/Button';
import { DropdownMenu, type MenuEntry } from '../ui/DropdownMenu';
import { cn } from '../ui/cn';

export type HeaderMenuEntry = MenuEntry & { desktopOnly?: boolean; narrowOnly?: boolean };
type HeaderMenuCommand = Exclude<HeaderMenuEntry, { type: 'separator' | 'label' }>;

/** A labelled UI-only group. The caller owns every action, permission and busy state. */
export default function HeaderActionMenu({
  items,
  label = 'Ещё',
  className,
}: {
  items: HeaderMenuEntry[];
  label?: string;
  className?: string;
}) {
  const [desktop, setDesktop] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches,
  );
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const media = window.matchMedia('(min-width: 768px)');
    const update = () => setDesktop(media.matches);
    media.addEventListener('change', update);
    update();
    return () => media.removeEventListener('change', update);
  }, []);
  const visible = items.filter((item) => (!item.desktopOnly || desktop) && (!item.narrowOnly || !desktop));
  const commands = visible.filter(
    (item): item is HeaderMenuCommand => item.type !== 'separator' && item.type !== 'label',
  );
  if (commands.length === 0) return null;
  const busy = commands.find((item) => item.loading);
  return (
    <span className={cn('inline-flex min-w-0 max-w-full', className)}>
      <DropdownMenu
        responsive
        width={288}
        aria-label={label}
        items={visible}
        trigger={
          <Button
            variant="secondary"
            iconRight={ChevronDown}
            aria-busy={Boolean(busy) || undefined}
            className="min-w-0 max-w-full !whitespace-normal max-sm:min-h-11"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
            )}
            {label}
          </Button>
        }
      />
      {busy && (
        <span className="sr-only" role="status">
          Выполняется: {busy.label}
        </span>
      )}
    </span>
  );
}
