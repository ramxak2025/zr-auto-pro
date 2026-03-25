import { ShieldX, MessageCircle, LogOut } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

// WhatsApp number for payment inquiries (change this to your number)
const WHATSAPP_NUMBER = '79884444436';

export default function SubscriptionBlockedPage() {
  const { user, logout } = useAuth();

  const tenantName = user?.tenant?.name || 'Автосервис';
  const endDate = user?.tenant?.subscriptionEnd
    ? new Date(user.tenant.subscriptionEnd).toLocaleDateString('ru-RU', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : null;

  const whatsappUrl = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(
    `Здравствуйте! Хочу оплатить тариф для "${tenantName}".`
  )}`;

  return (
    <div className="min-h-screen min-h-[100dvh] bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center p-4 pt-[env(safe-area-inset-top,0px)] pb-[env(safe-area-inset-bottom,0px)]">
      <div className="w-full max-w-sm">
        <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-8 text-center">
          {/* Icon */}
          <div className="w-16 h-16 mx-auto mb-5 bg-red-50 rounded-2xl flex items-center justify-center">
            <ShieldX className="w-8 h-8 text-red-500" />
          </div>

          {/* Title */}
          <h1 className="text-xl font-bold text-gray-900 mb-2">
            Доступ заблокирован
          </h1>

          {/* Description */}
          <p className="text-sm text-gray-500 mb-1">
            Подписка для <span className="font-medium text-gray-700">{tenantName}</span> истекла
            {endDate && <span className="text-gray-400"> {endDate}</span>}
          </p>
          <p className="text-sm text-gray-500 mb-6">
            Оплатите тариф для восстановления доступа
          </p>

          {/* WhatsApp button */}
          <a
            href={whatsappUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 w-full py-3 px-4 bg-[#25D366] hover:bg-[#20bd5a] text-white font-semibold rounded-xl transition-colors mb-3"
          >
            <MessageCircle className="w-5 h-5" />
            Написать в WhatsApp
          </a>

          {/* Logout */}
          <button
            onClick={logout}
            className="flex items-center justify-center gap-2 w-full py-2.5 px-4 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-50 rounded-xl transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Выйти из аккаунта
          </button>
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-gray-400 mt-6">
          Autexa v1.7 &copy; 2026
        </p>
      </div>
    </div>
  );
}
