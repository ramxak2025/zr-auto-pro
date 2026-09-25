import { useQuery } from '@tanstack/react-query';
import { CalendarDays, Check, CreditCard, Info, MessageCircle, Users, X } from 'lucide-react';
import { format, isPast, parseISO } from 'date-fns';
import { ru } from 'date-fns/locale';

import { subscriptionApi } from '../api/services';
import type { SubscriptionInfo } from '../types';
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  Money,
  PageHeader,
  QueryState,
  SkeletonCard,
  buttonClasses,
  cn,
} from '../ui';
import { MiniStat } from '../components/dashboard/shared';
// Возможности тарифа сгруппированы (core / section / integration), чтобы каждая
// карточка тарифа перечисляла 23 ключа под заголовками разделов.
import { FEATURE_GROUPS } from '../utils/featureGroups';
import { getWhatsAppChatUrl } from '../config/contacts';

export default function TariffPage() {
  // В слоте ['subscription'] лежит САМ объект подписки — так его пишут оболочка,
  // FeatureGate и App. Раньше страница клала сюда ответ axios и читала `.data`
  // через select: если слот уже был прогрет оболочкой, страница показывала
  // «Тариф не назначен» при живой подписке.
  const {
    data: sub,
    isLoading,
    isError,
    refetch,
    isFetching,
  } = useQuery<SubscriptionInfo>({
    queryKey: ['subscription'],
    queryFn: async () => (await subscriptionApi.get()).data,
  });

  const subscriptionEnd = sub?.subscriptionEnd ? parseISO(sub.subscriptionEnd) : null;
  const isExpired = subscriptionEnd ? isPast(subscriptionEnd) : false;

  const whatsappUrl = getWhatsAppChatUrl('Здравствуйте! Хочу оплатить подписку.');

  return (
    <div className="space-y-5">
      <PageHeader
        title="Тариф и подписка"
        icon={CreditCard}
        subtitle="Ваш тариф, срок оплаты и доступные возможности"
      />

      <QueryState
        isLoading={isLoading}
        isError={isError}
        onRetry={refetch}
        isFetching={isFetching}
        loader={
          <div className="max-w-3xl space-y-5">
            <SkeletonCard lines={3} />
          </div>
        }
        minHeight="min-h-[40vh]"
        errorTitle="Не удалось загрузить подписку"
      >
        <div className="space-y-6">
          {/* Текущая подписка */}
          <Card padding="none" className="max-w-3xl">
            <CardHeader
              icon={CreditCard}
              title={sub?.tenantName || 'Ваша организация'}
              subtitle={sub?.planName ? `Тариф: ${sub.planName}` : 'Тариф не назначен'}
              actions={
                sub?.status && sub.status !== 'active' ? (
                  <Badge tone={sub.status === 'suspended' ? 'bad' : 'warn'} dot>
                    {sub.status === 'suspended' ? 'Приостановлена' : 'Истекла'}
                  </Badge>
                ) : isExpired ? (
                  <Badge tone="bad" dot>
                    Истекла
                  </Badge>
                ) : subscriptionEnd ? (
                  <Badge tone="ok" dot>
                    Активна
                  </Badge>
                ) : undefined
              }
            />
            <CardBody className="space-y-5">
              <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-3">
                <MiniStat
                  label={
                    <span className="inline-flex items-center gap-1">
                      <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
                      Оплачено до
                    </span>
                  }
                  value={subscriptionEnd ? format(subscriptionEnd, 'd MMMM yyyy', { locale: ru }) : 'Не указано'}
                  tone={isExpired ? 'bad' : 'neutral'}
                />
                <MiniStat
                  label="Стоимость тарифа"
                  value={sub?.monthlyPrice ? <Money value={sub.monthlyPrice} /> : 'Не указано'}
                  hint={sub?.monthlyPrice ? 'в месяц' : undefined}
                />
                {sub && (
                  <MiniStat
                    label={
                      <span className="inline-flex items-center gap-1">
                        <Users className="h-3.5 w-3.5" aria-hidden="true" />
                        Сотрудников
                      </span>
                    }
                    value={`${sub.currentUsers} / ${sub.maxUsers}`}
                    tone={sub.currentUsers >= sub.maxUsers ? 'warn' : 'neutral'}
                  />
                )}
              </div>

              {sub?.subscriptionNote && (
                <div className="flex items-start gap-2.5 rounded-lg border border-info/20 bg-info-soft px-4 py-3">
                  <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-info" aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-info-text">Примечание</p>
                    <p className="mt-0.5 text-sm text-info-text">{sub.subscriptionNote}</p>
                  </div>
                </div>
              )}

              <a
                href={whatsappUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonClasses({ variant: 'primary', className: 'w-full sm:w-auto' })}
              >
                <MessageCircle className="h-4 w-4" aria-hidden="true" />
                Связаться для оплаты (WhatsApp)
              </a>
            </CardBody>
          </Card>

          {/* Доступные тарифы */}
          {sub?.plans && sub.plans.length > 0 && (
            <section aria-labelledby="tariff-plans" className="space-y-3">
              <h2 id="tariff-plans" className="text-md font-semibold text-ink">
                Доступные тарифы
              </h2>
              <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
                {sub.plans.map((plan) => {
                  const isCurrent = sub.planId ? sub.planId === plan.id : sub.planName === plan.name;
                  const features: string[] = Array.isArray(plan.features) ? plan.features : [];

                  return (
                    <Card
                      key={plan.id}
                      as="article"
                      padding="none"
                      aria-label={`Тариф ${plan.name}`}
                      className={cn('flex flex-col', isCurrent && 'border-accent/50 ring-1 ring-accent/30')}
                    >
                      <div className="px-5 pt-5">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <h3 className="text-md font-semibold text-ink">{plan.name}</h3>
                            {plan.description && <p className="mt-1 text-sm text-ink-3">{plan.description}</p>}
                          </div>
                          {isCurrent && (
                            <Badge tone="accent" icon={Check}>
                              Ваш тариф
                            </Badge>
                          )}
                        </div>

                        <p className="mt-4 flex items-baseline gap-1">
                          <Money value={plan.monthlyPrice} className="text-2xl font-semibold tracking-tight text-ink" />
                          <span className="text-sm text-ink-3">/ мес</span>
                        </p>

                        <p className="mt-3 flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-2 text-sm text-ink-2">
                          <Users className="h-4 w-4 flex-shrink-0 text-ink-3" aria-hidden="true" />
                          До {plan.maxUsers} сотрудников
                        </p>
                      </div>

                      <div className="flex-1 space-y-4 px-5 py-4">
                        {FEATURE_GROUPS.map((grp) => (
                          <div key={grp.group}>
                            <p className="mb-1.5 text-xs font-semibold text-ink-3">{grp.label}</p>
                            <ul className="space-y-1.5">
                              {grp.items.map((feat) => {
                                const included = features.includes(feat.key);
                                return (
                                  <li key={feat.key} className="flex items-center gap-2 text-sm">
                                    {included ? (
                                      <Check className="h-4 w-4 flex-shrink-0 text-ok" aria-hidden="true" />
                                    ) : (
                                      <X className="h-4 w-4 flex-shrink-0 text-ink-4" aria-hidden="true" />
                                    )}
                                    <span className={included ? 'text-ink-2' : 'text-ink-3 line-through'}>
                                      {feat.label}
                                    </span>
                                    <span className="sr-only">{included ? ' — входит' : ' — не входит'}</span>
                                  </li>
                                );
                              })}
                            </ul>
                          </div>
                        ))}
                      </div>

                      {!isCurrent && (
                        <div className="border-t border-line px-5 py-4">
                          <a
                            href={whatsappUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={buttonClasses({ variant: 'secondary', fullWidth: true })}
                          >
                            <MessageCircle className="h-4 w-4" aria-hidden="true" />
                            Подключить «{plan.name}»
                          </a>
                        </div>
                      )}
                    </Card>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      </QueryState>
    </div>
  );
}
