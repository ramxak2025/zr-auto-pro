import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import gsap from 'gsap';
import { IconButton } from '../../ui/IconButton';
import { cn } from '../../ui/cn';
import { focusRing } from '../../ui/tokens';

type SearchRequest = { expanded: boolean; focus: boolean };

/** One input stays mounted across the source-control morph and every breakpoint. */
export default function WarehouseSearch({
  value,
  placeholder,
  geometryKey,
  onChange,
  onExpandedChange,
}: {
  value: string;
  placeholder: string;
  geometryKey: string;
  onChange: (value: string) => void;
  onExpandedChange: (expanded: boolean) => void;
}) {
  const [local, setLocal] = useState(value);
  const [request, setRequest] = useState<SearchRequest>(() => ({ expanded: Boolean(value), focus: false }));
  const { expanded } = request;
  const [present, setPresent] = useState(Boolean(value));
  const field = useRef<HTMLInputElement>(null);
  const launch = useRef<HTMLButtonElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const animation = useRef<{ motion: gsap.core.Timeline; reduced: boolean }>();
  const requested = useRef(request);
  const focused = useRef<SearchRequest>();
  const change = useRef(onChange);
  change.current = onChange;
  const requestExpansion = useCallback((nextExpanded: boolean, focus: boolean) => {
    // Each intent has its own identity, even for close/open in one React batch.
    // Invalidate an old exit synchronously, before the next commit.
    const next = { expanded: nextExpanded, focus };
    requested.current = next;
    if (nextExpanded) setPresent(true);
    setRequest(next);
  }, []);
  const finishClose = useCallback((closing: SearchRequest) => {
    if (requested.current === closing && !closing.expanded) setPresent(false);
  }, []);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stop = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => {
    stop();
    setLocal(value);
    if (value && !requested.current.expanded) requestExpansion(true, false);
  }, [value, requestExpansion]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  useEffect(() => onExpandedChange(expanded), [expanded, onExpandedChange]);

  useLayoutEffect(() => {
    const node = root.current;
    const command = node?.closest<HTMLElement>('.warehouse-command');
    const scope = command?.querySelector<HTMLElement>('.warehouse-scope');
    if (!node || !command || !scope) return;
    const media = gsap.matchMedia();
    media.add(
      { narrow: '(max-width: 767px)', wide: '(min-width: 768px)', reduced: '(prefers-reduced-motion: reduce)' },
      (context) => {
        const narrow = Boolean(context.conditions?.narrow);
        const reduced = Boolean(context.conditions?.reduced);
        // Keep distinct endpoints. Reduced motion seeks them without playing;
        // a zero-duration fromTo cannot distinguish progress(0) from progress(1).
        const duration = 0.25;
        const scopeWidth = scope.scrollWidth;
        const controlsWidth = [...command.querySelectorAll<HTMLElement>('[data-warehouse-tool]')].reduce(
          (width, item) => width + item.getBoundingClientRect().width + 4,
          0,
        );
        const targetWidth = () =>
          Math.max(
            narrow ? 148 : 240,
            Math.min(360, command.clientWidth - (narrow ? 0 : scopeWidth + 16) - controlsWidth - 12),
          );
        const motion = gsap.timeline({ paused: true });
        motion
          .fromTo(node, { width: 44 }, { width: targetWidth, duration, ease: 'power3.out' }, 0)
          .fromTo(
            launch.current,
            { opacity: 1, scale: 1 },
            { opacity: 0, scale: reduced ? 1 : 0.8, duration: duration * 0.5 },
            0,
          )
          .fromTo(
            node.querySelector('.journal-search-field'),
            { opacity: 0, x: reduced ? 0 : 12 },
            { opacity: 1, x: 0, duration: duration * 0.8, ease: 'power3.out' },
            duration * 0.16,
          );
        if (narrow)
          motion.fromTo(
            scope,
            { width: scopeWidth, opacity: 1, x: 0 },
            { width: 0, opacity: 0, x: reduced ? 0 : -10, duration, ease: 'power3.out' },
            0,
          );
        animation.current = { motion, reduced };
        const current = requested.current;
        motion.progress(current.expanded ? 1 : 0, true);
        if (!current.expanded) finishClose(current);
        scope.inert = narrow && current.expanded;
        const resize = new ResizeObserver(() => {
          const progress = motion.progress();
          motion.invalidate().progress(progress, true);
        });
        resize.observe(command);
        return () => {
          resize.disconnect();
          scope.inert = false;
          motion.eventCallback('onReverseComplete', null);
          animation.current = undefined;
        };
      },
      root,
    );
    return () => media.revert();
  }, [finishClose, geometryKey]);

  useLayoutEffect(() => {
    const scope = root.current?.closest('.warehouse-command')?.querySelector<HTMLElement>('.warehouse-scope');
    if (scope) scope.inert = expanded && window.matchMedia('(max-width: 767px)').matches;
    const current = animation.current;
    if (!current) {
      if (!expanded) finishClose(request);
      return;
    }
    const { motion, reduced } = current;
    motion.eventCallback('onReverseComplete', null);
    if (expanded) {
      if (reduced) motion.pause().progress(1, true);
      else motion.timeScale(1).play();
    } else if (reduced || motion.progress() === 0) {
      motion.pause().progress(0, true);
      finishClose(request);
    } else {
      motion.eventCallback('onReverseComplete', () => finishClose(request));
      motion.timeScale(1.25).reverse();
    }
  }, [request, expanded, finishClose]);

  useLayoutEffect(() => {
    // Focus belongs to the committed intent and its presence endpoint, never
    // to an animation frame or an exit that a newer request has superseded.
    if (!request.focus || requested.current !== request || focused.current === request || expanded !== present) return;
    focused.current = request;
    (expanded ? field.current : launch.current)?.focus({ preventScroll: true });
  }, [request, expanded, present]);

  const clear = () => {
    stop();
    setLocal('');
    change.current('');
  };
  const dismiss = () => {
    requestExpansion(false, true);
    clear();
    field.current?.blur();
  };
  return (
    <div ref={root} className="journal-search" data-expanded={expanded} data-present={present}>
      <IconButton
        ref={launch}
        label="Открыть поиск товара"
        icon={Search}
        className="journal-search-launch journal-action"
        tabIndex={expanded ? -1 : 0}
        aria-expanded={expanded}
        onClick={() => requestExpansion(true, true)}
      />
      <div className="journal-search-field" aria-hidden={!expanded}>
        <Search size={18} className="journal-search-symbol" aria-hidden="true" />
        <input
          ref={field}
          type="text"
          inputMode="search"
          value={local}
          tabIndex={expanded ? 0 : -1}
          autoComplete="off"
          spellCheck={false}
          placeholder={placeholder}
          aria-label="Поиск товара"
          onChange={(event) => {
            const next = event.target.value;
            setLocal(next);
            stop();
            timer.current = setTimeout(() => {
              timer.current = null;
              change.current(next);
            }, 300);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              dismiss();
            }
          }}
        />
        {local && (
          <IconButton
            label="Очистить поиск"
            icon={X}
            className="journal-search-clear"
            disabled={!expanded}
            onClick={() => {
              clear();
              field.current?.focus({ preventScroll: true });
            }}
          />
        )}
        <button
          type="button"
          className={cn('journal-search-cancel', focusRing)}
          tabIndex={expanded ? 0 : -1}
          onClick={dismiss}
        >
          Отмена
        </button>
      </div>
    </div>
  );
}
