import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Megaphone, Plus, Trash2, Loader2, Send, Link as LinkIcon, X, Eye, Ban, History } from 'lucide-react';
import toast from 'react-hot-toast';
import { format, parseISO } from 'date-fns';
import { ru } from 'date-fns/locale';

import { notificationsApi } from '../../api/services';
import ConfirmDialog from '../../components/ConfirmDialog';
import type { BroadcastButton, BroadcastHistoryItem } from '../../types';

interface EditableButton {
  label: string;
  action: 'dismiss' | 'link';
  url: string;
}

const MAX_BUTTONS = 3;

export default function AdminBroadcastPage() {
  const queryClient = useQueryClient();

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [buttons, setButtons] = useState<EditableButton[]>([]);
  const [confirmSendOpen, setConfirmSendOpen] = useState(false);
  const [cancelId, setCancelId] = useState<string | null>(null);

  const {
    data: history,
    isLoading: historyLoading,
    isError: historyError,
  } = useQuery({
    queryKey: ['admin-broadcasts'],
    queryFn: () => notificationsApi.listBroadcasts(),
    select: (res) => res.data as BroadcastHistoryItem[],
  });

  const sendMutation = useMutation({
    mutationFn: () => {
      const payloadButtons: BroadcastButton[] = buttons
        .filter((b) => b.label.trim())
        .map((b) =>
          b.action === 'link'
            ? { label: b.label.trim(), action: 'link', url: b.url.trim() }
            : { label: b.label.trim(), action: 'dismiss' },
        );
      return notificationsApi.createBroadcast({
        title: title.trim(),
        body: body.trim(),
        imageUrl: imageUrl.trim() || undefined,
        buttons: payloadButtons.length ? payloadButtons : undefined,
      });
    },
    onSuccess: () => {
      toast.success('Рассылка отправлена всем владельцам');
      setTitle('');
      setBody('');
      setImageUrl('');
      setButtons([]);
      queryClient.invalidateQueries({ queryKey: ['admin-broadcasts'] });
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || 'Не удалось отправить рассылку');
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => notificationsApi.cancelBroadcast(id),
    onSuccess: () => {
      toast.success('Рассылка отменена');
      queryClient.invalidateQueries({ queryKey: ['admin-broadcasts'] });
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || 'Не удалось отменить рассылку');
    },
  });

  const addButton = () => {
    if (buttons.length >= MAX_BUTTONS) return;
    setButtons((prev) => [...prev, { label: '', action: 'dismiss', url: '' }]);
  };

  const updateButton = (index: number, patch: Partial<EditableButton>) => {
    setButtons((prev) => prev.map((b, i) => (i === index ? { ...b, ...patch } : b)));
  };

  const removeButton = (index: number) => {
    setButtons((prev) => prev.filter((_, i) => i !== index));
  };

  const linkButtonsValid = buttons.every((b) => b.action !== 'link' || b.url.trim().length > 0);
  const canSend = title.trim().length > 0 && body.trim().length > 0 && linkButtonsValid && !sendMutation.isPending;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !body.trim()) {
      toast.error('Заполните заголовок и текст');
      return;
    }
    if (!linkButtonsValid) {
      toast.error('У кнопок-ссылок укажите URL');
      return;
    }
    setConfirmSendOpen(true);
  };

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Рассылка владельцам</h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Composer */}
        <form onSubmit={handleSubmit} className="card card-body space-y-4 self-start">
          <div className="flex items-center gap-2 text-gray-500">
            <Megaphone className="w-5 h-5" />
            <span className="text-sm">Объявление получат все директора автосервисов.</span>
          </div>

          <div>
            <label className="label">Заголовок</label>
            <input
              type="text"
              className="input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Например: Обновление приложения"
              maxLength={120}
              required
            />
          </div>

          <div>
            <label className="label">Текст</label>
            <textarea
              className="input"
              rows={4}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Что нового / что нужно сделать владельцам"
              maxLength={1000}
              required
            />
          </div>

          <div>
            <label className="label">Картинка (URL, необязательно)</label>
            <input
              type="url"
              className="input"
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              placeholder="https://..."
            />
          </div>

          {/* Buttons editor */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="label mb-0">Кнопки (до {MAX_BUTTONS})</label>
              <button
                type="button"
                onClick={addButton}
                disabled={buttons.length >= MAX_BUTTONS}
                className="btn-ghost btn-sm"
              >
                <Plus className="w-4 h-4" />
                Добавить
              </button>
            </div>

            {buttons.length === 0 ? (
              <p className="text-xs text-gray-400">Без кнопок объявление можно будет только закрыть.</p>
            ) : (
              <div className="space-y-3">
                {buttons.map((btn, i) => (
                  <div key={i} className="rounded-lg border border-gray-200 p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        className="input"
                        value={btn.label}
                        onChange={(e) => updateButton(i, { label: e.target.value })}
                        placeholder="Текст кнопки"
                        maxLength={40}
                      />
                      <button
                        type="button"
                        onClick={() => removeButton(i)}
                        className="p-2 text-gray-400 hover:text-red-600 rounded-lg hover:bg-red-50 transition-colors flex-shrink-0"
                        title="Удалить кнопку"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      <select
                        className="input flex-shrink-0 w-36"
                        value={btn.action}
                        onChange={(e) => updateButton(i, { action: e.target.value as 'dismiss' | 'link' })}
                      >
                        <option value="dismiss">Закрыть</option>
                        <option value="link">Ссылка</option>
                      </select>
                      {btn.action === 'link' && (
                        <input
                          type="url"
                          className="input"
                          value={btn.url}
                          onChange={(e) => updateButton(i, { url: e.target.value })}
                          placeholder="https://..."
                        />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center justify-end pt-2 border-t border-gray-200">
            <button type="submit" disabled={!canSend} className="btn-primary">
              {sendMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Отправка...
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  Отправить всем
                </>
              )}
            </button>
          </div>
        </form>

        {/* Live preview — center card */}
        <div className="self-start">
          <p className="text-sm font-medium text-gray-500 mb-3">Предпросмотр</p>
          <div className="rounded-3xl bg-gray-100 p-6 flex items-center justify-center min-h-[320px]">
            <div className="w-full max-w-sm rounded-2xl bg-white shadow-xl overflow-hidden">
              {imageUrl.trim() && (
                <img
                  src={imageUrl.trim()}
                  alt=""
                  className="w-full h-40 object-cover bg-gray-100"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.display = 'none';
                  }}
                />
              )}
              <div className="p-5">
                <div className="flex items-center justify-center w-12 h-12 rounded-full bg-primary-50 mx-auto mb-3">
                  <Megaphone className="w-6 h-6 text-primary-600" />
                </div>
                <h3 className="text-lg font-bold text-gray-900 text-center">
                  {title.trim() || 'Заголовок объявления'}
                </h3>
                <p className="text-sm text-gray-600 text-center mt-2 whitespace-pre-line">
                  {body.trim() || 'Здесь будет текст вашего объявления для владельцев автосервисов.'}
                </p>

                <div className="mt-5 space-y-2">
                  {buttons.filter((b) => b.label.trim()).length === 0 ? (
                    <button
                      type="button"
                      disabled
                      className="w-full flex items-center justify-center gap-2 bg-primary-600 text-white font-semibold py-2.5 rounded-xl"
                    >
                      <X className="w-4 h-4" />
                      Понятно
                    </button>
                  ) : (
                    buttons
                      .filter((b) => b.label.trim())
                      .map((b, i) => (
                        <button
                          key={i}
                          type="button"
                          disabled
                          className={`w-full flex items-center justify-center gap-2 font-semibold py-2.5 rounded-xl ${
                            i === 0 ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-700'
                          }`}
                        >
                          {b.action === 'link' && <LinkIcon className="w-4 h-4" />}
                          {b.label.trim()}
                        </button>
                      ))
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* History */}
      <div className="mt-10">
        <div className="flex items-center gap-2 mb-4">
          <History className="w-5 h-5 text-gray-500" />
          <h2 className="text-lg font-semibold text-gray-900">История рассылок</h2>
        </div>

        {historyLoading ? (
          <div className="card card-body flex items-center justify-center py-10 text-gray-400">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span className="ml-2 text-sm">Загрузка...</span>
          </div>
        ) : historyError ? (
          <div className="card card-body text-center py-10">
            <p className="text-sm text-red-600">Не удалось загрузить историю рассылок.</p>
            <button
              type="button"
              onClick={() => queryClient.invalidateQueries({ queryKey: ['admin-broadcasts'] })}
              className="btn-secondary btn-sm mt-3"
            >
              Повторить
            </button>
          </div>
        ) : !history || history.length === 0 ? (
          <div className="card card-body text-center py-10 text-gray-400">
            <Megaphone className="w-8 h-8 mx-auto mb-2 text-gray-300" />
            <p className="text-sm">Вы ещё не отправляли рассылок.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {history.map((item) => {
              const isCancelled = item.cancelledAt !== null;
              const isCancelling = cancelMutation.isPending && cancelMutation.variables === item.id;
              return (
                <div
                  key={item.id}
                  className="bg-white rounded-xl border border-gray-200 shadow-sm px-4 py-3.5 flex items-start justify-between gap-4"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-gray-900 truncate">{item.title}</span>
                      {isCancelled ? (
                        <span className="badge-red text-xs">Отменена</span>
                      ) : (
                        <span className="badge-green text-xs">Активна</span>
                      )}
                    </div>
                    {item.body && <p className="text-sm text-gray-600 mt-1 line-clamp-2">{item.body}</p>}
                    <div className="flex items-center gap-3 mt-2 text-xs text-gray-500 flex-wrap">
                      <span>{format(parseISO(item.createdAt), 'd MMM yyyy, HH:mm', { locale: ru })}</span>
                      <span className="flex items-center gap-1">
                        <Eye className="w-3.5 h-3.5" />
                        {item.seenCount} {item.seenCount === 1 ? 'просмотр' : 'просмотров'}
                      </span>
                      {isCancelled && (
                        <span>
                          отменена {format(parseISO(item.cancelledAt as string), 'd MMM, HH:mm', { locale: ru })}
                        </span>
                      )}
                    </div>
                  </div>

                  {!isCancelled && (
                    <button
                      type="button"
                      onClick={() => setCancelId(item.id)}
                      disabled={isCancelling}
                      className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-red-600 bg-white border border-gray-200 hover:bg-red-50 hover:border-red-200 rounded-lg transition-colors disabled:opacity-50"
                    >
                      {isCancelling ? <Loader2 className="w-4 h-4 animate-spin" /> : <Ban className="w-4 h-4" />}
                      Отменить
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Confirm: send new broadcast */}
      <ConfirmDialog
        isOpen={confirmSendOpen}
        onClose={() => setConfirmSendOpen(false)}
        onConfirm={() => sendMutation.mutate()}
        title="Отправить рассылку"
        message="Объявление получат все владельцы автосервисов. Отправить сейчас?"
        confirmText="Отправить"
        variant="primary"
      />

      {/* Confirm: cancel an active broadcast */}
      <ConfirmDialog
        isOpen={!!cancelId}
        onClose={() => setCancelId(null)}
        onConfirm={() => {
          if (cancelId) cancelMutation.mutate(cancelId);
          setCancelId(null);
        }}
        title="Отменить рассылку"
        message="Объявление перестанет показываться владельцам. Это действие нельзя отменить."
        confirmText="Отменить рассылку"
        variant="danger"
      />
    </div>
  );
}
