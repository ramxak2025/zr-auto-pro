import { Megaphone, Sparkles, Send, Target, BarChart3, Users } from 'lucide-react';

const upcomingFeatures = [
  {
    icon: Send,
    title: 'Рассылки клиентам',
    description: 'WhatsApp и SMS напоминания о ТО и акциях',
    color: 'bg-green-50',
    iconColor: 'text-green-600',
  },
  {
    icon: Target,
    title: 'Акции и скидки',
    description: 'Создание промо-кодов и программ лояльности',
    color: 'bg-purple-50',
    iconColor: 'text-purple-600',
  },
  {
    icon: BarChart3,
    title: 'Аналитика маркетинга',
    description: 'ROI рекламных каналов и отслеживание источников',
    color: 'bg-blue-50',
    iconColor: 'text-blue-600',
  },
  {
    icon: Users,
    title: 'Сегментация клиентов',
    description: 'Группировка по частоте визитов, среднему чеку, авто',
    color: 'bg-amber-50',
    iconColor: 'text-amber-600',
  },
];

export default function MarketingPage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh] px-4">
      {/* Hero */}
      <div className="text-center mb-10">
        <div className="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-gradient-to-br from-violet-500 to-fuchsia-500 shadow-lg shadow-violet-200 mb-6">
          <Megaphone className="w-10 h-10 text-white" />
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Маркетинг</h1>
        <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-violet-50 border border-violet-200 mb-4">
          <Sparkles className="w-3.5 h-3.5 text-violet-500" />
          <span className="text-xs font-semibold text-violet-600">В разработке</span>
        </div>
        <p className="text-sm text-gray-500 max-w-sm mx-auto leading-relaxed">
          Мы работаем над инструментами для привлечения и удержания клиентов вашего автосервиса
        </p>
      </div>

      {/* Feature cards */}
      <div className="w-full max-w-lg space-y-3 mb-10">
        {upcomingFeatures.map((feature) => {
          const Icon = feature.icon;
          return (
            <div
              key={feature.title}
              className="flex items-center gap-4 bg-white rounded-2xl border border-gray-100 shadow-sm p-4 opacity-75"
            >
              <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${feature.color} flex-shrink-0`}>
                <Icon className={`h-6 w-6 ${feature.iconColor}`} />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-900">{feature.title}</p>
                <p className="text-xs text-gray-500 mt-0.5">{feature.description}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Progress indicator */}
      <div className="text-center">
        <div className="flex items-center justify-center gap-1.5 mb-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className={`h-1.5 rounded-full transition-all ${
                i < 2 ? 'w-6 bg-violet-500' : 'w-4 bg-gray-200'
              }`}
            />
          ))}
        </div>
        <p className="text-xs text-gray-400">Ожидайте в ближайших обновлениях</p>
      </div>
    </div>
  );
}
