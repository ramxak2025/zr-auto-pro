import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Wrench, Plus, Package, User, Calendar, AlertTriangle, RefreshCw,
  Trash2, ChevronRight, ChevronDown, X, Search, Archive, Clock, CheckCircle,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { equipmentApi, productsApi, usersApi, uploadsApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import Modal from '../components/Modal';
import { formatMoney } from '../../../shared/utils/formatters';
import type { Product, User as UserType } from '../types';

const STATUS_MAP: Record<string, { label: string; color: string; bg: string }> = {
  active: { label: 'Активно', color: 'text-green-700', bg: 'bg-green-50' },
  replaced: { label: 'Заменено', color: 'text-blue-700', bg: 'bg-blue-50' },
  returned: { label: 'Возвращено', color: 'text-gray-700', bg: 'bg-gray-100' },
  written_off: { label: 'Списано', color: 'text-red-700', bg: 'bg-red-50' },
};

export default function EquipmentPage() {
  const { hasPermission, isRole } = useAuth();
  const queryClient = useQueryClient();
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editItem, setEditItem] = useState<any>(null);
  const [expandedUser, setExpandedUser] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const canEdit = isRole('director' as any, 'admin' as any, 'superadmin' as any);

  const { data: summary = [] } = useQuery({
    queryKey: ['equipment-summary'],
    queryFn: async () => { const res = await equipmentApi.getSummary(); return res.data; },
  });

  const { data: items = [], isLoading } = useQuery({
    queryKey: ['equipment', selectedUserId],
    queryFn: async () => {
      const params: any = { status: 'active' };
      if (selectedUserId) params.userId = selectedUserId;
      const res = await equipmentApi.getAll(params);
      return res.data;
    },
  });

  const { data: allItems = [] } = useQuery({
    queryKey: ['equipment-all', expandedUser],
    queryFn: async () => {
      if (!expandedUser) return [];
      const res = await equipmentApi.getAll({ userId: expandedUser });
      return res.data;
    },
    enabled: !!expandedUser,
  });

  const { data: masters = [] } = useQuery({
    queryKey: ['users-masters'],
    queryFn: async () => { const res = await usersApi.getAll(); return (res.data as UserType[]).filter(u => u.isActive && (u.role === 'master' || u.role === 'admin')); },
    staleTime: 60_000,
  });

  const { data: products = [] } = useQuery({
    queryKey: ['products-for-equipment'],
    queryFn: async () => { const res = await productsApi.getAll({ limit: 500 }); return (res.data as any)?.data || res.data || []; },
    staleTime: 60_000,
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => equipmentApi.create(data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['equipment'] }); queryClient.invalidateQueries({ queryKey: ['equipment-summary'] }); toast.success('Имущество выдано'); setShowCreateModal(false); },
    onError: () => toast.error('Ошибка'),
  });

  const writeOffMutation = useMutation({
    mutationFn: (id: string) => equipmentApi.writeOff(id, 'Списание'),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['equipment'] }); queryClient.invalidateQueries({ queryKey: ['equipment-summary'] }); toast.success('Списано'); },
  });

  const replaceMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => equipmentApi.replace(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['equipment'] }); queryClient.invalidateQueries({ queryKey: ['equipment-summary'] }); toast.success('Заменено'); },
  });

  const totalCost = summary.reduce((s: number, u: any) => s + u.totalCost, 0);
  const totalActive = summary.reduce((s: number, u: any) => s + u.activeCount, 0);
  const totalExpired = summary.reduce((s: number, u: any) => s + u.expiredCount, 0);

  const filteredSummary = search
    ? summary.filter((u: any) => u.fullName.toLowerCase().includes(search.toLowerCase()))
    : summary;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Имущество</h1>
          <p className="text-xs text-gray-400 mt-0.5">Учёт выданного оборудования и инструментов</p>
        </div>
        {canEdit && (
          <button onClick={() => setShowCreateModal(true)} className="btn-primary text-sm">
            <Plus className="h-4 w-4" />Выдать
          </button>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 text-center">
          <Package className="h-5 w-5 text-primary-500 mx-auto mb-1" />
          <p className="text-lg font-bold text-gray-900">{totalActive}</p>
          <p className="text-[10px] text-gray-400">Активных</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 text-center">
          <Wrench className="h-5 w-5 text-green-500 mx-auto mb-1" />
          <p className="text-lg font-bold text-green-600">{formatMoney(totalCost)}</p>
          <p className="text-[10px] text-gray-400">Общая стоимость</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 text-center">
          <AlertTriangle className="h-5 w-5 text-orange-500 mx-auto mb-1" />
          <p className="text-lg font-bold text-orange-600">{totalExpired}</p>
          <p className="text-[10px] text-gray-400">Истёк срок</p>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Поиск сотрудника..."
          className="input pl-9"
        />
      </div>

      {/* Employee cards */}
      <div className="space-y-3">
        {filteredSummary.map((emp: any) => {
          const isExpanded = expandedUser === emp.userId;
          const empItems = isExpanded ? allItems : [];
          return (
            <div key={emp.userId} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              <button
                onClick={() => setExpandedUser(isExpanded ? null : emp.userId)}
                className="w-full flex items-center gap-4 px-5 py-4 hover:bg-gray-50 transition-colors text-left"
              >
                {emp.avatar ? (
                  <img src={emp.avatar} alt="" className="h-11 w-11 rounded-full object-cover border-2 border-gray-100" />
                ) : (
                  <div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary-100 text-primary-700 font-bold text-sm">
                    {emp.fullName?.charAt(0) || '?'}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 truncate">{emp.fullName}</p>
                  <div className="flex items-center gap-3 mt-0.5">
                    <span className="text-xs text-gray-500">{emp.activeCount} предметов</span>
                    <span className="text-xs font-semibold text-primary-600">{formatMoney(emp.totalCost)}</span>
                    {emp.expiredCount > 0 && (
                      <span className="text-[10px] font-medium text-orange-600 bg-orange-50 px-1.5 py-0.5 rounded-full">
                        {emp.expiredCount} истёк срок
                      </span>
                    )}
                  </div>
                </div>
                <ChevronDown className={`h-5 w-5 text-gray-300 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
              </button>

              {isExpanded && (
                <div className="border-t border-gray-100 px-5 py-3 space-y-2">
                  {empItems.length === 0 ? (
                    <p className="text-sm text-gray-400 text-center py-4">Нет выданного имущества</p>
                  ) : (
                    empItems.map((item: any) => {
                      const st = STATUS_MAP[item.status] || STATUS_MAP.active;
                      const isExpiredDate = item.expiresAt && new Date(item.expiresAt) < new Date();
                      return (
                        <div key={item.id} className={`flex items-center gap-3 p-3 rounded-xl ${item.status === 'active' ? 'bg-gray-50' : 'bg-gray-50/50 opacity-60'}`}>
                          {item.photo ? (
                            <img src={item.photo} alt="" className="h-12 w-12 rounded-lg object-cover flex-shrink-0" />
                          ) : (
                            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-gray-100 flex-shrink-0">
                              <Package className="h-5 w-5 text-gray-300" />
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-900 truncate">{item.name}</p>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-xs font-semibold text-gray-700">{formatMoney(item.cost)}</span>
                              <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${st.bg} ${st.color}`}>{st.label}</span>
                              {isExpiredDate && item.status === 'active' && (
                                <span className="text-[10px] font-medium text-orange-600 bg-orange-50 px-1.5 py-0.5 rounded-full">Истёк срок</span>
                              )}
                            </div>
                            {item.serviceLifeMonths && (
                              <p className="text-[10px] text-gray-400 mt-0.5">
                                <Clock className="inline h-3 w-3 mr-0.5" />
                                Срок: {item.serviceLifeMonths} мес.
                              </p>
                            )}
                          </div>
                          {canEdit && item.status === 'active' && (
                            <div className="flex gap-1 flex-shrink-0">
                              <button
                                onClick={() => replaceMutation.mutate({ id: item.id, data: { reason: 'Замена' } })}
                                className="p-1.5 rounded-lg hover:bg-blue-50 text-blue-500"
                                title="Заменить"
                              >
                                <RefreshCw className="h-3.5 w-3.5" />
                              </button>
                              <button
                                onClick={() => writeOffMutation.mutate(item.id)}
                                className="p-1.5 rounded-lg hover:bg-red-50 text-red-400"
                                title="Списать"
                              >
                                <Archive className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Create modal */}
      {showCreateModal && (
        <CreateEquipmentModal
          masters={masters}
          products={products as Product[]}
          onClose={() => setShowCreateModal(false)}
          onSave={(data: any) => createMutation.mutate(data)}
          saving={createMutation.isPending}
        />
      )}
    </div>
  );
}

function CreateEquipmentModal({ masters, products, onClose, onSave, saving }: {
  masters: UserType[];
  products: Product[];
  onClose: () => void;
  onSave: (data: any) => void;
  saving: boolean;
}) {
  const [userId, setUserId] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [cost, setCost] = useState('');
  const [source, setSource] = useState<'new' | 'warehouse'>('new');
  const [productId, setProductId] = useState('');
  const [serviceLifeMonths, setServiceLifeMonths] = useState('');
  const [photo, setPhoto] = useState('');
  const [uploading, setUploading] = useState(false);

  const handlePhotoUpload = async (file: File) => {
    setUploading(true);
    try {
      const res = await uploadsApi.upload(file);
      setPhoto(res.data.url);
    } catch { }
    setUploading(false);
  };

  const handleProductSelect = (pid: string) => {
    setProductId(pid);
    const p = products.find(pr => pr.id === pid);
    if (p) {
      setName(p.name);
      setCost(String(p.costPrice || p.sellPrice || 0));
      if (p.photo) setPhoto(p.photo);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId) { toast.error('Выберите сотрудника'); return; }
    if (!name.trim()) { toast.error('Укажите название'); return; }
    onSave({
      userId, name: name.trim(), description: description.trim() || undefined,
      cost: parseFloat(cost) || 0, source,
      productId: source === 'warehouse' ? productId : undefined,
      serviceLifeMonths: parseInt(serviceLifeMonths) || undefined,
      photo: photo || undefined,
    });
  };

  return (
    <Modal isOpen onClose={onClose} title="Выдать имущество" size="lg">
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Employee */}
        <div>
          <label className="label">Сотрудник</label>
          <select value={userId} onChange={e => setUserId(e.target.value)} className="input">
            <option value="">Выберите</option>
            {masters.map(m => <option key={m.id} value={m.id}>{m.fullName}</option>)}
          </select>
        </div>

        {/* Source */}
        <div>
          <label className="label">Источник</label>
          <div className="flex gap-2">
            <button type="button" onClick={() => setSource('new')}
              className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-all ${source === 'new' ? 'bg-primary-50 text-primary-700 border border-primary-200' : 'bg-gray-50 text-gray-500 border border-gray-200'}`}>
              Новый
            </button>
            <button type="button" onClick={() => setSource('warehouse')}
              className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-all ${source === 'warehouse' ? 'bg-primary-50 text-primary-700 border border-primary-200' : 'bg-gray-50 text-gray-500 border border-gray-200'}`}>
              Со склада
            </button>
          </div>
        </div>

        {/* From warehouse — product picker */}
        {source === 'warehouse' && (
          <div>
            <label className="label">Товар со склада</label>
            <select value={productId} onChange={e => handleProductSelect(e.target.value)} className="input">
              <option value="">Выберите товар</option>
              {products.filter(p => p.stock > 0).map(p => (
                <option key={p.id} value={p.id}>{p.name} — {formatMoney(p.costPrice)} (ост: {p.stock})</option>
              ))}
            </select>
          </div>
        )}

        {/* Name + Cost */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Название</label>
            <input value={name} onChange={e => setName(e.target.value)} className="input" placeholder="Набор инструментов" />
          </div>
          <div>
            <label className="label">Стоимость, ₽</label>
            <input value={cost} onChange={e => setCost(e.target.value)} className="input" placeholder="0" type="number" />
          </div>
        </div>

        {/* Description */}
        <div>
          <label className="label">Описание</label>
          <input value={description} onChange={e => setDescription(e.target.value)} className="input" placeholder="Необязательно" />
        </div>

        {/* Service life */}
        <div>
          <label className="label">Срок службы (мес.)</label>
          <input value={serviceLifeMonths} onChange={e => setServiceLifeMonths(e.target.value)} className="input" placeholder="12" type="number" />
        </div>

        {/* Photo */}
        <div>
          <label className="label">Фото</label>
          <div className="flex items-center gap-3">
            {photo && <img src={photo} alt="" className="h-16 w-16 rounded-lg object-cover" />}
            <label className="btn-secondary text-xs cursor-pointer">
              {uploading ? 'Загрузка...' : 'Загрузить фото'}
              <input type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handlePhotoUpload(f); }} />
            </label>
          </div>
        </div>

        <button type="submit" disabled={saving} className="btn-primary w-full">
          {saving ? 'Сохранение...' : 'Выдать имущество'}
        </button>
      </form>
    </Modal>
  );
}
