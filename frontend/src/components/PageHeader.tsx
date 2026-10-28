import { Children, Fragment, isValidElement, useLayoutEffect, useRef, type ReactNode } from 'react';
import { ArrowLeft, type LucideIcon } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import gsap from 'gsap';
import { cn } from '../ui/cn';
import { IconButton } from '../ui/IconButton';
import { SectionHeaderContext } from '../ui/SectionHeaderContext';
import './page-header.css';

export interface PageHeaderProps {
  composition?: 'section' | 'navigation';
  /** Название страницы уходит с холстом при прокрутке, как в Журнале и Складе. */
  title: string;
  icon?: LucideIcon;
  /** Пассивный контекст: счётчик, период, пояснение. */
  subtitle?: string;
  /** Действия страницы с исходными disabled/loading и разрешениями. */
  actions?: ReactNode;
  /** Путь или исходный обработчик, включая защиту несохранённой формы. */
  backTo?: string | (() => void);
  meta?: ReactNode;
  /** Корневые поиск, фильтры и вкладки. Панели карточек остаются в контенте. */
  toolbar?: ReactNode;
  /** Static — для отдельного горизонтального рабочего холста. */
  variant?: 'sticky' | 'static';
  className?: string;
}

// Conditional fragments must not leave an empty island for a role without actions.
function hasContent(value: ReactNode): boolean {
  return Children.toArray(value).some((child) =>
    isValidElement<{ children?: ReactNode }>(child) && child.type === Fragment
      ? hasContent(child.props.children)
      : true,
  );
}

/**
 * One stable command island; no portals, clones or remounts when the title scrolls away.
 * The main element remains the only page scroller. Its real padding and the wrapped
 * heading are measured, so the island pins to main's top on every shell and breakpoint.
 */
export default function PageHeader({
  title,
  icon: Icon,
  subtitle,
  actions,
  backTo,
  meta,
  toolbar,
  composition = 'section',
  variant = 'sticky',
  className = '',
}: PageHeaderProps) {
  const navigate = useNavigate();
  const root = useRef<HTMLElement>(null);
  const heading = useRef<HTMLDivElement>(null);
  const command = useRef<HTMLDivElement>(null);
  const onBack = typeof backTo === 'function' ? backTo : backTo ? () => navigate(backTo) : undefined;
  const hasToolbar = hasContent(toolbar);
  const hasActions = hasContent(actions);
  const navigation = composition === 'navigation';
  const hasCommands = Boolean(navigation || onBack || hasToolbar || hasActions);
  const sticky = hasCommands && variant === 'sticky';

  useLayoutEffect(() => {
    const node = root.current;
    const titleNode = heading.current;
    const dock = command.current;
    const scroll = node?.closest('main');
    if (!node || !dock || !scroll || !sticky) return;
    const parent = node.parentElement;
    const context = gsap.context(() => {}, node);
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0;
    let headingHeight = 0;
    const timeline = gsap.timeline({ paused: true });
    context.add(() => timeline.to(node, { '--section-material': 1, duration: 1, ease: 'none' }));
    const update = () => {
      frame = 0;
      // Read natural scrolling, not a translated title or a guessed scroll distance.
      const progress =
        navigation || !titleNode
          ? 1
          : Math.max(
              0,
              Math.min(
                1,
                (scroll.getBoundingClientRect().top - titleNode.getBoundingClientRect().top) /
                  Math.max(1, headingHeight),
              ),
            );
      timeline.progress(reduced.matches ? Number(progress >= 0.99) : progress);
      node.dataset.sectionCompact = String(progress >= 0.99);
      node.dataset.sectionProgress = progress.toFixed(3);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const measure = () => {
      headingHeight = navigation ? 0 : (titleNode?.getBoundingClientRect().height ?? 0);
      const style = getComputedStyle(scroll);
      const inset = Number.parseFloat(style.paddingTop) || 0;
      const bottomInset = Number.parseFloat(style.paddingBottom) || 0;
      const pinnedHeight =
        dock.getBoundingClientRect().height + (Number.parseFloat(getComputedStyle(node).paddingBottom) || 0);
      node.style.setProperty('--section-heading-height', `${headingHeight}px`);
      node.style.setProperty('--section-sticky-inset', `${inset}px`);
      node.style.setProperty('--section-inline-inset', `${Number.parseFloat(style.paddingLeft) || 0}px`);
      // The side column must fit below the island inside main, including its bottom
      // padding. A viewport-based maximum lets the form's bottom push it under the island.
      parent?.style.setProperty('--section-header-sticky-height', `${pinnedHeight - inset}px`);
      parent?.style.setProperty(
        '--section-header-available-height',
        `${Math.max(0, scroll.clientHeight - pinnedHeight - bottomInset)}px`,
      );
      schedule();
    };
    const resize = new ResizeObserver(measure);
    if (titleNode) resize.observe(titleNode);
    resize.observe(dock);
    resize.observe(scroll);
    scroll.addEventListener('scroll', schedule, { passive: true });
    reduced.addEventListener('change', schedule);
    window.addEventListener('resize', measure);
    measure();
    update();
    return () => {
      resize.disconnect();
      cancelAnimationFrame(frame);
      scroll.removeEventListener('scroll', schedule);
      reduced.removeEventListener('change', schedule);
      window.removeEventListener('resize', measure);
      parent?.style.removeProperty('--section-header-sticky-height');
      parent?.style.removeProperty('--section-header-available-height');
      context.revert();
      timeline.kill();
    };
  }, [sticky, navigation]);

  const identity = (
    <>
      <div className="section-heading-line">
        {Icon && <Icon className="section-heading-icon" aria-hidden="true" />}
        <h1 className="section-title">{title}</h1>
        {meta && <div className="section-heading-meta">{meta}</div>}
      </div>
      {subtitle && <p className="section-subtitle">{subtitle}</p>}
    </>
  );
  const back = onBack ? (
    <IconButton label="Назад" icon={ArrowLeft} variant="ghost" onClick={onBack} className="section-back" />
  ) : null;

  return (
    <header
      ref={root}
      className={cn(
        'section-header',
        navigation && 'section-header--navigation',
        sticky && 'section-header--sticky',
        className,
      )}
      data-section-composition={composition}
      data-section-variant={sticky ? 'sticky' : 'static'}
      data-section-compact={navigation ? 'true' : 'false'}
      data-section-progress={navigation ? '1' : '0'}
    >
      {!navigation && (
        <div ref={heading} className="section-heading">
          {identity}
        </div>
      )}
      {hasCommands && (
        <SectionHeaderContext.Provider value={true}>
          <div className="section-command-material" aria-hidden="true" />
          <div ref={command} className="section-command">
            {navigation ? (
              <>
                <div className="section-navigation-row">
                  {back}
                  <div className="section-navigation-identity">{identity}</div>
                  {hasActions && <div className="section-actions">{actions}</div>}
                </div>
                {hasToolbar && <div className="section-toolbar section-navigation-toolbar">{toolbar}</div>}
              </>
            ) : (
              <>
                {(onBack || hasToolbar) && (
                  <div className="section-command-main">
                    {back}
                    {hasToolbar && <div className="section-toolbar">{toolbar}</div>}
                  </div>
                )}
                {hasActions && <div className="section-actions">{actions}</div>}
              </>
            )}
          </div>
        </SectionHeaderContext.Provider>
      )}
    </header>
  );
}
