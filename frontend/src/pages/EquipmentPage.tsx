import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Package,
  Plus,
  Users,
  Warehouse,
  Trash2,
  Clock,
  AlertTriangle,
  FolderPlus,
  Wrench,
  Shirt,
  RotateCcw,
  ChevronRight,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import toast from 'react-hot-toast';
import { equipmentApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  DataTable,
  EmptyState,
  Field,
  IconButton,
  Input,
  Modal,
  Money,
  PageHeader,
  QueryState,
  SearchInput,
  SegmentedControl,
  Select,
  SkeletonCard,
  TabPanel,
  Tabs,
  Toolbar,
  cn,
  toneChip,
} from '../ui';
import type { DataTableColumn, TabItem, Tone } from '../ui';
import ImageUpload from '../components/ImageUpload';
import PhotoLightbox from '../components/warehouse/PhotoLightbox';
import { countLabel, parseNumberInput } from '../components/warehouse/format';
import { useUrlParams } from '../components/warehouse/useUrlParams';
import { formatMoney } from '../../../shared/utils/formatters';

// API имущества типизирован как any[] — локальные формы записей.
interface EquipmentItem {
  id: string;
  name: string;
  cost: number;
  status?: string;
  categoryType?: string;
  photo?: string | null;
  serviceLifeMonths?: number | null;
  expiresAt?: string | null;
  userName?: string | null;
  trashExpiresAt?: string | null;
}
interface StorageItem {
  id: string;
  name: string;
  purchasePrice: number;
  quantity: number;
  unit?: string;
  photo?: string | null;
  serviceLifeMonths?: number | null;
  categoryId?: string | null;
}
interface EquipmentCategory {
  id: string;
  name: string;
}
interface EmployeeSummary {
  userId: string;
  fullName: string;
  avatar?: string | null;
  toolsCount: number;
  uniformCount: number;
  expiredCount: number;
  activeCount: number;
  totalCost: number;
}

type Tab = 'employees' | 'storage' | 'trash';
type CategoryKey = 'tools' | 'uniform' | 'other';

const CATEGORY_TYPES: { key: CategoryKey; label: string; icon: LucideIcon; tone: Tone }[] = [
  { key: 'tools', label: 'Инструменты', icon: Wrench, tone: 'accent' },
  { key: 'uniform', label: 'Форма', icon: Shirt, tone: 'info' },
  { key: 'other', label: 'Прочее', icon: Package, tone: 'neutral' },
];

function categoryMeta(key?: string) {
  return CATEGORY_TYPES.find((c) => c.key === key) ?? CATEGORY_TYPES[2];
}

function initialsOf(name?: string): string {
  return (
    name
      ?.trim()
      .split(/\s+/)
      .map((w) => w[0])
      .join('')
      .slice(0, 2)
      .toUpperCase() || '?'
  );
}

function Avatar({ name, src, size = 'md' }: { name: string; src?: string | null; size?: 'sm' | 'md' | 'lg' }) {
  const cls = size === 'lg' ? 'h-14 w-14 text-lg' : size === 'sm' ? 'h-8 w-8 text-xs' : 'h-10 w-10 text-sm';
  return src ? (
    <img src={src} alt="" className={cn('flex-shrink-0 rounded-full object-cover', cls)} />
  ) : (
    <span
      className={cn(
        'flex flex-shrink-0 items-center justify-center rounded-full bg-accent-soft font-semibold text-accent-text',
        cls,
      )}
      aria-hidden="true"
    >
      {initialsOf(name)}
    </span>
  );
}

function PhotoThumb({
  photo,
  name,
  onPreview,
}: {
  photo?: string | null;
  name: string;
  onPreview: (url: string) => void;
}) {
  if (photo) {
    return (
      <button
        type="button"
        aria-label={`Открыть фото: ${name}`}
        onClick={() => onPreview(photo)}
        className="h-10 w-10 flex-shrink-0 overflow-hidden rounded-md bg-surface-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2"
      >
        <img src={photo} alt="" className="h-full w-full object-cover" loading="lazy" />
      </button>
    );
  }
  return (
    <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md bg-surface-3">
      <Package className="h-4 w-4 text-ink-4" aria-hidden="true" />
    </span>
  );
}

// ─── Имущество сотрудника ────────────────────────────────────────────────────

function EmployeeDetail({
  employee,
  onBack,
  canEdit,
}: {
  employee: EmployeeSummary;
  onBack: () => void;
  canEdit: boolean;
}) {
  const queryClient = useQueryClient();
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [showIssue, setShowIssue] = useState(false);
  const [trashTarget, setTrashTarget] = useState<EquipmentItem | null>(null);

  const itemsQuery = useQuery({
    queryKey: ['equipment-user', employee.userId],
    queryFn: async () => (await equipmentApi.getByUser(employee.userId, true)).data as EquipmentItem[],
  });
  const items = useMemo(() => itemsQuery.data ?? [], [itemsQuery.data]);

  const storageQuery = useQuery({
    queryKey: ['equipment-storage-all'],
    queryFn: async () => (await equipmentApi.getStorageItems()).data as StorageItem[],
    enabled: showIssue,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['equipment'] });
    queryClient.invalidateQueries({ queryKey: ['equipment-user', employee.userId] });
    queryClient.invalidateQueries({ queryKey: ['equipment-summary'] });
    queryClient.invalidateQueries({ queryKey: ['eq-storage'] });
    queryClient.invalidateQueries({ queryKey: ['eq-trash'] });
  };

  const issueMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => equipmentApi.issue(data),
    onSuccess: () => {
      invalidate();
      toast.success('Выдано');
      setShowIssue(false);
    },
    onError: () => toast.error('Не удалось выдать'),
  });

  const trashMutation = useMutation({
    mutationFn: (id: string) => equipmentApi.trash(id, 'Списание'),
    onSuccess: () => {
      invalidate();
      toast.success('Перемещено в корзину');
    },
    onError: () => toast.error('Не удалось списать'),
  });

  const returnMutation = useMutation({
    mutationFn: (id: string) => equipmentApi.returnToStorage(id),
    onSuccess: () => {
      invalidate();
      toast.success('Возвращено на склад');
    },
    onError: () => toast.error('Не удалось вернуть'),
  });

  const activeItems = useMemo(() => items.filter((i) => i.status === 'active'), [items]);
  const totalCost = activeItems.reduce((s, i) => s + (i.cost || 0), 0);

  const columns: DataTableColumn<EquipmentItem>[] = [
    {
      key: 'name',
      header: 'Предмет',
      sortable: true,
      render: (item) => (
        <span className="flex min-w-0 items-center gap-3">
          <PhotoThumb photo={item.photo} name={item.name} onPreview={setPhotoUrl} />
          <span className="truncate font-medium text-ink">{item.name}</span>
        </span>
      ),
      footer: (rows) => `Итого: ${countLabel(rows.length, ['предмет', 'предмета', 'предметов'])}`,
    },
    {
      key: 'categoryType',
      header: 'Категория',
      hideBelow: 'sm',
      sortable: true,
      render: (item) => {
        const meta = categoryMeta(item.categoryType);
        return (
          <Badge tone={meta.tone} icon={meta.icon}>
            {meta.label}
          </Badge>
        );
      },
    },
    {
      key: 'serviceLifeMonths',
      header: 'Срок службы',
      hideBelow: 'md',
      render: (item) => {
        if (!item.serviceLifeMonths) return <span className="text-ink-3">—</span>;
        const expired = item.expiresAt && new Date(item.expiresAt) < new Date();
        return expired ? (
          <Badge tone="warn" icon={Clock}>
            Истёк срок
          </Badge>
        ) : (
          <span className="text-ink-2">{item.serviceLifeMonths} мес.</span>
        );
      },
    },
    {
      key: 'cost',
      header: 'Стоимость',
      numeric: true,
      sortable: true,
      render: (item) => <Money value={item.cost} className="font-medium text-ink" />,
      footer: () => <Money value={totalCost} />,
    },
    ...(canEdit
      ? ([
          {
            key: 'actions',
            header: <span className="sr-only">Действия</span>,
            interactive: true,
            align: 'right',
            width: 96,
            render: (item) => (
              <span className="inline-flex items-center justify-end gap-1">
                <IconButton
                  label={`Вернуть на склад: ${item.name}`}
                  icon={RotateCcw}
                  size="sm"
                  onClick={() => returnMutation.mutate(item.id)}
                  disabled={returnMutation.isPending}
                />
                <IconButton
                  label={`Списать: ${item.name}`}
                  icon={Trash2}
                  size="sm"
                  variant="danger"
                  onClick={() => setTrashTarget(item)}
                  disabled={trashMutation.isPending}
                />
              </span>
            ),
          },
        ] as DataTableColumn<EquipmentItem>[])
      : []),
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title={employee.fullName}
        backTo={onBack}
        subtitle={
          itemsQuery.data
            ? `${countLabel(activeItems.length, ['предмет', 'предмета', 'предметов'])} на ${formatMoney(totalCost)}`
            : 'Выданное имущество'
        }
        meta={<Avatar name={employee.fullName} src={employee.avatar} size="sm" />}
        actions={
          canEdit ? (
            <Button icon={Plus} onClick={() => setShowIssue(true)}>
              Выдать
            </Button>
          ) : undefined
        }
      />

      <DataTable
        rows={activeItems}
        rowKey={(i) => i.id}
        columns={columns}
        caption={`Имущество: ${employee.fullName}`}
        defaultSort={{ key: 'categoryType', dir: 'asc' }}
        isLoading={itemsQuery.isLoading}
        isError={itemsQuery.isError}
        onRetry={() => itemsQuery.refetch()}
        isFetching={itemsQuery.isFetching}
        emptyState={{
          icon: Package,
          title: 'Имущество не выдано',
          description: canEdit ? 'Выдайте инструмент или форму со склада или заведите новый предмет' : undefined,
        }}
      />

      {showIssue && (
        <IssueModal
          userId={employee.userId}
          storageItems={storageQuery.data ?? []}
          storageLoading={storageQuery.isLoading}
          onClose={() => setShowIssue(false)}
          onSave={(d) => issueMutation.mutate(d)}
          saving={issueMutation.isPending}
        />
      )}

      <ConfirmDialog
        isOpen={!!trashTarget}
        onClose={() => setTrashTarget(null)}
        onConfirm={() => trashTarget && trashMutation.mutate(trashTarget.id)}
        title="Списать предмет?"
        message={`«${trashTarget?.name ?? ''}» переедет в корзину имущества; в течение 7 дней его можно восстановить.`}
        confirmText="Списать"
        variant="danger"
      />

      <PhotoLightbox url={photoUrl} onClose={() => setPhotoUrl(null)} />
    </div>
  );
}

// ─── Выдача ──────────────────────────────────────────────────────────────────

function IssueModal({
  userId,
  storageItems,
  storageLoading,
  onClose,
  onSave,
  saving,
}: {
  userId: string;
  storageItems: StorageItem[];
  storageLoading: boolean;
  onClose: () => void;
  onSave: (data: Record<string, unknown>) => void;
  saving: boolean;
}) {
  const [source, setSource] = useState<'storage' | 'new'>('storage');
  const [storageItemId, setStorageItemId] = useState('');
  const [name, setName] = useState('');
  const [cost, setCost] = useState('');
  const [categoryType, setCategoryType] = useState<CategoryKey>('tools');
  const [serviceLife, setServiceLife] = useState('');
  const [photo, setPhoto] = useState('');

  const handleStorageSelect = (id: string) => {
    setStorageItemId(id);
    const item = storageItems.find((s) => s.id === id);
    if (item) {
      setName(item.name);
      setCost(String(item.purchasePrice));
      if (item.photo) setPhoto(item.photo);
      if (item.serviceLifeMonths) setServiceLife(String(item.serviceLifeMonths));
    }
  };

  const submit = () => {
    if (!name.trim()) {
      toast.error('Укажите название');
      return;
    }
    onSave({
      userId,
      name: name.trim(),
      cost: parseNumberInput(cost) ?? 0,
      categoryType,
      storageItemId: source === 'storage' ? storageItemId || undefined : undefined,
      serviceLifeMonths: parseInt(serviceLife, 10) || undefined,
      photo: photo || undefined,
    });
  };

  const available = storageItems.filter((s) => s.quantity > 0);

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Выдать имущество"
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Отмена
          </Button>
          <Button onClick={submit} loading={saving}>
            Выдать
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <SegmentedControl<'storage' | 'new'>
          aria-label="Источник"
          fullWidth
          value={source}
          onChange={setSource}
          options={[
            { value: 'storage', label: 'Со склада' },
            { value: 'new', label: 'Новый предмет' },
          ]}
        />

        {source === 'storage' && (
          <Field
            label="Предмет со склада"
            htmlFor="issue-storage-item"
            hint={
              storageLoading
                ? 'Загружаем склад…'
                : available.length === 0
                  ? 'На складе нет доступных предметов'
                  : undefined
            }
          >
            <Select
              id="issue-storage-item"
              value={storageItemId}
              onChange={(e) => handleStorageSelect(e.target.value)}
              placeholder="Выберите со склада"
              options={available.map((s) => ({
                value: s.id,
                label: `${s.name} — ${formatMoney(s.purchasePrice)} (ост. ${s.quantity})`,
              }))}
            />
          </Field>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Название" htmlFor="issue-name" required>
            <Input id="issue-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
          </Field>
          <Field label="Стоимость, ₽" htmlFor="issue-cost">
            <Input
              id="issue-cost"
              inputMode="decimal"
              value={cost}
              onChange={(e) => setCost(e.target.value)}
              className="tabular-nums"
            />
          </Field>
        </div>

        <Field label="Категория">
          <SegmentedControl<CategoryKey>
            aria-label="Категория имущества"
            fullWidth
            value={categoryType}
            onChange={setCategoryType}
            options={CATEGORY_TYPES.map((c) => ({ value: c.key, label: c.label, icon: c.icon }))}
          />
        </Field>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Срок службы, мес." htmlFor="issue-life" hint="По истечении предмет подсветится">
            <Input
              id="issue-life"
              inputMode="numeric"
              value={serviceLife}
              onChange={(e) => setServiceLife(e.target.value)}
              placeholder="12"
              className="tabular-nums"
            />
          </Field>
          <Field label="Фото">
            <ImageUpload
              variant="avatar"
              label="Фото предмета"
              value={photo}
              onChange={setPhoto}
              onClear={() => setPhoto('')}
            />
          </Field>
        </div>
      </div>
    </Modal>
  );
}

// ─── Подсобка ────────────────────────────────────────────────────────────────

function StorageTab({ canEdit }: { canEdit: boolean }) {
  const queryClient = useQueryClient();
  const [params, setParam] = useUrlParams();
  const selectedCat = params.get('cat');
  const search = params.get('q') ?? '';

  const [showCreate, setShowCreate] = useState(false);
  const [catName, setCatName] = useState('');
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [deleteItemTarget, setDeleteItemTarget] = useState<StorageItem | null>(null);
  const [deleteCatOpen, setDeleteCatOpen] = useState(false);

  const categoriesQuery = useQuery({
    queryKey: ['eq-categories'],
    queryFn: async () => (await equipmentApi.getCategories()).data as EquipmentCategory[],
  });
  const categories = categoriesQuery.data ?? [];

  const itemsQuery = useQuery({
    queryKey: ['eq-storage', selectedCat, search],
    queryFn: async () =>
      (await equipmentApi.getStorageItems({ categoryId: selectedCat || undefined, search: search || undefined }))
        .data as StorageItem[],
  });
  const items = useMemo(() => itemsQuery.data ?? [], [itemsQuery.data]);

  const createCatMut = useMutation({
    mutationFn: (name: string) => equipmentApi.createCategory({ name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['eq-categories'] });
      setCatName('');
      toast.success('Папка создана');
    },
    onError: () => toast.error('Не удалось создать папку'),
  });
  const removeCatMut = useMutation({
    mutationFn: (id: string) => equipmentApi.removeCategory(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['eq-categories'] });
      queryClient.invalidateQueries({ queryKey: ['eq-storage'] });
      setParam({ cat: null });
      toast.success('Папка удалена');
    },
    onError: () => toast.error('Не удалось удалить папку'),
  });
  const createItemMut = useMutation({
    mutationFn: (data: Record<string, unknown>) => equipmentApi.createStorageItem(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['eq-storage'] });
      queryClient.invalidateQueries({ queryKey: ['equipment-storage-all'] });
      setShowCreate(false);
      toast.success('Добавлено на склад');
    },
    onError: () => toast.error('Не удалось добавить'),
  });
  const removeItemMut = useMutation({
    mutationFn: (id: string) => equipmentApi.removeStorageItem(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['eq-storage'] });
      queryClient.invalidateQueries({ queryKey: ['equipment-storage-all'] });
      toast.success('Удалено');
    },
    onError: () => toast.error('Не удалось удалить'),
  });

  // Count items per category (root view queries all items).
  const catCounts = useMemo(() => {
    const map: Record<string, number> = {};
    items.forEach((i) => {
      if (i.categoryId) map[i.categoryId] = (map[i.categoryId] || 0) + 1;
    });
    return map;
  }, [items]);

  const currentCategory = categories.find((c) => c.id === selectedCat);
  const inFolderOrSearch = !!selectedCat || !!search;

  const itemColumns: DataTableColumn<StorageItem>[] = [
    {
      key: 'name',
      header: 'Предмет',
      sortable: true,
      render: (item) => (
        <span className="flex min-w-0 items-center gap-3">
          <PhotoThumb photo={item.photo} name={item.name} onPreview={setPhotoUrl} />
          <span className="truncate font-medium text-ink">{item.name}</span>
        </span>
      ),
      footer: (rows) => `Итого: ${countLabel(rows.length, ['предмет', 'предмета', 'предметов'])}`,
    },
    {
      key: 'quantity',
      header: 'В наличии',
      numeric: true,
      sortable: true,
      render: (item) => (
        <span className={item.quantity > 0 ? 'text-ink-2' : 'text-bad-text'}>
          {item.quantity} {item.unit || 'шт'}
        </span>
      ),
    },
    {
      key: 'serviceLifeMonths',
      header: 'Срок службы',
      hideBelow: 'md',
      render: (item) =>
        item.serviceLifeMonths ? (
          <span className="text-ink-2">{item.serviceLifeMonths} мес.</span>
        ) : (
          <span className="text-ink-3">—</span>
        ),
    },
    {
      key: 'purchasePrice',
      header: 'Цена',
      numeric: true,
      sortable: true,
      render: (item) => <Money value={item.purchasePrice} className="font-medium text-ink" />,
      footer: (rows) => <Money value={rows.reduce((s, r) => s + (r.purchasePrice || 0) * (r.quantity || 0), 0)} />,
    },
    ...(canEdit
      ? ([
          {
            key: 'actions',
            header: <span className="sr-only">Действия</span>,
            interactive: true,
            align: 'right',
            width: 56,
            render: (item) => (
              <IconButton
                label={`Удалить: ${item.name}`}
                icon={Trash2}
                size="sm"
                variant="danger"
                onClick={() => setDeleteItemTarget(item)}
                disabled={removeItemMut.isPending}
              />
            ),
          },
        ] as DataTableColumn<StorageItem>[])
      : []),
  ];

  return (
    <div className="space-y-4">
      <Toolbar>
        {selectedCat && (
          <nav aria-label="Папки подсобки" className="flex min-w-0 items-center gap-1 text-sm">
            <button
              type="button"
              onClick={() => setParam({ cat: null, q: null })}
              className="inline-flex items-center gap-1 rounded-sm font-medium text-accent-text hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
            >
              <Warehouse className="h-4 w-4" aria-hidden="true" />
              Подсобка
            </button>
            <ChevronRight className="h-3.5 w-3.5 text-ink-4" aria-hidden="true" />
            <span className="truncate font-semibold text-ink" aria-current="page">
              {currentCategory?.name ?? '…'}
            </span>
          </nav>
        )}
        <div className="w-full sm:w-64">
          <SearchInput
            value={search}
            onChange={(value) => setParam({ q: value }, { replace: true })}
            placeholder="Поиск по подсобке…"
          />
        </div>
        {canEdit && inFolderOrSearch && (
          <div className="ml-auto">
            <Button icon={Plus} onClick={() => setShowCreate(true)}>
              Добавить на склад
            </Button>
          </div>
        )}
      </Toolbar>

      {/* Папки — на корневом уровне без поиска */}
      {!inFolderOrSearch && (
        <QueryState
          isLoading={categoriesQuery.isLoading}
          isError={categoriesQuery.isError}
          onRetry={() => categoriesQuery.refetch()}
          isFetching={categoriesQuery.isFetching}
          errorTitle="Не удалось загрузить папки"
          loader={<SkeletonCard lines={3} />}
        >
          {categories.length > 0 && (
            <Card as="div">
              <ul className="divide-y divide-line">
                {categories.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => setParam({ cat: c.id })}
                      aria-label={`Открыть папку «${c.name}»`}
                      className="flex w-full items-center gap-4 px-4 py-3 text-left transition-colors duration-150 hover:bg-surface-2 focus:outline-none focus-visible:bg-surface-2 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60"
                    >
                      <span
                        className={cn(
                          'flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg',
                          toneChip.warn,
                        )}
                      >
                        <Warehouse className="h-[18px] w-[18px]" aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-ink">{c.name}</span>
                        <span className="block text-xs text-ink-3">
                          {countLabel(catCounts[c.id] || 0, ['предмет', 'предмета', 'предметов'])}
                        </span>
                      </span>
                      <ChevronRight className="h-4 w-4 flex-shrink-0 text-ink-4" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {categories.length === 0 && !canEdit && (
            <Card>
              <EmptyState icon={Warehouse} title="В подсобке пока пусто" />
            </Card>
          )}
          {canEdit && (
            <form
              className="flex flex-col gap-2 sm:flex-row"
              onSubmit={(e) => {
                e.preventDefault();
                if (catName.trim()) createCatMut.mutate(catName.trim());
              }}
            >
              <Input
                leftIcon={FolderPlus}
                aria-label="Название новой папки"
                value={catName}
                onChange={(e) => setCatName(e.target.value)}
                placeholder="Название новой папки…"
                autoComplete="off"
                className="sm:flex-1"
              />
              <Button
                type="submit"
                variant="secondary"
                icon={FolderPlus}
                disabled={!catName.trim()}
                loading={createCatMut.isPending}
              >
                Создать папку
              </Button>
            </form>
          )}
        </QueryState>
      )}

      {/* Предметы — в папке или при поиске */}
      {inFolderOrSearch && (
        <>
          <DataTable
            rows={items}
            rowKey={(i) => i.id}
            columns={itemColumns}
            caption="Предметы в подсобке"
            isLoading={itemsQuery.isLoading}
            isError={itemsQuery.isError}
            onRetry={() => itemsQuery.refetch()}
            isFetching={itemsQuery.isFetching}
            emptyState={{
              icon: Package,
              title: search ? 'Ничего не найдено' : 'В папке пока пусто',
              description: search ? `По запросу «${search}» предметов нет` : undefined,
              action:
                canEdit && !search ? { label: 'Добавить на склад', onClick: () => setShowCreate(true) } : undefined,
            }}
          />
          {selectedCat && canEdit && (
            <div className="flex justify-end">
              <Button
                variant="ghost"
                size="sm"
                icon={Trash2}
                className="text-bad-text hover:bg-bad-soft hover:text-bad-text"
                onClick={() => setDeleteCatOpen(true)}
              >
                Удалить папку
              </Button>
            </div>
          )}
        </>
      )}

      {showCreate && (
        <CreateStorageItemModal
          categoryId={selectedCat}
          onClose={() => setShowCreate(false)}
          onSave={(d) => createItemMut.mutate(d)}
          saving={createItemMut.isPending}
        />
      )}

      <ConfirmDialog
        isOpen={!!deleteItemTarget}
        onClose={() => setDeleteItemTarget(null)}
        onConfirm={() => deleteItemTarget && removeItemMut.mutate(deleteItemTarget.id)}
        title="Удалить предмет со склада?"
        message={`«${deleteItemTarget?.name ?? ''}» будет удалён из подсобки.`}
        confirmText="Удалить"
        variant="danger"
      />

      <ConfirmDialog
        isOpen={deleteCatOpen}
        onClose={() => setDeleteCatOpen(false)}
        onConfirm={() => selectedCat && removeCatMut.mutate(selectedCat)}
        title="Удалить папку?"
        message={`Папка «${currentCategory?.name ?? ''}» будет удалена.`}
        confirmText="Удалить папку"
        variant="danger"
      />

      <PhotoLightbox url={photoUrl} onClose={() => setPhotoUrl(null)} />
    </div>
  );
}

function CreateStorageItemModal({
  categoryId,
  onClose,
  onSave,
  saving,
}: {
  categoryId: string | null;
  onClose: () => void;
  onSave: (data: Record<string, unknown>) => void;
  saving: boolean;
}) {
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [qty, setQty] = useState('1');
  const [serviceLife, setServiceLife] = useState('');
  const [photo, setPhoto] = useState('');

  const submit = () => {
    if (!name.trim()) {
      toast.error('Укажите название');
      return;
    }
    onSave({
      name: name.trim(),
      purchasePrice: parseNumberInput(price) ?? 0,
      quantity: parseInt(qty, 10) || 1,
      categoryId,
      serviceLifeMonths: parseInt(serviceLife, 10) || undefined,
      photo: photo || undefined,
    });
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Добавить на склад"
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Отмена
          </Button>
          <Button onClick={submit} loading={saving}>
            Добавить
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Название" htmlFor="storage-name" required>
          <Input id="storage-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Цена, ₽" htmlFor="storage-price">
            <Input
              id="storage-price"
              inputMode="decimal"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className="tabular-nums"
            />
          </Field>
          <Field label="Кол-во" htmlFor="storage-qty">
            <Input
              id="storage-qty"
              inputMode="numeric"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              className="tabular-nums"
            />
          </Field>
          <Field label="Срок, мес." htmlFor="storage-life">
            <Input
              id="storage-life"
              inputMode="numeric"
              value={serviceLife}
              onChange={(e) => setServiceLife(e.target.value)}
              className="tabular-nums"
            />
          </Field>
        </div>
        <Field label="Фото">
          <ImageUpload
            variant="avatar"
            label="Фото предмета"
            value={photo}
            onChange={setPhoto}
            onClear={() => setPhoto('')}
          />
        </Field>
      </div>
    </Modal>
  );
}

// ─── Корзина ─────────────────────────────────────────────────────────────────

function TrashTab() {
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  // Безвозвратное удаление — owner-only ключ equipment_permanent_delete
  // (backend DELETE /equipment/:id; у системного «Администратора» сид false —
  // как прежний @Roles директор/superadmin). Кнопку прячем без права.
  const canPermanentDelete = hasPermission('equipment_permanent_delete');
  const [deleteTarget, setDeleteTarget] = useState<EquipmentItem | null>(null);

  const trashQuery = useQuery({
    queryKey: ['eq-trash'],
    queryFn: async () => (await equipmentApi.getTrash()).data as EquipmentItem[],
  });
  const trashItems = trashQuery.data ?? [];

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['eq'] });
    queryClient.invalidateQueries({ queryKey: ['eq-trash'] });
    queryClient.invalidateQueries({ queryKey: ['equipment'] });
    queryClient.invalidateQueries({ queryKey: ['equipment-summary'] });
  };
  const restoreMut = useMutation({
    mutationFn: (id: string) => equipmentApi.restore(id),
    onSuccess: () => {
      invalidate();
      toast.success('Восстановлено');
    },
    onError: () => toast.error('Не удалось восстановить'),
  });
  const deleteMut = useMutation({
    mutationFn: (id: string) => equipmentApi.remove(id),
    onSuccess: () => {
      invalidate();
      toast.success('Удалено навсегда');
    },
    onError: () => toast.error('Не удалось удалить'),
  });

  const daysLeft = (item: EquipmentItem): number | null =>
    item.trashExpiresAt
      ? Math.max(0, Math.ceil((new Date(item.trashExpiresAt).getTime() - Date.now()) / 86400000))
      : null;

  const columns: DataTableColumn<EquipmentItem>[] = [
    {
      key: 'name',
      header: 'Предмет',
      render: (item) => <span className="font-medium text-ink">{item.name}</span>,
    },
    {
      key: 'userName',
      header: 'Сотрудник',
      hideBelow: 'sm',
      render: (item) => item.userName || <span className="text-ink-3">—</span>,
    },
    {
      key: 'cost',
      header: 'Стоимость',
      numeric: true,
      render: (item) => <Money value={item.cost} />,
    },
    {
      key: 'daysLeft',
      header: 'Автоудаление',
      hideBelow: 'md',
      render: (item) => {
        const d = daysLeft(item);
        if (d === null) return <span className="text-ink-3">—</span>;
        return (
          <Badge tone={d <= 1 ? 'bad' : d <= 3 ? 'warn' : 'neutral'} icon={Clock}>
            через {countLabel(d, ['день', 'дня', 'дней'])}
          </Badge>
        );
      },
    },
    {
      key: 'actions',
      header: <span className="sr-only">Действия</span>,
      interactive: true,
      align: 'right',
      width: 96,
      render: (item) => (
        <span className="inline-flex items-center justify-end gap-1">
          <IconButton
            label={`Восстановить: ${item.name}`}
            icon={RotateCcw}
            size="sm"
            onClick={() => restoreMut.mutate(item.id)}
            disabled={restoreMut.isPending}
          />
          {canPermanentDelete && (
            <IconButton
              label={`Удалить навсегда: ${item.name}`}
              icon={X}
              size="sm"
              variant="danger"
              onClick={() => setDeleteTarget(item)}
              disabled={deleteMut.isPending}
            />
          )}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-3">Списанное имущество хранится 7 дней, затем удаляется автоматически.</p>
      <DataTable
        rows={trashItems}
        rowKey={(i) => i.id}
        columns={columns}
        caption="Корзина имущества"
        isLoading={trashQuery.isLoading}
        isError={trashQuery.isError}
        onRetry={() => trashQuery.refetch()}
        isFetching={trashQuery.isFetching}
        emptyState={{ icon: Trash2, title: 'Корзина пуста' }}
      />
      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && deleteMut.mutate(deleteTarget.id)}
        title="Удалить навсегда?"
        message={`«${deleteTarget?.name ?? ''}» будет удалён без возможности восстановления.`}
        confirmText="Удалить навсегда"
        variant="danger"
      />
    </div>
  );
}

// ─── Страница ────────────────────────────────────────────────────────────────

const TABS: TabItem<Tab>[] = [
  { key: 'employees', label: 'Сотрудники', icon: Users },
  { key: 'storage', label: 'Подсобка', icon: Warehouse },
  { key: 'trash', label: 'Корзина', icon: Trash2 },
];

export default function EquipmentPage() {
  const { user, hasPermission } = useAuth();
  // Волна «права как в Битрикс24»: CRUD имущества (выдача/возврат/списание/
  // склад/корзина) — только с equipment_manage; байпас superadmin/director —
  // внутри hasPermission, admin — по матрице роли. Просмотр — equipment_view.
  const canEdit = hasPermission('equipment_manage');
  const isMaster = user?.role === 'master';

  // Вкладка и выбранный сотрудник — в URL.
  const [params, setParam] = useUrlParams();
  const tabParam = params.get('tab');
  const tab: Tab = tabParam === 'storage' || tabParam === 'trash' ? tabParam : 'employees';
  const employeeId = params.get('employee');
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);

  const summaryQuery = useQuery({
    queryKey: ['equipment-summary'],
    queryFn: async () => (await equipmentApi.getSummary()).data as EmployeeSummary[],
    enabled: !isMaster,
  });
  const summary = summaryQuery.data ?? [];

  const myQuery = useQuery({
    queryKey: ['equipment-my'],
    queryFn: async () => (await equipmentApi.getMyEquipment()).data as EquipmentItem[],
    enabled: isMaster,
  });

  // Мастер видит только своё имущество.
  if (isMaster) {
    const items = myQuery.data ?? [];
    const total = items.reduce((s, i) => s + (i.cost || 0), 0);
    const myColumns: DataTableColumn<EquipmentItem>[] = [
      {
        key: 'name',
        header: 'Предмет',
        render: (item) => (
          <span className="flex min-w-0 items-center gap-3">
            <PhotoThumb photo={item.photo} name={item.name} onPreview={setPhotoUrl} />
            <span className="truncate font-medium text-ink">{item.name}</span>
          </span>
        ),
        footer: (rows) => `Итого: ${countLabel(rows.length, ['предмет', 'предмета', 'предметов'])}`,
      },
      {
        key: 'categoryType',
        header: 'Категория',
        hideBelow: 'sm',
        render: (item) => {
          const meta = categoryMeta(item.categoryType);
          return (
            <Badge tone={meta.tone} icon={meta.icon}>
              {meta.label}
            </Badge>
          );
        },
      },
      {
        key: 'cost',
        header: 'Стоимость',
        numeric: true,
        render: (item) => <Money value={item.cost} className="font-medium text-ink" />,
        footer: () => <Money value={total} />,
      },
    ];
    return (
      <div className="space-y-5">
        <PageHeader
          title="Моё имущество"
          icon={Package}
          subtitle={
            myQuery.data
              ? `${countLabel(items.length, ['предмет', 'предмета', 'предметов'])} на ${formatMoney(total)}`
              : undefined
          }
        />
        <DataTable
          rows={items}
          rowKey={(i) => i.id}
          columns={myColumns}
          caption="Моё имущество"
          isLoading={myQuery.isLoading}
          isError={myQuery.isError}
          onRetry={() => myQuery.refetch()}
          isFetching={myQuery.isFetching}
          emptyState={{ icon: Package, title: 'Имущество не выдано' }}
        />
        <PhotoLightbox url={photoUrl} onClose={() => setPhotoUrl(null)} />
      </div>
    );
  }

  // Карточка сотрудника — по ?employee=<userId>.
  if (employeeId) {
    const employee = summary.find((e) => e.userId === employeeId);
    if (!summaryQuery.data) {
      return (
        <div className="space-y-5">
          <PageHeader title="Имущество сотрудника" backTo={() => setParam({ employee: null })} />
          <QueryState
            isLoading={summaryQuery.isLoading}
            isError={summaryQuery.isError}
            onRetry={() => summaryQuery.refetch()}
            isFetching={summaryQuery.isFetching}
            loader={<SkeletonCard lines={4} />}
          >
            <></>
          </QueryState>
        </div>
      );
    }
    if (!employee) {
      return (
        <div className="space-y-5">
          <PageHeader title="Имущество сотрудника" backTo={() => setParam({ employee: null })} />
          <Card>
            <EmptyState
              icon={Users}
              title="Сотрудник не найден"
              description="Возможно, ссылка устарела"
              action={{ label: 'К списку сотрудников', onClick: () => setParam({ employee: null }) }}
            />
          </Card>
        </div>
      );
    }
    return <EmployeeDetail employee={employee} onBack={() => setParam({ employee: null })} canEdit={canEdit} />;
  }

  const summaryColumns: DataTableColumn<EmployeeSummary>[] = [
    {
      key: 'fullName',
      header: 'Сотрудник',
      primary: true,
      sortable: true,
      render: (emp) => (
        <span className="flex min-w-0 items-center gap-3">
          <Avatar name={emp.fullName} src={emp.avatar} size="sm" />
          <span className="truncate">{emp.fullName}</span>
        </span>
      ),
      footer: (rows) => `Итого: ${countLabel(rows.length, ['сотрудник', 'сотрудника', 'сотрудников'])}`,
    },
    {
      key: 'toolsCount',
      header: 'Инструменты',
      numeric: true,
      hideBelow: 'md',
      sortable: true,
      render: (emp) => (emp.toolsCount > 0 ? emp.toolsCount : <span className="text-ink-3">—</span>),
    },
    {
      key: 'uniformCount',
      header: 'Форма',
      numeric: true,
      hideBelow: 'md',
      sortable: true,
      render: (emp) => (emp.uniformCount > 0 ? emp.uniformCount : <span className="text-ink-3">—</span>),
    },
    {
      key: 'expiredCount',
      header: 'Истёк срок',
      numeric: true,
      hideBelow: 'sm',
      sortable: true,
      render: (emp) =>
        emp.expiredCount > 0 ? (
          <Badge tone="warn" icon={AlertTriangle}>
            {emp.expiredCount}
          </Badge>
        ) : (
          <span className="text-ink-3">—</span>
        ),
    },
    {
      key: 'activeCount',
      header: 'Предметов',
      numeric: true,
      hideBelow: 'sm',
      sortable: true,
      render: (emp) => emp.activeCount,
      footer: (rows) => rows.reduce((s, r) => s + (r.activeCount || 0), 0),
    },
    {
      key: 'totalCost',
      header: 'Стоимость',
      numeric: true,
      sortable: true,
      render: (emp) => <Money value={emp.totalCost} className="font-medium text-ink" />,
      footer: (rows) => <Money value={rows.reduce((s, r) => s + (r.totalCost || 0), 0)} />,
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Имущество"
        icon={Package}
        subtitle="Инструменты и форма: у сотрудников, в подсобке, в корзине"
      />

      <Tabs
        aria-label="Разделы имущества"
        idPrefix="equipment"
        items={TABS}
        value={tab}
        onChange={(key) => setParam({ tab: key === 'employees' ? null : key, cat: null, q: null })}
      />

      <TabPanel idPrefix="equipment" tabKey="employees" active={tab === 'employees'}>
        <DataTable
          rows={summary}
          rowKey={(emp) => emp.userId}
          onRowClick={(emp) => setParam({ employee: emp.userId })}
          rowLabel={(emp) => `Открыть имущество: ${emp.fullName}`}
          columns={summaryColumns}
          caption="Имущество по сотрудникам"
          isLoading={summaryQuery.isLoading}
          isError={summaryQuery.isError}
          onRetry={() => summaryQuery.refetch()}
          isFetching={summaryQuery.isFetching}
          emptyState={{
            icon: Users,
            title: 'Сотрудников пока нет',
            description: 'Имущество появится после выдачи сотрудникам',
          }}
        />
      </TabPanel>

      <TabPanel idPrefix="equipment" tabKey="storage" active={tab === 'storage'}>
        <StorageTab canEdit={canEdit} />
      </TabPanel>

      <TabPanel idPrefix="equipment" tabKey="trash" active={tab === 'trash'}>
        <TrashTab />
      </TabPanel>
    </div>
  );
}
