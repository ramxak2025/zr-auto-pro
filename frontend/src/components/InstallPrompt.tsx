import { useState, useEffect, useCallback } from 'react';
import { X, Share, Plus, Download, Smartphone, ChevronDown } from 'lucide-react';

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
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as any).standalone === true
  );
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
    }, 300);
  }, []);

  const handleAndroidInstall = useCallback(async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      dismiss();
    }
    setDeferredPrompt(null);
  }, [deferredPrompt, dismiss]);

  if (!visible || !platform) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-[9998] bg-black/40 backdrop-blur-sm transition-opacity duration-300 ${
          closing ? 'opacity-0' : 'opacity-100'
        }`}
        onClick={dismiss}
      />

      {/* Bottom sheet */}
      <div
        className={`fixed inset-x-0 bottom-0 z-[9999] transition-transform duration-300 ease-out ${
          closing ? 'translate-y-full' : 'translate-y-0'
        }`}
      >
        <div className="mx-auto max-w-lg">
          <div className="rounded-t-3xl bg-white shadow-2xl pb-[env(safe-area-inset-bottom)]">
            {/* Drag handle */}
            <div className="flex justify-center pt-3 pb-1">
              <div className="h-1 w-10 rounded-full bg-gray-300" />
            </div>

            {/* Close button */}
            <button
              onClick={dismiss}
              className="absolute top-4 right-4 flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 text-gray-500 hover:bg-gray-200 transition-colors"
              aria-label="Закрыть"
            >
              <X className="h-4 w-4" />
            </button>

            <div className="px-6 pb-6 pt-2">
              {platform === 'ios' ? <IOSContent /> : <AndroidContent onInstall={handleAndroidInstall} hasPrompt={!!deferredPrompt} />}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

/* ─── iOS Instructions ─── */
function IOSContent() {
  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-4">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary-500 to-primary-700 shadow-lg shadow-primary-500/25">
          <img src="/icon-96.png" alt="Autexa" className="h-11 w-11 rounded-xl" />
        </div>
        <div>
          <h3 className="text-lg font-bold text-gray-900">Установить Autexa</h3>
          <p className="text-sm text-gray-500">Быстрый доступ с главного экрана</p>
        </div>
      </div>

      {/* Benefit pills */}
      <div className="flex flex-wrap gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-50 px-3 py-1.5 text-xs font-medium text-primary-700">
          <Smartphone className="h-3.5 w-3.5" /> Как приложение
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-green-50 px-3 py-1.5 text-xs font-medium text-green-700">
          <Download className="h-3.5 w-3.5" /> Работает офлайн
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-purple-50 px-3 py-1.5 text-xs font-medium text-purple-700">
          <Plus className="h-3.5 w-3.5" /> Без App Store
        </span>
      </div>

      {/* Steps */}
      <div className="space-y-0">
        <Step
          number={1}
          icon={
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-50">
              <Share className="h-5 w-5 text-primary-600" />
            </div>
          }
          title="Нажмите «Поделиться»"
          description={
            <span>
              Нажмите иконку{' '}
              <span className="inline-flex items-center gap-0.5 rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-primary-600">
                <Share className="h-3 w-3" /> Поделиться
              </span>{' '}
              внизу экрана
            </span>
          }
          isLast={false}
        />
        <Step
          number={2}
          icon={
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-50">
              <ChevronDown className="h-5 w-5 text-primary-600" />
            </div>
          }
          title="Пролистайте вниз"
          description="Найдите пункт в появившемся меню"
          isLast={false}
        />
        <Step
          number={3}
          icon={
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-50">
              <Plus className="h-5 w-5 text-primary-600" />
            </div>
          }
          title="«На экран Домой»"
          description={
            <span>
              Нажмите{' '}
              <span className="inline-flex items-center gap-0.5 rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-700">
                <Plus className="h-3 w-3" /> На экран «Домой»
              </span>
            </span>
          }
          isLast
        />
      </div>

      {/* Footer note */}
      <p className="text-center text-xs text-gray-400">
        Приложение бесплатно и не занимает место
      </p>
    </div>
  );
}

/* ─── Android Instructions / Install ─── */
function AndroidContent({ onInstall, hasPrompt }: { onInstall: () => void; hasPrompt: boolean }) {
  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-4">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary-500 to-primary-700 shadow-lg shadow-primary-500/25">
          <img src="/icon-96.png" alt="Autexa" className="h-11 w-11 rounded-xl" />
        </div>
        <div>
          <h3 className="text-lg font-bold text-gray-900">Установить Autexa</h3>
          <p className="text-sm text-gray-500">Добавьте на главный экран</p>
        </div>
      </div>

      {/* Benefit pills */}
      <div className="flex flex-wrap gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-50 px-3 py-1.5 text-xs font-medium text-primary-700">
          <Smartphone className="h-3.5 w-3.5" /> Как приложение
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-green-50 px-3 py-1.5 text-xs font-medium text-green-700">
          <Download className="h-3.5 w-3.5" /> Работает офлайн
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-purple-50 px-3 py-1.5 text-xs font-medium text-purple-700">
          <Plus className="h-3.5 w-3.5" /> Без Google Play
        </span>
      </div>

      {hasPrompt ? (
        /* Native install button via beforeinstallprompt */
        <button
          onClick={onInstall}
          className="flex w-full items-center justify-center gap-2.5 rounded-2xl bg-gradient-to-r from-primary-600 to-primary-700 px-6 py-4 text-base font-semibold text-white shadow-lg shadow-primary-600/30 transition-all duration-200 active:scale-[0.98] hover:shadow-xl hover:shadow-primary-600/40"
        >
          <Download className="h-5 w-5" />
          Установить приложение
        </button>
      ) : (
        /* Manual instructions fallback */
        <div className="space-y-0">
          <Step
            number={1}
            icon={
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-50">
                <MoreIcon />
              </div>
            }
            title="Откройте меню Chrome"
            description={
              <span>
                Нажмите{' '}
                <span className="inline-flex items-center rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-700">
                  ⋮
                </span>{' '}
                в правом верхнем углу
              </span>
            }
            isLast={false}
          />
          <Step
            number={2}
            icon={
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-50">
                <Plus className="h-5 w-5 text-primary-600" />
              </div>
            }
            title="«Добавить на главный экран»"
            description="Или «Установить приложение»"
            isLast
          />
        </div>
      )}

      {/* Footer note */}
      <p className="text-center text-xs text-gray-400">
        Приложение бесплатно и не занимает место
      </p>
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
    <div className="flex gap-3">
      {/* Left: number line */}
      <div className="flex flex-col items-center">
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary-600 text-xs font-bold text-white shadow-sm">
          {number}
        </div>
        {!isLast && <div className="w-px flex-1 bg-gray-200 my-1" />}
      </div>
      {/* Right: content */}
      <div className={`flex items-start gap-3 ${isLast ? 'pb-0' : 'pb-4'}`}>
        {icon}
        <div className="pt-0.5">
          <p className="text-sm font-semibold text-gray-900">{title}</p>
          <p className="text-xs text-gray-500 mt-0.5">{description}</p>
        </div>
      </div>
    </div>
  );
}

/* ─── Three-dot menu icon ─── */
function MoreIcon() {
  return (
    <svg className="h-5 w-5 text-primary-600" viewBox="0 0 24 24" fill="currentColor">
      <circle cx="12" cy="5" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="12" cy="19" r="2" />
    </svg>
  );
}
