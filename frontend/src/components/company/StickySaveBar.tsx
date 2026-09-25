import { useEffect } from 'react';
import { PencilLine } from 'lucide-react';
import { Button } from '../../ui/Button';
import { cn } from '../../ui/cn';

/**
 * Предупреждаем браузер о несохранённых правках (F5, закрытие вкладки, переход
 * по внешней ссылке). Внутренние переходы react-router здесь не перехватить:
 * приложение живёт на <BrowserRouter>, а useBlocker требует data router.
 */
export function useUnsavedGuard(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Современные браузеры показывают свой текст; returnValue нужен Safari/старым Chrome.
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);
}

/**
 * Липкая полоса «есть несохранённые изменения» у нижнего края области
 * прокрутки (<main>). Появляется только при dirty — кнопка сохранения всегда
 * в поле зрения, даже когда правят первое поле длинной формы (аудит 2.8, P1).
 */
export default function StickySaveBar({
  visible,
  saving = false,
  onSave,
  onDiscard,
  label = 'Есть несохранённые изменения',
  saveLabel = 'Сохранить',
  className,
}: {
  visible: boolean;
  saving?: boolean;
  onSave: () => void;
  onDiscard?: () => void;
  label?: string;
  saveLabel?: string;
  className?: string;
}) {
  if (!visible) return null;
  return (
    <div
      role="region"
      aria-label="Несохранённые изменения"
      className={cn(
        'sticky bottom-0 z-20 mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface/95 px-4 py-3 shadow-pop backdrop-blur',
        'motion-safe:animate-pop-in',
        className,
      )}
    >
      <p className="flex min-w-0 items-center gap-2 text-sm text-ink-2">
        <PencilLine className="h-4 w-4 flex-shrink-0 text-ink-3" aria-hidden="true" />
        <span className="truncate">{label}</span>
      </p>
      <div className="flex items-center gap-2">
        {onDiscard && (
          <Button variant="secondary" onClick={onDiscard} disabled={saving}>
            Отменить
          </Button>
        )}
        <Button onClick={onSave} loading={saving}>
          {saveLabel}
        </Button>
      </div>
    </div>
  );
}
