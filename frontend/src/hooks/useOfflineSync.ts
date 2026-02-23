import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';

/**
 * Listen for Service Worker background sync messages.
 *
 * When mutations are replayed after coming back online,
 * invalidate all queries so the UI shows fresh data.
 * Also notify SW when we go online so it can start replaying.
 */
export function useOfflineSync() {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    const handleMessage = (event: MessageEvent) => {
      const { data } = event;

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
          toast.error(`${failed} операций не удалось отправить`);
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
