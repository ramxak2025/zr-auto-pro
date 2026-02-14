import { useState, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  Plus,
  Pencil,
  Trash2,
  Loader2,
  AlertCircle,
  PackageOpen,
  ChevronDown,
  Phone,
  User as UserIcon,
} from 'lucide-react';
import { suppliersApi } from '../api/services';
import type { Supplier, PaginatedResponse } from '../types';
import SearchInput from '../components/SearchInput';
import Pagination from '../components/Pagination';
import Modal from '../components/Modal';
import PhoneInput, { isPhoneComplete, getPhoneRaw } from '../components/PhoneInput';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatAmount(value: number): string {
  return value.toLocaleString('ru-RU') + ' \u20BD';
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}.${month}.${year}`;
}

// ---------------------------------------------------------------------------
// Confirm Dialog (inline)
// ---------------------------------------------------------------------------

interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  isLoading?: boolean;
}

function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  isLoading,
}: ConfirmDialogProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="sm">
      <p className="text-sm text-gray-600 mb-6">{message}</p>
      <div className="flex items-center justify-end gap-3">
        <button
          type="button"
          onClick={onClose}
          disabled={isLoading}
          className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
        >
          Отмена
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={isLoading}
          className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
        >
          {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
          Удалить
        </button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Supplier Form Modal
// ---------------------------------------------------------------------------

interface SupplierFormData {
  name: string;
  phone: string;
  contactPerson: string;
  comment: string;
}

interface SupplierFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  supplier?: Supplier | null;
  onSubmit: (data: SupplierFormData) => void;
  isLoading: boolean;
}

function SupplierFormModal({
  isOpen,
  onClose,
  supplier,
  onSubmit,
  isLoading,
}: SupplierFormModalProps) {
  const [name, setName] = useState(supplier?.name || '');
  const [phone, setPhone] = useState(supplier?.phone || '');
  const [contactPerson, setContactPerson] = useState(
    supplier?.contactPerson || '',
  );
  const [comment, setComment] = useState(supplier?.comment || '');

  // Reset form when modal opens with new data
  useState(() => {
    setName(supplier?.name || '');
    setPhone(supplier?.phone || '');
    setContactPerson(supplier?.contactPerson || '');
    setComment(supplier?.comment || '');
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      toast.error('Введите название поставщика');
      return;
    }
    if (phone.trim() && !isPhoneComplete(phone)) {
      toast.error('Введите телефон полностью');
      return;
    }
    onSubmit({
      name: trimmedName,
      phone: phone.trim() ? getPhoneRaw(phone) : '',
      contactPerson: contactPerson.trim(),
      comment: comment.trim(),
    });
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={supplier ? 'Редактировать поставщика' : 'Новый поставщик'}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Name */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Название <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Название поставщика"
            className="block w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 shadow-sm transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
          />
        </div>

        {/* Phone */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Телефон
          </label>
          <PhoneInput
            value={phone}
            onChange={setPhone}
            className="block w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 shadow-sm transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
          />
        </div>

        {/* Contact Person */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Контактное лицо
          </label>
          <input
            type="text"
            value={contactPerson}
            onChange={(e) => setContactPerson(e.target.value)}
            placeholder="ФИО контактного лица"
            className="block w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 shadow-sm transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
          />
        </div>

        {/* Comment */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Комментарий
          </label>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={3}
            placeholder="Дополнительная информация..."
            className="block w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 shadow-sm transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 resize-none"
          />
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
          >
            Отмена
          </button>
          <button
            type="submit"
            disabled={isLoading}
            className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-700 disabled:opacity-50"
          >
            {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
            {supplier ? 'Сохранить' : 'Создать'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

const LIMIT = 20;

export default function SuppliersPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  // Modal state
  const [formOpen, setFormOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Supplier | null>(null);

  // ---- Queries ----

  const {
    data: suppliersData,
    isLoading,
    isError,
  } = useQuery<PaginatedResponse<Supplier>>({
    queryKey: ['suppliers', { search, page }],
    queryFn: async () => {
      const res = await suppliersApi.getAll({
        search: search || undefined,
        page,
        limit: LIMIT,
      });
      return res.data;
    },
    placeholderData: keepPreviousData,
  });

  // ---- Mutations ----

  const createMutation = useMutation({
    mutationFn: (data: SupplierFormData) => suppliersApi.create(data),
    onSuccess: () => {
      toast.success('Поставщик создан');
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      closeForm();
    },
    onError: () => {
      toast.error('Не удалось создать поставщика');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: SupplierFormData }) =>
      suppliersApi.update(id, data),
    onSuccess: () => {
      toast.success('Поставщик обновлён');
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      closeForm();
    },
    onError: () => {
      toast.error('Не удалось обновить поставщика');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => suppliersApi.delete(id),
    onSuccess: () => {
      toast.success('Поставщик удалён');
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      setDeleteTarget(null);
    },
    onError: () => {
      toast.error('Не удалось удалить поставщика');
    },
  });

  // ---- Handlers ----

  function openCreate() {
    setEditingSupplier(null);
    setFormOpen(true);
  }

  function openEdit(supplier: Supplier) {
    setEditingSupplier(supplier);
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setEditingSupplier(null);
  }

  function handleFormSubmit(data: SupplierFormData) {
    if (editingSupplier) {
      updateMutation.mutate({ id: editingSupplier.id, data });
    } else {
      createMutation.mutate(data);
    }
  }

  function handleSearchChange(v: string) {
    setSearch(v);
    setPage(1);
  }

  const suppliers = suppliersData?.data || [];
  const total = suppliersData?.total || 0;
  const isMutating = createMutation.isPending || updateMutation.isPending;

  // ---- Render ----

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Поставщики</h1>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-primary-700"
        >
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">Добавить поставщика</span>
        </button>
      </div>

      {/* Search */}
      <div className="max-w-full sm:max-w-sm">
        <SearchInput
          value={search}
          onChange={handleSearchChange}
          placeholder="Поиск по названию..."
        />
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
        </div>
      ) : isError ? (
        <div className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">
          <AlertCircle className="h-5 w-5 flex-shrink-0" />
          <p className="text-sm">Не удалось загрузить список поставщиков</p>
        </div>
      ) : suppliers.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-gray-200 bg-white py-16">
          <PackageOpen className="h-12 w-12 text-gray-300 mb-3" />
          <p className="text-gray-500 text-sm">
            {search ? 'Ничего не найдено' : 'Нет поставщиков'}
          </p>
          {!search && (
            <button
              onClick={openCreate}
              className="mt-4 flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-700"
            >
              <Plus className="h-4 w-4" />
              Добавить первого поставщика
            </button>
          )}
        </div>
      ) : (
        <>
          {/* Mobile accordion cards */}
          <div className="md:hidden space-y-2">
            {suppliers.map((supplier) => (
              <div
                key={supplier.id}
                className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden"
              >
                {/* Card header – clickable to navigate */}
                <div
                  onClick={() => navigate(`/suppliers/${supplier.id}`)}
                  className="flex items-center justify-between gap-3 px-4 py-3 cursor-pointer active:bg-gray-50"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-gray-900 truncate">
                      {supplier.name}
                    </p>
                    <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                      {supplier.contactPerson && (
                        <span className="inline-flex items-center gap-1 truncate">
                          <UserIcon className="h-3 w-3 flex-shrink-0" />
                          {supplier.contactPerson}
                        </span>
                      )}
                      {supplier.phone && (
                        <span className="inline-flex items-center gap-1">
                          <Phone className="h-3 w-3 flex-shrink-0" />
                          {supplier.phone}
                        </span>
                      )}
                    </div>
                  </div>
                  <ChevronDown className="h-4 w-4 text-gray-400 flex-shrink-0 -rotate-90" />
                </div>

                {/* Financial info */}
                <div className="border-t border-gray-100 px-4 py-2.5 grid grid-cols-3 gap-2 text-center">
                  <div>
                    <p className="text-[10px] text-gray-400 font-medium">Закупки</p>
                    <p className="text-xs font-semibold text-gray-900">{formatAmount(supplier.totalPurchases)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-gray-400 font-medium">Оплачено</p>
                    <p className="text-xs font-semibold text-gray-900">{formatAmount(supplier.totalPaid)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-gray-400 font-medium">Долг</p>
                    <p className={`text-xs font-semibold ${supplier.currentDebt > 0 ? 'text-red-600' : 'text-gray-900'}`}>
                      {formatAmount(supplier.currentDebt)}
                    </p>
                  </div>
                </div>

                {/* Actions */}
                <div className="border-t border-gray-100 flex items-center justify-end gap-1 px-3 py-2">
                  <button
                    onClick={() => openEdit(supplier)}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
                    title="Редактировать"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => setDeleteTarget(supplier)}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600"
                    title="Удалить"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop Table */}
          <div className="hidden md:block overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50">
                    <th className="px-4 py-3 font-semibold text-gray-600">
                      Название
                    </th>
                    <th className="px-4 py-3 font-semibold text-gray-600">
                      Контактное лицо
                    </th>
                    <th className="px-4 py-3 font-semibold text-gray-600">
                      Телефон
                    </th>
                    <th className="px-4 py-3 font-semibold text-gray-600 text-right">
                      Общая сумма закупок
                    </th>
                    <th className="px-4 py-3 font-semibold text-gray-600 text-right">
                      Оплачено
                    </th>
                    <th className="px-4 py-3 font-semibold text-gray-600 text-right">
                      Текущий долг
                    </th>
                    <th className="px-4 py-3 font-semibold text-gray-600 text-right">
                      Действия
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {suppliers.map((supplier) => (
                    <tr
                      key={supplier.id}
                      onClick={() => navigate(`/suppliers/${supplier.id}`)}
                      className="cursor-pointer transition-colors hover:bg-gray-50"
                    >
                      <td className="px-4 py-3 font-medium text-gray-900">
                        {supplier.name}
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {supplier.contactPerson || '\u2014'}
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {supplier.phone || '\u2014'}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-900">
                        {formatAmount(supplier.totalPurchases)}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-900">
                        {formatAmount(supplier.totalPaid)}
                      </td>
                      <td
                        className={`px-4 py-3 text-right font-medium ${
                          supplier.currentDebt > 0
                            ? 'text-red-600'
                            : 'text-gray-900'
                        }`}
                      >
                        {formatAmount(supplier.currentDebt)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              openEdit(supplier);
                            }}
                            className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
                            title="Редактировать"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeleteTarget(supplier);
                            }}
                            className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600"
                            title="Удалить"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Pagination */}
          <Pagination
            page={page}
            total={total}
            limit={LIMIT}
            onChange={setPage}
          />
        </>
      )}

      {/* Create / Edit Modal */}
      {formOpen && (
        <SupplierFormModal
          key={editingSupplier?.id || 'new'}
          isOpen={formOpen}
          onClose={closeForm}
          supplier={editingSupplier}
          onSubmit={handleFormSubmit}
          isLoading={isMutating}
        />
      )}

      {/* Delete Confirm Dialog */}
      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        title="Удалить поставщика"
        message={`Вы уверены, что хотите удалить поставщика "${deleteTarget?.name}"? Это действие нельзя отменить.`}
        isLoading={deleteMutation.isPending}
      />
    </div>
  );
}
