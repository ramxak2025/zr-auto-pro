import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
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
  dispatchPublicBookingIntent,
  parsePublicBookingIntent,
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
function messageFor(error: unknown): string {
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
  const { slug = '' } = useParams<{ slug: string }>();
  return <PublicBookingView key={slug} slug={slug} />;
}

function PublicBookingView({ slug }: { slug: string }) {
  const [landing, setLanding] = useState<PublicBookingLanding | null>(null);
  const [date, setDate] = useState('');
  const [slots, setSlots] = useState<PublicBookingSlotPage | null>(null);
  const slotsRef = useRef<PublicBookingSlotPage | null>(null);
  slotsRef.current = slots;
  const [selected, setSelected] = useState<string[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
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
      setError(messageFor(cause));
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
          ...(append && slotsRef.current?.nextAfter ? { after: slotsRef.current.nextAfter } : {}),
        });
        if (generation !== slotsGeneration.current || !isCurrent()) return;
        setSlots((current) =>
          append && current ? { ...page.data, slots: [...current.slots, ...page.data.slots] } : page.data,
        );
        if (!append) setSelectedSlot(null);
      } catch (cause) {
        if (generation !== slotsGeneration.current || !isCurrent()) return;
        setError(messageFor(cause));
      } finally {
        if (generation === slotsGeneration.current && isCurrent()) setBusy(false);
      }
    },
    [date, isCurrent, landing, selected, slug, slotsRef],
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

  const selectedServices = useMemo(
    () => landing?.services.filter((service) => selected.includes(service.id)) ?? [],
    [landing, selected],
  );
  const totalDuration = selectedServices.reduce((sum, service) => sum + service.durationMinutes, 0);
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
    const capturedLease = lease;
    const current = () => isCurrent() && leaseRef.current === capturedLease;
    actionInFlightRef.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await dispatchPublicBookingIntent({
        slug,
        key: storageKey(slug),
        storage: intentStorage,
        locks: intentLocks,
        body: saved.body,
        saved,
        parseReceipt: readPublicBookingReceipt,
        isCurrent: current,
        send: (body) => publicBookingsApi.submit(slug, body),
      });
      if (!current()) return;
      setSaved(result.record);
      if (result.kind === 'confirmed') setReceipt(result.result);
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
        name: name.trim(),
        phone: phone.trim(),
        ...(comment.trim() ? { comment: comment.trim() } : {}),
        consentVersion: landing.consentVersion,
        consentAccepted: true,
      };
      const result = await dispatchPublicBookingIntent({
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
      });
      if (!current()) return;
      setSaved(result.record);
      if (result.kind === 'confirmed') setReceipt(result.result);
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
      <main className="min-h-screen bg-slate-50 p-8 text-slate-700">
        <p>{loading ? 'Загружаем страницу записи…' : error || 'Страница записи недоступна.'}</p>
        {corruptRecovery && (
          <p role="alert" className="mt-4 rounded-xl border border-rose-300 bg-rose-50 p-4 text-rose-900">
            Сохранённую заявку нельзя проверить безопасно. Новая отправка заблокирована, чтобы избежать дубля.
          </p>
        )}
        {saved && !receipt && <RecoveryPanel saved={saved} busy={busy} onRecover={recover} onRetry={retrySaved} />}
        {receipt && saved && (
          <ReceiptPanel receipt={receipt} busy={busy} onNew={() => void startNewRequestAfterReceipt()} />
        )}
        <button className="mt-4 rounded-xl bg-blue-600 px-5 py-3 text-white" onClick={() => void loadLanding()}>
          Повторить
        </button>
      </main>
    );

  return (
    <main className="min-h-screen bg-[#f5f7fb] px-4 py-8 text-slate-900 sm:py-12">
      <div className="mx-auto max-w-2xl">
        <header className="mb-7 rounded-3xl bg-[#101a2e] px-6 py-7 text-white shadow-xl sm:px-9">
          <div className="mb-5 flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-blue-600 font-bold">A</span>
            <span className="font-semibold tracking-tight">Autexa</span>
          </div>
          <p className="text-sm font-semibold uppercase tracking-[.15em] text-blue-300">Онлайн-запись</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">{landing.displayName}</h1>
          <p className="mt-3 text-slate-300">{landing.address}</p>
          <p className="mt-1 text-slate-300">{landing.contacts}</p>
          <div className="mt-5 border-t border-white/15 pt-4 text-sm text-slate-300">
            <strong className="text-white">Исполнитель:</strong> {landing.operator.name} · {landing.operator.contact}
            <p className="mt-1">{landing.operator.requisites}</p>
          </div>
        </header>

        {corruptRecovery && (
          <section
            role="alert"
            className="mb-5 rounded-2xl border border-rose-300 bg-rose-50 p-5 text-sm text-rose-900"
          >
            Не удалось прочитать сохранённые данные прежней заявки. Новая отправка заблокирована, чтобы не создать
            дубль. Обратитесь в сервис: {landing.contacts}
          </section>
        )}
        {saved && !receipt && <RecoveryPanel saved={saved} busy={busy} onRecover={recover} onRetry={retrySaved} />}

        {receipt ? (
          <ReceiptPanel receipt={receipt} busy={busy} onNew={() => void startNewRequestAfterReceipt()} />
        ) : (
          <form onSubmit={submit} className="space-y-5">
            <section className="rounded-3xl bg-white p-6 shadow-sm sm:p-8">
              <Step number="01" title="Выберите услуги" />
              <div className="mt-5 space-y-3">
                {landing.services.map((service) => (
                  <label
                    key={service.id}
                    className={`flex cursor-pointer items-center justify-between gap-4 rounded-2xl border p-4 transition ${selected.includes(service.id) ? 'border-blue-500 bg-blue-50/60' : 'border-slate-200 hover:border-slate-300'}`}
                  >
                    <span>
                      <span className="block font-semibold">{service.name}</span>
                      <span className="mt-1 block text-sm text-slate-500">
                        {service.durationMinutes} мин
                        {landing.showPrices && service.price !== undefined
                          ? ` · ${service.price.toLocaleString('ru-RU')} ₽`
                          : ''}
                      </span>
                    </span>
                    <input
                      type="checkbox"
                      aria-label={service.name}
                      className="h-5 w-5 accent-blue-600"
                      checked={selected.includes(service.id)}
                      onChange={(event) =>
                        setSelected((current) =>
                          event.target.checked ? [...current, service.id] : current.filter((id) => id !== service.id),
                        )
                      }
                    />
                  </label>
                ))}
              </div>
              {totalDuration > 0 && (
                <p className="mt-4 text-sm font-medium text-slate-600">Общая длительность: {totalDuration} мин</p>
              )}
            </section>
            <section className="rounded-3xl bg-white p-6 shadow-sm sm:p-8">
              <Step number="02" title="Выберите время" />
              <label className="mt-5 block text-sm font-semibold">
                Дата, {landing.timezone}
                <input
                  type="date"
                  value={date}
                  min={tenantToday(landing.timezone, landing.serverAt)}
                  max={addDays(tenantToday(landing.timezone, landing.serverAt), 30)}
                  onChange={(event) => setDate(event.target.value)}
                  className="mt-2 block w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base"
                />
              </label>
              {selected.length === 0 ? (
                <p className="mt-4 text-sm text-slate-500">Сначала отметьте одну или несколько услуг.</p>
              ) : (
                <>
                  <p className="mt-4 text-sm text-slate-500">{dateLabel(date)}</p>
                  {busy && !slots ? <p className="mt-3 text-slate-500">Ищем свободное время…</p> : null}
                  <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {slots?.slots.map((slot) => (
                      <button
                        type="button"
                        key={slot.startsAt}
                        onClick={() => setSelectedSlot(slot.startsAt)}
                        className={`rounded-xl border px-3 py-3 font-semibold ${selectedSlot === slot.startsAt ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-200 bg-white hover:border-blue-400'}`}
                      >
                        {clock(slot.startsAt, landing.timezone)}
                      </button>
                    ))}
                  </div>
                  {slots?.slots.length === 0 && !busy && (
                    <p className="mt-3 text-sm text-slate-600">
                      На эту дату нет доступного времени. Попробуйте другой день.
                    </p>
                  )}
                  {slots?.nextAfter && (
                    <button
                      type="button"
                      className="mt-4 text-sm font-semibold text-blue-700"
                      onClick={() => void loadSlots(date, true)}
                    >
                      Показать следующие варианты
                    </button>
                  )}
                </>
              )}
            </section>
            <section className="rounded-3xl bg-white p-6 shadow-sm sm:p-8">
              <Step number="03" title="Оставьте контакты" />
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <label className="text-sm font-semibold">
                  Имя
                  <input
                    required
                    maxLength={120}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-base font-normal"
                    autoComplete="name"
                  />
                </label>
                <label className="text-sm font-semibold">
                  Телефон
                  <input
                    required
                    maxLength={40}
                    value={phone}
                    onChange={(event) => setPhone(event.target.value)}
                    className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-base font-normal"
                    autoComplete="tel"
                    inputMode="tel"
                  />
                </label>
              </div>
              <label className="mt-4 block text-sm font-semibold">
                Комментарий <span className="font-normal text-slate-500">(необязательно)</span>
                <textarea
                  maxLength={1000}
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                  className="mt-2 min-h-24 w-full rounded-xl border border-slate-300 px-4 py-3 text-base font-normal"
                />
              </label>
              <label className="mt-5 flex items-start gap-3 text-sm leading-6 text-slate-700">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 accent-blue-600"
                  checked={consentedForCurrentVersion}
                  onChange={(event) => setConsented(event.target.checked)}
                />
                <span>
                  {landing.consentText} Ознакомьтесь с{' '}
                  <a href="#policy" className="font-semibold text-blue-700 underline">
                    условиями записи
                  </a>
                  .
                </span>
              </label>
              <details id="policy" className="mt-4 rounded-xl bg-slate-50 p-4 text-sm leading-6 text-slate-600">
                <summary className="cursor-pointer font-semibold text-slate-800">Условия обработки данных</summary>
                <p className="mt-3 whitespace-pre-wrap">{landing.policyText}</p>
                <p className="mt-3">
                  <strong>Исполнитель:</strong> {landing.operator.name}, {landing.operator.requisites},{' '}
                  {landing.operator.contact}
                </p>
              </details>
              <button
                type="submit"
                disabled={
                  busy || !!saved || !selectedSlot || !consentedForCurrentVersion || !name.trim() || !phone.trim()
                }
                className="mt-6 w-full rounded-xl bg-blue-600 px-5 py-4 font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? 'Отправляем…' : landing.mode === 'approval' ? 'Отправить заявку' : 'Записаться'}
              </button>
              <p className="mt-3 text-center text-xs leading-5 text-slate-500">
                {landing.mode === 'approval'
                  ? 'Время будет подтверждено сотрудником сервиса.'
                  : 'После отправки проверьте статус заявки.'}
              </p>
            </section>
          </form>
        )}
        {error && (
          <p role="alert" className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
            {error}{' '}
            {saved && !receipt && (
              <button className="ml-1 font-semibold underline" onClick={() => void recover()}>
                Проверить ещё раз
              </button>
            )}
          </p>
        )}
        <footer className="py-7 text-center text-xs text-slate-500">
          Страница записи сервиса · {landing.timezone}
        </footer>
      </div>
    </main>
  );
}

function Step({ number, title }: { number: string; title: string }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="font-mono text-sm font-semibold text-blue-600">{number}</span>
      <h2 className="text-xl font-bold tracking-tight">{title}</h2>
    </div>
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

function ReceiptPanel({ receipt, busy, onNew }: { receipt: PublicBookingReceipt; busy: boolean; onNew: () => void }) {
  return (
    <section className="my-5 rounded-3xl bg-white p-7 shadow-sm" aria-live="polite">
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
      <p className="mt-2 text-slate-600">
        {dateLabel(tenantDate(receipt.startsAt, 'UTC'))}, {clock(receipt.startsAt, 'UTC')} · UTC
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
        disabled={busy}
        className="mt-5 rounded-xl bg-blue-600 px-5 py-3 font-semibold text-white disabled:opacity-50"
        onClick={onNew}
      >
        Новая заявка
      </button>
    </section>
  );
}
