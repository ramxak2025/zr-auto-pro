/** Two independent controls; the existing groupBy wire value/export stays intact. */
export const ABC_BASES = [
  { value: 'revenue', label: 'Выручка' },
  { value: 'gross', label: 'Валовая прибыль' },
] as const;

export const ANALYSIS_KINDS = [
  { value: 'all', label: 'Все' },
  { value: 'products', label: 'Товары' },
  { value: 'services', label: 'Услуги' },
] as const;

export function readAbcSelection(groupBy: string | null) {
  const [basis, kind] = (groupBy ?? 'revenue-all').split('-');
  return {
    basis: basis === 'gross' ? 'gross' : 'revenue',
    kind: kind === 'products' || kind === 'services' ? kind : 'all',
  };
}
