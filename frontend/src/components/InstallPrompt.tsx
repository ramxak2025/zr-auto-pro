import { useState, useEffect, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { X, Share, Plus, Download, Smartphone, ChevronDown, WifiOff } from 'lucide-react';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { IconButton } from '../ui/IconButton';
import { cn } from '../ui/cn';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

type Platform = 'ios' | 'android' | null;

const DISMISS_KEY = 'autexa_install_dismissed';
const DISMISS_DURATION = 7 * 24 * 60 * 60 * 1000; // 7 days

function getPlatform(): Platform {
  const ua = navigator.userAgent || '';
  // iOS detection
  if (/iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) {
    return 'ios';
  }
  // Android detection
  if (/Android/.test(ua)) {
    return 'android';
  }
  return null;
}

function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone === true;
}

function isDismissed(): boolean {
  const dismissed = localStorage.getItem(DISMISS_KEY);
  if (!dismissed) return false;
  const timestamp = parseInt(dismissed, 10);
  if (Date.now() - timestamp > DISMISS_DURATION) {
    localStorage.removeItem(DISMISS_KEY);
    return false;
  }
  return true;
}

export default function InstallPrompt() {
  // Показываем ТОЛЬКО на странице входа (решение владельца 07.07):
  // на маркетинговом сайте баннер «установите приложение» мешал продажам.
  const { pathname } = useLocation();
  const [platform, setPlatform] = useState<Platform>(null);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);
  const [closing, setClosing] = useState(false);

  // Listen for Android's beforeinstallprompt
  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  // Determine platform & visibility
  useEffect(() => {
    if (isStandalone() || isDismissed()) return;

    const detected = getPlatform();
    if (!detected) return;

    setPlatform(detected);

    // Small delay so the page loads first
    const timer = setTimeout(() => setVisible(true), 2000);
    return () => clearTimeout(timer);
  }, []);

  const dismiss = useCallback(() => {
    setClosing(true);
    setTimeout(() => {
      setVisible(false);
      setClosing(false);
      localStorage.setItem(DISMISS_KEY, Date.now().toString());
    }, 200);
  }, []);

  // Escape закрывает шторку — как любой диалог.
  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [visible, dismiss]);

  const handleAndroidInstall = useCallback(async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      dismiss();
    }
    setDeferredPrompt(null);
  }, [deferredPrompt, dismiss]);

  if (pathname !== '/login') return null;
  if (!visible || !platform) return null;

  return (
    <>
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Закрыть"
        className={cn(
          'fixed inset-0 z-[9998] cursor-default bg-ink/40 transition-opacity duration-200',
          closing ? 'opacity-0' : 'opacity-100',
        )}
        onClick={dismiss}
      />

      {/* Bottom sheet */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="install-prompt-title"
        className={cn(
          'fixed inset-x-0 bottom-0 z-[9999] transition-transform duration-200 ease-out',
          closing ? 'translate-y-full' : 'translate-y-0',
        )}
      >
        <div className="mx-auto max-w-lg">
          <div className="rounded-t-2xl bg-surface pb-[env(safe-area-inset-bottom)] shadow-pop">
            {/* Drag handle */}
            <div className="flex justify-center pb-1 pt-3" aria-hidden="true">
              <div className="h-1 w-10 rounded-full bg-line-strong" />
            </div>

            <IconButton label="Закрыть" icon={X} onClick={dismiss} className="absolute right-3 top-3" />

            <div className="px-6 pb-6 pt-2">
              {platform === 'ios' ? (
                <IOSContent />
              ) : (
                <AndroidContent onInstall={handleAndroidInstall} hasPrompt={!!deferredPrompt} />
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

/* ─── Общая шапка шторки ─── */
function SheetHeader({ subtitle }: { subtitle: string }) {
  return (
    <div className="flex items-center gap-4">
      <span className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-xl bg-accent-soft">
        <img src="/icon-96.png" alt="" className="h-10 w-10 rounded-lg" />
      </span>
      <div className="min-w-0">
        <h3 id="install-prompt-title" className="text-md font-semibold text-ink">
          Установить Autexa
        </h3>
        <p className="text-sm text-ink-3">{subtitle}</p>
      </div>
    </div>
  );
}

function BenefitPills({ store }: { store: string }) {
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Преимущества">
      <li>
        <Badge tone="accent" icon={Smartphone}>
          Как приложение
        </Badge>
      </li>
      <li>
        <Badge tone="ok" icon={WifiOff}>
          Работает офлайн
        </Badge>
      </li>
      <li>
        <Badge icon={Plus}>Без {store}</Badge>
      </li>
    </ul>
  );
}

/* ─── iOS Instructions ─── */
function IOSContent() {
  return (
    <div className="space-y-5">
      <SheetHeader subtitle="Быстрый доступ с главного экрана" />
      <BenefitPills store="App Store" />

      <ol className="space-y-0">
        <Step
          number={1}
          icon={<Share className="h-[18px] w-[18px]" aria-hidden="true" />}
          title="Нажмите «Поделиться»"
          description={
            <span>
              Нажмите иконку{' '}
              <span className="inline-flex items-center gap-0.5 rounded bg-surface-3 px-1.5 py-0.5 text-xs font-medium text-accent-text">
                <Share className="h-3 w-3" aria-hidden="true" /> Поделиться
              </span>{' '}
              внизу экрана
            </span>
          }
          isLast={false}
        />
        <Step
          number={2}
          icon={<ChevronDown className="h-[18px] w-[18px]" aria-hidden="true" />}
          title="Пролистайте вниз"
          description="Найдите пункт в появившемся меню"
          isLast={false}
        />
        <Step
          number={3}
          icon={<Plus className="h-[18px] w-[18px]" aria-hidden="true" />}
          title="«На экран Домой»"
          description={
            <span>
              Нажмите{' '}
              <span className="inline-flex items-center gap-0.5 rounded bg-surface-3 px-1.5 py-0.5 text-xs font-medium text-ink-2">
                <Plus className="h-3 w-3" aria-hidden="true" /> На экран «Домой»
              </span>
            </span>
          }
          isLast
        />
      </ol>

      <p className="text-center text-xs text-ink-3">Приложение бесплатно и не занимает место</p>
    </div>
  );
}

/* ─── Android Instructions / Install ─── */
function AndroidContent({ onInstall, hasPrompt }: { onInstall: () => void; hasPrompt: boolean }) {
  return (
    <div className="space-y-5">
      <SheetHeader subtitle="Добавьте на главный экран" />
      <BenefitPills store="Google Play" />

      {hasPrompt ? (
        /* Native install button via beforeinstallprompt */
        <Button size="lg" fullWidth icon={Download} onClick={onInstall}>
          Установить приложение
        </Button>
      ) : (
        /* Manual instructions fallback */
        <ol className="space-y-0">
          <Step
            number={1}
            icon={<MoreIcon className="h-[18px] w-[18px]" />}
            title="Откройте меню Chrome"
            description={
              <span>
                Нажмите{' '}
                <span className="inline-flex items-center rounded bg-surface-3 px-1.5 py-0.5 text-xs font-medium text-ink-2">
                  ⋮
                </span>{' '}
                в правом верхнем углу
              </span>
            }
            isLast={false}
          />
          <Step
            number={2}
            icon={<Plus className="h-[18px] w-[18px]" aria-hidden="true" />}
            title="«Добавить на главный экран»"
            description="Или «Установить приложение»"
            isLast
          />
        </ol>
      )}

      <p className="text-center text-xs text-ink-3">Приложение бесплатно и не занимает место</p>
    </div>
  );
}

/* ─── Shared Step Component ─── */
function Step({
  number,
  icon,
  title,
  description,
  isLast,
}: {
  number: number;
  icon: React.ReactNode;
  title: string;
  description: React.ReactNode;
  isLast: boolean;
}) {
  return (
    <li className="flex gap-3">
      {/* Left: number line */}
      <div className="flex flex-col items-center">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent text-xs font-semibold tabular-nums text-white">
          {number}
        </span>
        {!isLast && <span className="my-1 w-px flex-1 bg-line" aria-hidden="true" />}
      </div>
      {/* Right: content */}
      <div className={cn('flex items-start gap-3', isLast ? 'pb-0' : 'pb-4')}>
        <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
          {icon}
        </span>
        <div className="pt-0.5">
          <p className="text-sm font-semibold text-ink">{title}</p>
          <p className="mt-0.5 text-xs text-ink-3">{description}</p>
        </div>
      </div>
    </li>
  );
}

/* ─── Three-dot menu icon ─── */
function MoreIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="12" cy="5" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="12" cy="19" r="2" />
    </svg>
  );
}
