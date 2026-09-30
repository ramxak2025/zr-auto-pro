/**
 * useStorageCells — справочник ячеек хранения ОДНОГО склада (2026-09-30).
 *
 * Ключ `['storage-cells', warehouseId]` — в whitelist persistentCache (по слоту на
 * склад: main / defect / used), поэтому список поднимается на холодном старте и
 * пикер ячейки открывается уже с данными. Глобальный `placeholderData: prev => prev`
 * (App.tsx) здесь сужен до «предыдущие данные ТОГО ЖЕ склада»: при смене склада
 * чужие ячейки не должны мелькать и, главное, не должны быть доступны для выбора —
 * сервер отвергнет ячейку чужого склада (`STORAGE_CELL_WRONG_WAREHOUSE`).
 */
import { useQuery, type QueryClient, type UseQueryResult } from '@tanstack/react-query';
import { storageCellsApi } from '../api/services';
import type { StorageCell } from '../../../shared/types';

export const STORAGE_CELLS_KEY = 'storage-cells';

export function storageCellsQueryKey(warehouseId: string | null | undefined) {
  return [STORAGE_CELLS_KEY, warehouseId ?? null] as const;
}

/** Не-массив из кэша (HTML при 502, сырой axios-ответ) деградирует в `[]`, а не роняет `.filter`. */
export function toStorageCellArray(value: unknown): StorageCell[] {
  return Array.isArray(value) ? (value as StorageCell[]) : [];
}

export function useStorageCells(
  warehouseId: string | null | undefined,
  options?: { enabled?: boolean },
): UseQueryResult<StorageCell[]> {
  return useQuery<StorageCell[]>({
    queryKey: storageCellsQueryKey(warehouseId),
    queryFn: async () => toStorageCellArray((await storageCellsApi.list(warehouseId as string)).data),
    enabled: !!warehouseId && (options?.enabled ?? true),
    placeholderData: (prev, prevQuery) => (prevQuery?.queryKey[1] === (warehouseId ?? null) ? prev : undefined),
    // Справочник меняется редко и только с этого экрана — мутации инвалидируют его сами.
    staleTime: 30_000,
  });
}

/** Ячейки изменились (создана, переименована) — обновить только справочник. */
export function invalidateStorageCells(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: [STORAGE_CELLS_KEY] });
}

/**
 * Ячейка удалена или у товаров сменился адрес: кроме справочника (счётчики
 * `productsCount`) устаревают списки товаров — в строке склада и в подборе Кассы
 * стоит чип с кодом, — и открытые карточки.
 */
export function invalidateStorageCellsAndProducts(queryClient: QueryClient): Promise<void[]> {
  return Promise.all([
    invalidateStorageCells(queryClient),
    queryClient.invalidateQueries({ queryKey: ['products'] }),
    queryClient.invalidateQueries({ queryKey: ['all-products-check'] }),
    queryClient.invalidateQueries({ queryKey: ['product'] }),
  ]);
}
