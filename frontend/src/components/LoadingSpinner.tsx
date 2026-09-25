/**
 * Полноэкранный скелет оболочки — fallback маршрута / загрузки сессии
 * (App.tsx). Повторяет форму НОВОЙ оболочки: тёмная боковая панель + белая
 * верхняя панель на десктопе, шапка + нижние табы на телефоне, — чтобы первый
 * кадр приложения не отличался от следующего. Внутри страниц НЕ использовать
 * (там — Skeleton / InlineLoader / QueryState).
 */
export default function LoadingSpinner() {
  return (
    <div className="flex h-screen h-[100dvh] bg-canvas" role="status" aria-label="Загрузка…">
      {/* Боковая панель (desktop) */}
      <div className="hidden w-[256px] flex-shrink-0 flex-col bg-rail md:flex" aria-hidden="true">
        <div className="flex h-14 items-center gap-2.5 border-b border-white/10 px-4">
          <div className="h-8 w-8 rounded-lg bg-white/10" />
          <div className="h-4 w-20 rounded bg-white/10" />
        </div>
        <div className="space-y-2 px-3 py-4">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="flex h-9 items-center gap-3 px-2.5">
              <div className="h-[18px] w-[18px] rounded bg-white/10" />
              <div className="h-3 rounded bg-white/10" style={{ width: `${48 + ((i * 23) % 60)}px` }} />
            </div>
          ))}
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Верхняя панель */}
        <div
          className="flex h-14 flex-shrink-0 items-center gap-3 border-b border-line bg-surface px-4 md:px-6"
          aria-hidden="true"
        >
          <div className="h-8 w-24 animate-pulse rounded bg-surface-3 md:hidden" />
          <div className="hidden h-4 w-28 animate-pulse rounded bg-surface-3 md:block" />
          <div className="flex-1" />
          <div className="h-7 w-7 animate-pulse rounded-full bg-surface-3" />
        </div>

        {/* Контент */}
        <div className="flex-1 space-y-4 overflow-hidden p-4 md:p-6" aria-hidden="true">
          <div className="h-6 w-48 animate-pulse rounded bg-line/70" />
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-24 animate-pulse rounded-xl border border-line bg-surface" />
            ))}
          </div>
          <div className="h-48 animate-pulse rounded-xl border border-line bg-surface" />
          <div className="h-32 animate-pulse rounded-xl border border-line bg-surface" />
        </div>

        {/* Нижние табы (mobile) */}
        <div
          className="flex h-[68px] flex-shrink-0 items-center justify-around border-t border-line bg-surface px-4 md:hidden"
          aria-hidden="true"
        >
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex flex-col items-center gap-1">
              <div className="h-5 w-5 animate-pulse rounded bg-surface-3" />
              <div className="h-2 w-8 animate-pulse rounded bg-surface-3" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
