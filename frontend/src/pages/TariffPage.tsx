import { useQuery } from '@tanstack/react-query';
import { CreditCard, CalendarDays, Info, MessageCircle, Check, X, Users } from 'lucide-react';
import { format, parseISO, isPast } from 'date-fns';
import { ru } from 'date-fns/locale';

import { subscriptionApi } from '../api/services';
import { SubscriptionInfo } from '../types';
import LoadingSpinner from '../components/LoadingSpinner';

const WHATSAPP_PHONE = '79884444436';

const ALL_FEATURES: { key: string; label: string }[] = [
  { key: 'checks_view', label: 'Заказ-наряды' },
  { key: 'clients_view', label: 'Клиенты и авто' },
  { key: 'warehouse_view', label: 'Склад' },
  { key: 'services_view', label: 'Услуги' },
  { key: 'suppliers_view', label: 'Поставщики' },
  { key: 'cashflow_view', label: 'Движение денег' },
  { key: 'salary_view', label: 'Зарплата' },
  { key: 'schedule_view', label: 'Расписание' },
  { key: 'reports_view', label: 'Отчёты' },
  { key: 'users_manage', label: 'Управление пользователями' },
  { key: 'export_data', label: 'Экспорт данных' },
];

function getFeatureLabel(key: string): string {
  const found = ALL_FEATURES.find((f) => f.key === key);
  return found ? found.label : key;
}

export default function TariffPage() {
  const { data: sub, isLoading } = useQuery({
    queryKey: ['subscription'],
    queryFn: () => subscriptionApi.get(),
    select: (res) => res.data as SubscriptionInfo,
  });

  if (isLoading) return <LoadingSpinner />;

  const subscriptionEnd = sub?.subscriptionEnd
    ? parseISO(sub.subscriptionEnd)
    : null;
  const isExpired = subscriptionEnd ? isPast(subscriptionEnd) : false;

  const whatsappUrl = `https://wa.me/${WHATSAPP_PHONE}?text=${encodeURIComponent('Здравствуйте! Хочу оплатить подписку.')}`;

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Подписка</h1>
      </div>

      <div className="max-w-3xl space-y-6">
        {/* Current subscription info */}
        <div className="card">
          <div className="card-body space-y-5">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-primary-50 rounded-xl">
                <CreditCard className="w-7 h-7 text-primary-600" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-gray-900">
                  {sub?.tenantName || 'Ваша организация'}
                </h2>
                <p className="text-sm text-gray-500">
                  {sub?.planName ? `Тариф: ${sub.planName}` : 'Тариф не назначен'}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Subscription end */}
              <div className="flex items-start gap-3 p-4 bg-gray-50 rounded-lg">
                <CalendarDays className="w-5 h-5 text-gray-400 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium text-gray-700">Оплачено до</p>
                  {subscriptionEnd ? (
                    <p className={`text-lg font-semibold mt-0.5 ${isExpired ? 'text-red-600' : 'text-gray-900'}`}>
                      {format(subscriptionEnd, 'd MMMM yyyy', { locale: ru })}
                      {isExpired && (
                        <span className="badge-red ml-2">Истекла</span>
                      )}
                    </p>
                  ) : (
                    <p className="text-lg font-semibold text-gray-400 mt-0.5">Не указано</p>
                  )}
                </div>
              </div>

              {/* Price */}
              <div className="flex items-start gap-3 p-4 bg-gray-50 rounded-lg">
                <CreditCard className="w-5 h-5 text-gray-400 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium text-gray-700">Стоимость тарифа</p>
                  <p className="text-lg font-semibold text-gray-900 mt-0.5">
                    {sub?.monthlyPrice ? `${sub.monthlyPrice.toLocaleString('ru-RU')} ₽/мес` : 'Не указано'}
                  </p>
                </div>
              </div>
            </div>

            {/* Users info */}
            {sub && (
              <div className="flex items-center justify-between py-3 border-t border-gray-100">
                <div className="flex items-center gap-2 text-sm text-gray-500">
                  <Users className="w-4 h-4" />
                  <span>Сотрудников</span>
                </div>
                <span className="text-sm font-semibold text-gray-900">
                  {sub.currentUsers} / {sub.maxUsers}
                </span>
              </div>
            )}

            {/* Note from admin */}
            {sub?.subscriptionNote && (
              <div className="flex items-start gap-3 p-4 bg-blue-50 rounded-lg">
                <Info className="w-5 h-5 text-blue-500 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium text-blue-700">Примечание</p>
                  <p className="text-sm text-blue-600 mt-0.5">{sub.subscriptionNote}</p>
                </div>
              </div>
            )}

            {/* WhatsApp button */}
            <a
              href={whatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 w-full py-3 px-4 bg-green-500 hover:bg-green-600 text-white font-medium rounded-xl transition-colors"
            >
              <MessageCircle className="w-5 h-5" />
              Связаться для оплаты (WhatsApp)
            </a>
          </div>
        </div>

        {/* Available plans */}
        {sub?.plans && sub.plans.length > 0 && (
          <div>
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Доступные тарифы</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {sub.plans.map((plan) => {
                const isCurrent = sub.planName === plan.name;
                const features: string[] = Array.isArray(plan.features) ? plan.features : [];

                return (
                  <div
                    key={plan.id}
                    className={`card relative overflow-hidden ${
                      isCurrent ? 'ring-2 ring-primary-500' : ''
                    }`}
                  >
                    {isCurrent && (
                      <div className="bg-primary-500 text-white text-xs font-medium text-center py-1">
                        Ваш тариф
                      </div>
                    )}
                    <div className="card-body space-y-4">
                      <div>
                        <h3 className="text-lg font-bold text-gray-900">{plan.name}</h3>
                        {plan.description && (
                          <p className="text-sm text-gray-500 mt-1">{plan.description}</p>
                        )}
                      </div>

                      <div>
                        <span className="text-3xl font-bold text-gray-900">
                          {plan.monthlyPrice.toLocaleString('ru-RU')}
                        </span>
                        <span className="text-gray-500 ml-1">₽/мес</span>
                      </div>

                      <div className="flex items-center gap-2 p-3 bg-primary-50 rounded-lg">
                        <Users className="w-5 h-5 text-primary-600 flex-shrink-0" />
                        <span className="text-sm font-semibold text-primary-700">
                          До {plan.maxUsers} сотрудников
                        </span>
                      </div>

                      <ul className="space-y-1.5">
                        {ALL_FEATURES.map((feat) => {
                          const included = features.includes(feat.key);
                          return (
                            <li key={feat.key} className="flex items-center gap-2 text-sm">
                              {included ? (
                                <Check className="w-4 h-4 text-green-500 flex-shrink-0" />
                              ) : (
                                <X className="w-4 h-4 text-gray-300 flex-shrink-0" />
                              )}
                              <span className={included ? 'text-gray-700' : 'text-gray-400 line-through'}>
                                {feat.label}
                              </span>
                            </li>
                          );
                        })}
                      </ul>

                      {!isCurrent && (
                        <a
                          href={whatsappUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center justify-center gap-2 w-full py-2.5 px-4 bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium rounded-lg transition-colors"
                        >
                          <MessageCircle className="w-4 h-4" />
                          Подключить
                        </a>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
