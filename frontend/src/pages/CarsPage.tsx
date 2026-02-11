import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Car } from 'lucide-react';
import { carsApi } from '../api/services';
import type { Car as CarType, PaginatedResponse } from '../types';
import SearchInput from '../components/SearchInput';
import Pagination from '../components/Pagination';
import EmptyState from '../components/EmptyState';
import LoadingSpinner from '../components/LoadingSpinner';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('ru-RU');
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

const LIMIT = 20;

export default function CarsPage() {
  const navigate = useNavigate();

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const {
    data: carsData,
    isLoading,
    isError,
  } = useQuery<PaginatedResponse<CarType>>({
    queryKey: ['cars', { search, page }],
    queryFn: async () => {
      const res = await carsApi.getAll({
        search: search || undefined,
        page,
        limit: LIMIT,
      });
      return res.data;
    },
    keepPreviousData: true,
  } as any);

  function handleSearchChange(v: string) {
    setSearch(v);
    setPage(1);
  }

  const cars = carsData?.data || [];
  const total = carsData?.total || 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Автомобили</h1>
        <p className="text-sm text-gray-500 mt-1">Всего: {total}</p>
      </div>

      {/* Search */}
      <div className="max-w-sm">
        <SearchInput
          value={search}
          onChange={handleSearchChange}
          placeholder="Поиск по госномеру или марке..."
        />
      </div>

      {/* Content */}
      {isLoading ? (
        <LoadingSpinner />
      ) : isError ? (
        <div className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">
          <p className="text-sm">Не удалось загрузить список автомобилей</p>
        </div>
      ) : cars.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white">
          <EmptyState
            icon={Car}
            title={search ? 'Ничего не найдено' : 'Нет автомобилей'}
            description={
              search
                ? 'Попробуйте изменить параметры поиска'
                : 'Автомобили добавляются через карточку клиента'
            }
          />
        </div>
      ) : (
        <>
          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50/50">
                    <th className="px-4 py-3 font-semibold text-gray-600">Госномер</th>
                    <th className="px-4 py-3 font-semibold text-gray-600">
                      Марка / Модель
                    </th>
                    <th className="px-4 py-3 font-semibold text-gray-600">Владелец</th>
                    <th className="px-4 py-3 font-semibold text-gray-600">Дата</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {cars.map((car) => (
                    <tr
                      key={car.id}
                      onClick={() => navigate(`/clients/${car.clientId}`)}
                      className="cursor-pointer transition-colors hover:bg-gray-50"
                    >
                      <td className="px-4 py-3 font-medium text-gray-900">
                        {car.plateNumber}
                      </td>
                      <td className="px-4 py-3 text-gray-600">{car.makeModel}</td>
                      <td className="px-4 py-3 text-gray-600">
                        {car.client?.fullName || '\u2014'}
                      </td>
                      <td className="px-4 py-3 text-gray-500">
                        {formatDate(car.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <Pagination page={page} total={total} limit={LIMIT} onChange={setPage} />
        </>
      )}
    </div>
  );
}
