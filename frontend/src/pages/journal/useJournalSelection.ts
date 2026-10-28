import { useLayoutEffect, useRef, type RefObject } from 'react';
import gsap from 'gsap';

/** The same physical selection follows scope, period and master changes. */
export function useJournalSelection(root: RefObject<HTMLElement>, value: string) {
  const move = useRef<() => void>();
  useLayoutEffect(() => {
    const node = root.current;
    const plate = node?.querySelector<HTMLElement>('[data-selection-backplate]');
    if (!node || !plate) return;
    const context = gsap.context(() => {}, node);
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    let positioned = false;
    const update = () => {
      const selected = node.querySelector<HTMLElement>('[data-selection-active="true"]');
      context.add(() => {
        gsap.killTweensOf(plate);
        if (!selected) {
          gsap.to(plate, { opacity: 0, duration: reduced.matches ? 0 : 0.12 });
          return;
        }
        gsap.to(plate, {
          x: selected.offsetLeft,
          y: selected.offsetTop,
          width: selected.offsetWidth,
          height: selected.offsetHeight,
          opacity: 1,
          duration: positioned && !reduced.matches ? 0.23 : 0,
          ease: 'power3.out',
        });
        positioned = true;
      });
    };
    move.current = update;
    const resize = new ResizeObserver(update);
    resize.observe(node);
    node.querySelectorAll<HTMLElement>('[data-selection-active]').forEach((item) => resize.observe(item));
    reduced.addEventListener('change', update);
    update();
    return () => {
      move.current = undefined;
      resize.disconnect();
      reduced.removeEventListener('change', update);
      context.revert();
    };
  }, [root]);
  useLayoutEffect(() => move.current?.(), [value]);
}
