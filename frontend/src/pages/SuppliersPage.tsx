import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Truck, Phone, User } from 'lucide-react';
import toast from 'react-hot-toast';

import { suppliersApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import SearchInput from '../components/SearchInput';
import Modal from '../components/Modal';
import Pagination from '../components/Pagination';
import PhoneInput from '../components/PhoneInput';
import PageHeader from '../components/PageHeader';
import QueryState from '../components/QueryState';
import { useClickableRow } from '../hooks/useClickableRow';
import { Supplier, PaginatedResponse } from '../types';
import { formatMoney } from '../../../shared/utils/formatters';

// `useClickableRow` returns a static prop bag (no React state) — aliasing lets
// us apply it per-row inside `.map()` without tripping rules-of-hooks.
const clickableRowProps = useClickableRow;

interface SupplierFormData {
  name: string;
  phone: string;
  contactPerson: string;
  comment: string;
}

const emptyForm: SupplierFormData = {
  name: '',
  phone: '',
  contactPerson: '',
  comment: '',
};

export default function SuppliersPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  // ROLE-ONLY: создание/редактирование/удаление поставщиков — только с
  // suppliers_manage (байпас superadmin/director — внутри hasPermission;
  // admin — по матрице роли). Просмотр (suppliers_access) — у всех, кто попал.
  const canManage = hasPermission('suppliers_manage');

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const limit = 20;

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [form, setForm] = useState<SupplierFormData>(emptyForm);

  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ['suppliers', search, page],
    queryFn: () => suppliersApi.getAll({ search, page, limit }),
    select: (res) => res.data as PaginatedResponse<Supplier>,
  });

  const createMutation = useMutation({
    mutationFn: (data: SupplierFormData) => suppliersApi.create(data),
    onSuccess: () => {
      toast.success('Поставщик создан');
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      closeModal();
    },
    onError: () => toast.error('Ошибка при создании поставщика'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: SupplierFormData }) => suppliersApi.update(id, data),
    onSuccess: () => {
      toast.success('Поставщик обновлен');
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      closeModal();
    },
    onError: () => toast.error('Ошибка при обновлении поставщика'),
  });

  const openCreateModal = () => {
    setEditingSupplier(null);
    setForm(emptyForm);
    setIsModalOpen(true);
  };

  const openEditModal = (supplier: Supplier, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingSupplier(supplier);
    setForm({
      name: supplier.name,
      phone: supplier.phone || '',
      contactPerson: supplier.contactPerson || '',
      comment: supplier.comment || '',
    });
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingSupplier(null);
    setForm(emptyForm);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      toast.error('Введите название поставщика');
      return;
    }
    if (editingSupplier) {
      updateMutation.mutate({ id: editingSupplier.id, data: form });
    } else {
      createMutation.mutate(form);
    }
  };

  const isSubmitting = createMutation.isPending || updateMutation.isPending;

  const suppliers = data?.data || [];
  const total = data?.total || 0;
  const totalDebt = suppliers.reduce((sum, s) => sum + (s.currentDebt || 0), 0);
  const totalPurchasesSum = suppliers.reduce((sum, s) => sum + (s.totalPurchases || 0), 0);

  return (
    <div>
      {/* Header */}
      <PageHeader
        title="Поставщики"
        icon={Truck}
        actions={
          canManage ? (
            <button onClick={openCreateModal} className="btn-primary">
              <Plus className="w-4 h-4" />
              Новый поставщик
            </button>
          ) : undefined
        }
      />

      {/* Search */}
      <div className="mb-4 max-w-md">
        <SearchInput
          value={search}
          onChange={(val) => {
            setSearch(val);
            setPage(1);
          }}
          placeholder="Поиск по названию, контакту..."
        />
      </div>

      {/* KPI strip */}
      {!isLoading && suppliers.length > 0 && (
        <div className="grid grid-cols-3 gap-2.5 mb-4">
          <div className="rounded-xl bg-primary-50 p-3">
            <p className="text-[10px] font-semibold text-primary-500 uppercase tracking-wider">Поставщиков</p>
            <p className="text-base sm:text-lg font-bold text-primary-700 mt-0.5 tabular-nums">{total}</p>
          </div>
          <div className="rounded-xl bg-red-50 p-3">
            <p className="text-[10px] font-semibold text-red-500 uppercase tracking-wider">Общий долг</p>
            <p className="text-base sm:text-lg font-bold text-red-700 mt-0.5 tabular-nums">{formatMoney(totalDebt)}</p>
          </div>
          <div className="rounded-xl bg-gray-50 p-3">
            <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Оборот закупок</p>
            <p className="text-base sm:text-lg font-bold text-gray-700 mt-0.5 tabular-nums">
              {formatMoney(totalPurchasesSum)}
            </p>
          </div>
        </div>
      )}

      {/* Table */}
      <QueryState
        isLoading={isLoading}
        isError={isError}
        onRetry={() => refetch()}
        isFetching={isFetching}
        isEmpty={suppliers.length === 0}
        empty={{
          icon: Truck,
          title: 'Нет поставщиков',
          description: 'Добавьте первого поставщика для учета закупок',
          action: canManage ? { label: 'Новый поставщик', onClick: openCreateModal } : undefined,
        }}
        minHeight="min-h-[40vh]"
      >
        <>
          {/* Mobile cards */}
          <div className="md:hidden space-y-3">
            {suppliers.map((supplier) => (
              <div
                key={supplier.id}
                {...clickableRowProps(() => navigate(`/suppliers/${supplier.id}`), { label: supplier.name })}
                className={`rounded-xl border shadow-sm p-4 active:bg-gray-50 transition-colors cursor-pointer ${
                  supplier.isSystem ? 'bg-primary-50/30 border-primary-200' : 'bg-white border-gray-100'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-semibold text-gray-900 text-sm truncate">{supplier.name}</span>
                    {supplier.isSystem ? (
                      <span className="text-[9px] font-bold tracking-wider uppercase px-1.5 py-0.5 rounded bg-primary-100 text-primary-700 flex-shrink-0">
                        Системный
                      </span>
                    ) : null}
                  </div>
                  {supplier.currentDebt > 0 && (
                    <span className="text-xs font-medium text-red-600 flex-shrink-0">
                      {formatMoney(supplier.currentDebt)}
                    </span>
                  )}
                </div>
                {supplier.contactPerson && !supplier.isSystem && (
                  <p className="text-xs text-gray-500 mb-1">{supplier.contactPerson}</p>
                )}
                {supplier.isSystem ? <p className="text-xs text-gray-500 mb-1">Покупка б/у у клиентов</p> : null}
                <div className="flex items-center gap-4 text-xs text-gray-500">
                  <span>
                    Закупки: <span className="font-medium text-gray-700">{formatMoney(supplier.totalPurchases)}</span>
                  </span>
                  <span>
                    Оплачено: <span className="font-medium text-gray-700">{formatMoney(supplier.totalPaid)}</span>
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop table — dense, full-width */}
          <div className="hidden md:block table-container md:max-h-[70vh]">
            <table className="table [&_th]:sticky [&_th]:top-0 [&_th]:z-10">
              <thead>
                <tr>
                  <th>Поставщик</th>
                  <th>Контактное лицо</th>
                  <th>Телефон</th>
                  <th className="text-right">Закупки</th>
                  <th className="text-right">Оплачено</th>
                  <th className="text-right">Долг</th>
                  <th className="text-center">Статус</th>
                </tr>
              </thead>
              <tbody>
                {suppliers.map((supplier) => (
                  <tr
                    key={supplier.id}
                    {...clickableRowProps(() => navigate(`/suppliers/${supplier.id}`), { label: supplier.name })}
                    className={`cursor-pointer hover:bg-gray-50 ${supplier.isSystem ? 'bg-primary-50/30' : ''}`}
                  >
                    <td className="font-medium text-gray-900">
                      <div className="flex items-center gap-3">
                        <div
                          className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl ${
                            supplier.isSystem ? 'bg-primary-100 text-primary-600' : 'bg-gray-100 text-gray-500'
                          }`}
                        >
                          <Truck className="w-4 h-4" />
                        </div>
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="truncate">{supplier.name}</span>
                          {supplier.isSystem ? (
                            <span className="text-[9px] font-bold tracking-wider uppercase px-1.5 py-0.5 rounded bg-primary-100 text-primary-700 flex-shrink-0">
                              {'\u0421\u0438\u0441\u0442\u0435\u043c\u043d\u044b\u0439'}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </td>
                    <td className="text-gray-600">
                      {supplier.isSystem
                        ? '\u041f\u043e\u043a\u0443\u043f\u043a\u0430 \u0431/\u0443 \u0443 \u043a\u043b\u0438\u0435\u043d\u0442\u043e\u0432'
                        : supplier.contactPerson || '\u2014'}
                    </td>
                    <td className="text-gray-600">{supplier.isSystem ? '\u2014' : supplier.phone || '\u2014'}</td>
                    <td className="text-right text-gray-900 tabular-nums">{formatMoney(supplier.totalPurchases)}</td>
                    <td className="text-right text-gray-900 tabular-nums">{formatMoney(supplier.totalPaid)}</td>
                    <td
                      className={`text-right font-medium tabular-nums ${
                        supplier.currentDebt > 0 ? 'text-red-600' : 'text-gray-900'
                      }`}
                    >
                      {formatMoney(supplier.currentDebt)}
                    </td>
                    <td className="text-center">
                      {supplier.currentDebt > 0 ? (
                        <span className="badge-danger">Долг</span>
                      ) : (
                        <span className="badge-success">Оплачено</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Pagination page={page} total={total} limit={limit} onChange={setPage} />
        </>
      </QueryState>

      {/* Create / Edit Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={closeModal}
        title={editingSupplier ? 'Редактировать поставщика' : 'Новый поставщик'}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">Название *</label>
            <input
              type="text"
              className="input"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="ООО Запчасти"
            />
          </div>

          <div>
            <label className="label">Контактное лицо</label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                className="input pl-10"
                value={form.contactPerson}
                onChange={(e) => setForm({ ...form, contactPerson: e.target.value })}
                placeholder="Иван Иванов"
              />
            </div>
          </div>

          <div>
            <label className="label">Телефон</label>
            <div className="relative">
              <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <PhoneInput
                value={form.phone}
                onChange={(val) => setForm({ ...form, phone: val })}
                placeholder="+7 (XXX) XXX-XX-XX"
              />
            </div>
          </div>

          <div>
            <label className="label">Комментарий</label>
            <textarea
              className="input"
              rows={3}
              value={form.comment}
              onChange={(e) => setForm({ ...form, comment: e.target.value })}
              placeholder="Заметки о поставщике..."
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-200">
            <button type="button" onClick={closeModal} className="btn-secondary">
              Отмена
            </button>
            <button type="submit" disabled={isSubmitting} className="btn-primary">
              {isSubmitting ? 'Сохранение...' : editingSupplier ? 'Сохранить' : 'Создать'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
