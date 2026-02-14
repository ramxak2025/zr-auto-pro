import { useAuth } from '../contexts/AuthContext';
import {
  CalendarClock,
  Users,
  CreditCard,
  MessageCircle,
} from 'lucide-react';

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function getSubscriptionStatus(subscriptionEnd?: string | null): {
  label: string;
  color: string;
  bg: string;
  borderColor: string;
} {
  if (!subscriptionEnd) {
    return { label: 'Бессрочно', color: 'text-blue-700', bg: 'bg-blue-50', borderColor: 'border-blue-200' };
  }
  const end = new Date(subscriptionEnd);
  const now = new Date();
  const daysLeft = Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  if (daysLeft < 0) {
    return { label: 'Истекла', color: 'text-red-700', bg: 'bg-red-50', borderColor: 'border-red-200' };
  }
  if (daysLeft <= 7) {
    return { label: `Осталось ${daysLeft} дн.`, color: 'text-orange-700', bg: 'bg-orange-50', borderColor: 'border-orange-200' };
  }
  return { label: 'Активна', color: 'text-green-700', bg: 'bg-green-50', borderColor: 'border-green-200' };
}

export default function TariffPage() {
  const { user } = useAuth();
  const tenant = user?.tenant;

  const subStatus = getSubscriptionStatus(tenant?.subscriptionEnd);

  const whatsappNumber = '89884444436';
  const whatsappLink = `https://wa.me/${whatsappNumber.replace(/^8/, '7')}`;

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900">Тариф</h1>

      {/* Subscription status card */}
      <div className={`rounded-2xl border-2 ${subStatus.borderColor} ${subStatus.bg} p-6`}>
        <div className="flex items-center gap-3 mb-4">
          <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${subStatus.bg}`}>
            <CalendarClock className={`h-6 w-6 ${subStatus.color}`} />
          </div>
          <div>
            <p className="text-sm text-gray-500">Статус подписки</p>
            <p className={`text-lg font-bold ${subStatus.color}`}>{subStatus.label}</p>
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between rounded-xl bg-white/80 px-4 py-3">
            <div className="flex items-center gap-2.5">
              <CalendarClock className="h-5 w-5 text-gray-400" />
              <span className="text-sm text-gray-600">Оплачено до</span>
            </div>
            <span className="text-sm font-semibold text-gray-900">
              {tenant?.subscriptionEnd ? formatDate(tenant.subscriptionEnd) : 'Бессрочно'}
            </span>
          </div>

          <div className="flex items-center justify-between rounded-xl bg-white/80 px-4 py-3">
            <div className="flex items-center gap-2.5">
              <Users className="h-5 w-5 text-gray-400" />
              <span className="text-sm text-gray-600">Количество сотрудников</span>
            </div>
            <span className="text-sm font-semibold text-gray-900">
              до {tenant?.maxUsers || 0} чел.
            </span>
          </div>

          <div className="flex items-center justify-between rounded-xl bg-white/80 px-4 py-3">
            <div className="flex items-center gap-2.5">
              <CreditCard className="h-5 w-5 text-gray-400" />
              <span className="text-sm text-gray-600">Стоимость</span>
            </div>
            <span className="text-sm font-semibold text-gray-900">
              По тарифу
            </span>
          </div>
        </div>
      </div>

      {/* Payment info */}
      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-3 mb-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-green-50">
            <MessageCircle className="h-6 w-6 text-green-600" />
          </div>
          <div>
            <p className="text-base font-semibold text-gray-900">Оплата тарифа</p>
            <p className="text-sm text-gray-500">Свяжитесь с нами для оплаты или продления</p>
          </div>
        </div>

        <p className="text-sm text-gray-600 mb-4">
          Для оплаты тарифа или по любым вопросам пишите нам в WhatsApp:
        </p>

        <a
          href={whatsappLink}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-3 w-full rounded-xl bg-green-500 px-6 py-3.5 text-base font-semibold text-white shadow-lg shadow-green-500/25 hover:bg-green-600 active:scale-[0.98] transition-all"
        >
          <MessageCircle className="h-5 w-5" />
          Написать в WhatsApp
        </a>

        <p className="text-center text-xs text-gray-400 mt-3">
          +7 (988) 444-44-36
        </p>
      </div>
    </div>
  );
}
