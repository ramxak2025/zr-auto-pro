/**
 * Ячейки хранения склада (172, 2026-09-30) — один запрос на склад, общий для формы
 * товара, шторки «Ячейки хранения», фильтра «Ячейка» и выбора ячейки.
 *
 * ГЛАВНОЕ ПРАВИЛО: пока на складе нет ни одной ячейки, `hasCells === false`, и экраны
 * рисуются ровно как раньше — без колонок, плашек и пикеров. Поэтому решение
 * «показывать ли адресное хранение» принимается только по этим данным.
 */
import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { storageCellsApi } from '../api/services';
import type { StorageCell, StorageCellError } from '../types';
import { apiErrorMessage } from '../../../shared/utils/apiError';

/** Ключ списка ячеек одного склада. Ячейки другого склада в этом слоте кеша не лежат. */
export const storageCellsKey = (warehouseId: string | null | undefined) =>
  ['storage-cells', warehouseId || 'none'] as const;

/** Порядок как на сервере — `sortOrder`, дальше по коду, но «A-2» раньше «A-10» (естественная сортировка). */
export function sortStorageCells(cells: readonly StorageCell[]): StorageCell[] {
  return [...cells].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code, 'ru', { numeric: true, sensitivity: 'base' }),
  );
}

export interface UseStorageCells {
  /** Ячейки именно этого склада, по порядку. Пусто, пока склад не выбран или ячеек нет. */
  cells: StorageCell[];
  /** На складе есть хотя бы одна ячейка — только тогда рисуем адресное хранение. */
  hasCells: boolean;
  byId: Map<string, StorageCell>;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
  /** Только список ячеек склада — после создания и перестановки (товары от этого не меняются). */
  invalidateCells: () => void;
  /** Ячейки склада и списки товаров — после переименования, удаления ячейки и смены адреса у товаров. */
  invalidate: () => void;
  /** Положить в кеш свежесозданную/изменённую ячейку, не дожидаясь перезапроса (иначе select на миг не найдёт её). */
  upsert: (cell: StorageCell) => void;
}

export function useStorageCells(warehouseId: string | null | undefined): UseStorageCells {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: storageCellsKey(warehouseId),
    queryFn: async () => (await storageCellsApi.list(warehouseId as string)).data,
    enabled: !!warehouseId,
    staleTime: 30_000,
  });

  const data = query.data;
  // Глобальный placeholderData держит прошлый ответ при смене склада — чужие ячейки отсекаем по складу.
  const cells = useMemo(
    () => (warehouseId && data ? sortStorageCells(data.filter((c) => c.warehouseId === warehouseId)) : []),
    [data, warehouseId],
  );
  const byId = useMemo(() => new Map(cells.map((c) => [c.id, c])), [cells]);

  const invalidateCells = useCallback(() => {
    if (warehouseId) queryClient.invalidateQueries({ queryKey: storageCellsKey(warehouseId) });
  }, [queryClient, warehouseId]);

  const invalidate = useCallback(() => {
    invalidateCells();
    queryClient.invalidateQueries({ queryKey: ['products'] });
    queryClient.invalidateQueries({ queryKey: ['products-all'] });
  }, [queryClient, invalidateCells]);

  const upsert = useCallback(
    (cell: StorageCell) => {
      if (!warehouseId) return;
      queryClient.setQueryData<StorageCell[]>(storageCellsKey(warehouseId), (old) => [
        ...(old ?? []).filter((c) => c.id !== cell.id),
        cell,
      ]);
    },
    [queryClient, warehouseId],
  );

  const { refetch } = query;
  const refetchCells = useCallback(() => {
    void refetch();
  }, [refetch]);

  return {
    cells,
    hasCells: cells.length > 0,
    byId,
    // Чужой ответ из placeholderData (смена склада) тоже «ещё не знаем», а не «ячеек нет».
    isLoading: !!warehouseId && (query.isLoading || query.isPlaceholderData),
    isError: query.isError,
    refetch: refetchCells,
    invalidateCells,
    invalidate,
    upsert,
  };
}

// ─── Ошибки сервера ────────────────────────────────────────────────────────────

export type StorageCellErrorCode = StorageCellError['code'];

function errorData(err: unknown): Partial<StorageCellError> | null {
  const data = (err as { response?: { data?: unknown } } | null)?.response?.data;
  return data && typeof data === 'object' ? (data as Partial<StorageCellError>) : null;
}

/** Машинный код ошибки модуля ячеек или null (сеть, чужая ошибка). */
export function storageCellErrorCode(err: unknown): StorageCellErrorCode | null {
  const code = errorData(err)?.code;
  return code === 'STORAGE_CELL_EXISTS' || code === 'STORAGE_CELL_NOT_EMPTY' || code === 'STORAGE_CELL_WRONG_WAREHOUSE'
    ? code
    : null;
}

/** `productsCount` из 409 `STORAGE_CELL_NOT_EMPTY` — сколько товаров лежит в ячейке. */
export function storageCellErrorProductsCount(err: unknown): number | null {
  const n = errorData(err)?.productsCount;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

/** Понятный текст ошибки: по коду — наш, иначе текст сервера, иначе запасной. */
export function storageCellErrorMessage(err: unknown, fallback: string): string {
  switch (storageCellErrorCode(err)) {
    case 'STORAGE_CELL_EXISTS':
      return 'Ячейка с таким кодом уже есть на этом складе';
    case 'STORAGE_CELL_WRONG_WAREHOUSE':
      return 'Эта ячейка относится к другому складу — выберите ячейку текущего склада';
    case 'STORAGE_CELL_NOT_EMPTY':
      return 'В ячейке есть товары — перенесите их в другую ячейку или снимите адрес';
    default:
      return apiErrorMessage(err) ?? fallback;
  }
}
