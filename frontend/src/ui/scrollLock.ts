/**
 * Счётчик блокировок прокрутки body для наложений (Drawer, Modal). Несколько
 * открытых слоёв — один lock; последний закрывшийся возвращает overflow.
 * Компенсирует ширину полосы прокрутки, чтобы контент не «прыгал» на десктопе.
 */
let count = 0;
let prevOverflow = '';
let prevPaddingRight = '';

export function lockBodyScroll(): void {
  if (typeof document === 'undefined') return;
  if (count === 0) {
    prevOverflow = document.body.style.overflow;
    prevPaddingRight = document.body.style.paddingRight;
    const scrollbar = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = 'hidden';
    if (scrollbar > 0) document.body.style.paddingRight = `${scrollbar}px`;
  }
  count += 1;
}

export function unlockBodyScroll(): void {
  if (typeof document === 'undefined') return;
  count = Math.max(0, count - 1);
  if (count === 0) {
    document.body.style.overflow = prevOverflow;
    document.body.style.paddingRight = prevPaddingRight;
  }
}
