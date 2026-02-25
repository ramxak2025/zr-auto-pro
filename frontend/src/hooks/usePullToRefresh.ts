import { useRef, useEffect, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';

interface PullToRefreshOptions {
  /** Element to attach touch listeners to (default: auto-detect <main>) */
  containerRef?: React.RefObject<HTMLElement>;
  /** Minimum pull distance in px to trigger refresh (default: 80) */
  threshold?: number;
  /** Max indicator displacement in px (default: 120) */
  maxPull?: number;
  /** Callback when refresh triggered. If omitted — invalidates all active queries */
  onRefresh?: () => Promise<void> | void;
  /** Disable the hook entirely */
  disabled?: boolean;
}

/**
 * Native-feeling pull-to-refresh for PWA.
 *
 * Attaches to the <main> scroll container and detects a swipe-down gesture
 * when the user is at scrollTop ≈ 0. Shows a CSS-driven indicator and
 * invalidates React Query cache on release.
 */
export function usePullToRefresh(options: PullToRefreshOptions = {}) {
  const {
    threshold = 80,
    maxPull = 120,
    onRefresh,
    disabled = false,
  } = options;

  const queryClient = useQueryClient();
  const startY = useRef(0);
  const currentY = useRef(0);
  const pulling = useRef(false);
  const refreshing = useRef(false);
  const indicatorEl = useRef<HTMLDivElement | null>(null);

  // Create the indicator element once
  const getIndicator = useCallback(() => {
    if (indicatorEl.current) return indicatorEl.current;
    const el = document.createElement('div');
    el.className = 'ptr-indicator';
    el.innerHTML = `
      <div class="ptr-spinner">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
          <path d="M12 2v6M12 22v-6M4.93 4.93l4.24 4.24M14.83 14.83l4.24 4.24M2 12h6M22 12h-6M4.93 19.07l4.24-4.24M14.83 9.17l4.24-4.24"/>
        </svg>
      </div>
    `;
    return el;
  }, []);

  useEffect(() => {
    if (disabled) return;

    // Only on mobile / touch devices
    const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    if (!isTouchDevice) return;

    const container = options.containerRef?.current ?? document.querySelector('main');
    if (!container) return;

    const indicator = getIndicator();
    indicatorEl.current = indicator;

    // Insert indicator before the main content container
    if (!indicator.parentNode) {
      container.parentElement?.insertBefore(indicator, container);
    }

    const onTouchStart = (e: TouchEvent) => {
      if (refreshing.current) return;
      if (container.scrollTop > 5) return; // not at top

      startY.current = e.touches[0].clientY;
      currentY.current = startY.current;
      pulling.current = true;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!pulling.current || refreshing.current) return;

      currentY.current = e.touches[0].clientY;
      const delta = currentY.current - startY.current;

      // Only pull down
      if (delta < 0) {
        pulling.current = false;
        indicator.style.transform = 'translateY(-100%)';
        indicator.style.opacity = '0';
        return;
      }

      // Damped pull (feels native)
      const progress = Math.min(delta / maxPull, 1);
      const displacement = progress * maxPull * 0.5; // 50% damping

      indicator.style.transform = `translateY(${displacement - 48}px)`;
      indicator.style.opacity = String(Math.min(progress * 1.5, 1));

      // Rotate spinner based on progress
      const spinner = indicator.querySelector('.ptr-spinner') as HTMLElement;
      if (spinner) {
        spinner.style.transform = `rotate(${progress * 360}deg) scale(${0.5 + progress * 0.5})`;
      }

      // If threshold reached, add ready class
      if (delta >= threshold) {
        indicator.classList.add('ptr-ready');
      } else {
        indicator.classList.remove('ptr-ready');
      }

      // Prevent browser's native scroll-bounce
      if (container.scrollTop <= 0 && delta > 0) {
        e.preventDefault();
      }
    };

    const onTouchEnd = async () => {
      if (!pulling.current || refreshing.current) return;

      const delta = currentY.current - startY.current;
      pulling.current = false;

      if (delta >= threshold) {
        // Trigger refresh
        refreshing.current = true;
        indicator.classList.add('ptr-refreshing');
        indicator.classList.remove('ptr-ready');
        indicator.style.transform = 'translateY(12px)';

        try {
          if (onRefresh) {
            await onRefresh();
          } else {
            await queryClient.invalidateQueries();
          }
        } finally {
          // Animate out
          setTimeout(() => {
            indicator.classList.remove('ptr-refreshing');
            indicator.style.transform = 'translateY(-100%)';
            indicator.style.opacity = '0';
            refreshing.current = false;
          }, 300);
        }
      } else {
        // Snap back
        indicator.style.transform = 'translateY(-100%)';
        indicator.style.opacity = '0';
        indicator.classList.remove('ptr-ready');
      }
    };

    container.addEventListener('touchstart', onTouchStart, { passive: true });
    container.addEventListener('touchmove', onTouchMove, { passive: false });
    container.addEventListener('touchend', onTouchEnd, { passive: true });

    return () => {
      container.removeEventListener('touchstart', onTouchStart);
      container.removeEventListener('touchmove', onTouchMove);
      container.removeEventListener('touchend', onTouchEnd);
      indicator.remove();
      indicatorEl.current = null;
    };
  }, [disabled, threshold, maxPull, onRefresh, queryClient, getIndicator, options.containerRef]);
}
