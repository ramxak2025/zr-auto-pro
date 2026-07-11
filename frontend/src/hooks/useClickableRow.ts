import { KeyboardEvent } from 'react';

interface ClickableRowProps {
  role: 'button';
  tabIndex: 0;
  onClick: () => void;
  onKeyDown: (e: KeyboardEvent) => void;
  'aria-label'?: string;
}

/**
 * Makes a non-semantic clickable row/cell/tile keyboard-operable. The audit
 * found core lists (Clients, Cars, Schedule grid) used `onClick` on `<tr>` /
 * `<div>` with only `cursor-pointer` — unreachable by keyboard. Spread the
 * returned props onto the element to add role="button", tab focus, and
 * Enter/Space activation.
 *
 *   <tr {...useClickableRow(() => navigate(id), { label: client.name })}>
 */
export function useClickableRow(onActivate: () => void, options?: { label?: string }): ClickableRowProps {
  return {
    role: 'button',
    tabIndex: 0,
    onClick: onActivate,
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onActivate();
      }
    },
    ...(options?.label ? { 'aria-label': options.label } : {}),
  };
}
