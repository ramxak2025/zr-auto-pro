import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Package,
  Plus,
  Users,
  Warehouse,
  Trash2,
  RefreshCw,
  ArrowLeft,
  Search,
  ChevronRight,
  Clock,
  AlertTriangle,
  FolderPlus,
  X,
  Wrench,
  Shirt,
  RotateCcw,
  Archive,
  Image as ImageIcon,
  Eye,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { equipmentApi, usersApi, uploadsApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import Modal from '../components/Modal';
import { formatMoney } from '../../../shared/utils/formatters';
import type { User as UserType } from '../types';

type Tab = 'employees' | 'storage' | 'trash';
const CATEGORY_TYPES = [
  { key: 'tools', label: 'Инструменты', icon: Wrench, color: 'text-blue-600', bg: 'bg-blue-50' },
  { key: 'uniform', label: 'Форма', icon: Shirt, color: 'text-purple-600', bg: 'bg-purple-50' },
  { key: 'other', label: 'Прочее', icon: Package, color: 'text-gray-600', bg: 'bg-gray-100' },
];

// ─── Photo Viewer Modal ─────────────────────────────────────────────
function PhotoViewer({ url, onClose }: { url: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80" onClick={onClose}>
      <button
        onClick={onClose}
        className="absolute top-4 right-4 p-2 rounded-full bg-white/20 text-white hover:bg-white/40"
      >
        <X className="h-6 w-6" />
      </button>
      <img
        src={url}
        alt=""
        className="max-w-[90vw] max-h-[85vh] rounded-xl object-contain"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}

// ─── Employee Detail Page ───────────────────────────────────────────
function EmployeeDetail({
  userId,
  userName,
  userAvatar,
  onBack,
  canEdit,
}: {
  userId: string;
  userName: string;
  userAvatar?: string;
  onBack: () => void;
  canEdit: boolean;
}) {
  const queryClient = useQueryClient();
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [showIssue, setShowIssue] = useState(false);

  const { data: items = [] } = useQuery({
    queryKey: ['equipment-user', userId],
    queryFn: async () => {
      const res = await equipmentApi.getByUser(userId, true);
      return res.data;
    },
  });

  const { data: storageItems = [] } = useQuery({
    queryKey: ['equipment-storage-all'],
    queryFn: async () => {
      const res = await equipmentApi.getStorageItems();
      return res.data;
    },
    enabled: showIssue,
  });

  const issueMutation = useMutation({
    mutationFn: (data: any) => equipmentApi.issue(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['equipment'] });
      toast.success('Выдано');
      setShowIssue(false);
    },
  });

  const trashMutation = useMutation({
    mutationFn: (id: string) => equipmentApi.trash(id, 'Списание'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['equipment'] });
      toast.success('В корзину');
    },
  });

  const returnMutation = useMutation({
    mutationFn: (id: string) => equipmentApi.returnToStorage(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['equipment'] });
      toast.success('Возвращено на склад');
    },
  });

  const activeItems = items.filter((i: any) => i.status === 'active');
  const tools = activeItems.filter((i: any) => i.categoryType === 'tools');
  const uniforms = activeItems.filter((i: any) => i.categoryType === 'uniform');
  const other = activeItems.filter((i: any) => i.categoryType === 'other');
  const totalCost = activeItems.reduce((s: number, i: any) => s + i.cost, 0);
  const initials =
    userName
      ?.split(' ')
      .map((w: string) => w[0])
      .join('')
      .slice(0, 2) || '?';

  const renderSection = (title: string, icon: any, items: any[], color: string) => {
    const Icon = icon;
    if (items.length === 0) return null;
    return (
      <div className="space-y-2" key={title}>
        <div className="flex items-center gap-2">
          <Icon className={`h-4 w-4 ${color}`} />
          <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
          <span className="text-xs text-gray-400">{items.length}</span>
        </div>
        {items.map((item: any) => {
          const expired = item.expiresAt && new Date(item.expiresAt) < new Date();
          return (
            <div
              key={item.id}
              className="flex items-center gap-3 p-3 bg-white rounded-xl border border-gray-100 shadow-sm"
            >
              {item.photo ? (
                <button onClick={() => setPhotoUrl(item.photo)} className="flex-shrink-0 group relative">
                  <img src={item.photo} alt="" className="h-14 w-14 rounded-lg object-cover" />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 rounded-lg flex items-center justify-center transition-all">
                    <Eye className="h-4 w-4 text-white opacity-0 group-hover:opacity-100" />
                  </div>
                </button>
              ) : (
                <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-gray-50 flex-shrink-0">
                  <Package className="h-6 w-6 text-gray-200" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-900 truncate">{item.name}</p>
                <p className="text-xs font-medium text-primary-600">{formatMoney(item.cost)}</p>
                {item.serviceLifeMonths && (
                  <p className={`text-[10px] mt-0.5 ${expired ? 'text-orange-600 font-medium' : 'text-gray-400'}`}>
                    <Clock className="inline h-3 w-3 mr-0.5" />
                    {expired ? 'Истёк срок' : `${item.serviceLifeMonths} мес.`}
                  </p>
                )}
              </div>
              {canEdit && (
                <div className="flex gap-1 flex-shrink-0">
                  <button
                    onClick={() => returnMutation.mutate(item.id)}
                    className="p-1.5 rounded-lg hover:bg-blue-50 text-blue-400"
                    title="На склад"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => trashMutation.mutate(item.id)}
                    className="p-1.5 rounded-lg hover:bg-red-50 text-red-400"
                    title="Списать"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="space-y-5">
      <button onClick={onBack} className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700">
        <ArrowLeft className="h-4 w-4" />
        Назад
      </button>

      {/* Employee header */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <div className="flex items-center gap-4">
          {userAvatar ? (
            <img src={userAvatar} alt="" className="h-16 w-16 rounded-full object-cover border-2 border-gray-100" />
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary-100 text-primary-700 font-bold text-xl">
              {initials}
            </div>
          )}
          <div className="flex-1">
            <h2 className="text-lg font-bold text-gray-900">{userName}</h2>
            <div className="flex items-center gap-4 mt-1">
              <span className="text-sm text-gray-500">{activeItems.length} предметов</span>
              <span className="text-sm font-bold text-primary-600">{formatMoney(totalCost)}</span>
            </div>
          </div>
          {canEdit && (
            <button onClick={() => setShowIssue(true)} className="btn-primary text-sm">
              <Plus className="h-4 w-4" />
              Выдать
            </button>
          )}
        </div>
      </div>

      {activeItems.length === 0 ? (
        <div className="text-center py-12">
          <Package className="h-10 w-10 text-gray-200 mx-auto mb-3" />
          <p className="text-sm text-gray-400">Нет выданного имущества</p>
        </div>
      ) : (
        <div className="space-y-5">
          {renderSection('Инструменты', Wrench, tools, 'text-blue-600')}
          {renderSection('Форма', Shirt, uniforms, 'text-purple-600')}
          {renderSection('Прочее', Package, other, 'text-gray-600')}
        </div>
      )}

      {showIssue && (
        <IssueModal
          userId={userId}
          storageItems={storageItems}
          onClose={() => setShowIssue(false)}
          onSave={(d: any) => issueMutation.mutate(d)}
          saving={issueMutation.isPending}
        />
      )}
      {photoUrl && <PhotoViewer url={photoUrl} onClose={() => setPhotoUrl(null)} />}
    </div>
  );
}

// ─── Issue Modal ────────────────────────────────────────────────────
function IssueModal({ userId, storageItems, onClose, onSave, saving }: any) {
  const [source, setSource] = useState<'storage' | 'new'>('storage');
  const [storageItemId, setStorageItemId] = useState('');
  const [name, setName] = useState('');
  const [cost, setCost] = useState('');
  const [categoryType, setCategoryType] = useState('tools');
  const [serviceLife, setServiceLife] = useState('');
  const [photo, setPhoto] = useState('');
  const [uploading, setUploading] = useState(false);

  const handleStorageSelect = (id: string) => {
    setStorageItemId(id);
    const item = storageItems.find((s: any) => s.id === id);
    if (item) {
      setName(item.name);
      setCost(String(item.purchasePrice));
      if (item.photo) setPhoto(item.photo);
      if (item.serviceLifeMonths) setServiceLife(String(item.serviceLifeMonths));
    }
  };

  return (
    <Modal isOpen onClose={onClose} title="Выдать имущество" size="lg">
      <div className="space-y-4">
        <div className="flex gap-2">
          {[
            { k: 'storage', l: 'Со склада' },
            { k: 'new', l: 'Новый' },
          ].map((s) => (
            <button
              key={s.k}
              type="button"
              onClick={() => setSource(s.k as any)}
              className={`flex-1 py-2 rounded-lg text-sm font-medium ${source === s.k ? 'bg-primary-50 text-primary-700 border border-primary-200' : 'bg-gray-50 text-gray-500'}`}
            >
              {s.l}
            </button>
          ))}
        </div>

        {source === 'storage' && (
          <select value={storageItemId} onChange={(e) => handleStorageSelect(e.target.value)} className="input">
            <option value="">Выберите со склада</option>
            {storageItems
              .filter((s: any) => s.quantity > 0)
              .map((s: any) => (
                <option key={s.id} value={s.id}>
                  {s.name} — {formatMoney(s.purchasePrice)} (ост: {s.quantity})
                </option>
              ))}
          </select>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Название</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className="input" />
          </div>
          <div>
            <label className="label">Стоимость ₽</label>
            <input value={cost} onChange={(e) => setCost(e.target.value)} className="input" type="number" />
          </div>
        </div>

        <div>
          <label className="label">Категория</label>
          <div className="flex gap-2">
            {CATEGORY_TYPES.map((ct) => (
              <button
                key={ct.key}
                type="button"
                onClick={() => setCategoryType(ct.key)}
                className={`flex-1 py-2 rounded-lg text-xs font-medium ${categoryType === ct.key ? `${ct.bg} ${ct.color} border border-current/20` : 'bg-gray-50 text-gray-400'}`}
              >
                {ct.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="label">Срок службы (мес.)</label>
          <input
            value={serviceLife}
            onChange={(e) => setServiceLife(e.target.value)}
            className="input"
            type="number"
            placeholder="12"
          />
        </div>

        <div className="flex items-center gap-3">
          {photo && <img src={photo} className="h-14 w-14 rounded-lg object-cover" />}
          <label className="btn-secondary text-xs cursor-pointer">
            {uploading ? '...' : 'Фото'}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                setUploading(true);
                try {
                  const r = await uploadsApi.upload(f);
                  setPhoto(r.data.url);
                } catch {}
                setUploading(false);
              }}
            />
          </label>
        </div>

        <button
          onClick={() => {
            if (!name.trim()) {
              toast.error('Укажите название');
              return;
            }
            onSave({
              userId,
              name: name.trim(),
              cost: parseFloat(cost) || 0,
              categoryType,
              storageItemId: source === 'storage' ? storageItemId : undefined,
              serviceLifeMonths: parseInt(serviceLife) || undefined,
              photo: photo || undefined,
            });
          }}
          disabled={saving}
          className="btn-primary w-full"
        >
          {saving ? 'Сохранение...' : 'Выдать'}
        </button>
      </div>
    </Modal>
  );
}

// ─── Storage Room Tab ───────────────────────────────────────────────
function StorageTab() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [catName, setCatName] = useState('');
  const [selectedCat, setSelectedCat] = useState<string | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);

  const { data: categories = [] } = useQuery({
    queryKey: ['eq-categories'],
    queryFn: async () => (await equipmentApi.getCategories()).data,
  });
  const { data: items = [] } = useQuery({
    queryKey: ['eq-storage', selectedCat, search],
    queryFn: async () =>
      (await equipmentApi.getStorageItems({ categoryId: selectedCat || undefined, search: search || undefined })).data,
  });

  const createCatMut = useMutation({
    mutationFn: (name: string) => equipmentApi.createCategory({ name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['eq-categories'] });
      setCatName('');
    },
  });
  const removeCatMut = useMutation({
    mutationFn: (id: string) => equipmentApi.removeCategory(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['eq-categories'] });
      setSelectedCat(null);
    },
  });
  const createItemMut = useMutation({
    mutationFn: (data: any) => equipmentApi.createStorageItem(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['eq-storage'] });
      setShowCreate(false);
      toast.success('Добавлено');
    },
  });
  const removeItemMut = useMutation({
    mutationFn: (id: string) => equipmentApi.removeStorageItem(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['eq-storage'] });
      toast.success('Удалено');
    },
  });

  // Count items per category
  const catCounts = useMemo(() => {
    const map: Record<string, number> = {};
    items.forEach((i: any) => {
      if (i.categoryId) map[i.categoryId] = (map[i.categoryId] || 0) + 1;
    });
    return map;
  }, [items]);

  return (
    <div className="space-y-4">
      {/* Breadcrumb */}
      {selectedCat && (
        <div className="flex items-center gap-2 text-sm">
          <button
            onClick={() => setSelectedCat(null)}
            className="text-primary-600 hover:underline flex items-center gap-1"
          >
            <Warehouse className="h-4 w-4" />
            Подсобка
          </button>
          <ChevronRight className="h-3 w-3 text-gray-400" />
          <span className="font-semibold text-gray-900">{categories.find((c: any) => c.id === selectedCat)?.name}</span>
        </div>
      )}

      {/* Folders view — when no category selected */}
      {!selectedCat && !search && categories.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          {categories.map((c: any) => (
            <button
              key={c.id}
              onClick={() => setSelectedCat(c.id)}
              className="w-full flex items-center gap-4 px-4 py-3.5 hover:bg-gray-50 active:bg-gray-100 transition-colors text-left border-b border-gray-50 last:border-0"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50">
                <Warehouse className="h-5 w-5 text-amber-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-900">{c.name}</p>
                <p className="text-xs text-gray-400">{catCounts[c.id] || 0} предметов</p>
              </div>
              <ChevronRight className="h-5 w-5 text-gray-300" />
            </button>
          ))}
        </div>
      )}

      {/* New folder input */}
      {!selectedCat && (
        <div className="flex gap-2">
          <div className="relative flex-1">
            <FolderPlus className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              value={catName}
              onChange={(e) => setCatName(e.target.value)}
              placeholder="Название новой папки..."
              className="input pl-9 text-sm"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && catName.trim()) createCatMut.mutate(catName.trim());
              }}
            />
          </div>
          {catName.trim() && (
            <button onClick={() => createCatMut.mutate(catName.trim())} className="btn-primary text-sm">
              Создать
            </button>
          )}
        </div>
      )}

      {/* Search + Add button — when inside a folder */}
      {(selectedCat || search) && (
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск..."
              className="input pl-9"
            />
          </div>
          <button onClick={() => setShowCreate(true)} className="btn-primary text-sm">
            <Plus className="h-4 w-4" />
            Добавить
          </button>
        </div>
      )}

      {/* Items list — when inside a folder or searching */}
      {(selectedCat || search) &&
        (items.length === 0 ? (
          <div className="text-center py-12">
            <Package className="h-10 w-10 text-gray-200 mx-auto mb-3" />
            <p className="text-sm text-gray-400">Пусто</p>
            <button onClick={() => setShowCreate(true)} className="btn-secondary text-xs mt-3">
              <Plus className="h-3 w-3" />
              Добавить
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {items.map((item: any) => (
              <div
                key={item.id}
                className="flex items-center gap-3 p-3 bg-white rounded-xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow"
              >
                {item.photo ? (
                  <button onClick={() => setPhotoUrl(item.photo)} className="flex-shrink-0 group relative">
                    <img src={item.photo} className="h-14 w-14 rounded-lg object-cover" />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 rounded-lg flex items-center justify-center transition-all">
                      <Eye className="h-4 w-4 text-white opacity-0 group-hover:opacity-100" />
                    </div>
                  </button>
                ) : (
                  <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-gray-50 flex-shrink-0">
                    <Package className="h-6 w-6 text-gray-200" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 truncate">{item.name}</p>
                  <div className="flex items-center gap-3 text-xs mt-0.5">
                    <span className="text-emerald-600 font-bold">{formatMoney(item.purchasePrice)}</span>
                    <span className="text-gray-400">
                      В наличии: {item.quantity} {item.unit}
                    </span>
                  </div>
                  {item.serviceLifeMonths && (
                    <p className="text-[10px] text-gray-400 mt-0.5">
                      <Clock className="inline h-3 w-3 mr-0.5" />
                      Срок: {item.serviceLifeMonths} мес.
                    </p>
                  )}
                </div>
                <button
                  onClick={() => removeItemMut.mutate(item.id)}
                  className="p-2 rounded-lg hover:bg-red-50 text-red-300 hover:text-red-500 transition-colors"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        ))}

      {/* Delete folder button */}
      {selectedCat && (
        <button
          onClick={() => removeCatMut.mutate(selectedCat)}
          className="text-xs text-red-400 hover:text-red-600 flex items-center gap-1 mx-auto"
        >
          <Trash2 className="h-3 w-3" />
          Удалить папку
        </button>
      )}

      {showCreate && (
        <CreateStorageItemModal
          categoryId={selectedCat}
          onClose={() => setShowCreate(false)}
          onSave={(d: any) => createItemMut.mutate(d)}
          saving={createItemMut.isPending}
        />
      )}
      {photoUrl && <PhotoViewer url={photoUrl} onClose={() => setPhotoUrl(null)} />}
    </div>
  );
}

function CreateStorageItemModal({ categoryId, onClose, onSave, saving }: any) {
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [qty, setQty] = useState('1');
  const [serviceLife, setServiceLife] = useState('');
  const [photo, setPhoto] = useState('');
  const [uploading, setUploading] = useState(false);

  return (
    <Modal isOpen onClose={onClose} title="Добавить на склад" size="md">
      <div className="space-y-3">
        <div>
          <label className="label">Название</label>
          <input value={name} onChange={(e) => setName(e.target.value)} className="input" />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="label">Цена ₽</label>
            <input value={price} onChange={(e) => setPrice(e.target.value)} className="input" type="number" />
          </div>
          <div>
            <label className="label">Кол-во</label>
            <input value={qty} onChange={(e) => setQty(e.target.value)} className="input" type="number" />
          </div>
          <div>
            <label className="label">Срок мес.</label>
            <input
              value={serviceLife}
              onChange={(e) => setServiceLife(e.target.value)}
              className="input"
              type="number"
            />
          </div>
        </div>
        <div className="flex items-center gap-3">
          {photo && <img src={photo} className="h-12 w-12 rounded-lg object-cover" />}
          <label className="btn-secondary text-xs cursor-pointer">
            {uploading ? '...' : 'Фото'}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                setUploading(true);
                try {
                  const r = await uploadsApi.upload(f);
                  setPhoto(r.data.url);
                } catch {}
                setUploading(false);
              }}
            />
          </label>
        </div>
        <button
          onClick={() => {
            if (!name.trim()) return;
            onSave({
              name: name.trim(),
              purchasePrice: parseFloat(price) || 0,
              quantity: parseInt(qty) || 1,
              categoryId,
              serviceLifeMonths: parseInt(serviceLife) || undefined,
              photo: photo || undefined,
            });
          }}
          disabled={saving}
          className="btn-primary w-full"
        >
          {saving ? '...' : 'Добавить'}
        </button>
      </div>
    </Modal>
  );
}

// ─── Trash Tab ──────────────────────────────────────────────────────
function TrashTab() {
  const queryClient = useQueryClient();
  const { data: trashItems = [] } = useQuery({
    queryKey: ['eq-trash'],
    queryFn: async () => (await equipmentApi.getTrash()).data,
  });
  const restoreMut = useMutation({
    mutationFn: (id: string) => equipmentApi.restore(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['eq'] });
      toast.success('Восстановлено');
    },
  });
  const deleteMut = useMutation({
    mutationFn: (id: string) => equipmentApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['eq'] });
      toast.success('Удалено навсегда');
    },
  });

  return trashItems.length === 0 ? (
    <div className="text-center py-12">
      <Trash2 className="h-10 w-10 text-gray-200 mx-auto mb-3" />
      <p className="text-sm text-gray-400">Корзина пуста</p>
    </div>
  ) : (
    <div className="space-y-2">
      <p className="text-xs text-gray-400">Автоудаление через 7 дней</p>
      {trashItems.map((item: any) => {
        const daysLeft = item.trashExpiresAt
          ? Math.max(0, Math.ceil((new Date(item.trashExpiresAt).getTime() - Date.now()) / 86400000))
          : '?';
        return (
          <div
            key={item.id}
            className="flex items-center gap-3 p-3 bg-white rounded-xl border border-gray-100 opacity-70"
          >
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">{item.name}</p>
              <p className="text-xs text-gray-400">
                {item.userName} · {formatMoney(item.cost)} · {daysLeft}д
              </p>
            </div>
            <button
              onClick={() => restoreMut.mutate(item.id)}
              className="p-1.5 rounded-lg hover:bg-green-50 text-green-500"
              title="Восстановить"
            >
              <RotateCcw className="h-4 w-4" />
            </button>
            <button
              onClick={() => deleteMut.mutate(item.id)}
              className="p-1.5 rounded-lg hover:bg-red-50 text-red-400"
              title="Удалить навсегда"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────
export default function EquipmentPage() {
  const { user, isRole, hasPermission } = useAuth();
  const [tab, setTab] = useState<Tab>('employees');
  const [selectedEmployee, setSelectedEmployee] = useState<any>(null);
  // ROLE-ONLY: CRUD имущества (выдача/возврат/списание/склад/корзина) — только
  // owner-class ИЛИ роль с equipment_manage. Просмотр — equipment_view.
  const canEdit = isRole('director' as any, 'admin' as any, 'superadmin' as any) || hasPermission('equipment_manage');
  const isMaster = user?.role === 'master';

  const { data: summary = [] } = useQuery({
    queryKey: ['equipment-summary'],
    queryFn: async () => {
      const res = await equipmentApi.getSummary();
      return res.data;
    },
    enabled: !isMaster,
  });

  const { data: myEquipment } = useQuery({
    queryKey: ['equipment-my'],
    queryFn: async () => {
      const res = await equipmentApi.getMyEquipment();
      return res.data;
    },
    enabled: isMaster,
  });

  // Master view — only their own equipment
  if (isMaster) {
    const items = myEquipment || [];
    const total = items.reduce((s: number, i: any) => s + i.cost, 0);
    return (
      <div className="space-y-5">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Моё имущество</h1>
          <p className="text-xs text-gray-400">
            {items.length} предметов на {formatMoney(total)}
          </p>
        </div>
        {items.length === 0 ? (
          <div className="text-center py-12">
            <Package className="h-10 w-10 text-gray-200 mx-auto mb-3" />
            <p className="text-sm text-gray-400">Нет выданного имущества</p>
          </div>
        ) : (
          items.map((item: any) => (
            <div
              key={item.id}
              className="flex items-center gap-3 p-4 bg-white rounded-xl border border-gray-100 shadow-sm"
            >
              {item.photo ? (
                <img src={item.photo} className="h-14 w-14 rounded-lg object-cover" />
              ) : (
                <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-gray-50">
                  <Package className="h-6 w-6 text-gray-200" />
                </div>
              )}
              <div className="flex-1">
                <p className="text-sm font-semibold text-gray-900">{item.name}</p>
                <p className="text-xs text-primary-600 font-medium">{formatMoney(item.cost)}</p>
              </div>
            </div>
          ))
        )}
      </div>
    );
  }

  // Employee detail view
  if (selectedEmployee) {
    return (
      <EmployeeDetail
        userId={selectedEmployee.userId}
        userName={selectedEmployee.fullName}
        userAvatar={selectedEmployee.avatar}
        onBack={() => setSelectedEmployee(null)}
        canEdit={canEdit}
      />
    );
  }

  const tabs: { key: Tab; label: string; icon: typeof Users }[] = [
    { key: 'employees', label: 'Сотрудники', icon: Users },
    { key: 'storage', label: 'Подсобка', icon: Warehouse },
    { key: 'trash', label: 'Корзина', icon: Trash2 },
  ];

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-bold text-gray-900">Имущество</h1>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all ${tab === t.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}
          >
            <t.icon className="h-4 w-4" />
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'employees' && (
        <div className="space-y-3">
          {summary.map((emp: any) => (
            <button
              key={emp.userId}
              onClick={() => setSelectedEmployee(emp)}
              className="w-full flex items-center gap-4 p-4 bg-white rounded-2xl border border-gray-100 shadow-sm hover:border-primary-200 hover:shadow-md transition-all text-left"
            >
              {emp.avatar ? (
                <img src={emp.avatar} alt="" className="h-12 w-12 rounded-full object-cover border-2 border-gray-100" />
              ) : (
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary-100 text-primary-700 font-bold">
                  {emp.fullName?.charAt(0)}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-900">{emp.fullName}</p>
                <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                  {emp.toolsCount > 0 && (
                    <span className="text-[10px] text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded-full">
                      <Wrench className="inline h-3 w-3 mr-0.5" />
                      {emp.toolsCount}
                    </span>
                  )}
                  {emp.uniformCount > 0 && (
                    <span className="text-[10px] text-purple-600 bg-purple-50 px-1.5 py-0.5 rounded-full">
                      <Shirt className="inline h-3 w-3 mr-0.5" />
                      {emp.uniformCount}
                    </span>
                  )}
                  {emp.expiredCount > 0 && (
                    <span className="text-[10px] text-orange-600 bg-orange-50 px-1.5 py-0.5 rounded-full">
                      <AlertTriangle className="inline h-3 w-3 mr-0.5" />
                      {emp.expiredCount}
                    </span>
                  )}
                </div>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-sm font-bold text-primary-600">{formatMoney(emp.totalCost)}</p>
                <p className="text-[10px] text-gray-400">{emp.activeCount} предм.</p>
              </div>
              <ChevronRight className="h-5 w-5 text-gray-300 flex-shrink-0" />
            </button>
          ))}
        </div>
      )}

      {tab === 'storage' && <StorageTab />}
      {tab === 'trash' && <TrashTab />}
    </div>
  );
}
