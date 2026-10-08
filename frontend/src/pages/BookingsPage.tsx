import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { createSessionBoundClient } from '../api/axios';
import { useAuth } from '../contexts/AuthContext';
import { Button, Card, CardBody, CardHeader, Field, Input, PageHeader, Select, Textarea } from '../ui';
import type { PublicBookingResource, Service, StaffPublicBookingRequest } from '../../../shared/types';
import type { PutPublicBookingSettingsRequest } from '../../../shared/api/types';
import { apiErrorMessage } from '../../../shared/utils/apiError';
import { createBookingsApi, createClientsApi, createServicesApi } from '../../../shared/api/createServices';
import { readStoredToken } from '../utils/sessionToken';

function operationId(): string {
  if (!globalThis.crypto?.randomUUID) throw new Error('Браузер не поддерживает безопасную отправку.');
  return globalThis.crypto.randomUUID();
}

export default function BookingsPage() {
  const queryClient = useQueryClient();
  const { user, token, hasPermission } = useAuth();
  const canManage = hasPermission('company_manage');
  const canReview = hasPermission('bookings_access');
  const ownerScope = `${user?.id ?? ''}:${user?.currentPointId ?? ''}`;
  const sessionClient = useMemo(() => (token ? createSessionBoundClient(token) : null), [token]);
  const scopedBookingsApi = useMemo(() => (sessionClient ? createBookingsApi(sessionClient) : null), [sessionClient]);
  const scopedClientsApi = useMemo(() => (sessionClient ? createClientsApi(sessionClient) : null), [sessionClient]);
  const scopedServicesApi = useMemo(() => (sessionClient ? createServicesApi(sessionClient) : null), [sessionClient]);
  const [settingsDraft, setSettingsDraft] = useState<Partial<PutPublicBookingSettingsRequest> | null>(null);
  const [newSlug, setNewSlug] = useState('');
  const decisionKeys = useRef(new Map<string, { accept: boolean; requestId: string }>());
  useEffect(() => {
    setSettingsDraft(null);
    setNewSlug('');
    decisionKeys.current.clear();
  }, [ownerScope]);
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
  const servicesQuery = useQuery({
    queryKey: ['bookings', 'service-options', ownerScope],
    queryFn: async () => {
      if (!scopedServicesApi) throw new Error('Нет активной сессии');
      return (await scopedServicesApi.getAll({ page: 1, limit: 500 })).data;
    },
    enabled: canManage && !!scopedServicesApi,
  });
  const requestsQuery = useQuery<StaffPublicBookingRequest[]>({
    queryKey: ['bookings', 'public-requests', ownerScope],
    queryFn: async () => {
      if (!scopedBookingsApi) throw new Error('Нет активной сессии');
      return (await scopedBookingsApi.requests()).data;
    },
    enabled: canReview && !!scopedBookingsApi,
  });
  const settings = pageQuery.data;
  const services: Service[] = servicesQuery.data?.data ?? [];
  const resources = resourcesQuery.data ?? [];

  const draft = useMemo<PutPublicBookingSettingsRequest | null>(() => {
    if (settingsDraft && settings)
      return {
        requestId: '',
        revision: settings.revision,
        slug: settings.slug,
        displayName: settingsDraft.displayName ?? settings.displayName,
        address: settingsDraft.address ?? settings.address,
        contacts: settingsDraft.contacts ?? settings.contacts,
        showPrices: settingsDraft.showPrices ?? settings.showPrices,
        mode: settingsDraft.mode ?? settings.mode,
        slotStepMinutes: settingsDraft.slotStepMinutes ?? settings.slotStepMinutes,
        openingHours: settingsDraft.openingHours ?? settings.openingHours,
        operator: settingsDraft.operator ?? settings.operator,
        policyText: settingsDraft.policyText ?? settings.policyText,
        consentText: settingsDraft.consentText ?? settings.consentText,
        services: settingsDraft.services ?? settings.services,
        resourceIds: settingsDraft.resourceIds ?? settings.resourceIds,
      };
    if (settings)
      return {
        requestId: '',
        revision: settings.revision,
        slug: settings.slug,
        displayName: settings.displayName,
        address: settings.address,
        contacts: settings.contacts,
        showPrices: settings.showPrices,
        mode: settings.mode,
        slotStepMinutes: settings.slotStepMinutes,
        openingHours: settings.openingHours,
        operator: settings.operator,
        policyText: settings.policyText,
        consentText: settings.consentText,
        services: settings.services,
        resourceIds: settings.resourceIds,
      };
    if (!settings && settingsDraft && newSlug.trim())
      return {
        requestId: '',
        revision: 0,
        slug: newSlug.trim(),
        displayName: settingsDraft.displayName ?? '',
        address: settingsDraft.address ?? '',
        contacts: settingsDraft.contacts ?? '',
        showPrices: settingsDraft.showPrices ?? false,
        mode: settingsDraft.mode ?? 'approval',
        slotStepMinutes: settingsDraft.slotStepMinutes ?? 15,
        openingHours: settingsDraft.openingHours,
        operator: settingsDraft.operator ?? { name: '', requisites: '', contact: '' },
        policyText: settingsDraft.policyText ?? '',
        consentText: settingsDraft.consentText ?? '',
        services: settingsDraft.services ?? [],
        resourceIds: settingsDraft.resourceIds ?? [],
      };
    return null;
  }, [newSlug, settings, settingsDraft]);

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
    const current = settingsDraft?.openingHours ?? settings?.openingHours ?? {};
    putDraft({ openingHours: { ...current, [day]: hours } });
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6 lg:p-9">
      <PageHeader title="Онлайн-запись" subtitle="Настройте публичную страницу и разберите заявки клиентов." />
      {canManage && (
        <Card>
          <CardHeader title="Публичная страница" subtitle="Ссылка на запись доступна клиентам без входа в Autexa." />
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
                {!settings && (
                  <Field label="Короткая ссылка slug">
                    <Input
                      value={newSlug}
                      onChange={(event) =>
                        setNewSlug(
                          event.target.value
                            .toLowerCase()
                            .replace(/[^a-z0-9-]/g, '')
                            .slice(0, 80),
                        )
                      }
                      maxLength={80}
                      placeholder="например, garage-center"
                    />
                    <span className="mt-1 block text-xs text-slate-500">
                      После сохранения адрес страницы нельзя будет изменить.
                    </span>
                  </Field>
                )}
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="Название сервиса">
                    <Input
                      value={draft?.displayName ?? settings?.displayName ?? ''}
                      onChange={(event) => putDraft({ displayName: event.target.value })}
                      maxLength={160}
                    />
                  </Field>
                  <Field label="Публичная ссылка">
                    <Input
                      value={
                        settings?.slug
                          ? `${window.location.origin}/book/${settings.slug}`
                          : 'Ссылка появится после первого сохранения'
                      }
                      readOnly
                    />
                  </Field>
                  <Field label="Адрес">
                    <Input
                      value={draft?.address ?? settings?.address ?? ''}
                      onChange={(event) => putDraft({ address: event.target.value })}
                      maxLength={300}
                    />
                  </Field>
                  <Field label="Контакты">
                    <Input
                      value={draft?.contacts ?? settings?.contacts ?? ''}
                      onChange={(event) => putDraft({ contacts: event.target.value })}
                      maxLength={300}
                    />
                  </Field>
                  <Field label="Исполнитель">
                    <Input
                      value={draft?.operator.name ?? settings?.operator.name ?? ''}
                      onChange={(event) =>
                        putDraft({
                          operator: {
                            ...(draft?.operator ?? settings?.operator ?? { name: '', requisites: '', contact: '' }),
                            name: event.target.value,
                          },
                        })
                      }
                      maxLength={160}
                    />
                  </Field>
                  <Field label="Реквизиты">
                    <Input
                      value={draft?.operator.requisites ?? settings?.operator.requisites ?? ''}
                      onChange={(event) =>
                        putDraft({
                          operator: {
                            ...(draft?.operator ?? settings?.operator ?? { name: '', requisites: '', contact: '' }),
                            requisites: event.target.value,
                          },
                        })
                      }
                      maxLength={500}
                    />
                  </Field>
                  <Field label="Контакт исполнителя">
                    <Input
                      value={draft?.operator.contact ?? settings?.operator.contact ?? ''}
                      onChange={(event) =>
                        putDraft({
                          operator: {
                            ...(draft?.operator ?? settings?.operator ?? { name: '', requisites: '', contact: '' }),
                            contact: event.target.value,
                          },
                        })
                      }
                      maxLength={160}
                    />
                  </Field>
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
                  <Field label="Текст политики">
                    <Textarea
                      value={draft?.policyText ?? settings?.policyText ?? ''}
                      onChange={(event) => putDraft({ policyText: event.target.value })}
                      rows={4}
                    />
                  </Field>
                  <Field label="Текст согласия">
                    <Textarea
                      value={draft?.consentText ?? settings?.consentText ?? ''}
                      onChange={(event) => putDraft({ consentText: event.target.value })}
                      rows={4}
                    />
                  </Field>
                </div>
                <div className="mt-5 grid gap-5 md:grid-cols-2">
                  <fieldset>
                    <legend className="mb-2 font-semibold">Услуги и длительность</legend>
                    {servicesQuery.isError ? (
                      <button className="text-blue-700 underline" onClick={() => void servicesQuery.refetch()}>
                        Не удалось загрузить услуги · Повторить
                      </button>
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
                            <span className="min-w-0 flex-1">{service.name}</span>
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
                    {resourcesQuery.isError ? (
                      <button className="text-blue-700 underline" onClick={() => void resourcesQuery.refetch()}>
                        Не удалось загрузить сотрудников · Повторить
                      </button>
                    ) : (
                      resources.map((resource) => (
                        <label key={resource.id} className="flex items-center gap-3 border-t py-2 text-sm">
                          <input
                            type="checkbox"
                            checked={(draft?.resourceIds ?? settings?.resourceIds ?? []).includes(resource.id)}
                            onChange={(event) => toggleResource(resource.id, event.target.checked)}
                          />
                          <span>{resource.name}</span>
                          <span className="ml-auto text-slate-500">{resource.role}</span>
                        </label>
                      ))
                    )}
                  </fieldset>
                </div>
                <fieldset className="mt-6">
                  <legend className="mb-2 font-semibold">Рабочие часы</legend>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'].map(
                      (label, index) => {
                        const day = String(index);
                        const hours = (draft?.openingHours ?? settings?.openingHours ?? {})[day] ?? null;
                        return (
                          <div key={day} className="flex items-center gap-3 rounded-lg border border-slate-200 p-3">
                            <label className="flex min-w-32 items-center gap-2 text-sm">
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
                                  className="rounded border px-2 py-1"
                                />
                                <span>—</span>
                                <input
                                  aria-label={`${label}: окончание`}
                                  type="time"
                                  value={hours.end}
                                  onChange={(event) => setDayHours(day, { ...hours, end: event.target.value })}
                                  className="rounded border px-2 py-1"
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
                <div className="mt-6 flex flex-wrap gap-3">
                  <Button
                    disabled={!draft || save.isPending || !canManage}
                    onClick={() => {
                      if (draft) save.mutate({ ...draft, requestId: operationId() });
                    }}
                  >
                    Сохранить настройки
                  </Button>
                  {settings?.published && (
                    <Button variant="secondary" disabled={publish.isPending} onClick={() => publish.mutate(true)}>
                      Снять с публикации
                    </Button>
                  )}
                  {settings && !settings.published && (
                    <Button variant="secondary" disabled={publish.isPending} onClick={() => publish.mutate(false)}>
                      Опубликовать
                    </Button>
                  )}
                  {settings?.slug && (
                    <button
                      className="rounded-lg border px-4 py-2 text-sm font-semibold"
                      onClick={() => {
                        const value = `${window.location.origin}/book/${settings.slug}`;
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

      {canReview && (
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
