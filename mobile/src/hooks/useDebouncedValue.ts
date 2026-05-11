/**
 * useDebouncedValue — returns the input value after `delay` ms of stillness.
 *
 * Why this exists:
 *   Search inputs in lists (Clients, Cars, Suppliers, Services, Checks…) are
 *   wired straight into a `useQuery` key. Every keystroke would normally
 *   trigger a brand-new network request. The shared `<SearchInput>` component
 *   already debounces the `onChange` callback at 300 ms, but a few callers
 *   thread the *immediate* `setSearch` value into other places (filter chips,
 *   query keys with multiple inputs). For those, debouncing the value at the
 *   query-key level is the safe, single-responsibility solution.
 *
 *   This hook is intentionally tiny and dependency-free. It does NOT mutate
 *   the input; it returns a *snapshot* that lags behind by `delay` ms.
 */
import { useEffect, useState } from 'react';

export function useDebouncedValue<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);

  return debounced;
}
