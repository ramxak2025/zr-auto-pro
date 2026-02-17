import { useState, useEffect, FormEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus,
  Package,
  Edit2,
  Trash2,
  ArrowUpDown,
  AlertTriangle,
  Calendar,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { productsApi, suppliersApi } from '../api/services';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import SearchInput from '../components/SearchInput';
import LoadingSpinner from '../components/LoadingSpinner';
import EmptyState from '../components/EmptyState';
import Pagination from '../components/Pagination';
import { Product, Supplier, PaginatedResponse } from '../types';

const CATEGORIES = [
  'Все',
  'Масла',
  'Фильтры',
  'Тормозные',
  'Электрика',
  'Кузов',
  'Подвеска',
  'Другое',
];

const STOCK_MOVEMENT_TYPES = [
  { value: 'income', label: 'Приход' },
  { value: 'expense', label: 'Расход' },
  { value: 'writeoff', label: 'Списание' },
  { value: 'inventory', label: 'Инвентаризация' },
];

export default function ProductsPage() {
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [categoryFilter, setCategoryFilter] = useState('Все');
  const limit = 20;

  // Product modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);

  // Product form
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [costPrice, setCostPrice] = useState('');
  const [sellPrice, setSellPrice] = useState('');
  const [stock, setStock] = useState('');
  const [minStock, setMinStock] = useState('');
  const [supplierId, setSupplierId] = useState('');

  // Stock adjustment modal
  const [stockModalOpen, setStockModalOpen] = useState(false);
  const [stockProductId, setStockProductId] = useState<string | null>(null);
  const [stockType, setStockType] = useState('income');
  const [stockQuantity, setStockQuantity] = useState('');
  const [stockReason, setStockReason] = useState('');

  // Delete confirm
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Query products
  const { data, isLoading } = useQuery<PaginatedResponse<Product>>({
    queryKey: ['products', { search, page, limit, category: categoryFilter === 'Все' ? undefined : categoryFilter }],
    queryFn: async () => {
      const params: any = { search, page, limit };
      if (categoryFilter !== 'Все') {
        params.category = categoryFilter;
      }
      const res = await productsApi.getAll(params);
      return res.data;
    },
  });

  // Query suppliers for dropdown
  const { data: suppliersData } = useQuery<{ data: Supplier[] } | Supplier[]>({
    queryKey: ['suppliers'],
    queryFn: async () => {
      const res = await suppliersApi.getAll();
      return res.data;
    },
  });

  const suppliers: Supplier[] = Array.isArray(suppliersData)
    ? suppliersData
    : (suppliersData as any)?.data || [];

  // Mutations
  const createMutation = useMutation({
    mutationFn: (data: any) => productsApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      toast.success('Товар создан');
      closeModal();
    },
    onError: () => {
      toast.error('Ошибка при создании товара');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) =>
      productsApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      toast.success('Товар обновлён');
      closeModal();
    },
    onError: () => {
      toast.error('Ошибка при обновлении товара');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => productsApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      toast.success('Товар удалён');
    },
    onError: () => {
      toast.error('Ошибка при удалении товара');
    },
  });

  const stockMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) =>
      productsApi.updateStock(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      toast.success('Остаток обновлён');
      closeStockModal();
    },
    onError: () => {
      toast.error('Ошибка при обновлении остатка');
    },
  });

  // Modal handlers
  const openCreateModal = () => {
    setEditingProduct(null);
    setName('');
    setCategory('');
    setCostPrice('');
    setSellPrice('');
    setStock('0');
    setMinStock('0');
    setSupplierId('');
    setModalOpen(true);
  };

  const openEditModal = (product: Product, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingProduct(product);
    setName(product.name);
    setCategory(product.category || '');
    setCostPrice(String(product.costPrice));
    setSellPrice(String(product.sellPrice));
    setStock(String(product.stock));
    setMinStock(String(product.minStock));
    setSupplierId(product.supplierId || '');
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingProduct(null);
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const payload = {
      name,
      category: category || undefined,
      costPrice: Number(costPrice),
      sellPrice: Number(sellPrice),
      stock: Number(stock),
      minStock: Number(minStock),
      supplierId: supplierId || undefined,
    };
    if (editingProduct) {
      updateMutation.mutate({ id: editingProduct.id, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  // Stock adjustment handlers
  const openStockModal = (productId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setStockProductId(productId);
    setStockType('income');
    setStockQuantity('');
    setStockReason('');
    setStockModalOpen(true);
  };

  const closeStockModal = () => {
    setStockModalOpen(false);
    setStockProductId(null);
  };

  const handleStockSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!stockProductId) return;
    stockMutation.mutate({
      id: stockProductId,
      data: {
        type: stockType,
        quantity: Number(stockQuantity),
        reason: stockReason || undefined,
      },
    });
  };

  // Delete handlers
  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeleteId(id);
    setConfirmOpen(true);
  };

  const confirmDelete = () => {
    if (deleteId) {
      deleteMutation.mutate(deleteId);
      setDeleteId(null);
    }
  };

  const products = data?.data || [];
  const total = data?.total || 0;

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('ru-RU').format(amount);
  };

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <h1 className="page-title">Склад</h1>
        <button onClick={openCreateModal} className="btn-primary">
          <Plus className="w-4 h-4" />
          Новый товар
        </button>
      </div>

      {/* Search */}
      <div className="mb-4">
        <SearchInput
          value={search}
          onChange={(val) => {
            setSearch(val);
            setPage(1);
          }}
          placeholder="Поиск по названию товара..."
        />
      </div>

      {/* Category Filter Tabs */}
      <div className="flex flex-wrap gap-2 mb-4">
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            onClick={() => {
              setCategoryFilter(cat);
              setPage(1);
            }}
            className={`px-3 py-1.5 text-sm rounded-lg font-medium transition-colors ${
              categoryFilter === cat
                ? 'bg-primary-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Content */}
      {isLoading ? (
        <LoadingSpinner />
      ) : products.length === 0 ? (
        <EmptyState
          icon={Package}
          title="Нет товаров"
          description={
            search || categoryFilter !== 'Все'
              ? 'По вашему запросу ничего не найдено'
              : 'Добавьте первый товар на склад'
          }
          action={
            !search && categoryFilter === 'Все'
              ? { label: 'Добавить товар', onClick: openCreateModal }
              : undefined
          }
        />
      ) : (
        <>
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Название</th>
                  <th>Категория</th>
                  <th>Закуп цена</th>
                  <th>Продажная цена</th>
                  <th>Остаток</th>
                  <th>Поставщик</th>
                  <th className="w-32">Действия</th>
                </tr>
              </thead>
              <tbody>
                {products.map((product) => {
                  const isLowStock = product.stock <= product.minStock;
                  return (
                    <tr
                      key={product.id}
                      className={isLowStock ? 'bg-red-50' : ''}
                    >
                      <td>
                        <div className="flex items-center gap-2">
                          {isLowStock && (
                            <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0" />
                          )}
                          <span className="font-medium text-gray-900">
                            {product.name}
                          </span>
                        </div>
                      </td>
                      <td>
                        {product.category ? (
                          <span className="badge-default">{product.category}</span>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="text-gray-600">
                        {formatCurrency(product.costPrice)} сум
                      </td>
                      <td className="font-medium text-gray-900">
                        {formatCurrency(product.sellPrice)} сум
                      </td>
                      <td>
                        <span
                          className={
                            isLowStock ? 'badge-danger' : 'badge-success'
                          }
                        >
                          {product.stock} шт
                        </span>
                      </td>
                      <td className="text-gray-600">
                        {product.supplier?.name || '—'}
                      </td>
                      <td>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={(e) => openStockModal(product.id, e)}
                            className="p-1.5 text-gray-400 hover:text-blue-600 rounded-lg hover:bg-blue-50 transition-colors"
                            title="Движение товара"
                          >
                            <ArrowUpDown className="w-4 h-4" />
                          </button>
                          <button
                            onClick={(e) => openEditModal(product, e)}
                            className="p-1.5 text-gray-400 hover:text-primary-600 rounded-lg hover:bg-gray-100 transition-colors"
                            title="Редактировать"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={(e) => handleDelete(product.id, e)}
                            className="p-1.5 text-gray-400 hover:text-red-600 rounded-lg hover:bg-red-50 transition-colors"
                            title="Удалить"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
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

      {/* Create/Edit Product Modal */}
      <Modal
        isOpen={modalOpen}
        onClose={closeModal}
        title={editingProduct ? 'Редактировать товар' : 'Новый товар'}
        size="lg"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">Название</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="input"
              placeholder="Название товара"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Категория</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="input"
              >
                <option value="">Без категории</option>
                {CATEGORIES.filter((c) => c !== 'Все').map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="label">Поставщик</label>
              <select
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
                className="input"
              >
                <option value="">Не указан</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Закупочная цена</label>
              <input
                type="number"
                value={costPrice}
                onChange={(e) => setCostPrice(e.target.value)}
                className="input"
                placeholder="0"
                min="0"
                required
              />
            </div>

            <div>
              <label className="label">Продажная цена</label>
              <input
                type="number"
                value={sellPrice}
                onChange={(e) => setSellPrice(e.target.value)}
                className="input"
                placeholder="0"
                min="0"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Остаток на складе</label>
              <input
                type="number"
                value={stock}
                onChange={(e) => setStock(e.target.value)}
                className="input"
                placeholder="0"
                min="0"
                required
              />
            </div>

            <div>
              <label className="label">Мин. остаток (предупреждение)</label>
              <input
                type="number"
                value={minStock}
                onChange={(e) => setMinStock(e.target.value)}
                className="input"
                placeholder="0"
                min="0"
                required
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-200">
            <button type="button" onClick={closeModal} className="btn-secondary">
              Отмена
            </button>
            <button
              type="submit"
              disabled={createMutation.isPending || updateMutation.isPending}
              className="btn-primary"
            >
              {editingProduct ? 'Сохранить' : 'Создать'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Stock Adjustment Modal */}
      <Modal
        isOpen={stockModalOpen}
        onClose={closeStockModal}
        title="Движение товара"
      >
        <form onSubmit={handleStockSubmit} className="space-y-4">
          <div>
            <label className="label">Тип операции</label>
            <select
              value={stockType}
              onChange={(e) => setStockType(e.target.value)}
              className="input"
              required
            >
              {STOCK_MOVEMENT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="label">Количество</label>
            <input
              type="number"
              value={stockQuantity}
              onChange={(e) => setStockQuantity(e.target.value)}
              className="input"
              placeholder="0"
              min="1"
              required
            />
          </div>

          <div>
            <label className="label">Причина / Комментарий</label>
            <textarea
              value={stockReason}
              onChange={(e) => setStockReason(e.target.value)}
              className="input"
              rows={3}
              placeholder="Укажите причину (необязательно)"
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-200">
            <button
              type="button"
              onClick={closeStockModal}
              className="btn-secondary"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={stockMutation.isPending}
              className="btn-primary"
            >
              Применить
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete Confirm */}
      <ConfirmDialog
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={confirmDelete}
        title="Удалить товар"
        message="Вы уверены, что хотите удалить этот товар? Это действие нельзя отменить."
        confirmText="Удалить"
        variant="danger"
      />
    </div>
  );
}
