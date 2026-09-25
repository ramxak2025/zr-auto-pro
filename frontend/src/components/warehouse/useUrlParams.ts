import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

type ParamPatch = Record<string, string | number | null | undefined>;

/**
 * Состояние списка — в URL (DESIGN_SYSTEM.md, принцип 10): поиск, фильтр, страница,
 * вкладка, папка. F5, «Назад» браузера и пересылка ссылки сохраняют контекст.
 *
 *   const [params, setParam] = useUrlParams();
 *   setParam({ q: value, page: null }, { replace: true }); // null/'' — удалить ключ
 *
 * `replace: true` — для ввода в поиск (не плодить записи истории на каждую букву);
 * переходы по папкам/вкладкам/страницам — обычный push, чтобы работал «Назад».
 */
export function useUrlParams() {
  const [params, setParams] = useSearchParams();

  const setParam = useCallback(
    (patch: ParamPatch, opts?: { replace?: boolean }) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [key, value] of Object.entries(patch)) {
            if (value === null || value === undefined || value === '') next.delete(key);
            else next.set(key, String(value));
          }
          return next;
        },
        { replace: opts?.replace ?? false },
      );
    },
    [setParams],
  );

  return [params, setParam] as const;
}

/** Номер страницы из URL: целое ≥ 1, мусор → 1. */
export function pageParam(params: URLSearchParams): number {
  const n = Number(params.get('page') ?? 1);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}
