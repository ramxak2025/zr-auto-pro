import { useEffect, useRef, useState, type ReactNode } from 'react';
import { BookOpen } from 'lucide-react';
import { cn } from '../../ui/cn';

/** Only the secondary context yields space. Search and section controls never leave the working plane. */
export default function JournalHeader({ subtitle, children }: { subtitle: string; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  const context = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number>();
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const node = context.current;
    if (!node) return;
    const observer = new ResizeObserver(() => setHeight(node.getBoundingClientRect().height));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const scroll = ref.current?.closest('main');
    if (!scroll) return;
    let previous = scroll.scrollTop;
    let anchor = previous;
    let direction = 0;
    let collapsed = false;
    const update = (next: boolean) => {
      if (collapsed !== next) {
        collapsed = next;
        setCompact(next);
      }
    };
    const onScroll = () => {
      const y = Math.max(0, scroll.scrollTop);
      const nextDirection = Math.sign(y - previous);
      if (nextDirection !== direction) {
        anchor = previous;
        direction = nextDirection;
      }
      previous = y;
      if (ref.current?.contains(document.activeElement) || y < 24) {
        update(false);
        return;
      }
      if (Math.abs(y - anchor) < 36) return;
      update(direction > 0 && y > 80);
    };
    scroll.addEventListener('scroll', onScroll, { passive: true });
    return () => scroll.removeEventListener('scroll', onScroll);
  }, []);
  return (
    <header
      ref={ref}
      data-journal-compact={compact}
      className="sticky top-0 z-20 rounded-xl border border-line bg-surface px-3 pb-3 pt-2 sm:px-4"
    >
      <div className="flex min-h-10 items-center gap-2.5">
        <BookOpen className="h-5 w-5 shrink-0 text-accent" aria-hidden="true" />
        <h1 className="page-title">Журнал</h1>
      </div>
      <div
        aria-hidden={compact}
        className="overflow-hidden transition-[height] duration-200 ease-out motion-reduce:transition-none"
        style={{ height: compact ? 0 : height }}
      >
        <div
          ref={context}
          className={cn(
            'pb-3 text-sm text-ink-3 transition-[transform,opacity] duration-150 motion-reduce:transform-none motion-reduce:transition-none',
            compact && '-translate-y-1 opacity-0',
          )}
        >
          {subtitle}
        </div>
      </div>
      {children}
    </header>
  );
}
