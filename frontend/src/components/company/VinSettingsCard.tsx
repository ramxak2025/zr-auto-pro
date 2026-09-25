import { useId, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Car, ExternalLink, KeyRound, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';

import { vinApi } from '../../api/services';
import { useAuth } from '../../contexts/AuthContext';
import type { Tenant, UpdateVinSettingsRequest, VinDecodeResult, VinDecodeSource, VinSettings } from '../../types';
import { apiErrorMessage } from '../../../../shared/utils/apiError';
import { VIN_LENGTH, formatVin, isValidVin, normalizeVin } from '../../../../shared/utils/vin';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { Card, CardBody, CardHeader } from '../../ui/Card';
import { Field } from '../../ui/Field';
import { Input } from '../../ui/Input';
import { RadioGroup } from '../../ui/RadioGroup';
import { SkeletonCard } from '../../ui/Skeleton';
import { cn } from '../../ui/cn';
import { focusRing } from '../../ui/tokens';
import ConfirmDialog from '../ConfirmDialog';
import { ErrorRow } from '../dashboard/shared';
import ToggleRow from './ToggleRow';

/** Слот настроек VIN — тот же ключ, что у мобильного клиента (mobile/src/hooks/useVinEnabled.ts). */
export const VIN_SETTINGS_KEY = ['vin-settings'] as const;

/** Значение радиокнопки «Бесплатные справочники» (provider: null). */
const FREE_SOURCE = '__free__';

/** Источник расшифровки словами — спека, раздел 4 п. 1. */
export const VIN_SOURCE_LABELS: Record<VinDecodeSource, string> = {
  paid: 'платный сервис',
  nhtsa: 'справочник NHTSA',
  wmi: 'справочник производителей',
  none: 'не определён',
};

/** «Lada · 2019», «Kia Rio · 2015», «Не определено». */
function decodeSummary(result: VinDecodeResult): string {
  const parts = [result.makeModel, result.year ? String(result.year) : null].filter(Boolean);
  return parts.join(' · ') || 'Не определено';
}

/**
 * «Автомобили → VIN-код автомобиля» (171, 2026-09-25) — блок настроек компании.
 *
 * Читает GET /vin/settings и сохраняет PATCH /vin/settings по каждому действию
 * отдельно (как режим кассовой смены), без общей кнопки «Сохранить»:
 *   • переключатель «VIN-код автомобиля» — сразу, оптимистично;
 *   • «Источник данных» — бесплатные справочники (provider: null) либо один из
 *     provider'ов, которых отдаёт сервер (клиент их не хардкодит);
 *   • учётные данные провайдера — секреты полем пароля, сервер значения не
 *     возвращает: после сохранения «Ключ сохранён · Заменить · Удалить»;
 *   • «Проверить на VIN…» — POST /vin/decode с введённым VIN, результат и источник.
 *
 * КАК ОБНОВЛЯЕТСЯ ФЛАГ В СЕССИИ. useVinEnabled() читает сначала кэш
 * ['my-company'] (если он прогрет), затем user.tenant.vinEnabled. После
 * успешного PATCH мы (1) пишем новый флаг прямо в ['my-company'] — поле VIN в
 * карточках авто и режим поиска в Кассе переключаются в тот же кадр, (2)
 * инвалидируем ['my-company'] и (3) перечитываем профиль через
 * AuthContext.refreshUser() (GET /auth/me) — так флаг обновляется и у тех
 * экранов, где кэша компании нет. Перелогин не нужен.
 */
export default function VinSettingsCard() {
  const queryClient = useQueryClient();
  const { refreshUser } = useAuth();
  const idBase = useId();

  const settingsQuery = useQuery<VinSettings>({
    queryKey: VIN_SETTINGS_KEY,
    queryFn: async () => (await vinApi.getSettings()).data,
    staleTime: 60_000,
  });
  const settings = settingsQuery.data;

  // Черновик учётных данных провайдера — живёт только до «Сохранить ключ».
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [replacing, setReplacing] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  // «Проверить на VIN…»
  const [testVin, setTestVin] = useState('');

  const mutation = useMutation({
    mutationFn: (data: UpdateVinSettingsRequest) => vinApi.updateSettings(data),
    // Оптимистично — переключатель и выбор источника: они должны щёлкать
    // мгновенно. Учётные данные ждут ответа сервера: hasCredentials решает он.
    onMutate: async (next) => {
      const optimisticToggle = typeof next.enabled === 'boolean';
      const optimisticProvider = 'provider' in next && next.credentials === undefined;
      if (!optimisticToggle && !optimisticProvider) return { prev: undefined as VinSettings | undefined };
      await queryClient.cancelQueries({ queryKey: VIN_SETTINGS_KEY });
      const prev = queryClient.getQueryData<VinSettings>(VIN_SETTINGS_KEY);
      if (prev) {
        const nextProvider = next.provider ?? null;
        queryClient.setQueryData<VinSettings>(VIN_SETTINGS_KEY, {
          ...prev,
          ...(optimisticToggle ? { enabled: next.enabled as boolean } : null),
          ...(optimisticProvider
            ? {
                provider: nextProvider,
                // Смена провайдера без новых данных сбрасывает старые ключи — как на сервере.
                hasCredentials: nextProvider === prev.provider ? prev.hasCredentials : false,
              }
            : null),
        });
      }
      return { prev };
    },
    onSuccess: (res, vars) => {
      const fresh = res.data;
      queryClient.setQueryData(VIN_SETTINGS_KEY, fresh);
      // Флаг в сессии: кэш компании (его читает useVinEnabled) + профиль.
      queryClient.setQueryData<Tenant>(['my-company'], (prev) =>
        prev ? { ...prev, vinEnabled: fresh.enabled } : prev,
      );
      void queryClient.invalidateQueries({ queryKey: ['my-company'] });
      void refreshUser();
      setReplacing(false);
      setCredentials({});
      if (typeof vars.enabled === 'boolean') {
        toast.success(vars.enabled ? 'VIN-код автомобиля включён' : 'VIN-код автомобиля выключен');
      } else if (vars.credentials === null) {
        toast.success('Ключ удалён — расшифровка идёт по бесплатным справочникам');
      } else if (vars.credentials) {
        toast.success('Ключ сохранён');
      } else if ('provider' in vars) {
        toast.success(vars.provider ? 'Источник данных изменён' : 'Источник: бесплатные справочники');
      }
    },
    onError: (err: unknown, _vars, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(VIN_SETTINGS_KEY, ctx.prev);
      toast.error(apiErrorMessage(err) ?? 'Не удалось сохранить настройки VIN');
    },
  });

  const decodeMutation = useMutation({
    mutationFn: (vin: string) => vinApi.decode(vin),
  });

  const enabled = settings?.enabled === true;
  const providers = settings?.providers ?? [];
  const provider = providers.find((p) => p.id === settings?.provider) ?? null;
  const busy = mutation.isPending;

  const selectSource = (value: string) => {
    const id = value === FREE_SOURCE ? null : value;
    if ((settings?.provider ?? null) === id) return;
    setCredentials({});
    setReplacing(false);
    mutation.mutate({ provider: id });
  };

  const saveCredentials = () => {
    if (!provider) return;
    const filled: Record<string, string> = {};
    for (const f of provider.fields) filled[f.key] = (credentials[f.key] ?? '').trim();
    if (provider.fields.some((f) => !filled[f.key])) {
      toast.error(`Заполните все поля — для сервиса «${provider.name}» нужны все учётные данные`);
      return;
    }
    mutation.mutate({ provider: provider.id, credentials: filled });
  };

  const runTest = () => {
    if (!isValidVin(testVin) || decodeMutation.isPending) return;
    decodeMutation.mutate(testVin);
  };

  const testResult = decodeMutation.data?.data ?? null;
  const testError = decodeMutation.isError ? (apiErrorMessage(decodeMutation.error) ?? 'Не удалось проверить') : null;
  const showCredentialFields = !!provider && (!settings?.hasCredentials || replacing);

  if (settingsQuery.isLoading && !settings) return <SkeletonCard lines={3} />;

  return (
    <Card padding="none">
      <CardHeader icon={Car} title="Автомобили" subtitle="VIN-код и автоматическое определение марки и модели" />
      <CardBody className="space-y-5">
        {settingsQuery.isError && !settings ? (
          <ErrorRow
            message="Не удалось загрузить настройки VIN"
            onRetry={() => settingsQuery.refetch()}
            loading={settingsQuery.isFetching}
          />
        ) : (
          <>
            <ToggleRow
              label="VIN-код автомобиля"
              description="Поле VIN у машины, автоматическое определение марки и модели, поиск клиента по VIN."
              checked={enabled}
              onChange={(v) => mutation.mutate({ enabled: v })}
              disabled={busy}
            />

            {enabled ? (
              <>
                {/* Источник данных */}
                <div className="border-t border-line pt-5">
                  <RadioGroup
                    label="Источник данных"
                    value={provider?.id ?? FREE_SOURCE}
                    onChange={selectSource}
                    disabled={busy}
                    options={[
                      {
                        value: FREE_SOURCE,
                        label: 'Бесплатные справочники',
                        description:
                          'Справочник NHTSA и таблица производителей: марка, часто модель и год. Без ключа и оплаты.',
                      },
                      ...providers.map((p) => ({
                        value: p.id,
                        label: p.name,
                        description: p.description || 'Платный сервис: ключ вашего аккаунта, оплата за запросы.',
                      })),
                    ]}
                  />
                </div>

                {/* Учётные данные провайдера */}
                {provider ? (
                  <div className="space-y-3 rounded-lg border border-line bg-surface-2 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <KeyRound className="h-4 w-4 text-ink-3" aria-hidden="true" />
                      <span className="text-sm font-medium text-ink">Доступ к {provider.name}</span>
                      {settings?.hasCredentials ? (
                        <Badge tone="ok" dot>
                          Ключ сохранён
                        </Badge>
                      ) : (
                        <Badge tone="warn" dot>
                          Ключ не задан
                        </Badge>
                      )}
                    </div>

                    {showCredentialFields ? (
                      <div className="space-y-3">
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          {provider.fields.map((f) => {
                            const fieldId = `${idBase}-${f.key}`;
                            return (
                              <Field key={f.key} label={f.label} htmlFor={fieldId}>
                                <Input
                                  id={fieldId}
                                  type={f.secret ? 'password' : 'text'}
                                  autoComplete={f.secret ? 'new-password' : 'off'}
                                  spellCheck={false}
                                  value={credentials[f.key] ?? ''}
                                  onChange={(e) => setCredentials((prev) => ({ ...prev, [f.key]: e.target.value }))}
                                  placeholder={f.placeholder}
                                  disabled={busy}
                                />
                              </Field>
                            );
                          })}
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Button size="sm" onClick={saveCredentials} loading={busy}>
                            Сохранить ключ
                          </Button>
                          {replacing && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setReplacing(false);
                                setCredentials({});
                              }}
                              disabled={busy}
                            >
                              Отмена
                            </Button>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center gap-x-1 gap-y-1 text-sm text-ink-2">
                        <span>Значение не показывается.</span>
                        <Button size="sm" variant="ghost" onClick={() => setReplacing(true)} disabled={busy}>
                          Заменить
                        </Button>
                        <span className="text-ink-4" aria-hidden="true">
                          ·
                        </span>
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={Trash2}
                          onClick={() => setConfirmRemove(true)}
                          disabled={busy}
                          className="text-bad-text hover:text-bad-text"
                        >
                          Удалить
                        </Button>
                      </div>
                    )}

                    {provider.site && (
                      <a
                        href={provider.site}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={cn(
                          'inline-flex items-center gap-1 rounded text-sm font-medium text-accent hover:underline',
                          focusRing,
                        )}
                      >
                        Где получить ключ
                        <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                      </a>
                    )}
                  </div>
                ) : null}

                {/* Проверка расшифровки */}
                <div className="border-t border-line pt-5">
                  <Field
                    label="Проверить на VIN…"
                    htmlFor={`${idBase}-test`}
                    hint={`${testVin.length}/${VIN_LENGTH} · латиница и цифры без I, O, Q; кириллица заменяется автоматически`}
                  >
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <Input
                        id={`${idBase}-test`}
                        value={testVin}
                        onChange={(e) => {
                          setTestVin(normalizeVin(e.target.value).slice(0, VIN_LENGTH));
                          if (decodeMutation.data || decodeMutation.isError) decodeMutation.reset();
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            runTest();
                          }
                        }}
                        placeholder="XTA219010K0123456"
                        autoComplete="off"
                        spellCheck={false}
                        maxLength={VIN_LENGTH}
                        className="font-mono uppercase tracking-wider sm:max-w-xs"
                      />
                      <Button
                        variant="secondary"
                        onClick={runTest}
                        disabled={!isValidVin(testVin)}
                        loading={decodeMutation.isPending}
                      >
                        Проверить
                      </Button>
                    </div>
                  </Field>

                  <div role="status" aria-live="polite" className="mt-3 empty:hidden">
                    {testError ? (
                      <ErrorRow message={testError} onRetry={runTest} loading={decodeMutation.isPending} />
                    ) : testResult ? (
                      <VinTestResult result={testResult} />
                    ) : null}
                  </div>
                </div>
              </>
            ) : (
              <p className="text-xs text-ink-3">
                Пока опция выключена, ничего связанного с VIN в интерфейсе не показывается.
              </p>
            )}
          </>
        )}
      </CardBody>

      <ConfirmDialog
        isOpen={confirmRemove}
        onClose={() => setConfirmRemove(false)}
        onConfirm={() => mutation.mutate({ credentials: null })}
        title="Удалить ключ?"
        message={`Ключ доступа к «${provider?.name ?? 'сервису'}» будет удалён. Расшифровка продолжит работать по бесплатным справочникам.`}
        confirmText="Удалить"
        variant="danger"
        loading={busy}
      />
    </Card>
  );
}

function VinTestResult({ result }: { result: VinDecodeResult }) {
  if (!result.valid) {
    return (
      <p className="rounded-lg border border-bad/20 bg-bad-soft px-3.5 py-3 text-sm text-bad-text">
        VIN некорректен — 17 символов латиницей и цифрами, без I, O и Q.
      </p>
    );
  }
  const extras = [result.bodyType, result.fuel, result.engine].filter(Boolean) as string[];
  return (
    <div className="rounded-lg border border-line bg-surface-2 px-4 py-3">
      <p className="font-mono text-xs tracking-wider text-ink-3">{formatVin(result.vin)}</p>
      <p className="mt-1 text-md font-semibold text-ink">{decodeSummary(result)}</p>
      <p className="mt-0.5 text-xs text-ink-3">
        {result.source === 'none' ? 'Марку определить не удалось' : `Источник: ${VIN_SOURCE_LABELS[result.source]}`}
        {result.make && !result.model ? ' · модель нужно дописать вручную' : ''}
      </p>
      {extras.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {extras.map((x) => (
            <Badge key={x} outline>
              {x}
            </Badge>
          ))}
        </div>
      )}
      {result.notes && result.notes.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-xs text-warn-text">
          {result.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
