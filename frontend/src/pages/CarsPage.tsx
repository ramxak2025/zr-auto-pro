import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Car, Calendar, User } from 'lucide-react';
import { carsApi } from '../api/services';
import SearchInput from '../components/SearchInput';
import LoadingSpinner from '../components/LoadingSpinner';
import EmptyState from '../components/EmptyState';
import Pagination from '../components/Pagination';
import { Car as CarType, PaginatedResponse } from '../types';

export default function CarsPage() {
  const navigate = useNavigate();

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const limit = 20;

  const { data, isLoading } = useQuery<PaginatedResponse<CarType>>({
    queryKey: ['cars', { search, page, limit }],
    queryFn: async () => {
      const res = await carsApi.getAll({ search, page, limit });
      return res.data;
    },
  });

  const cars = data?.data || [];
  const total = data?.total || 0;

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  };

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <h1 className="page-title">Автомобили</h1>
      </div>

      {/* Search */}
      <div className="mb-4">
        <SearchInput
          value={search}
          onChange={(val) => {
            setSearch(val);
            setPage(1);
          }}
          placeholder="Поиск по гос номеру или марке..."
        />
      </div>

      {/* Content */}
      {isLoading ? (
        <LoadingSpinner />
      ) : cars.length === 0 ? (
        <EmptyState
          icon={Car}
          title="Нет автомобилей"
          description={
            search
              ? 'По вашему запросу ничего не найдено'
              : 'Автомобили будут добавлены через карточку клиента'
          }
        />
      ) : (
        <>
          {/* Mobile cards */}
          <div className="md:hidden space-y-3">
            {cars.map((car) => (
              <div
                key={car.id}
                onClick={() => car.clientId && navigate(`/clients/${car.clientId}`)}
                className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 active:bg-gray-50 transition-colors cursor-pointer"
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <Car className="w-4 h-4 text-gray-400" />
                    <span className="font-bold text-gray-900 text-sm">{car.plateNumber}</span>
                  </div>
                  <span className="text-xs text-gray-400">{formatDate(car.createdAt)}</span>
                </div>
                <p className="text-sm text-gray-700 ml-6">{car.makeModel}</p>
                {car.client && (
                  <p className="text-xs text-gray-500 ml-6 mt-0.5">{car.client.fullName}</p>
                )}
              </div>
            ))}
          </div>

          {/* Desktop table */}
          <div className="hidden md:block table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Гос номер</th>
                  <th>Марка / Модель</th>
                  <th>Владелец</th>
                  <th>Дата</th>
                </tr>
              </thead>
              <tbody>
                {cars.map((car) => (
                  <tr
                    key={car.id}
                    onClick={() => {
                      if (car.clientId) {
                        navigate(`/clients/${car.clientId}`);
                      }
                    }}
                    className="cursor-pointer hover:bg-gray-50"
                  >
                    <td>
                      <div className="flex items-center gap-2">
                        <Car className="w-4 h-4 text-gray-400 flex-shrink-0" />
                        <span className="font-semibold text-gray-900">
                          {car.plateNumber}
                        </span>
                      </div>
                    </td>
                    <td>
                      <span className="text-gray-700">{car.makeModel}</span>
                    </td>
                    <td>
                      <div className="flex items-center gap-2">
                        <User className="w-4 h-4 text-gray-400 flex-shrink-0" />
                        <span className="text-gray-600">
                          {car.client?.fullName || '—'}
                        </span>
                      </div>
                    </td>
                    <td>
                      <div className="flex items-center gap-2 text-gray-500">
                        <Calendar className="w-4 h-4 flex-shrink-0" />
                        {formatDate(car.createdAt)}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Pagination
            page={page}
            total={total}
            limit={limit}
            onChange={setPage}
          />
        </>
      )}
    </div>
  );
}
