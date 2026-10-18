import { FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  HelpCircle,
  MapPin,
  Phone,
  Search,
  X,
} from 'lucide-react';
import type { PublicBookingLanding, PublicBookingSlotPage } from '../../../../shared/types';
import './public-booking.css';
import BookingPhoneInput from './BookingPhoneInput';
import { normalizeBookingPhone } from '../../utils/bookingPhone';

type Props = {
  landing: PublicBookingLanding;
  date: string;
  minDate: string;
  maxDate: string;
  selected: string[];
  selectedSlot: string | null;
  resourceKey: string;
  slots: PublicBookingSlotPage | null;
  busy: boolean;
  blocked: boolean;
  error: string;
  name: string;
  phone: string;
  comment: string;
  consented: boolean;
  onSelected: (value: string[]) => void;
  onDate: (value: string) => void;
  onResource: (value: string) => void;
  onSlot: (value: string) => void;
  onName: (value: string) => void;
  onPhone: (value: string) => void;
  onComment: (value: string) => void;
  onConsent: (value: boolean) => void;
  onSubmit: (event: FormEvent) => void;
  onMoreSlots: () => void;
  onRetrySlots: () => void;
  recovery: ReactNode;
  receipt: ReactNode;
};

function dayAfter(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
function monday(date: string) {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return dayAfter(date, -((weekday + 6) % 7));
}
function dateText(date: string, weekday = false) {
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    ...(weekday ? { weekday: 'long' as const } : {}),
    timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00Z`));
}
function timeText(instant: string, timezone: string) {
  return new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: timezone }).format(
    new Date(instant),
  );
}
const money = (value: number) => `${value.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ₽`;
function priceBounds(service: PublicBookingLanding['services'][number]) {
  if (service.priceType === 'range' && typeof service.minPrice === 'number' && typeof service.maxPrice === 'number')
    return { min: service.minPrice, max: service.maxPrice };
  return typeof service.price === 'number' ? { min: service.price, max: service.price } : null;
}
function servicePrice(service: PublicBookingLanding['services'][number]) {
  const bounds = priceBounds(service);
  return bounds
    ? bounds.min === bounds.max
      ? money(bounds.min)
      : `${bounds.min.toLocaleString('ru-RU')}–${money(bounds.max)}`
    : 'Цена уточняется';
}
function safeLink(value: string | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

export default function PublicBookingExperience(props: Props) {
  const { landing, selected, date, selectedSlot, resourceKey, busy } = props;
  const [step, updateStep] = useState(0);
  const [choosingMaster, updateChoosingMaster] = useState(false);
  const [logoFailed, setLogoFailed] = useState(false);
  const [coverFailed, setCoverFailed] = useState(false);
  const [timeMasterOpen, setTimeMasterOpen] = useState(false);
  const masterToggle = useRef<HTMLButtonElement>(null);
  const shell = useRef<HTMLElement>(null);
  const allowedStep = useRef(0);
  allowedStep.current = selectedSlot ? 2 : selected.length ? 1 : 0;
  const setStep = (next: number) => {
    if (next === step) return;
    if (typeof window !== 'undefined')
      window.history.pushState(
        {
          ...window.history.state,
          bookingSlug: landing.slug,
          bookingStep: next,
          bookingMaster: false,
          bookingPath: 'service',
        },
        '',
      );
    updateStep(next);
  };
  const setChoosingMaster = (next: boolean) => {
    if (next !== choosingMaster && typeof window !== 'undefined')
      window.history.pushState(
        {
          ...window.history.state,
          bookingSlug: landing.slug,
          bookingStep: 0,
          bookingMaster: next,
          bookingPath: next ? 'master' : 'service',
        },
        '',
      );
    updateChoosingMaster(next);
  };
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.history.replaceState(
      {
        ...window.history.state,
        bookingSlug: landing.slug,
        bookingStep: 0,
        bookingMaster: false,
        bookingPath: 'service',
      },
      '',
    );
    const back = (event: PopStateEvent) => {
      if (event.state?.bookingSlug !== landing.slug) return;
      updateStep(Math.max(0, Math.min(allowedStep.current, event.state.bookingStep ?? 0)));
      updateChoosingMaster(event.state.bookingMaster === true);
    };
    window.addEventListener('popstate', back);
    const viewport = window.visualViewport;
    const resize = () =>
      shell.current?.style.setProperty('--pb-viewport', `${viewport?.height ?? window.innerHeight}px`);
    resize();
    viewport?.addEventListener('resize', resize);
    return () => {
      window.removeEventListener('popstate', back);
      viewport?.removeEventListener('resize', resize);
    };
  }, [landing.slug]);
  useEffect(() => {
    setLogoFailed(false);
    setCoverFailed(false);
  }, [landing.logoUrl, landing.backgroundImageUrl]);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [contactsOpen, setContactsOpen] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const contacts = useRef<HTMLDivElement>(null);
  const previousView = useRef('0:false');
  const hadReceipt = useRef(false);
  const week = monday(date || props.minDate);
  const categories = useMemo(
    () => [...new Set(landing.services.map((s) => s.category?.split('/')[0].trim()).filter((c): c is string => !!c))],
    [landing.services],
  );
  const visibleServices = landing.services.filter(
    (s) =>
      (!category || s.category?.split('/')[0].trim() === category) &&
      `${s.name} ${s.category ?? ''}`.toLocaleLowerCase('ru-RU').includes(query.toLocaleLowerCase('ru-RU')),
  );
  const selectedServices = landing.services.filter((s) => selected.includes(s.id));
  const duration = selectedServices.reduce((sum, service) => sum + service.durationMinutes, 0);
  const bounds = selectedServices.map(priceBounds);
  const totalPrice =
    selectedServices.length && bounds.every((b): b is NonNullable<typeof b> => b !== null)
      ? bounds.reduce((total, b) => ({ min: total.min + b.min, max: total.max + b.max }), { min: 0, max: 0 })
      : null;
  const priceLabel = totalPrice
    ? totalPrice.min === totalPrice.max
      ? money(totalPrice.min)
      : `${totalPrice.min.toLocaleString('ru-RU')}–${money(totalPrice.max)}`
    : 'Стоимость уточнит сервис';
  const selectedMaster = landing.resources?.find((r) => r.resourceKey === resourceKey);
  const showForm = !props.receipt && !props.blocked;
  const phoneText = landing.links?.phone || landing.contacts;
  const phoneHref = /^[+\d ()-]{7,32}$/.test(phoneText) ? `tel:${phoneText.replace(/[^+\d]/g, '')}` : null;
  const socialLinks = (['whatsapp', 'telegram', 'vk', 'instagram'] as const).flatMap((key) => {
    const href = safeLink(landing.links?.[key]);
    const label = { whatsapp: 'WhatsApp', telegram: 'Telegram', vk: 'ВКонтакте', instagram: 'Instagram' }[key];
    return href ? [{ key, href, label }] : [];
  });

  useEffect(() => {
    const view = `${step}:${choosingMaster}`;
    if (previousView.current === view) return;
    previousView.current = view;
    heading.current?.focus({ preventScroll: true });
    heading.current?.closest('section')?.scrollTo({ top: 0, behavior: 'auto' });
  }, [step, choosingMaster]);

  useEffect(() => {
    setTimeMasterOpen(false);
  }, [step]);

  useEffect(() => {
    if (hadReceipt.current && !props.receipt) updateStep(0);
    hadReceipt.current = !!props.receipt;
  }, [props.receipt]);

  const openContacts = () => {
    setContactsOpen(true);
    requestAnimationFrame(() => contacts.current?.scrollIntoView({ block: 'nearest' }));
  };
  const weekMove = (amount: number) => {
    const first = dayAfter(week, amount * 7);
    props.onDate(first < props.minDate ? props.minDate : first);
  };

  return (
    <main className={`public-booking${showForm ? ' pb-wizard' : ''}`} data-public-booking data-step={step} ref={shell}>
      <div className="pb-container">
        <header
          className={`pb-business${step > 0 && showForm ? ' pb-business-compact' : ''}${landing.backgroundImageUrl && !coverFailed ? ' pb-business-cover' : ''}`}
        >
          {landing.backgroundImageUrl && !coverFailed && (
            <img
              className="pb-cover-image"
              src={landing.backgroundImageUrl}
              alt=""
              onError={() => setCoverFailed(true)}
            />
          )}
          <div className="pb-business-details">
            <div className="pb-business-mark" aria-hidden="true">
              {landing.logoUrl && !logoFailed ? (
                <img src={landing.logoUrl} alt="" onError={() => setLogoFailed(true)} />
              ) : (
                <span>
                  {landing.displayName
                    .trim()
                    .split(/\s+/)
                    .slice(0, 2)
                    .map((part) => part[0])
                    .join('')}
                </span>
              )}
            </div>
            <h1>{landing.displayName}</h1>
            <p className="pb-address">
              <MapPin size={14} aria-hidden="true" />
              {landing.address}
            </p>
            <button
              className="pb-contact-button"
              type="button"
              onClick={() => setContactsOpen((current) => !current)}
              aria-expanded={contactsOpen}
              aria-controls="pb-business-contacts"
            >
              <Phone size={14} aria-hidden="true" />
              <span className="pb-contact-label">Контакты сервиса</span>
              <ChevronDown size={13} aria-hidden="true" />
            </button>
            {contactsOpen && (
              <div className="pb-contact-links" id="pb-business-contacts" ref={contacts}>
                {phoneHref ? <a href={phoneHref}>{phoneText}</a> : <span>{phoneText}</span>}
                {socialLinks.map((link) => (
                  <a key={link.key} href={link.href} target="_blank" rel="noopener noreferrer">
                    {link.label}
                  </a>
                ))}
              </div>
            )}
          </div>
        </header>
        {showForm && (
          <nav className="pb-steps" aria-label="Этапы записи">
            {['Услуги', 'Время', 'Контакты'].map((label, index) => (
              <button
                key={label}
                type="button"
                aria-current={step === index ? 'step' : undefined}
                disabled={(index === 1 && !selected.length) || (index === 2 && !selectedSlot)}
                onClick={() => setStep(index)}
                className={step === index ? 'is-current' : index < step ? 'is-complete' : ''}
              >
                <span>{index < step ? <Check size={12} aria-hidden="true" /> : index + 1}</span>
                {label}
              </button>
            ))}
          </nav>
        )}
        <div className="pb-content">
          {props.recovery}
          {props.receipt}
          {showForm && (
            <form onSubmit={props.onSubmit}>
              {step === 0 && (
                <section aria-labelledby="pb-heading">
                  <h2 id="pb-heading" ref={heading} tabIndex={-1}>
                    {choosingMaster ? 'Выберите мастера' : 'Выберите услуги'}
                  </h2>
                  <p className="pb-description">
                    {choosingMaster
                      ? 'Выберите специалиста или доверьте выбор сервису.'
                      : selectedMaster
                        ? `Мастер: ${selectedMaster.name}`
                        : 'Можно выбрать несколько.'}
                  </p>
                  <div className="pb-paths" role="group" aria-label="С чего начать запись">
                    <button
                      type="button"
                      aria-pressed={!choosingMaster}
                      onClick={() => {
                        setChoosingMaster(false);
                      }}
                    >
                      Услуги
                    </button>
                    <button
                      type="button"
                      aria-pressed={choosingMaster}
                      onClick={() => {
                        setChoosingMaster(true);
                      }}
                    >
                      Мастера
                    </button>
                  </div>
                  {choosingMaster ? (
                    <MasterChoices landing={landing} resourceKey={resourceKey} onResource={props.onResource} allowAny />
                  ) : (
                    <>
                      <label className="pb-search">
                        <Search size={17} aria-hidden="true" />
                        <input
                          type="search"
                          aria-label="Поиск по всем услугам"
                          placeholder="Найти услугу"
                          value={query}
                          onChange={(event) => {
                            setQuery(event.target.value);
                            setCategory('');
                          }}
                        />
                        {query && (
                          <button type="button" aria-label="Очистить поиск" onClick={() => setQuery('')}>
                            <X size={16} aria-hidden="true" />
                          </button>
                        )}
                      </label>
                      {!!categories.length && (
                        <div className="pb-categories" aria-label="Категории услуг">
                          <button type="button" aria-pressed={!category} onClick={() => setCategory('')}>
                            Все
                          </button>
                          {categories.map((value) => (
                            <button
                              type="button"
                              key={value}
                              aria-pressed={category === value}
                              onClick={() => setCategory(value)}
                            >
                              {value}
                            </button>
                          ))}
                        </div>
                      )}
                      <div className="pb-services">
                        {visibleServices.map((service) => (
                          <label
                            key={service.id}
                            className={`pb-service${selected.includes(service.id) ? ' is-selected' : ''}`}
                          >
                            <input
                              type="checkbox"
                              checked={selected.includes(service.id)}
                              onChange={(event) =>
                                props.onSelected(
                                  event.target.checked
                                    ? [...selected, service.id]
                                    : selected.filter((id) => id !== service.id),
                                )
                              }
                            />
                            <span className="pb-service-copy">
                              <span className="pb-service-name">{service.name}</span>
                              <span className="pb-duration">{service.durationMinutes} мин</span>
                            </span>
                            {landing.showPrices && <span className="pb-service-price">{servicePrice(service)}</span>}
                          </label>
                        ))}
                      </div>
                      {!visibleServices.length && (
                        <div className="pb-empty">
                          <h3>Услуг не найдено</h3>
                          <p>Попробуйте другое название.</p>
                          <button
                            type="button"
                            className="pb-link"
                            onClick={() => {
                              setQuery('');
                              setCategory('');
                            }}
                          >
                            Показать все услуги
                          </button>
                        </div>
                      )}
                      <button type="button" className="pb-help" onClick={openContacts}>
                        <HelpCircle size={15} aria-hidden="true" />
                        Помогите выбрать услугу
                      </button>
                    </>
                  )}
                </section>
              )}
              {step === 1 && (
                <section aria-labelledby="pb-heading">
                  <h2 id="pb-heading" ref={heading} tabIndex={-1}>
                    Когда вам удобно?
                  </h2>
                  <p className="pb-description">
                    {selectedServices.map((service) => service.name).join(', ')} · {duration} мин
                  </p>
                  {!!landing.resources?.length && (
                    <div className="pb-time-master">
                      <div className="pb-master-summary">
                        <div>
                          <span>Мастер</span>
                          <strong>{selectedMaster?.name || 'Любой свободный мастер'}</strong>
                        </div>
                        <button
                          ref={masterToggle}
                          type="button"
                          className="pb-link"
                          aria-label="Изменить мастера"
                          aria-expanded={timeMasterOpen}
                          aria-controls="pb-time-master-choices"
                          onClick={() => setTimeMasterOpen((open) => !open)}
                        >
                          Изменить
                        </button>
                      </div>
                      {timeMasterOpen && (
                        <div id="pb-time-master-choices">
                          <MasterChoices
                            landing={landing}
                            resourceKey={resourceKey}
                            onResource={props.onResource}
                            onChoose={() => {
                              setTimeMasterOpen(false);
                              masterToggle.current?.focus({ preventScroll: true });
                            }}
                            allowAny
                          />
                        </div>
                      )}
                    </div>
                  )}
                  <div className="pb-week-title">
                    <h3>
                      {dateText(week)} — {dateText(dayAfter(week, 6))}
                    </h3>
                    <div>
                      <button
                        type="button"
                        aria-label="Предыдущая неделя"
                        disabled={dayAfter(week, -1) < props.minDate}
                        onClick={() => weekMove(-1)}
                      >
                        <ChevronLeft size={17} />
                      </button>
                      <button
                        type="button"
                        aria-label="Следующая неделя"
                        disabled={dayAfter(week, 7) > props.maxDate}
                        onClick={() => weekMove(1)}
                      >
                        <ChevronRight size={17} />
                      </button>
                    </div>
                  </div>
                  <div className="pb-week" aria-label="Дни недели">
                    {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((label, index) => {
                      const value = dayAfter(week, index);
                      return (
                        <button
                          type="button"
                          key={value}
                          aria-pressed={date === value}
                          aria-label={dateText(value, true)}
                          disabled={value < props.minDate || value > props.maxDate}
                          onClick={() => value !== date && props.onDate(value)}
                        >
                          <span>{label}</span>
                          <strong>{Number(value.slice(8))}</strong>
                        </button>
                      );
                    })}
                  </div>
                  <h3 className="pb-section-title">{dateText(date, true)}</h3>
                  {busy && !props.slots ? (
                    <p className="pb-status" role="status">
                      Ищем свободное время…
                    </p>
                  ) : (
                    <div className="pb-times">
                      {props.slots?.slots.map((slot) => (
                        <button
                          type="button"
                          key={slot.startsAt}
                          disabled={busy}
                          aria-pressed={selectedSlot === slot.startsAt}
                          onClick={() => props.onSlot(slot.startsAt)}
                        >
                          {timeText(slot.startsAt, landing.timezone)}
                        </button>
                      ))}
                    </div>
                  )}
                  {props.slots?.slots.length === 0 && !busy && (
                    <div className="pb-empty">
                      <h3>Свободного времени нет</h3>
                      <p>Выберите другой день{resourceKey ? ' или мастера' : ''}.</p>
                    </div>
                  )}
                  {props.slots?.nextAfter && (
                    <button type="button" className="pb-link pb-more" disabled={busy} onClick={props.onMoreSlots}>
                      Ещё время
                    </button>
                  )}
                  <p className="pb-timezone">
                    <Clock size={13} />
                    Местное время сервиса
                  </p>
                </section>
              )}
              {step === 2 && (
                <section aria-labelledby="pb-heading">
                  <h2 id="pb-heading" ref={heading} tabIndex={-1}>
                    Проверьте запись
                  </h2>
                  <p className="pb-description">Оставьте контакты для связи с сервисом.</p>
                  <div className="pb-selection">
                    <div className="pb-selection-heading">
                      <strong>
                        {dateText(date)} · {selectedSlot && timeText(selectedSlot, landing.timezone)}
                      </strong>
                      <button type="button" className="pb-link" onClick={() => setStep(1)}>
                        Изменить
                      </button>
                    </div>
                    <p>{selectedServices.map((service) => service.name).join(', ')}</p>
                    <p className="pb-muted">{selectedMaster?.name || 'Любой свободный мастер'}</p>
                    {landing.showPrices && (
                      <p>
                        {totalPrice && totalPrice.min !== totalPrice.max ? 'Ориентировочно: ' : ''}
                        {priceLabel}
                      </p>
                    )}
                  </div>
                  <div className="pb-fields">
                    <label>
                      Ваше имя
                      <input
                        required
                        maxLength={100}
                        autoComplete="name"
                        placeholder="Как к вам обращаться"
                        value={props.name}
                        onChange={(event) => props.onName(event.target.value)}
                      />
                    </label>
                    <label htmlFor="pb-phone">
                      Номер телефона
                      <BookingPhoneInput value={props.phone} onChange={props.onPhone} />
                    </label>
                    <label>
                      Комментарий <span className="pb-optional">необязательно</span>
                      <textarea
                        rows={2}
                        maxLength={1000}
                        placeholder="Автомобиль, пожелания или описание проблемы"
                        value={props.comment}
                        onChange={(event) => props.onComment(event.target.value)}
                      />
                    </label>
                  </div>
                  <details id="pb-consent-document" className="pb-legal">
                    <summary>Согласие на обработку данных</summary>
                    <p>{landing.consentText}</p>
                  </details>
                  <details className="pb-legal">
                    <summary>Политика конфиденциальности</summary>
                    <p>{landing.policyText}</p>
                    <p>
                      {landing.operator.name}
                      {landing.operator.requisites ? ` · ${landing.operator.requisites}` : ''}
                      <br />
                      {landing.operator.contact}
                    </p>
                  </details>
                </section>
              )}
              <div className="pb-action-area">
                {!!selected.length && landing.showPrices && (
                  <div className="pb-total">
                    <div>
                      <span>
                        {totalPrice && totalPrice.min !== totalPrice.max
                          ? 'Ориентировочная стоимость'
                          : 'Стоимость работ'}
                      </span>
                      <strong>{priceLabel}</strong>
                    </div>
                    <span>{duration} мин</span>
                  </div>
                )}
                {totalPrice && totalPrice.min !== totalPrice.max && landing.showPrices && (
                  <p className="pb-price-note">Точную цену согласуете с сервисом.</p>
                )}
                {step < 2 ? (
                  <button
                    type="button"
                    className="pb-primary"
                    disabled={step === 0 ? !choosingMaster && !selected.length : !selectedSlot || busy}
                    onClick={() => (choosingMaster ? setChoosingMaster(false) : setStep(step + 1))}
                  >
                    {step === 0 ? (choosingMaster ? 'Выбрать услуги' : 'Продолжить') : 'Указать контакты'}
                    <ArrowRight size={16} aria-hidden="true" />
                  </button>
                ) : (
                  <>
                    <label className="pb-consent">
                      <input
                        required
                        type="checkbox"
                        checked={props.consented}
                        onChange={(event) => props.onConsent(event.target.checked)}
                      />
                      <span>
                        Даю согласие на обработку персональных данных.{' '}
                        <a
                          href="#pb-consent-document"
                          onClick={() => {
                            const document = globalThis.document.getElementById('pb-consent-document');
                            if (document instanceof HTMLDetailsElement) document.open = true;
                          }}
                        >
                          Текст согласия
                        </a>
                        .
                      </span>
                    </label>
                    <button
                      type="submit"
                      className="pb-primary"
                      disabled={
                        busy ||
                        props.blocked ||
                        !selectedSlot ||
                        !props.consented ||
                        !props.name.trim() ||
                        !normalizeBookingPhone(props.phone)
                      }
                    >
                      {busy ? 'Отправляем…' : landing.mode === 'approval' ? 'Отправить заявку' : 'Подтвердить запись'}
                      <ArrowRight size={16} aria-hidden="true" />
                    </button>
                  </>
                )}
                {step > 0 && (
                  <button
                    type="button"
                    className="pb-back"
                    disabled={busy}
                    onClick={() => {
                      if (typeof window !== 'undefined' && window.history.state?.bookingSlug === landing.slug)
                        window.history.back();
                      else updateStep(step - 1);
                    }}
                  >
                    <ArrowLeft size={14} />
                    Назад
                  </button>
                )}
                {step === 2 && (
                  <p className="pb-confirmation-note">
                    {landing.mode === 'approval'
                      ? 'Администратор подтвердит время и свяжется с вами.'
                      : 'Дождитесь подтверждения на этой странице.'}
                  </p>
                )}
              </div>
            </form>
          )}
          {props.error && (
            <div className="pb-error">
              <p role="alert">{props.error}</p>
              {step === 1 && showForm && (
                <button type="button" className="pb-link" disabled={busy} onClick={props.onRetrySlots}>
                  Повторить загрузку времени
                </button>
              )}
            </div>
          )}
        </div>
        <footer className="pb-footer">
          <a href="https://autexa.pw" target="_blank" rel="noopener noreferrer">
            <span>Работает на</span>
            <img src="/logo.png" alt="Autexa" width="90" height="30" />
          </a>
        </footer>
      </div>
    </main>
  );
}

function MasterChoices({
  landing,
  resourceKey,
  onResource,
  allowAny = false,
  onChoose,
}: {
  landing: PublicBookingLanding;
  resourceKey: string;
  onResource: (value: string) => void;
  allowAny?: boolean;
  onChoose?: () => void;
}) {
  const choose = (value: string) => {
    if (value !== resourceKey) onResource(value);
    onChoose?.();
  };
  return (
    <div className="pb-resources" role="group" aria-label="Выбор мастера">
      {allowAny && (
        <button type="button" aria-pressed={!resourceKey} onClick={() => choose('')} className="pb-any-master">
          Любой свободный мастер
        </button>
      )}
      {landing.resources?.map((resource) => (
        <button
          key={resource.resourceKey}
          type="button"
          aria-pressed={resourceKey === resource.resourceKey}
          onClick={() => choose(resource.resourceKey)}
          className="pb-master"
        >
          <MasterAvatar name={resource.name} avatar={resource.avatar} />
          <span className="pb-master-info">
            <strong>{resource.name}</strong>
            <span>{resource.profession || 'Мастер'}</span>
          </span>
          {resourceKey === resource.resourceKey && <Check size={18} aria-hidden="true" />}
        </button>
      ))}
      {!landing.resources?.length && <p className="pb-status">Нет доступных мастеров. Свяжитесь с сервисом.</p>}
    </div>
  );
}
function MasterAvatar({ name, avatar }: { name: string; avatar?: string | null }) {
  const [failed, setFailed] = useState(false);
  const safeAvatar =
    avatar &&
    (/^https?:\/\//.test(avatar) || /^\/(?!\/)/.test(avatar) || /^data:image\/(png|jpeg|webp);base64,/.test(avatar));
  return (
    <span className="pb-avatar" aria-hidden="true">
      {safeAvatar && !failed ? (
        <img src={avatar} alt="" onError={() => setFailed(true)} />
      ) : (
        name
          .trim()
          .split(/\s+/)
          .slice(0, 2)
          .map((part) => part[0])
          .join('')
      )}
    </span>
  );
}
