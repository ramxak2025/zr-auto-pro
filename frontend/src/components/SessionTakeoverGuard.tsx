import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

import { endSessionWithNotice } from '../api/axios';
import { SESSION_TOKEN_KEY, inspectStoredSession } from '../utils/sessionToken';

/**
 * ВТОРАЯ ВКЛАДКА ПОСЛЕ СМЕНЫ ФИЛИАЛА (167) — заслон на весь экран.
 *
 * ПРОБЛЕМА. Токен сессии лежит в localStorage, а он ОБЩИЙ на все вкладки. Когда
 * руководитель мгновенно переходит в другой филиал в одной вкладке, вторая об
 * этом не знает: её экраны по-прежнему подписаны прежним филиалом и показывают
 * его цифры, а любой следующий запрос уйдёт уже НОВЫМ токеном и вернёт данные
 * НОВОГО филиала. Человек читает заголовок «ТопГаз», а пробитый чек уходит в
 * «ZR AUTO» — ровно та ошибка, из-за которой филиал вообще сделали свойством
 * сессии. Молча подменить вкладку нельзя: подмены не видно.
 *
 * РЕШЕНИЕ. Каждая вкладка помнит свой токен (utils/sessionToken.ts). Как только
 * в общем хранилище оказывается чужой, вкладка:
 *   • перестаёт отправлять запросы (перехватчик в api/axios.ts) — чтобы в кеш
 *     не попали цифры филиала, которого нет в заголовке;
 *   • показывает этот заслон: работать здесь нельзя, нужно обновить страницу.
 *
 * ПОЧЕМУ «ОБНОВИТЬ», А НЕ «ВЫЙТИ И ВОЙТИ». Сессия в хранилище ЖИВАЯ — это та,
 * в которой человек прямо сейчас работает в соседней вкладке. Выход отсюда
 * отозвал бы её токен на сервере и обесточил бы ту вкладку посреди заказ-наряда.
 * Поэтому единственное действие — перезагрузка: вкладка поднимется в том же
 * филиале, что и соседняя, без пароля. А если токен к тому моменту уже мёртв
 * (например, в соседней вкладке вышли), перезагрузка сама приведёт на вход:
 * /auth/me ответит 401, и сработает обычный путь завершения сессии.
 *
 * ВТОРОЙ СЛУЧАЙ — В ХРАНИЛИЩЕ ПУСТО: в другой вкладке нажали «Выход», и наш
 * токен сервер уже отозвал. Здесь сессии действительно нет, поэтому уводим на
 * вход с объяснением, а не оставляем человека наедине с экранами, где каждая
 * кнопка отвечает ошибкой.
 */

/** Причина, которую увидит человек на экране входа: он этот выход не нажимал. */
const LOGGED_OUT_ELSEWHERE = 'Вы вышли из аккаунта в другой вкладке — войдите заново';

export default function SessionTakeoverGuard() {
  const [takenOver, setTakenOver] = useState(false);

  const check = useCallback(() => {
    const state = inspectStoredSession();
    if (state === 'foreign') {
      setTakenOver(true);
      return;
    }
    if (state === 'gone') {
      endSessionWithNotice(LOGGED_OUT_ELSEWHERE);
    }
  }, []);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      // event.key === null — вызвали localStorage.clear(): затронуты все ключи.
      if (event.key !== null && event.key !== SESSION_TOKEN_KEY) return;
      check();
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') check();
    };

    window.addEventListener('storage', onStorage);
    // Событие storage может не дойти до замороженной вкладки (фон на телефоне,
    // bfcache). Поэтому при возврате к вкладке и при фокусе сверяемся сами —
    // иначе человек вернётся к экрану, который выглядит рабочим, но не работает.
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', check);
    check();

    return () => {
      window.removeEventListener('storage', onStorage);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', check);
    };
  }, [check]);

  if (!takenOver) return null;

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="session-takeover-title"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-gray-900/60 p-4 backdrop-blur-sm"
    >
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
            <AlertTriangle className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h2 id="session-takeover-title" className="text-base font-bold text-gray-900">
              Сессия обновлена в другой вкладке
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-gray-600">
              В другой вкладке вы перешли в другой филиал или вошли под другим аккаунтом. Эта страница показывает данные
              прежнего филиала, поэтому работать в ней нельзя — иначе чек уйдёт не в тот автосервис.
            </p>
            <p className="mt-2 text-sm leading-relaxed text-gray-600">
              Обновите страницу: вкладка откроется в текущем филиале, пароль вводить не нужно. Незавершённые
              заказ-наряды в этой вкладке будут потеряны.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-primary-600 px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-primary-700"
        >
          <RefreshCw className="h-4 w-4" />
          Обновить страницу
        </button>
      </div>
    </div>
  );
}
