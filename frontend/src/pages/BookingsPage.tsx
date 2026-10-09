import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { createSessionBoundClient } from '../api/axios';
import { useAuth } from '../contexts/AuthContext';
import { Button, Card, CardBody, CardHeader, Field, Input, PageHeader, Select } from '../ui';
import type {
  PublicBookingContactLinks,
  PublicBookingResource,
  PublicBookingServiceOption,
  StaffPublicBookingRequest,
} from '../../../shared/types';
import type { PutPublicBookingSettingsRequest } from '../../../shared/api/types';
import { apiErrorMessage } from '../../../shared/utils/apiError';
import { roleLabels } from '../../../shared/utils/formatters';
import { createBookingsApi, createClientsApi } from '../../../shared/api/createServices';
import { readStoredToken } from '../utils/sessionToken';

function operationId(): string {
  if (!globalThis.crypto?.randomUUID) throw new Error('Браузер не поддерживает безопасную отправку.');
  return globalThis.crypto.randomUUID();
}

const DEFAULT_BOOKING_HOURS = Object.fromEntries(
  Array.from({ length: 7 }, (_, day) => [String(day), { start: '09:00', end: '18:00' }]),
);

export default function BookingsPage() {
  const queryClient = useQueryClient();
  const { user, token, hasPermission } = useAuth();
  const canManage = hasPermission('company_manage');
  const canReview = hasPermission('bookings_access');
  const [activeTab, setActiveTab] = useState<'settings' | 'requests'>(canManage ? 'settings' : 'requests');
  const ownerScope = `${user?.id ?? ''}:${user?.currentPointId ?? ''}`;
  const sessionClient = useMemo(() => (token ? createSessionBoundClient(token) : null), [token]);
  const scopedBookingsApi = useMemo(() => (sessionClient ? createBookingsApi(sessionClient) : null), [sessionClient]);
  const scopedClientsApi = useMemo(() => (sessionClient ? createClientsApi(sessionClient) : null), [sessionClient]);
  const [settingsDraft, setSettingsDraft] = useState<Partial<PutPublicBookingSettingsRequest> | null>(null);
  const decisionKeys = useRef(new Map<string, { accept: boolean; requestId: string }>());
  useEffect(() => {
    setSettingsDraft(null);
    decisionKeys.current.clear();
  }, [ownerScope]);
  useEffect(() => {
    if (activeTab === 'settings' && !canManage) setActiveTab('requests');
    else if (activeTab === 'requests' && !canReview) setActiveTab('settings');
  }, [activeTab, canManage, canReview]);
  const pageQuery = useQuery({
    queryKey: ['bookings', 'public-settings', ownerScope],
    queryFn: async () => {
      if (!scopedBookingsApi) throw new Error('Нет активной сессии');
      return (await scopedBookingsApi.getPublicSettings()).data;
    },
    enabled: canManage && !!scopedBookingsApi,
  });
  const resourcesQuery = useQuery<PublicBookingResource[]>({
    queryKey: ['bookings', 'public-resources', ownerScope],
    queryFn: async () => {
      if (!scopedBookingsApi) throw new Error('Нет активной сессии');
      return (await scopedBookingsApi.publicResources()).data;
    },
    enabled: canManage && !!scopedBookingsApi,
  });
  const servicesQuery = useQuery<PublicBookingServiceOption[]>({
    queryKey: ['bookings', 'service-options', ownerScope],
    queryFn: async () => {
      if (!scopedBookingsApi) throw new Error('Нет активной сессии');
      const all: PublicBookingServiceOption[] = [];
      let page = 1;
      let total = 0;
      do {
        const result = (await scopedBookingsApi.publicServices({ page, limit: 500 })).data;
        all.push(...result.data);
        total = result.total;
        if (result.data.length === 0 && all.length < total)
          throw new Error('Не удалось загрузить весь список услуг. Повторите попытку.');
        page += 1;
        if (page > 10000) throw new Error('Слишком большой каталог услуг для загрузки.');
      } while (all.length < total);
      return all;
    },
    enabled: canManage && !!scopedBookingsApi,
  });
  const requestsQuery = useQuery<StaffPublicBookingRequest[]>({
    queryKey: ['bookings', 'public-requests', ownerScope],
    queryFn: async () => {
      if (!scopedBookingsApi) throw new Error('Нет активной сессии');
      return (await scopedBookingsApi.requests()).data;
    },
    enabled: canReview && activeTab === 'requests' && !!scopedBookingsApi,
  });
  const settings = pageQuery.data;
  const publicUrl = settings?.publicUrl;
  const services = servicesQuery.data ?? [];
  const resources = resourcesQuery.data ?? [];

  const draft = useMemo<PutPublicBookingSettingsRequest | null>(() => {
    if (!settings && !settingsDraft) return null;
    const tenant = user?.tenant;
    const profileContacts = [tenant?.phone, tenant?.email].filter(Boolean).join(' · ');
    const profileLinks: PublicBookingContactLinks = tenant?.phone ? { phone: tenant.phone } : {};
    return {
      requestId: '',
      revision: settings?.revision ?? 0,
      displayName: settingsDraft?.displayName ?? settings?.displayName ?? tenant?.name ?? '',
      address: settingsDraft?.address ?? settings?.address ?? tenant?.address ?? '',
      contacts: settingsDraft?.contacts ?? settings?.contacts ?? profileContacts,
      links: settingsDraft?.links ?? settings?.links ?? profileLinks,
      showPrices: settingsDraft?.showPrices ?? settings?.showPrices ?? false,
      mode: settingsDraft?.mode ?? settings?.mode ?? 'approval',
      slotStepMinutes: settingsDraft?.slotStepMinutes ?? settings?.slotStepMinutes ?? 15,
      openingHours: settingsDraft?.openingHours ?? settings?.openingHours ?? DEFAULT_BOOKING_HOURS,
      services: settingsDraft?.services ?? settings?.services ?? [],
      resourceIds: settingsDraft?.resourceIds ?? settings?.resourceIds ?? [],
    };
  }, [settings, settingsDraft, user?.tenant]);

  const save = useMutation({
    mutationFn: (body: PutPublicBookingSettingsRequest) => {
      if (!scopedBookingsApi) throw new Error('Нет активной сессии');
      return scopedBookingsApi.putPublicSettings(body);
    },
    onSuccess: (result) => {
      if (readStoredToken() !== token) return;
      setSettingsDraft(null);
      queryClient.setQueryData(['bookings', 'public-settings', ownerScope], result.data);
      toast.success('Настройки страницы сохранены');
    },
    onError: (error) => toast.error(apiErrorMessage(error) ?? 'Настройки не сохранены. Обновите данные и повторите.'),
  });
  const publish = useMutation({
    mutationFn: (published: boolean) => {
      if (!scopedBookingsApi) throw new Error('Нет активной сессии');
      return published
        ? scopedBookingsApi.unpublish({ requestId: operationId() })
        : scopedBookingsApi.publish({ requestId: operationId() });
    },
    onSuccess: (result) => {
      if (readStoredToken() === token)
        queryClient.setQueryData(['bookings', 'public-settings', ownerScope], result.data);
    },
    onError: (error) => toast.error(apiErrorMessage(error) ?? 'Не удалось изменить публикацию'),
  });
  const decide = useMutation({
    mutationFn: ({ request, accept }: { request: StaffPublicBookingRequest; accept: boolean }) => {
      const intent = decisionKeys.current.get(request.id);
      if (intent && intent.accept !== accept)
        throw new Error('Сначала повторите выбранное действие или обновите результат заявки.');
      const requestId = intent?.requestId ?? operationId();
      decisionKeys.current.set(request.id, { accept, requestId });
      if (!scopedBookingsApi) throw new Error('Нет активной сессии');
      return accept
        ? scopedBookingsApi.approve(request.id, { requestId })
        : scopedBookingsApi.reject(request.id, { requestId });
    },
    onSuccess: (_result, variables) => {
      decisionKeys.current.delete(variables.request.id);
      void queryClient.invalidateQueries({ queryKey: ['bookings', 'public-requests'] });
    },
    onError: (error) => toast.error(apiErrorMessage(error) ?? 'Запрос уже изменился. Обновите список.'),
  });
  const linkClient = useMutation({
    mutationFn: async (request: StaffPublicBookingRequest) => {
      if (!request.bookingId) throw new Error('Сначала подтвердите запись.');
      if (!scopedClientsApi || !scopedBookingsApi) throw new Error('Нет активной сессии');
      const match = await scopedClientsApi.lookupByPhone(request.phone);
      if (!match.data) throw new Error('В этой точке не найдена подходящая карточка клиента.');
      return scopedBookingsApi.linkClient(request.bookingId, { requestId: operationId(), clientId: match.data.id });
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['bookings', 'public-requests'] }),
    onError: (error) =>
      toast.error(apiErrorMessage(error) ?? (error instanceof Error ? error.message : 'Не удалось связать клиента')),
  });

  const putDraft = (patch: Partial<PutPublicBookingSettingsRequest>) =>
    setSettingsDraft((current) => ({ ...current, ...patch }));
  const toggleService = (serviceId: string, checked: boolean) => {
    const current = settingsDraft?.services ?? settings?.services ?? [];
    putDraft({
      services: checked
        ? [...current, { serviceId, durationMinutes: 90 }]
        : current.filter((item) => item.serviceId !== serviceId),
    });
  };
  const toggleResource = (resourceId: string, checked: boolean) => {
    const current = settingsDraft?.resourceIds ?? settings?.resourceIds ?? [];
    putDraft({ resourceIds: checked ? [...current, resourceId] : current.filter((id) => id !== resourceId) });
  };
  const setDayHours = (day: string, hours: { start: string; end: string } | null) => {
    const current = settingsDraft?.openingHours ?? settings?.openingHours ?? DEFAULT_BOOKING_HOURS;
    putDraft({ openingHours: { ...current, [day]: hours } });
  };
  const setPublicLink = (key: keyof PublicBookingContactLinks, value: string) => {
    const current = draft?.links ?? settings?.links ?? {};
    putDraft({ links: { ...current, [key]: value } });
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6 lg:p-9">
      <PageHeader title="Онлайн-запись" subtitle="Настройте страницу для клиентов и разберите входящие заявки." />
      {canManage && canReview && (
        <div role="group" aria-label="Онлайн-запись" className="inline-flex rounded-xl bg-slate-100 p-1">
          {canManage && (
            <button
              type="button"
              aria-pressed={activeTab === 'settings'}
              onClick={() => setActiveTab('settings')}
              className={`rounded-lg px-4 py-2 text-sm font-semibold ${activeTab === 'settings' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'}`}
            >
              Страница
            </button>
          )}
          {canReview && (
            <button
              type="button"
              aria-pressed={activeTab === 'requests'}
              onClick={() => setActiveTab('requests')}
              className={`rounded-lg px-4 py-2 text-sm font-semibold ${activeTab === 'requests' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'}`}
            >
              Заявки
            </button>
          )}
        </div>
      )}
      {canManage && activeTab === 'settings' && (
        <Card>
          <CardHeader title="Настройки страницы" subtitle="Ссылка для записи останется постоянной." />
          <CardBody>
            {pageQuery.isLoading ? (
              <p>Загружаем настройки…</p>
            ) : pageQuery.isError ? (
              <div role="alert" className="text-rose-700">
                Не удалось загрузить настройки.{' '}
                <button className="underline" onClick={() => void pageQuery.refetch()}>
                  Повторить
                </button>
              </div>
            ) : (
              <>
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="Название сервиса">
                    <Input
                      value={draft?.displayName ?? settings?.displayName ?? user?.tenant?.name ?? ''}
                      onChange={(event) => putDraft({ displayName: event.target.value })}
                      maxLength={160}
                    />
                  </Field>
                  <Field label="Публичная ссылка">
                    <Input value={settings?.publicUrl ?? 'Ссылка появится после первого сохранения'} readOnly />
                  </Field>
                  <Field label="Адрес">
                    <Input
                      value={draft?.address ?? settings?.address ?? user?.tenant?.address ?? ''}
                      onChange={(event) => putDraft({ address: event.target.value })}
                      maxLength={300}
                    />
                  </Field>
                  <Field label="Контакты">
                    <Input
                      value={
                        draft?.contacts ??
                        settings?.contacts ??
                        [user?.tenant?.phone, user?.tenant?.email].filter(Boolean).join(' · ')
                      }
                      onChange={(event) => putDraft({ contacts: event.target.value })}
                      maxLength={300}
                    />
                  </Field>
                  <Field label="Телефон для связи">
                    <Input
                      type="tel"
                      value={draft?.links?.phone ?? settings?.links?.phone ?? user?.tenant?.phone ?? ''}
                      onChange={(event) => setPublicLink('phone', event.target.value)}
                      maxLength={32}
                    />
                  </Field>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {(
                      [
                        ['instagram', 'Instagram', 'https://instagram.com/...'],
                        ['whatsapp', 'WhatsApp', 'https://wa.me/...'],
                        ['vk', 'ВКонтакте', 'https://vk.com/...'],
                        ['telegram', 'Telegram', 'https://t.me/...'],
                      ] as const
                    ).map(([key, label, placeholder]) => (
                      <Field key={key} label={label}>
                        <Input
                          type="url"
                          value={draft?.links?.[key] ?? settings?.links?.[key] ?? ''}
                          onChange={(event) => setPublicLink(key, event.target.value)}
                          placeholder={placeholder}
                          maxLength={500}
                        />
                      </Field>
                    ))}
                  </div>
                  <Field label="Телефон для связи">
                    <Input
                      type="tel"
                      value={draft?.links?.phone ?? settings?.links?.phone ?? user?.tenant?.phone ?? ''}
                      onChange={(event) =>
                        putDraft({ links: { ...(draft?.links ?? settings?.links ?? {}), phone: event.target.value } })
                      }
                      maxLength={32}
                    />
                  </Field>
                  {(
                    [
                      ['instagram', 'Instagram', 'https://instagram.com/...'],
                      ['whatsapp', 'WhatsApp', 'https://wa.me/...'],
                      ['vk', 'ВКонтакте', 'https://vk.com/...'],
                      ['telegram', 'Telegram', 'https://t.me/...'],
                    ] as const
                  ).map(([key, label, placeholder]) => (
                    <Field key={key} label={label}>
                      <Input
                        type="url"
                        value={draft?.links?.[key] ?? settings?.links?.[key] ?? ''}
                        onChange={(event) =>
                          putDraft({ links: { ...(draft?.links ?? settings?.links ?? {}), [key]: event.target.value } })
                        }
                        placeholder={placeholder}
                        maxLength={500}
                      />
                    </Field>
                  ))}
                  <Field label="Подтверждение заявок">
                    <Select
                      value={draft?.mode ?? settings?.mode ?? 'approval'}
                      onChange={(event) => putDraft({ mode: event.target.value as 'instant' | 'approval' })}
                    >
                      <option value="approval">Сотрудник подтверждает</option>
                      <option value="instant">Подтверждать автоматически</option>
                    </Select>
                  </Field>
                  <Field label="Шаг времени (минуты)">
                    <Input
                      type="number"
                      min={5}
                      max={120}
                      value={draft?.slotStepMinutes ?? settings?.slotStepMinutes ?? 15}
                      onChange={(event) => putDraft({ slotStepMinutes: Number(event.target.value) })}
                    />
                  </Field>
                </div>
                <div className="mt-5 grid gap-5 md:grid-cols-2">
                  <fieldset>
                    <legend className="mb-2 font-semibold">Услуги и длительность</legend>
                    {servicesQuery.isLoading ? (
                      <p className="text-sm text-slate-500">Загружаем каталог услуг…</p>
                    ) : servicesQuery.isError ? (
                      <button className="text-blue-700 underline" onClick={() => void servicesQuery.refetch()}>
                        Не удалось загрузить услуги · Повторить
                      </button>
                    ) : services.length === 0 ? (
                      <p className="text-sm text-slate-500">В каталоге пока нет услуг.</p>
                    ) : (
                      services.map((service) => {
                        const chosen = (draft?.services ?? settings?.services ?? []).find(
                          (item) => item.serviceId === service.id,
                        );
                        return (
                          <label key={service.id} className="flex items-center gap-3 border-t py-2 text-sm">
                            <input
                              type="checkbox"
                              checked={!!chosen}
                              onChange={(event) => toggleService(service.id, event.target.checked)}
                            />
                            <span className="min-w-0 flex-1">
                              {service.name}
                              {service.category && (
                                <span className="ml-2 text-xs text-slate-500">{service.category}</span>
                              )}
                            </span>
                            {chosen && (
                              <input
                                aria-label={`Длительность: ${service.name}`}
                                type="number"
                                min={5}
                                max={720}
                                value={chosen.durationMinutes}
                                onChange={(event) =>
                                  putDraft({
                                    services: (draft?.services ?? settings?.services ?? []).map((item) =>
                                      item.serviceId === service.id
                                        ? { ...item, durationMinutes: Number(event.target.value) }
                                        : item,
                                    ),
                                  })
                                }
                                className="w-24 rounded-lg border px-2 py-1"
                              />
                            )}
                          </label>
                        );
                      })
                    )}
                  </fieldset>
                  <fieldset>
                    <legend className="mb-2 font-semibold">Сотрудники, принимающие записи</legend>
                    {resourcesQuery.isLoading ? (
                      <p className="text-sm text-slate-500">Загружаем сотрудников…</p>
                    ) : resourcesQuery.isError ? (
                      <button className="text-blue-700 underline" onClick={() => void resourcesQuery.refetch()}>
                        Не удалось загрузить сотрудников · Повторить
                      </button>
                    ) : resources.length === 0 ? (
                      <p className="text-sm text-slate-500">Нет доступных сотрудников для записи.</p>
                    ) : (
                      resources.map((resource) => (
                        <label key={resource.id} className="flex items-center gap-3 border-t py-2 text-sm">
                          <input
                            type="checkbox"
                            checked={(draft?.resourceIds ?? settings?.resourceIds ?? []).includes(resource.id)}
                            onChange={(event) => toggleResource(resource.id, event.target.checked)}
                          />
                          <span>{resource.name}</span>
                          <span className="ml-auto text-slate-500">{roleLabels[resource.role] ?? resource.role}</span>
                        </label>
                      ))
                    )}
                  </fieldset>
                </div>
                <fieldset className="mt-6">
                  <legend className="mb-2 font-semibold">Рабочие часы</legend>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'].map(
                      (label, index) => {
                        const day = String(index);
                        const hours =
                          (draft?.openingHours ?? settings?.openingHours ?? DEFAULT_BOOKING_HOURS)[day] ?? null;
                        return (
                          <div
                            key={day}
                            className="flex items-center gap-2 rounded-lg border border-slate-200 px-2 py-2"
                          >
                            <label className="flex min-w-28 items-center gap-2 text-sm">
                              <input
                                type="checkbox"
                                checked={!!hours}
                                onChange={(event) =>
                                  setDayHours(day, event.target.checked ? { start: '09:00', end: '18:00' } : null)
                                }
                              />
                              {label}
                            </label>
                            {hours && (
                              <>
                                <input
                                  aria-label={`${label}: начало`}
                                  type="time"
                                  value={hours.start}
                                  onChange={(event) => setDayHours(day, { ...hours, start: event.target.value })}
                                  className="w-24 rounded border px-2 py-1 text-sm"
                                />
                                <span>—</span>
                                <input
                                  aria-label={`${label}: окончание`}
                                  type="time"
                                  value={hours.end}
                                  onChange={(event) => setDayHours(day, { ...hours, end: event.target.value })}
                                  className="w-24 rounded border px-2 py-1 text-sm"
                                />
                              </>
                            )}
                          </div>
                        );
                      },
                    )}
                  </div>
                </fieldset>
                <label className="mt-5 flex items-center gap-3 text-sm">
                  <input
                    type="checkbox"
                    checked={draft?.showPrices ?? settings?.showPrices ?? false}
                    onChange={(event) => putDraft({ showPrices: event.target.checked })}
                  />
                  Показывать цены услуг
                </label>
                <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm">
                  <p className="font-semibold">Политика и отдельное согласие</p>
                  <p className="mt-1 text-slate-600">
                    Autexa формирует оба текста из реквизитов компании и настроенных контактов. Клиент отдельно отмечает
                    согласие перед отправкой заявки.
                  </p>
                  {settings ? (
                    <details className="mt-3">
                      <summary className="cursor-pointer font-medium">Показать текст сохранённой версии</summary>
                      <h3 className="mt-3 font-semibold">Политика обработки</h3>
                      <pre className="mt-1 whitespace-pre-wrap font-sans text-slate-700">{settings.policyText}</pre>
                      <h3 className="mt-3 font-semibold">Отдельное согласие</h3>
                      <pre className="mt-1 whitespace-pre-wrap font-sans text-slate-700">{settings.consentText}</pre>
                    </details>
                  ) : (
                    <p className="mt-3 text-slate-600">Тексты появятся после первого сохранения страницы.</p>
                  )}
                </div>
                <div className="mt-6 flex flex-wrap gap-3">
                  <Button
                    disabled={!draft || !settingsDraft || save.isPending || !canManage}
                    onClick={() => {
                      if (draft) save.mutate({ ...draft, requestId: operationId() });
                    }}
                  >
                    Сохранить настройки
                  </Button>
                  {settings?.published && (
                    <Button
                      variant="secondary"
                      disabled={publish.isPending || save.isPending || !!settingsDraft}
                      onClick={() => publish.mutate(true)}
                    >
                      Снять с публикации
                    </Button>
                  )}
                  {settings && !settings.published && (
                    <Button
                      variant="secondary"
                      disabled={publish.isPending || save.isPending || !!settingsDraft}
                      onClick={() => publish.mutate(false)}
                    >
                      Опубликовать
                    </Button>
                  )}
                  {publicUrl && (
                    <button
                      className="rounded-lg border px-4 py-2 text-sm font-semibold"
                      onClick={() => {
                        const value = publicUrl;
                        if (!navigator.clipboard?.writeText) {
                          toast.error('Скопируйте ссылку из поля вручную.');
                          return;
                        }
                        void navigator.clipboard
                          .writeText(value)
                          .then(() => toast.success('Ссылка скопирована'))
                          .catch(() => toast.error('Не удалось скопировать ссылку.'));
                      }}
                    >
                      Скопировать ссылку
                    </button>
                  )}
                </div>
              </>
            )}
          </CardBody>
        </Card>
      )}

      {canReview && activeTab === 'requests' && (
        <Card>
          <CardHeader title="Заявки клиентов" subtitle="Заявка становится записью только после подтверждения." />
          <CardBody>
            {requestsQuery.isLoading ? (
              <p>Загружаем заявки…</p>
            ) : requestsQuery.isError ? (
              <div role="alert">
                Не удалось загрузить список.{' '}
                <button className="underline" onClick={() => void requestsQuery.refetch()}>
                  Повторить
                </button>
              </div>
            ) : (requestsQuery.data ?? []).filter((request) => request.status === 'pending' || request.needsClientLink)
                .length === 0 ? (
              <p className="text-sm text-slate-500">Новых заявок нет.</p>
            ) : (
              <div className="space-y-4">
                {requestsQuery.data
                  ?.filter((request) => request.status === 'pending' || request.needsClientLink)
                  .map((request) => (
                    <article key={request.id} className="rounded-xl border border-slate-200 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <h3 className="font-semibold">{request.name}</h3>
                          <p className="text-sm text-slate-600">
                            {request.phone} · {new Date(request.startsAt).toLocaleString('ru-RU')} ·{' '}
                            {request.status === 'pending' ? 'Ожидает подтверждения' : 'Запись подтверждена'}
                          </p>
                          <ul className="mt-2 text-sm text-slate-600">
                            {request.services.map((service) => (
                              <li key={service.serviceId}>
                                {service.name} · {service.durationMinutes} мин
                              </li>
                            ))}
                          </ul>
                          {request.comment && <p className="mt-2 text-sm">{request.comment}</p>}
                        </div>
                        {request.status === 'pending' && (
                          <div className="flex gap-2">
                            <Button
                              disabled={
                                decide.isPending ||
                                (!!decisionKeys.current.get(request.id) &&
                                  decisionKeys.current.get(request.id)?.accept === false)
                              }
                              onClick={() => decide.mutate({ request, accept: true })}
                            >
                              Подтвердить
                            </Button>
                            <Button
                              variant="secondary"
                              disabled={
                                decide.isPending ||
                                (!!decisionKeys.current.get(request.id) &&
                                  decisionKeys.current.get(request.id)?.accept === true)
                              }
                              onClick={() => decide.mutate({ request, accept: false })}
                            >
                              Отклонить
                            </Button>
                          </div>
                        )}
                      </div>
                      {request.needsClientLink && request.bookingId && (
                        <div className="mt-4 border-t pt-3">
                          <p className="text-sm text-amber-800">
                            Для прихода сначала свяжите запись с карточкой клиента этой точки.
                          </p>
                          <Button
                            variant="secondary"
                            disabled={linkClient.isPending}
                            onClick={() => linkClient.mutate(request)}
                          >
                            Найти карточку по телефону и связать
                          </Button>
                        </div>
                      )}
                    </article>
                  ))}
              </div>
            )}
            <button
              className="mt-4 text-sm font-semibold text-blue-700 underline"
              onClick={() => void requestsQuery.refetch()}
            >
              Обновить заявки
            </button>
          </CardBody>
        </Card>
      )}
      {!canManage && !canReview && (
        <Card>
          <CardBody>
            <p>Для работы с онлайн-записью нет доступа.</p>
            <Link className="text-blue-700 underline" to="/">
              На главную
            </Link>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
