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
  const [step, setStep] = useState(0);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [contactsOpen, setContactsOpen] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const contacts = useRef<HTMLDivElement>(null);
  const previousStep = useRef(0);
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
    if (previousStep.current === step) return;
    previousStep.current = step;
    heading.current?.focus({ preventScroll: true });
    heading.current?.scrollIntoView({ block: 'start', behavior: 'auto' });
  }, [step]);

  useEffect(() => {
    if (hadReceipt.current && !props.receipt) setStep(0);
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
    <main className="public-booking" data-public-booking>
      <div className="pb-container">
        <header className={`pb-business${step > 0 && showForm ? ' pb-business-compact' : ''}`}>
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
            Контакты сервиса
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
                    Выберите услуги
                  </h2>
                  <p className="pb-description">Можно выбрать одну или несколько.</p>
                  <label className="pb-search">
                    <Search size={17} aria-hidden="true" />
                    <input
                      type="search"
                      aria-label="Поиск по всем услугам"
                      placeholder="Название услуги"
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
                        <span className="pb-service-top">
                          <span className="pb-service-name">{service.name}</span>
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
                        </span>
                        <span className="pb-service-bottom">
                          {landing.showPrices ? (
                            <span className="pb-service-price">{servicePrice(service)}</span>
                          ) : (
                            <span className="pb-muted">{service.category}</span>
                          )}
                          <span className="pb-duration">
                            <Clock size={12} aria-hidden="true" />
                            {service.durationMinutes} мин
                          </span>
                        </span>
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
                    <>
                      <h3 className="pb-section-title">Мастер</h3>
                      <div className="pb-resources" role="group" aria-label="Выбор мастера">
                        <button type="button" aria-pressed={!resourceKey} onClick={() => props.onResource('')}>
                          Любой свободный
                        </button>
                        {landing.resources.map((resource) => (
                          <button
                            key={resource.resourceKey}
                            type="button"
                            aria-pressed={resourceKey === resource.resourceKey}
                            onClick={() => props.onResource(resource.resourceKey)}
                          >
                            {resource.name}
                          </button>
                        ))}
                      </div>
                    </>
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
                          onClick={() => props.onDate(value)}
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
                    Местное время · {landing.timezone}
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
                    <label>
                      Номер телефона
                      <input
                        required
                        type="tel"
                        inputMode="tel"
                        autoComplete="tel"
                        maxLength={32}
                        placeholder="+7 (999) 123-45-67"
                        value={props.phone}
                        onChange={(event) => props.onPhone(event.target.value)}
                      />
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
                  <label className="pb-consent">
                    <input
                      type="checkbox"
                      checked={props.consented}
                      onChange={(event) => props.onConsent(event.target.checked)}
                    />
                    <span>
                      Даю согласие на обработку персональных данных для оформления записи.{' '}
                      <a href="#pb-consent-document">Текст согласия</a>.
                    </span>
                  </label>
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
                    disabled={step === 0 ? !selected.length : !selectedSlot || busy}
                    onClick={() => setStep(step + 1)}
                  >
                    {step === 0 ? 'Выбрать время' : 'Указать контакты'}
                    <ArrowRight size={16} aria-hidden="true" />
                  </button>
                ) : (
                  <button
                    type="submit"
                    className="pb-primary"
                    disabled={
                      busy ||
                      props.blocked ||
                      !selectedSlot ||
                      !props.consented ||
                      !props.name.trim() ||
                      !props.phone.trim()
                    }
                  >
                    {busy ? 'Отправляем…' : landing.mode === 'approval' ? 'Отправить заявку' : 'Подтвердить запись'}
                    <ArrowRight size={16} aria-hidden="true" />
                  </button>
                )}
                {step > 0 && (
                  <button type="button" className="pb-back" disabled={busy} onClick={() => setStep(step - 1)}>
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
            <p className="pb-error" role="alert">
              {props.error}
            </p>
          )}
        </div>
        <footer className="pb-footer">
          <a href="https://autexa.pw" target="_blank" rel="noopener noreferrer">
            Работает на <strong>Autexa</strong>
            <ArrowRight size={12} aria-hidden="true" />
          </a>
        </footer>
      </div>
    </main>
  );
}
