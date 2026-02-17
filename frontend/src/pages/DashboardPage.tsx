import { useQuery } from '@tanstack/react-query';
import { TrendingUp, ClipboardList, DollarSign, BarChart3, Trophy, Crown } from 'lucide-react';
import { checksApi } from '../api/services';
import LoadingSpinner from '../components/LoadingSpinner';
import type { DashboardStats, EmployeeRanking } from '../types';

const formatCurrency = (value: number): string => {
  return value.toLocaleString('ru-RU') + ' \u20B8';
};

export default function DashboardPage() {
  const { data: dashboardData, isLoading: dashLoading } = useQuery<DashboardStats>({
    queryKey: ['dashboard'],
    queryFn: async () => {
      const res = await checksApi.getDashboard();
      return res.data;
    },
  });

  const { data: rankingData, isLoading: rankLoading } = useQuery<EmployeeRanking>({
    queryKey: ['ranking'],
    queryFn: async () => {
      const res = await checksApi.getRanking();
      return res.data;
    },
  });

  if (dashLoading || rankLoading) {
    return <LoadingSpinner />;
  }

  const stats = dashboardData;
  const ranking = rankingData;

  const statCards = [
    {
      label: '\u0412\u044B\u0440\u0443\u0447\u043A\u0430 \u0437\u0430 \u0441\u0435\u0433\u043E\u0434\u043D\u044F',
      value: formatCurrency(stats?.todayRevenue ?? 0),
      icon: TrendingUp,
      color: 'text-green-600',
      bg: 'bg-green-50',
    },
    {
      label: '\u0427\u0435\u043A\u0438 \u0437\u0430 \u0441\u0435\u0433\u043E\u0434\u043D\u044F',
      value: String(stats?.todayChecks ?? 0),
      icon: ClipboardList,
      color: 'text-blue-600',
      bg: 'bg-blue-50',
    },
    {
      label: '\u0412\u044B\u0440\u0443\u0447\u043A\u0430 \u0437\u0430 \u043C\u0435\u0441\u044F\u0446',
      value: formatCurrency(stats?.monthRevenue ?? 0),
      icon: DollarSign,
      color: 'text-purple-600',
      bg: 'bg-purple-50',
    },
    {
      label: '\u041F\u0440\u0438\u0431\u044B\u043B\u044C \u0437\u0430 \u043C\u0435\u0441\u044F\u0446',
      value: formatCurrency(stats?.monthProfit ?? 0),
      icon: BarChart3,
      color: 'text-orange-600',
      bg: 'bg-orange-50',
    },
  ];

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="page-header">
        <h1 className="page-title">{'\u0413\u043B\u0430\u0432\u043D\u0430\u044F'}</h1>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((card, index) => {
          const Icon = card.icon;
          return (
            <div
              key={card.label}
              className="stat-card animate-fade-in-up"
              style={{ animationDelay: `${index * 100}ms` }}
            >
              <div className="flex items-center justify-between">
                <span className="stat-label">{card.label}</span>
                <div className={`p-2 rounded-lg ${card.bg}`}>
                  <Icon className={`w-5 h-5 ${card.color}`} />
                </div>
              </div>
              <span className="stat-value">{card.value}</span>
            </div>
          );
        })}
      </div>

      {/* Employee Ranking */}
      <div
        className="animate-fade-in-up"
        style={{ animationDelay: '400ms' }}
      >
        <div className="flex items-center gap-2 mb-4">
          <Trophy className="w-5 h-5 text-yellow-500" />
          <h2 className="text-lg font-semibold text-gray-900">
            {'\u0420\u0435\u0439\u0442\u0438\u043D\u0433 \u0441\u043E\u0442\u0440\u0443\u0434\u043D\u0438\u043A\u043E\u0432'}
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Today Ranking */}
          <div className="card">
            <div className="px-5 py-4 border-b border-gray-200">
              <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">
                {'\u0421\u0435\u0433\u043E\u0434\u043D\u044F'}
              </h3>
            </div>
            <div className="divide-y divide-gray-100">
              {ranking?.today && ranking.today.length > 0 ? (
                ranking.today.map((entry, idx) => (
                  <div key={entry.masterId} className="flex items-center justify-between px-5 py-3">
                    <div className="flex items-center gap-3">
                      <span className="flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold">
                        {idx === 0 ? (
                          <Crown className="w-5 h-5 text-yellow-500" />
                        ) : (
                          <span className="text-gray-400">{idx + 1}</span>
                        )}
                      </span>
                      <div>
                        <p className="text-sm font-medium text-gray-900">{entry.masterName}</p>
                        <p className="text-xs text-gray-500">
                          {entry.checkCount} {'\u0447\u0435\u043A'}{entry.checkCount > 1 && entry.checkCount < 5 ? '\u0430' : entry.checkCount >= 5 ? '\u043E\u0432' : ''}
                        </p>
                      </div>
                    </div>
                    <span className="text-sm font-semibold text-gray-900">
                      {formatCurrency(entry.revenue)}
                    </span>
                  </div>
                ))
              ) : (
                <div className="px-5 py-6 text-center text-sm text-gray-400">
                  {'\u041D\u0435\u0442 \u0434\u0430\u043D\u043D\u044B\u0445'}
                </div>
              )}
            </div>
          </div>

          {/* Month Ranking */}
          <div className="card">
            <div className="px-5 py-4 border-b border-gray-200">
              <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">
                {'\u0417\u0430 \u043C\u0435\u0441\u044F\u0446'}
              </h3>
            </div>
            <div className="divide-y divide-gray-100">
              {ranking?.month && ranking.month.length > 0 ? (
                ranking.month.map((entry, idx) => (
                  <div key={entry.masterId} className="flex items-center justify-between px-5 py-3">
                    <div className="flex items-center gap-3">
                      <span className="flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold">
                        {idx === 0 ? (
                          <Crown className="w-5 h-5 text-yellow-500" />
                        ) : (
                          <span className="text-gray-400">{idx + 1}</span>
                        )}
                      </span>
                      <div>
                        <p className="text-sm font-medium text-gray-900">{entry.masterName}</p>
                        <p className="text-xs text-gray-500">
                          {entry.checkCount} {'\u0447\u0435\u043A'}{entry.checkCount > 1 && entry.checkCount < 5 ? '\u0430' : entry.checkCount >= 5 ? '\u043E\u0432' : ''}
                        </p>
                      </div>
                    </div>
                    <span className="text-sm font-semibold text-gray-900">
                      {formatCurrency(entry.revenue)}
                    </span>
                  </div>
                ))
              ) : (
                <div className="px-5 py-6 text-center text-sm text-gray-400">
                  {'\u041D\u0435\u0442 \u0434\u0430\u043D\u043D\u044B\u0445'}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
