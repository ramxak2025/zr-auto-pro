import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import PublicBookingExperience from '../components/booking/PublicBookingExperience';
import { useParams } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import type { PublicBookingLanding, PublicBookingReceipt, PublicBookingSlotPage } from '../../../shared/types';
import type { SubmitPublicBookingRequest } from '../../../shared/api/types';
import {
  createPublicBookingIdentity,
  readPublicBookingReceipt,
  readPublicBookingRecovery,
} from '../../../shared/utils/publicBooking';
import { publicBookingsApi } from '../api/publicBookings';
import {
  clearPublicBookingIntent,
  dispatchAndReadCurrentPublicBooking,
  dispatchPublicBookingIntent,
  parsePublicBookingIntent,
  PublicBookingIntentError,
  recoverPublicBookingIntent,
  type PublicBookingSavedIntent,
} from '../utils/publicBookingIntent';
type SavedRequest = PublicBookingSavedIntent;
const storageKey = (slug: string) => `autexa.public-booking.recovery.v1:${slug}`;
let nextPageLease = 0;
function tenantToday(timezone: string, serverAt: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(serverAt));
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}
function tenantDate(instant: string, timezone: string): string {
  return tenantToday(timezone, instant);
}
function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const value = new Date(Date.UTC(year, month - 1, day + days));
  return [
    value.getUTCFullYear(),
    String(value.getUTCMonth() + 1).padStart(2, '0'),
    String(value.getUTCDate()).padStart(2, '0'),
  ].join('-');
}
function messageFor(error: unknown, phase: 'page' | 'slots' | 'request' = 'request'): string {
  if (error instanceof PublicBookingIntentError && error.code === 'INVALID_REQUEST') return error.message;
  const code =
    (error as { response?: { data?: { code?: string } } })?.response?.data?.code ?? (error as { code?: string })?.code;
  const intentCode = (error as { code?: string })?.code;
  if (code === 'CONSENT_CHANGED') return 'Текст согласия изменился. Проверьте новую версию и отправьте заявку заново.';
  if (code === 'SERVICES_CHANGED') return 'Список услуг обновился. Обновите страницу и выберите услуги ещё раз.';
  if (code === 'SLOT_UNAVAILABLE') return 'Это время уже недоступно. Выберите другой интервал.';
  if (code === 'BOOKING_DISABLED') return 'Онлайн-запись временно недоступна.';
  if (code === 'RESOURCE_UNAVAILABLE') return 'Выбранное время больше недоступно. Обновите список интервалов.';
  if (code === 'PUBLICATION_INCOMPLETE') return 'Сервис пока не завершил настройку онлайн-записи.';
  if (code === 'INVALID_REQUEST') return 'Проверьте контакты, услуги, согласие и выбранное время.';
  if (intentCode === 'STORAGE_UNAVAILABLE') return (error as Error).message;
  if (intentCode === 'PENDING_EXISTS' || intentCode === 'INTENT_CHANGED' || intentCode === 'LEASE_CHANGED')
    return (error as Error).message;
  if (phase === 'slots') return 'Не удалось загрузить свободное время. Проверьте соединение и повторите загрузку.';
  if (phase === 'page') return 'Не удалось загрузить страницу автосервиса. Проверьте соединение и нажмите «Повторить».';
  return 'Не удалось связаться с сервисом. Сохранённую заявку можно проверить и повторить без изменения данных.';
}
function dateLabel(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', weekday: 'long', timeZone: 'UTC' }).format(
    new Date(Date.UTC(year, month - 1, day)),
  );
}
function clock(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: timezone }).format(
    new Date(iso),
  );
}

export default function PublicBookingPage() {
  const { slug = '', publicCode = '' } = useParams<{ slug: string; publicCode: string }>();
  return publicCode ? (
    <PublicBookingCodeEntry key={publicCode} code={publicCode} />
  ) : (
    <PublicBookingView key={slug} slug={slug} />
  );
}

function PublicBookingCodeEntry({ code }: { code: string }) {
  const [canonicalSlug, setCanonicalSlug] = useState('');
  const [failure, setFailure] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setFailure(false);
    if (!/^[a-f0-9]{32}$/.test(code)) {
      setFailure(true);
      return;
    }
    void publicBookingsApi
      .landingByCode(code)
      .then((response) => {
        if (typeof response.data.slug !== 'string' || !/^[a-z0-9][a-z0-9-]{2,63}$/.test(response.data.slug))
          throw new Error('Invalid booking address response');
        if (active) setCanonicalSlug(response.data.slug);
      })
      .catch(() => {
        if (active) setFailure(true);
      });
    return () => {
      active = false;
    };
  }, [code, attempt]);
  if (canonicalSlug) return <PublicBookingView key={canonicalSlug} slug={canonicalSlug} />;
  return (
    <main className="public-booking">
      <div className="pb-container">
        <div className="pb-content">
          <h1>{failure ? 'Страница записи недоступна' : 'Загружаем запись…'}</h1>
          <p className="pb-description">
            {failure ? 'Проверьте ссылку или свяжитесь с автосервисом.' : 'Сейчас покажем услуги и свободное время.'}
          </p>
          {failure && /^[a-f0-9]{32}$/.test(code) && (
            <button type="button" className="pb-primary mt-5" onClick={() => setAttempt((value) => value + 1)}>
              Повторить
            </button>
          )}
        </div>
        <footer className="pb-footer">
          <a href="https://autexa.pw" target="_blank" rel="noopener noreferrer">
            Работает на <strong>Autexa</strong>
          </a>
        </footer>
      </div>
    </main>
  );
}

function PublicBookingView({ slug }: { slug: string }) {
  const [landing, setLanding] = useState<PublicBookingLanding | null>(null);
  const [date, setDate] = useState('');
  const [slots, setSlots] = useState<PublicBookingSlotPage | null>(null);
  const slotsRef = useRef<PublicBookingSlotPage | null>(null);
  slotsRef.current = slots;
  const [selected, setSelected] = useState<string[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [resourceKey, setResourceKey] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [comment, setComment] = useState('');
  const [consented, setConsented] = useState(false);
  const [saved, setSaved] = useState<SavedRequest | null>(null);
  const [corruptRecovery, setCorruptRecovery] = useState(false);
  const [receipt, setReceipt] = useState<PublicBookingReceipt | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const slotsGeneration = useRef(0);
  const mountedRef = useRef(true);
  const leaseRef = useRef(0);
  if (!leaseRef.current) leaseRef.current = ++nextPageLease;
  const lease = leaseRef.current;
  const isCurrent = useCallback(() => mountedRef.current && leaseRef.current === lease, [lease]);
  const consentVersionRef = useRef<string | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      slotsGeneration.current += 1;
    };
  }, []);

  const loadLanding = useCallback(async () => {
    const capturedLease = lease;
    const current = () => isCurrent() && capturedLease === leaseRef.current;
    if (!current()) return;
    setLoading(true);
    setError('');
    try {
      const response = await publicBookingsApi.landing(slug);
      if (!current()) return;
      setLanding(response.data);
      setDate((existing) => existing || tenantToday(response.data.timezone, response.data.serverAt));
    } catch (cause) {
      if (!current()) return;
      setError(messageFor(cause, 'page'));
    } finally {
      if (current()) setLoading(false);
    }
  }, [isCurrent, lease, slug]);

  useEffect(() => {
    setLanding(null);
    setDate('');
    setSlots(null);
    slotsGeneration.current += 1;
    setSelected([]);
    setSelectedSlot(null);
    setReceipt(null);
    try {
      const raw = localStorage.getItem(storageKey(slug));
      if (raw) {
        setSaved(parsePublicBookingIntent(raw, slug));
        setCorruptRecovery(false);
      } else {
        setSaved(null);
        setCorruptRecovery(false);
      }
    } catch {
      setSaved(null);
      setCorruptRecovery(true);
      setError('Не удалось прочитать сохранённую заявку. Новая отправка заблокирована во избежание дубля.');
    }
    void loadLanding();
  }, [slug, loadLanding]);

  useEffect(() => {
    if (!landing) return;
    if (consentVersionRef.current !== null && consentVersionRef.current !== landing.consentVersion) {
      setConsented(false);
      setError('Текст согласия изменился. Проверьте новую версию перед отправкой заявки.');
    }
    consentVersionRef.current = landing.consentVersion;
  }, [landing]);

  const loadSlots = useCallback(
    async (nextDate = date, append = false) => {
      if (!landing || selected.length === 0 || !nextDate) return;
      if (!isCurrent()) return;
      setBusy(true);
      setError('');
      const generation = ++slotsGeneration.current;
      try {
        const page = await publicBookingsApi.slots(slug, {
          from: nextDate,
          to: nextDate,
          serviceIds: selected,
          ...(resourceKey ? { resourceKey } : {}),
          ...(append && slotsRef.current?.nextAfter ? { after: slotsRef.current.nextAfter } : {}),
        });
        if (generation !== slotsGeneration.current || !isCurrent()) return;
        setSlots((current) =>
          append && current ? { ...page.data, slots: [...current.slots, ...page.data.slots] } : page.data,
        );
        if (!append) setSelectedSlot(null);
      } catch (cause) {
        if (generation !== slotsGeneration.current || !isCurrent()) return;
        setError(messageFor(cause, 'slots'));
      } finally {
        if (generation === slotsGeneration.current && isCurrent()) setBusy(false);
      }
    },
    [date, isCurrent, landing, selected, resourceKey, slug, slotsRef],
  );

  useEffect(() => {
    setSelectedSlot(null);
    if (landing && selected.length && date) {
      setSlots(null);
      void loadSlots(date);
    } else {
      slotsGeneration.current += 1;
      setSlots(null);
    }
  }, [landing, selected, date, loadSlots]);

  const consentedForCurrentVersion = consented && !!landing && consentVersionRef.current === landing.consentVersion;
  const actionInFlightRef = useRef(false);
  const intentStorage = {
    getItem: (key: string) => localStorage.getItem(key),
    setItem: (key: string, value: string) => localStorage.setItem(key, value),
    removeItem: (key: string) => localStorage.removeItem(key),
  };
  const intentLocks = typeof navigator === 'undefined' ? undefined : navigator.locks;

  const recover = async () => {
    if (!saved || actionInFlightRef.current || !isCurrent()) return;
    const capturedLease = lease;
    const current = () => isCurrent() && leaseRef.current === capturedLease;
    actionInFlightRef.current = true;
    setBusy(true);
    setError('');
    setReceipt(null);
    try {
      const result = await recoverPublicBookingIntent({
        slug,
        key: storageKey(slug),
        storage: intentStorage,
        locks: intentLocks,
        requestId: saved.requestId,
        recoveryToken: saved.recoveryToken,
        recover: (targetSlug, requestId, token) => publicBookingsApi.recover(targetSlug, requestId, token),
        parseRecovery: readPublicBookingRecovery,
        isCurrent: current,
      });
      if (!current()) return;
      if (result?.status === 'completed') {
        setSaved({ ...saved, body: null });
        setReceipt(result.result);
      } else if (result?.status === 'unknown')
        setError(
          saved.body
            ? 'Результат пока не найден. Данные сохранены: можно явно повторить тот же запрос.'
            : 'Статус больше не найден. Для защиты данных сохранён только ключ восстановления; повторная отправка недоступна. Обратитесь в сервис.',
        );
      else setError('Ответ не удалось проверить. Данные заявки сохранены; безопасно проверьте результат ещё раз.');
    } catch (cause) {
      if (!current()) return;
      setError(messageFor(cause));
    } finally {
      if (current()) {
        actionInFlightRef.current = false;
        setBusy(false);
      }
    }
  };

  const retrySaved = async () => {
    if (!saved?.body || actionInFlightRef.current || !isCurrent()) return;
    const savedBody = saved.body;
    const capturedLease = lease;
    const current = () => isCurrent() && leaseRef.current === capturedLease;
    actionInFlightRef.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await dispatchAndReadCurrentPublicBooking({
        dispatch: () =>
          dispatchPublicBookingIntent({
            slug,
            key: storageKey(slug),
            storage: intentStorage,
            locks: intentLocks,
            body: savedBody,
            saved,
            parseReceipt: readPublicBookingReceipt,
            isCurrent: current,
            send: (body) => publicBookingsApi.submit(slug, body),
          }),
        readCurrent: (record) =>
          recoverPublicBookingIntent({
            slug,
            key: storageKey(slug),
            storage: intentStorage,
            locks: intentLocks,
            requestId: record.requestId,
            recoveryToken: record.recoveryToken,
            recover: (targetSlug, requestId, token) => publicBookingsApi.recover(targetSlug, requestId, token),
            parseRecovery: readPublicBookingRecovery,
            isCurrent: current,
          }),
        onAcknowledged: (record) => {
          if (current()) setSaved(record);
        },
        isCurrent: current,
      });
      if (!current()) return;
      setSaved(result.record);
      if (result.kind === 'current') setReceipt(result.result);
      else if (result.kind === 'unverified')
        setError(
          'Повторный запрос получил подтверждение, но текущий статус проверить не удалось. Проверьте его ещё раз.',
        );
      else setError('Ответ неоднозначен. Заявка остаётся сохранённой; сначала проверьте её статус.');
    } catch (cause) {
      if (!current()) return;
      setError(messageFor(cause));
    } finally {
      if (current()) {
        actionInFlightRef.current = false;
        setBusy(false);
      }
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (
      !landing ||
      !selectedSlot ||
      !selected.length ||
      !consentedForCurrentVersion ||
      saved ||
      corruptRecovery ||
      !name.trim() ||
      !phone.trim() ||
      actionInFlightRef.current ||
      !isCurrent()
    )
      return;
    actionInFlightRef.current = true;
    const capturedSlug = slug;
    const capturedLease = lease;
    const current = () => isCurrent() && capturedLease === leaseRef.current && capturedSlug === slug;
    setBusy(true);
    setError('');
    try {
      if (!globalThis.crypto?.randomUUID || !globalThis.crypto?.getRandomValues) throw new Error('secure-random');
      const identity = createPublicBookingIdentity({
        randomUUID: () => globalThis.crypto.randomUUID(),
        randomBytes: () => globalThis.crypto.getRandomValues(new Uint8Array(32)),
      });
      const body: SubmitPublicBookingRequest = {
        ...identity,
        serviceIds: [...selected],
        startsAt: selectedSlot,
        ...(resourceKey ? { resourceKey } : {}),
        name: name.trim(),
        phone: phone.trim(),
        ...(comment.trim() ? { comment: comment.trim() } : {}),
        consentVersion: landing.consentVersion,
        consentAccepted: true,
      };
      const result = await dispatchAndReadCurrentPublicBooking({
        dispatch: () =>
          dispatchPublicBookingIntent({
            slug: capturedSlug,
            key: storageKey(capturedSlug),
            storage: intentStorage,
            locks: intentLocks,
            body,
            parseReceipt: readPublicBookingReceipt,
            isCurrent: current,
            onPersisted: (record) => {
              if (current()) setSaved(record);
            },
            send: (payload) => publicBookingsApi.submit(capturedSlug, payload),
          }),
        readCurrent: (record) =>
          recoverPublicBookingIntent({
            slug: capturedSlug,
            key: storageKey(capturedSlug),
            storage: intentStorage,
            locks: intentLocks,
            requestId: record.requestId,
            recoveryToken: record.recoveryToken,
            recover: (targetSlug, requestId, token) => publicBookingsApi.recover(targetSlug, requestId, token),
            parseRecovery: readPublicBookingRecovery,
            isCurrent: current,
          }),
        onAcknowledged: (record) => {
          if (current()) setSaved(record);
        },
        isCurrent: current,
      });
      if (!current()) return;
      setSaved(result.record);
      if (result.kind === 'current') setReceipt(result.result);
      else if (result.kind === 'unverified')
        setError('Заявка получила ответ, но её актуальный статус проверить не удалось. Проверьте его ещё раз.');
      else setError('Ответ неоднозначен. Проверьте статус сохранённой заявки, не отправляйте новую.');
    } catch (cause) {
      if (!current()) return;
      if ((cause as { definitiveRejected?: boolean }).definitiveRejected) setSaved(null);
      setError(
        cause instanceof Error && cause.message === 'secure-random'
          ? 'Браузер не поддерживает безопасную отправку. Обновите его и повторите.'
          : messageFor(cause),
      );
    } finally {
      if (current()) {
        actionInFlightRef.current = false;
        setBusy(false);
      }
    }
  };

  const startNewRequestAfterReceipt = async () => {
    if (!saved || !receipt || actionInFlightRef.current || !isCurrent()) return;
    actionInFlightRef.current = true;
    setBusy(true);
    try {
      await clearPublicBookingIntent({
        slug,
        key: storageKey(slug),
        storage: intentStorage,
        locks: intentLocks,
        requestId: saved.requestId,
        isCurrent,
      });
      if (!isCurrent()) return;
    } catch {
      if (isCurrent()) setError('Не удалось безопасно начать новую заявку. Сохранённая запись оставлена.');
      return;
    } finally {
      if (isCurrent()) {
        actionInFlightRef.current = false;
        setBusy(false);
      }
    }
    setSaved(null);
    setReceipt(null);
    setDate('');
    setSlots(null);
    setSelectedSlot(null);
    setName('');
    setPhone('');
    setComment('');
    setConsented(false);
    void loadLanding();
  };

  if (!landing)
    return (
      <main className="public-booking">
        <div className="pb-container">
          <div className="pb-content">
            <p>{loading ? 'Загружаем страницу записи…' : error || 'Страница записи недоступна.'}</p>
            {corruptRecovery && (
              <p role="alert" className="pb-error">
                Сохранённую заявку нельзя проверить безопасно. Новая отправка заблокирована, чтобы избежать дубля.
              </p>
            )}
            {saved && !receipt && <RecoveryPanel saved={saved} busy={busy} onRecover={recover} onRetry={retrySaved} />}
            {receipt && saved && (
              <ReceiptPanel
                receipt={receipt}
                busy={busy}
                onRefresh={recover}
                onNew={() => void startNewRequestAfterReceipt()}
              />
            )}
            <button type="button" className="pb-primary mt-5" disabled={loading} onClick={() => void loadLanding()}>
              Повторить
            </button>
          </div>
          <footer className="pb-footer">
            <a href="https://autexa.pw" target="_blank" rel="noopener noreferrer">
              Работает на <strong>Autexa</strong>
            </a>
          </footer>
        </div>
      </main>
    );

  return (
    <PublicBookingExperience
      landing={landing}
      date={date || tenantToday(landing.timezone, landing.serverAt)}
      minDate={tenantToday(landing.timezone, landing.serverAt)}
      maxDate={addDays(tenantToday(landing.timezone, landing.serverAt), 30)}
      selected={selected}
      selectedSlot={selectedSlot}
      resourceKey={resourceKey}
      slots={slots}
      busy={busy}
      blocked={!!saved || corruptRecovery}
      error={
        corruptRecovery
          ? 'Сохранённую заявку нельзя проверить безопасно. Свяжитесь с сервисом, чтобы не создать повторную запись.'
          : error
      }
      name={name}
      phone={phone}
      comment={comment}
      consented={consentedForCurrentVersion}
      onSelected={(value) => {
        setSelected(value);
        setSelectedSlot(null);
      }}
      onDate={(value) => {
        setDate(value);
        setSelectedSlot(null);
      }}
      onResource={(value) => {
        setResourceKey(value);
        setSelectedSlot(null);
      }}
      onSlot={setSelectedSlot}
      onName={setName}
      onPhone={setPhone}
      onComment={setComment}
      onConsent={setConsented}
      onSubmit={submit}
      onMoreSlots={() => void loadSlots(date, true)}
      onRetrySlots={() => void loadSlots(date)}
      recovery={
        saved && !receipt ? <RecoveryPanel saved={saved} busy={busy} onRecover={recover} onRetry={retrySaved} /> : null
      }
      receipt={
        receipt ? (
          <ReceiptPanel
            receipt={receipt}
            timezone={landing.timezone}
            busy={busy}
            onRefresh={recover}
            onNew={() => void startNewRequestAfterReceipt()}
          />
        ) : null
      }
    />
  );
}

function RecoveryPanel({
  saved,
  busy,
  onRecover,
  onRetry,
}: {
  saved: SavedRequest;
  busy: boolean;
  onRecover: () => void;
  onRetry: () => void;
}) {
  return (
    <section className="my-5 rounded-2xl border border-amber-300 bg-amber-50 p-5" aria-live="polite">
      <h2 className="font-semibold">Заявка уже сохранена</h2>
      <p className="mt-1 text-sm text-amber-900">
        {saved.body
          ? 'Сначала восстановите результат. Если отправите заявку повторно, она сохранит те же данные и номер.'
          : 'Сохранён только ключ восстановления. Проверьте результат; повторная отправка недоступна.'}
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        <button
          disabled={busy}
          className="rounded-xl bg-slate-900 px-4 py-3 font-semibold text-white disabled:opacity-50"
          onClick={onRecover}
        >
          {busy ? 'Проверяем…' : 'Проверить статус'}
        </button>
        {saved.body && (
          <button
            disabled={busy}
            className="rounded-xl border border-amber-500 px-4 py-3 font-semibold disabled:opacity-50"
            onClick={onRetry}
          >
            Повторить тот же запрос
          </button>
        )}
      </div>
    </section>
  );
}

function ReceiptPanel({
  receipt,
  timezone = 'UTC',
  busy,
  onRefresh,
  onNew,
}: {
  receipt: PublicBookingReceipt;
  timezone?: string;
  busy: boolean;
  onRefresh: () => void;
  onNew: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const confirmed = receipt.status === 'confirmed';
  const rejected = receipt.status === 'rejected' || receipt.status === 'cancelled';
  const statusColor = confirmed ? '#2563eb' : rejected ? '#e11d48' : '#64748b';
  const path = confirmed ? 'M6 12.5l4 4L18.5 8' : rejected ? 'M7 7l10 10M17 7L7 17' : '';
  return (
    <section className="my-5 rounded-3xl bg-white p-7 shadow-sm" aria-live="polite">
      <div className="mb-4 flex items-center gap-3">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-slate-50" aria-hidden="true">
          <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none">
            {confirmed || rejected ? (
              <motion.path
                d={path}
                stroke={statusColor}
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                initial={reduceMotion ? false : { pathLength: 0, opacity: 0.6 }}
                animate={{ pathLength: 1, opacity: 1 }}
                transition={{ duration: reduceMotion ? 0 : 0.32, ease: 'easeOut' }}
              />
            ) : (
              <circle cx="12" cy="12" r="8" stroke={statusColor} strokeWidth="2" />
            )}
          </svg>
        </span>
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-blue-700">
            Заявка {receipt.requestId.slice(0, 8)}
          </p>
          <h2 className="mt-2 text-2xl font-bold">
            {receipt.status === 'confirmed'
              ? 'Запись подтверждена'
              : receipt.status === 'pending'
                ? 'Заявка отправлена на подтверждение'
                : receipt.status === 'rejected'
                  ? 'Заявка отклонена'
                  : 'Запись отменена'}
          </h2>
        </div>
      </div>
      <p className="mt-2 text-slate-600">
        {dateLabel(tenantDate(receipt.startsAt, timezone))}, {clock(receipt.startsAt, timezone)} ·{' '}
        {timezone === 'UTC' ? 'UTC' : 'местное время сервиса'}
      </p>
      <ul className="mt-5 space-y-2">
        {receipt.services.map((service) => (
          <li key={service.serviceId} className="flex justify-between gap-4 border-t border-slate-100 pt-3">
            <span>{service.name}</span>
            <span className="text-slate-500">{service.durationMinutes} мин</span>
          </li>
        ))}
      </ul>
      <p className="mt-5 text-sm text-slate-600">
        {receipt.status === 'pending'
          ? 'Сотрудник сервиса ещё не подтвердил выбранное время.'
          : 'Сохраните номер заявки для обращения в сервис.'}
      </p>
      <button
        type="button"
        disabled={busy}
        className="mt-5 rounded-xl border border-slate-300 px-5 py-3 font-semibold disabled:opacity-50"
        onClick={onRefresh}
      >
        {busy ? 'Проверяем…' : 'Обновить статус'}
      </button>
      <button
        type="button"
        disabled={busy}
        className="mt-5 rounded-xl bg-blue-600 px-5 py-3 font-semibold text-white disabled:opacity-50"
        onClick={onNew}
      >
        Новая заявка
      </button>
    </section>
  );
}
