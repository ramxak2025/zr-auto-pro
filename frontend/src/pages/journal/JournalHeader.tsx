import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowLeft,
  BookOpen,
  Check,
  ChevronRight,
  MoreHorizontal,
  Package,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react';
import gsap from 'gsap';
import { cn } from '../../ui/cn';
import { IconButton } from '../../ui/IconButton';
import { focusRing } from '../../ui/tokens';
import JournalSearch from './JournalSearch';
import JournalFilters from './JournalFilters';
import JournalPopover from './JournalPopover';
import { journalPeriodLabel } from './journalFormatting';
import { useJournalSelection } from './useJournalSelection';
import './journal.css';

type View = 'checks' | 'docs' | 'trash';
const sections = [
  { key: 'checks' as const, label: 'Чеки', description: 'Заказ-наряды и продажи', icon: BookOpen },
  { key: 'docs' as const, label: 'Документы', description: 'Складские операции', icon: Package },
  { key: 'trash' as const, label: 'Корзина', description: 'Удалённые заказ-наряды', icon: Trash2 },
];

export default function JournalHeader({
  subtitle,
  view,
  onViewChange,
  canSeeTrash,
  search,
  onSearchChange,
  applied,
  options,
  onApply,
}: {
  subtitle: string;
  view: View;
  onViewChange: (view: View) => void;
  canSeeTrash: boolean;
  search: string;
  onSearchChange: (value: string) => void;
  applied: { from: string; to: string; masterId: string };
  options: { value: string; label: string }[];
  onApply: (values: { from: string; to: string; masterId: string }) => void;
}) {
  const root = useRef<HTMLElement>(null);
  const scope = useRef<HTMLDivElement>(null);
  const scopeTrigger = useRef<HTMLButtonElement>(null);
  const filterTrigger = useRef<HTMLButtonElement>(null);
  const [searchExpanded, setSearchExpanded] = useState(Boolean(search));
  const [sectionsOpen, setSectionsOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const id = useId();
  const hasPeriod = Boolean(applied.from || applied.to);
  const count = Number(hasPeriod) + Number(Boolean(applied.masterId));
  useJournalSelection(scope, view);

  // The measured heading scrolls naturally; only the command island stays pinned. No list
  // reflow, key changes or React updates on each scroll frame.
  useLayoutEffect(() => {
    const node = root.current;
    const scroll = node?.closest('main');
    if (!node || !scroll) return;
    const media = gsap.matchMedia();
    let frame = 0;
    media.add(
      { reduced: '(prefers-reduced-motion: reduce)', regular: '(prefers-reduced-motion: no-preference)' },
      () => {
        const heading = node.querySelector<HTMLElement>('.journal-heading');
        let titleHeight = 0;
        const measure = () => {
          titleHeight = heading?.getBoundingClientRect().height ?? 80;
          const stickyInset = Number.parseFloat(getComputedStyle(scroll).paddingTop) || 0;
          node.style.setProperty('--journal-title-height', `${titleHeight}px`);
          node.style.setProperty('--journal-sticky-inset', `${stickyInset}px`);
        };
        measure();
        const timeline = gsap
          .timeline({ paused: true })
          .to(node, { '--journal-material': 1, '--journal-dock-elevation': 0, duration: 1, ease: 'none' }, 0);
        // The parent remains in normal flow even after browser scroll restoration.
        const naturalTop = () => {
          let before = Number.parseFloat(getComputedStyle(node).marginTop) || 0;
          let sibling = node.previousElementSibling;
          while (sibling instanceof HTMLElement) {
            const style = getComputedStyle(sibling);
            before +=
              sibling.offsetHeight +
              (Number.parseFloat(style.marginTop) || 0) +
              (Number.parseFloat(style.marginBottom) || 0);
            sibling = sibling.previousElementSibling;
          }
          return (
            (node.parentElement?.getBoundingClientRect().top ?? 0) -
            scroll.getBoundingClientRect().top +
            scroll.scrollTop +
            before
          );
        };
        const update = () => {
          frame = 0;
          const progress = Math.max(0, Math.min(1, (scroll.scrollTop - naturalTop()) / Math.max(1, titleHeight)));
          timeline.progress(progress);
          node.dataset.journalCompact = String(progress >= 0.99);
          node.dataset.journalProgress = progress.toFixed(3);
          node.querySelector('.journal-heading')?.setAttribute('aria-hidden', String(progress >= 0.99));
        };
        const schedule = () => {
          if (!frame) frame = requestAnimationFrame(update);
        };
        const measureAndSchedule = () => {
          measure();
          schedule();
        };
        const resize = new ResizeObserver(measureAndSchedule);
        if (heading) resize.observe(heading);
        resize.observe(scroll);
        scroll.addEventListener('scroll', schedule, { passive: true });
        window.addEventListener('resize', measureAndSchedule);
        update();
        return () => {
          resize.disconnect();
          cancelAnimationFrame(frame);
          frame = 0;
          scroll.removeEventListener('scroll', schedule);
          window.removeEventListener('resize', measureAndSchedule);
        };
      },
      root,
    );
    return () => media.revert();
  }, []);

  const chips = [
    ...(hasPeriod
      ? [
          {
            key: 'period',
            label: journalPeriodLabel(applied.from, applied.to),
            clear: () => onApply({ ...applied, from: '', to: '' }),
          },
        ]
      : []),
    ...(applied.masterId
      ? [
          {
            key: 'master',
            label: options.find((option) => option.value === applied.masterId)?.label ?? 'Мастер выбран',
            clear: () => onApply({ ...applied, masterId: '' }),
          },
        ]
      : []),
  ];
  return (
    <header ref={root} data-journal-compact="false" data-journal-progress="0" className="journal-header">
      <div className="journal-heading">
        <h1 className="journal-title">Журнал</h1>
        <p className="journal-subtitle" title={subtitle}>
          {subtitle}
        </p>
      </div>
      <div className="journal-command-material" aria-hidden="true" />
      <div className="journal-command" data-search-open={view === 'checks' && searchExpanded}>
        <div ref={scope} className="journal-scope-dock journal-dock" role="group" aria-label="Раздел журнала">
          <span data-selection-backplate className="journal-selection-backplate" aria-hidden="true" />
          {view === 'trash' ? (
            <button
              type="button"
              onClick={() => onViewChange('checks')}
              className={cn('journal-scope-return', focusRing)}
            >
              <ArrowLeft size={17} aria-hidden="true" />
              <span>Корзина</span>
            </button>
          ) : (
            sections.slice(0, 2).map((section) => (
              <button
                key={section.key}
                type="button"
                aria-pressed={view === section.key}
                data-selection-active={view === section.key}
                onClick={() => onViewChange(section.key)}
                className={cn('journal-scope-option', focusRing)}
              >
                {section.label}
              </button>
            ))
          )}
        </div>
        <div className="journal-tools-dock journal-dock">
          {view === 'checks' && (
            <JournalSearch value={search} onChange={onSearchChange} onExpandedChange={setSearchExpanded} />
          )}
          {view !== 'trash' && (
            <div className="journal-filter-control">
              <IconButton
                ref={filterTrigger}
                label={`Фильтры журнала${count ? `, применено: ${count}` : ''}`}
                icon={SlidersHorizontal}
                aria-haspopup="dialog"
                aria-expanded={filtersOpen}
                onClick={() => setFiltersOpen(true)}
                className={cn('journal-action', count > 0 && 'journal-action--selected')}
              />
              {count > 0 && (
                <span className="journal-filter-count" aria-hidden="true">
                  {count}
                </span>
              )}
            </div>
          )}
          <div className="journal-more-control">
            <IconButton
              ref={scopeTrigger}
              label="Ещё в журнале"
              icon={MoreHorizontal}
              aria-haspopup="dialog"
              aria-expanded={sectionsOpen}
              onClick={() => setSectionsOpen(true)}
              className="journal-action"
            />
          </div>
        </div>
      </div>
      {view !== 'trash' && chips.length > 0 && (
        <div className="journal-applied" aria-label="Применённые фильтры">
          {chips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              aria-label={`Убрать фильтр: ${chip.label}`}
              title={chip.label}
              onClick={chip.clear}
              className={cn('journal-chip', focusRing)}
            >
              <span>{chip.label}</span>
              <X size={13} aria-hidden="true" />
            </button>
          ))}
          <button
            type="button"
            onClick={() => onApply({ from: '', to: '', masterId: '' })}
            className={cn('journal-reset', focusRing)}
          >
            Сбросить
          </button>
        </div>
      )}
      <JournalPopover
        open={sectionsOpen}
        onClose={() => setSectionsOpen(false)}
        anchor={scopeTrigger}
        labelledBy={`${id}-sections`}
        kind="sections"
      >
        <h2 id={`${id}-sections`} className="journal-menu-title">
          Разделы журнала
        </h2>
        <div className="journal-sections">
          {sections
            .filter((section) => section.key !== 'trash' || canSeeTrash)
            .map((section) => {
              const Icon = section.icon;
              return (
                <button
                  key={section.key}
                  type="button"
                  aria-current={view === section.key ? 'page' : undefined}
                  className={cn('journal-section-option', focusRing)}
                  onClick={() => {
                    onViewChange(section.key);
                    setSectionsOpen(false);
                  }}
                >
                  <Icon size={19} aria-hidden="true" />
                  <span>
                    <strong>{section.label}</strong>
                    <small>{section.description}</small>
                  </span>
                  {view === section.key ? (
                    <Check size={17} className="text-accent" aria-hidden="true" />
                  ) : (
                    <ChevronRight size={15} className="text-ink-3" aria-hidden="true" />
                  )}
                </button>
              );
            })}
        </div>
      </JournalPopover>
      <JournalFilters
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        anchor={filterTrigger}
        applied={applied}
        options={options}
        onApply={onApply}
      />
    </header>
  );
}

export function JournalPanel({
  tabKey,
  active,
  children,
  className,
}: {
  tabKey: View;
  active: boolean;
  children: ReactNode;
  className?: string;
}) {
  if (!active) return null;
  return (
    <section aria-label={sections.find((section) => section.key === tabKey)?.label} className={className}>
      {children}
    </section>
  );
}
