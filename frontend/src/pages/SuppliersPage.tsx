import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Truck, Phone, User } from 'lucide-react';
import toast from 'react-hot-toast';

import { suppliersApi } from '../api/services';
import SearchInput from '../components/SearchInput';
import Modal from '../components/Modal';
import LoadingSpinner from '../components/LoadingSpinner';
import EmptyState from '../components/EmptyState';
import Pagination from '../components/Pagination';
import PhoneInput from '../components/PhoneInput';
import { Supplier, PaginatedResponse } from '../types';
import { formatMoney } from '../../../shared/utils/formatters';

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

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const limit = 20;

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [form, setForm] = useState<SupplierFormData>(emptyForm);

  const { data, isLoading } = useQuery({
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
    mutationFn: ({ id, data }: { id: string; data: SupplierFormData }) =>
      suppliersApi.update(id, data),
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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Поставщики</h1>
        <button onClick={openCreateModal} className="btn-primary">
          <Plus className="w-4 h-4" />
          Новый поставщик
        </button>
      </div>

      {/* Search */}
      <SearchInput
        value={search}
        onChange={(val) => {
          setSearch(val);
          setPage(1);
        }}
        placeholder="Поиск по названию, контакту..."
      />

      {/* Table */}
      {isLoading ? (
        <LoadingSpinner />
      ) : suppliers.length === 0 ? (
        <EmptyState
          icon={Truck}
          title="Нет поставщиков"
          description="Добавьте первого поставщика для учета закупок"
          action={{ label: 'Новый поставщик', onClick: openCreateModal }}
        />
      ) : (
        <>
          {/* Mobile cards */}
          <div className="md:hidden space-y-3">
            {suppliers.map((supplier) => (
              <div
                key={supplier.id}
                onClick={() => navigate(`/suppliers/${supplier.id}`)}
                className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 active:bg-gray-50 transition-colors cursor-pointer"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="font-semibold text-gray-900 text-sm">{supplier.name}</span>
                  {supplier.currentDebt > 0 && (
                    <span className="text-xs font-medium text-red-600">{formatMoney(supplier.currentDebt)}</span>
                  )}
                </div>
                {supplier.contactPerson && (
                  <p className="text-xs text-gray-500 mb-1">{supplier.contactPerson}</p>
                )}
                <div className="flex items-center gap-4 text-xs text-gray-500">
                  <span>Закупки: <span className="font-medium text-gray-700">{formatMoney(supplier.totalPurchases)}</span></span>
                  <span>Оплачено: <span className="font-medium text-gray-700">{formatMoney(supplier.totalPaid)}</span></span>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop table */}
          <div className="hidden md:block table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Название</th>
                  <th>Контактное лицо</th>
                  <th>Телефон</th>
                  <th className="text-right">Закупки</th>
                  <th className="text-right">Оплачено</th>
                  <th className="text-right">Долг</th>
                </tr>
              </thead>
              <tbody>
                {suppliers.map((supplier) => (
                  <tr
                    key={supplier.id}
                    className="cursor-pointer hover:bg-gray-50"
                    onClick={() => navigate(`/suppliers/${supplier.id}`)}
                  >
                    <td className="font-medium text-gray-900">{supplier.name}</td>
                    <td className="text-gray-600">
                      {supplier.contactPerson || '\u2014'}
                    </td>
                    <td className="text-gray-600">
                      {supplier.phone || '\u2014'}
                    </td>
                    <td className="text-right text-gray-900">
                      {formatMoney(supplier.totalPurchases)}
                    </td>
                    <td className="text-right text-gray-900">
                      {formatMoney(supplier.totalPaid)}
                    </td>
                    <td
                      className={`text-right font-medium ${
                        supplier.currentDebt > 0 ? 'text-red-600' : 'text-gray-900'
                      }`}
                    >
                      {formatMoney(supplier.currentDebt)}
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
                onChange={(e) =>
                  setForm({ ...form, contactPerson: e.target.value })
                }
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
              {isSubmitting
                ? 'Сохранение...'
                : editingSupplier
                ? 'Сохранить'
                : 'Создать'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
