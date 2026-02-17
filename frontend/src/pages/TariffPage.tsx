import { CreditCard, CalendarDays, Info } from 'lucide-react';
import { format, parseISO, isPast } from 'date-fns';
import { ru } from 'date-fns/locale';

import { useAuth } from '../contexts/AuthContext';

export default function TariffPage() {
  const { user } = useAuth();
  const tenant = user?.tenant;

  const subscriptionEnd = tenant?.subscriptionEnd
    ? parseISO(tenant.subscriptionEnd)
    : null;

  const isExpired = subscriptionEnd ? isPast(subscriptionEnd) : false;

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Тариф и подписка</h1>
      </div>

      <div className="max-w-lg">
        <div className="card">
          <div className="card-body space-y-5">
            {/* Icon + Title */}
            <div className="flex items-center gap-3">
              <div className="p-3 bg-primary-50 rounded-xl">
                <CreditCard className="w-7 h-7 text-primary-600" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-gray-900">
                  {tenant?.name || 'Ваша организация'}
                </h2>
                <p className="text-sm text-gray-500">Информация о подписке</p>
              </div>
            </div>

            {/* Subscription End */}
            <div className="flex items-start gap-3 p-4 bg-gray-50 rounded-lg">
              <CalendarDays className="w-5 h-5 text-gray-400 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-gray-700">Подписка действует до</p>
                {subscriptionEnd ? (
                  <p className={`text-lg font-semibold mt-0.5 ${isExpired ? 'text-red-600' : 'text-gray-900'}`}>
                    {format(subscriptionEnd, 'd MMMM yyyy', { locale: ru })}
                    {isExpired && (
                      <span className="badge-red ml-2">Истекла</span>
                    )}
                  </p>
                ) : (
                  <p className="text-lg font-semibold text-gray-500 mt-0.5">Не указано</p>
                )}
              </div>
            </div>

            {/* Note from admin */}
            {tenant?.subscriptionNote && (
              <div className="flex items-start gap-3 p-4 bg-blue-50 rounded-lg">
                <Info className="w-5 h-5 text-blue-500 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium text-blue-700">Примечание</p>
                  <p className="text-sm text-blue-600 mt-0.5">{tenant.subscriptionNote}</p>
                </div>
              </div>
            )}

            {/* Max Users */}
            {tenant && (
              <div className="flex items-center justify-between py-3 border-t border-gray-100">
                <span className="text-sm text-gray-500">Максимум пользователей</span>
                <span className="text-sm font-semibold text-gray-900">{tenant.maxUsers}</span>
              </div>
            )}

            {/* Contact prompt */}
            <div className="p-4 bg-yellow-50 rounded-lg border border-yellow-100">
              <p className="text-sm text-yellow-800 font-medium">
                Свяжитесь с администратором для продления подписки
              </p>
              <p className="text-xs text-yellow-600 mt-1">
                Для продления или изменения тарифа обратитесь к администратору платформы.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
