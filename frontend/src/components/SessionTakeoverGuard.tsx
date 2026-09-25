import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

import { endSessionWithNotice } from '../api/axios';
import { SESSION_TOKEN_KEY, inspectStoredSession } from '../utils/sessionToken';
import { Button } from '../ui/Button';

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
      aria-describedby="session-takeover-text"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-ink/60 p-4 backdrop-blur-[2px]"
    >
      <div className="w-full max-w-md rounded-xl border border-line bg-surface p-6 shadow-pop">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-warn-soft text-warn">
            <AlertTriangle className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0" id="session-takeover-text">
            <h2 id="session-takeover-title" className="text-md font-semibold text-ink">
              Сессия обновлена в другой вкладке
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-ink-2">
              В другой вкладке вы перешли в другой филиал или вошли под другим аккаунтом. Эта страница показывает данные
              прежнего филиала, поэтому работать в ней нельзя — иначе чек уйдёт не в тот автосервис.
            </p>
            <p className="mt-2 text-sm leading-relaxed text-ink-2">
              Обновите страницу: вкладка откроется в текущем филиале, пароль вводить не нужно. Незавершённые
              заказ-наряды в этой вкладке будут потеряны.
            </p>
          </div>
        </div>
        <Button
          icon={RefreshCw}
          fullWidth
          size="lg"
          className="mt-5"
          onClick={() => window.location.reload()}
          autoFocus
        >
          Обновить страницу
        </Button>
      </div>
    </div>
  );
}
