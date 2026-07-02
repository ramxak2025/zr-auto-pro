import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';

/**
 * Listen for Service Worker background sync messages.
 *
 * When mutations are replayed after coming back online,
 * invalidate all queries so the UI shows fresh data.
 * Also notify SW when we go online so it can start replaying.
 *
 * SW v14: этот хук — ещё и источник СВЕЖЕГО токена для replay офлайн-очереди.
 * SW не хранит Authorization в записях (утечка + протухание), а спрашивает
 * его у живой вкладки сообщением GET_AUTH_TOKEN в момент отправки.
 */
export function useOfflineSync() {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    const handleMessage = (event: MessageEvent) => {
      const { data } = event;

      // SW запрашивает свежий токен для replay офлайн-очереди. Отвечаем в
      // переданный порт. Разлогинены (нет токена) → отвечаем null, SW отложит
      // очередь до следующей живой авторизованной вкладки.
      if (data?.type === 'GET_AUTH_TOKEN') {
        event.ports?.[0]?.postMessage({ token: localStorage.getItem('token') });
        return;
      }

      if (data?.type === 'MUTATION_QUEUED') {
        toast('Нет сети. Данные сохранены и отправятся автоматически', {
          icon: '📡',
          duration: 4000,
        });
      }

      if (data?.type === 'MUTATIONS_REPLAYED') {
        const { count, failed } = data;
        if (count > 0) {
          toast.success(`Отправлено ${count} сохранённых операций`);
          // Invalidate all queries to refresh UI with server data
          queryClient.invalidateQueries();
        }
        if (failed > 0) {
          // Сервер отклонил эти операции (или исчерпаны попытки) — на сервер
          // они НЕ попали. Честно и заметно: пользователь должен ввести данные
          // заново. Сами записи сохранены в IndexedDB autexa-sw →
          // autexa-offline-failed (для разбора/поддержки, не удаляются молча).
          toast.error(`Не отправлено операций: ${failed}. Сервер их отклонил — проверьте данные и введите заново.`, {
            duration: 10000,
          });
        }
      }
    };

    navigator.serviceWorker.addEventListener('message', handleMessage);

    // When we come back online, notify SW to replay mutations
    const handleOnline = () => {
      navigator.serviceWorker.controller?.postMessage({ type: 'ONLINE' });
      // Also refresh stale queries
      queryClient.invalidateQueries();
      toast.success('Соединение восстановлено');
    };

    const handleOffline = () => {
      toast('Нет подключения к сети', {
        icon: '📵',
        duration: 3000,
      });
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      navigator.serviceWorker.removeEventListener('message', handleMessage);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [queryClient]);
}
