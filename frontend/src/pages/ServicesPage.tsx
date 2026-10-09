import { useMemo, useRef, useState, type FormEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus,
  Wrench,
  Pencil,
  Trash2,
  Eye,
  EyeOff,
  ShieldCheck,
  History,
  FileSpreadsheet,
  Download,
  Upload,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { servicesApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import {
  Badge,
  Button,
  Checkbox,
  ConfirmDialog,
  DataTable,
  Field,
  IconButton,
  Input,
  Modal,
  Money,
  PageHeader,
  SearchInput,
  Toolbar,
} from '../ui';
import type { DataTableColumn } from '../ui';
import type { Service, PaginatedResponse, ServiceVisibilityConfig, ServicePriceHistoryEntry } from '../types';
import { normalizeServiceCategoryPath } from '../../../shared/utils/normalizeServiceCategoryPath';
import { countLabel, formatPercent, parseNumberInput } from '../components/warehouse/format';
import { useUrlParams } from '../components/warehouse/useUrlParams';
import type { ServiceImportPreview } from '../../../shared/api/types';
import {
  assertNoServiceWorkbookFormulas,
  assertServiceWorkbookSafe,
  parseServiceImportMatrix,
  serviceExportMatrix,
} from '../../../shared/utils/serviceSpreadsheet';
import { servicePriceFormValue } from '../../../shared/utils/servicePrices';

const FORM_ID = 'service-form';

interface ServicePayload {
  name: string;
  category?: string;
  priceType: 'fixed' | 'range';
  defaultPrice: number;
  minPrice?: number;
  maxPrice?: number;
  masterPercent?: number | null;
  warrantyDays?: number | null;
}

export default function ServicesPage() {
  const queryClient = useQueryClient();
  const { hasPermission, user } = useAuth();
  // ROLE-ONLY: управление каталогом (add/edit/delete + %/гарантия) — только с
  // services_manage (байпас superadmin/director — внутри hasPermission; admin —
  // по матрице роли). services_view (просмотр + в чек) — у всех, кто сюда
  // попал; backend всё равно вернёт 403 без права.
  const canManage = hasPermission('services_manage');
  const isOwner = user?.role === 'director' || user?.role === 'superadmin';
  const [showAllServices, setShowAllServices] = useState(false);
  const preferredOnly = !isOwner && !showAllServices;

  // Поиск и страница — в URL: F5 и «Назад» сохраняют список.
  const [params, setParam] = useUrlParams();
  const search = params.get('q') ?? '';

  // Модалка формы
  const [modalOpen, setModalOpen] = useState(false);
  const [editingService, setEditingService] = useState<Service | null>(null);
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [defaultPrice, setDefaultPrice] = useState('');
  const [priceType, setPriceType] = useState<'fixed' | 'range'>('fixed');
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [masterPercent, setMasterPercent] = useState('');
  const [warrantyDays, setWarrantyDays] = useState('');

  const [deleteTarget, setDeleteTarget] = useState<Service | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const [importPreview, setImportPreview] = useState<ServiceImportPreview | null>(null);
  const [importRequestId, setImportRequestId] = useState<string | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [historyTarget, setHistoryTarget] = useState<Service | null>(null);
  const historyQuery = useQuery<ServicePriceHistoryEntry[]>({
    queryKey: ['service-price-history', historyTarget?.id],
    queryFn: async () => {
      if (!historyTarget) return [];
      return (await servicesApi.priceHistory(historyTarget.id)).data;
    },
    enabled: !!historyTarget,
  });
  const [visibilityTarget, setVisibilityTarget] = useState<
    { kind: 'service'; id: string; label: string } | { kind: 'category'; path: string } | null
  >(null);
  const [visibilityRoleIds, setVisibilityRoleIds] = useState<string[]>([]);
  const [visibilityRuleActive, setVisibilityRuleActive] = useState(false);
  const [folderListOpen, setFolderListOpen] = useState(false);

  const { data, isLoading, isError, isFetching, refetch } = useQuery<PaginatedResponse<Service>>({
    queryKey: ['services', { search, preferredOnly, limit: 10000 }],
    queryFn: async () => {
      const res = await servicesApi.getAll({ search, page: 1, limit: 10000, preferredOnly });
      return res.data;
    },
  });

  const visibilityConfigQuery = useQuery<ServiceVisibilityConfig>({
    queryKey: ['service-visibility-config'],
    queryFn: async () => (await servicesApi.getVisibilityConfig()).data,
    enabled: canManage,
  });

  const invalidateServiceLists = () => {
    void queryClient.invalidateQueries({ queryKey: ['services'] });
    void queryClient.invalidateQueries({ queryKey: ['services-all'] });
  };
  const saveVisibilityRule = useMutation({
    mutationFn: ({
      target,
      roleIds,
    }: {
      target: { kind: 'service'; id: string; label: string } | { kind: 'category'; path: string };
      roleIds: string[];
    }) =>
      servicesApi.putVisibilityRule(
        target.kind === 'service'
          ? { serviceId: target.id, visibleRoleIds: roleIds }
          : { categoryPath: target.path, visibleRoleIds: roleIds },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['service-visibility-config'] });
      invalidateServiceLists();
      toast.success('Предпочтительная видимость сохранена');
      setVisibilityTarget(null);
    },
    onError: () => toast.error('Не удалось сохранить видимость'),
  });
  const resetVisibilityRule = useMutation({
    mutationFn: (target: { kind: 'service'; id: string; label: string } | { kind: 'category'; path: string }) =>
      target.kind === 'service'
        ? servicesApi.deleteServiceVisibilityRule(target.id)
        : servicesApi.deleteCategoryVisibilityRule(target.path),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['service-visibility-config'] });
      invalidateServiceLists();
      toast.success('Правило сброшено, действует наследование');
      setVisibilityTarget(null);
    },
    onError: () => toast.error('Не удалось сбросить правило'),
  });
  const openVisibilityEditor = (
    target: { kind: 'service'; id: string; label: string } | { kind: 'category'; path: string },
  ) => {
    if (!visibilityConfigQuery.isSuccess) {
      toast.error('Сначала загрузите настройки видимости');
      void visibilityConfigQuery.refetch();
      return;
    }
    const canonicalTarget =
      target.kind === 'category' ? { ...target, path: normalizeServiceCategoryPath(target.path) } : target;
    const rules = visibilityConfigQuery.data.rules;
    const rule =
      canonicalTarget.kind === 'service'
        ? rules.find((item) => item.serviceId === canonicalTarget.id)
        : rules.find((item) => normalizeServiceCategoryPath(item.categoryPath ?? '') === canonicalTarget.path);
    setVisibilityRoleIds(rule ? [...rule.visibleRoleIds] : []);
    setVisibilityRuleActive(!!rule);
    setVisibilityTarget(canonicalTarget);
  };

  const createMutation = useMutation({
    mutationFn: (payload: ServicePayload) => servicesApi.create(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['services'] });
      toast.success('Услуга создана');
      closeModal();
    },
    onError: () => toast.error('Ошибка при создании услуги'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: ServicePayload }) => servicesApi.update(id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['services'] });
      toast.success('Услуга обновлена');
      closeModal();
    },
    onError: () => toast.error('Ошибка при обновлении услуги'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => servicesApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['services'] });
      toast.success('Услуга удалена');
    },
    onError: () => toast.error('Ошибка при удалении услуги'),
  });

  const exportCatalog = async () => {
    try {
      const XLSX = await import('xlsx-service-import');
      const response = await servicesApi.exportCatalog();
      const sheet = XLSX.utils.aoa_to_sheet(serviceExportMatrix(response.data));
      const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(book, sheet, 'Услуги');
      XLSX.writeFile(book, 'Каталог услуг Autexa.xlsx');
    } catch {
      toast.error('Не удалось выгрузить каталог услуг');
    }
  };

  const previewFile = async (file?: File) => {
    if (!file) return;
    setImportBusy(true);
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error('Файл больше 5 МБ');
      const bytes = new Uint8Array(await file.arrayBuffer());
      assertServiceWorkbookSafe(bytes);
      const XLSX = await import('xlsx-service-import');
      const book = XLSX.read(bytes, { type: 'array', raw: true, cellFormula: true, sheetRows: 2001 });
      assertNoServiceWorkbookFormulas(Object.values(book.Sheets) as Array<Record<string, { f?: unknown }>>);
      const sheet = book.Sheets[book.SheetNames[0]];
      if (!sheet) throw new Error('В книге нет листа с услугами');
      const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', raw: true });
      const rows = parseServiceImportMatrix(matrix);
      const result = await servicesApi.previewImport(rows);
      setImportPreview(result.data);
      setImportRequestId(crypto.randomUUID());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось прочитать файл услуг');
      setImportPreview(null);
      setImportRequestId(null);
    } finally {
      setImportBusy(false);
      if (importInputRef.current) importInputRef.current.value = '';
    }
  };

  const confirmImport = async () => {
    if (!importPreview || !importRequestId || importPreview.summary.errors > 0) return;
    setImportBusy(true);
    try {
      const result = await servicesApi.confirmImport(importPreview.previewId, importRequestId);
      await queryClient.invalidateQueries({ queryKey: ['services'] });
      await queryClient.invalidateQueries({ queryKey: ['services-all'] });
      toast.success(`Импорт завершён: создано ${result.data.created}, обновлено ${result.data.updated}`);
      setImportPreview(null);
      setImportRequestId(null);
    } catch (error) {
      const status = (error as { response?: { status?: number } })?.response?.status;
      toast.error(
        status === 409 ? 'Каталог изменился. Загрузите файл повторно для нового просмотра.' : 'Импорт не выполнен',
      );
    } finally {
      setImportBusy(false);
    }
  };

  const openCreate = () => {
    setEditingService(null);
    setName('');
    setCategory('');
    setDefaultPrice('');
    setPriceType('fixed');
    setMinPrice('');
    setMaxPrice('');
    setMasterPercent('');
    setWarrantyDays('');
    setModalOpen(true);
  };

  const openEdit = (service: Service) => {
    setEditingService(service);
    setName(service.name);
    setCategory(service.category || '');
    setDefaultPrice(String(service.defaultPrice));
    setPriceType(service.priceType ?? 'fixed');
    setMinPrice(String(service.minPrice ?? service.defaultPrice));
    setMaxPrice(String(service.maxPrice ?? service.defaultPrice));
    setMasterPercent(service.masterPercent != null ? String(service.masterPercent) : '');
    setWarrantyDays(service.warrantyDays != null ? String(service.warrantyDays) : '');
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingService(null);
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error('Введите название услуги');
      return;
    }
    let pricePolicy;
    try {
      pricePolicy = servicePriceFormValue(priceType, defaultPrice, minPrice, maxPrice);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Проверьте цену услуги');
      return;
    }
    const pctRaw = masterPercent.trim();
    const pct = pctRaw === '' ? null : parseNumberInput(pctRaw);
    if (pctRaw !== '' && (pct === null || pct < 0 || pct > 100)) {
      toast.error('Процент мастера — число от 0 до 100');
      return;
    }
    const wdRaw = warrantyDays.trim();
    const wdParsed = wdRaw === '' ? null : parseNumberInput(wdRaw);
    if (wdRaw !== '' && wdParsed === null) {
      toast.error('Срок гарантии — целое число дней');
      return;
    }
    const payload: ServicePayload = {
      name: name.trim(),
      category: category.trim() || undefined,
      ...pricePolicy,
      masterPercent: pct,
      warrantyDays: wdParsed === null ? null : Math.max(0, Math.floor(wdParsed)),
    };
    if (editingService) updateMutation.mutate({ id: editingService.id, payload });
    else createMutation.mutate(payload);
  };

  const services = data?.data ?? [];
  const total = data?.total ?? 0;
  const [activePath, setActivePath] = useState<string[]>([]);
  const { folders, visibleServices } = useMemo(() => {
    const folderNames = new Set<string>();
    const visible: Service[] = [];
    for (const service of services) {
      const parts = (service.category || '')
        .split('/')
        .map((part) => part.trim())
        .filter(Boolean);
      if (activePath.some((part, index) => parts[index] !== part)) continue;
      if (!search && parts.length > activePath.length) folderNames.add(parts[activePath.length]);
      else if (search || parts.length === activePath.length) visible.push(service);
    }
    return {
      folders: [...folderNames].sort((a, b) => a.localeCompare(b, 'ru')),
      visibleServices: visible,
    };
  }, [services, activePath, search]);
  const saving = createMutation.isPending || updateMutation.isPending;

  const columns: DataTableColumn<Service>[] = [
    {
      key: 'name',
      header: 'Название',
      sortable: true,
      render: (s) => (
        <span className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-surface-3 text-ink-3">
            <Wrench className="h-4 w-4" aria-hidden="true" />
          </span>
          <span className="truncate font-medium text-ink">{s.name}</span>
        </span>
      ),
    },
    {
      key: 'category',
      header: 'Категория',
      hideBelow: 'sm',
      render: (s) =>
        s.category ? (
          <span className="inline-flex max-w-full items-center gap-1.5">
            <Badge outline>{s.category}</Badge>
            {canManage && (
              <IconButton
                label={`Настроить видимость папки ${s.category}`}
                icon={ShieldCheck}
                size="sm"
                disabled={!visibilityConfigQuery.isSuccess}
                onClick={() => openVisibilityEditor({ kind: 'category', path: s.category! })}
              />
            )}
          </span>
        ) : (
          <span className="text-ink-3">—</span>
        ),
    },
    {
      key: 'defaultPrice',
      header: 'Цена по умолчанию',
      numeric: true,
      sortable: true,
      render: (s) =>
        s.priceType === 'range' ? (
          <span className="font-medium text-ink">
            <Money value={s.minPrice ?? s.defaultPrice} /> – <Money value={s.maxPrice ?? s.defaultPrice} />
          </span>
        ) : (
          <Money value={s.defaultPrice} className="font-medium text-ink" />
        ),
    },
    ...(canManage
      ? ([
          {
            key: 'masterPercent',
            header: '% мастера',
            numeric: true,
            hideBelow: 'md',
            render: (s) =>
              s.masterPercent != null ? (
                <span className="font-medium text-ink-2">{formatPercent(s.masterPercent)}</span>
              ) : (
                <span className="text-ink-3">стандарт</span>
              ),
          },
        ] as DataTableColumn<Service>[])
      : []),
    {
      key: 'warrantyDays',
      header: 'Гарантия',
      numeric: true,
      hideBelow: 'md',
      render: (s) =>
        s.warrantyDays != null && s.warrantyDays > 0 ? (
          <span className="text-ink-2">{s.warrantyDays} дн.</span>
        ) : (
          <span className="text-ink-3">—</span>
        ),
    },
    ...(canManage
      ? ([
          {
            key: 'actions',
            header: <span className="sr-only">Действия</span>,
            interactive: true,
            align: 'right',
            width: 184,
            render: (s) => (
              <span className="inline-flex items-center justify-end gap-1">
                <IconButton
                  label={`Настроить видимость: ${s.name}`}
                  icon={ShieldCheck}
                  size="sm"
                  disabled={!visibilityConfigQuery.isSuccess}
                  onClick={() => openVisibilityEditor({ kind: 'service', id: s.id, label: s.name })}
                />
                <IconButton
                  label={`История цены: ${s.name}`}
                  icon={History}
                  size="sm"
                  onClick={() => setHistoryTarget(s)}
                />
                <IconButton label={`Изменить: ${s.name}`} icon={Pencil} size="sm" onClick={() => openEdit(s)} />
                <IconButton
                  label={`Удалить: ${s.name}`}
                  icon={Trash2}
                  size="sm"
                  variant="danger"
                  onClick={() => setDeleteTarget(s)}
                />
              </span>
            ),
          },
        ] as DataTableColumn<Service>[])
      : []),
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Услуги"
        icon={Wrench}
        subtitle={data ? `${countLabel(total, ['услуга', 'услуги', 'услуг'])} в прайс-листе` : undefined}
        actions={
          canManage ? (
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" icon={Download} onClick={() => void exportCatalog()}>
                Excel
              </Button>
              <Button
                variant="secondary"
                icon={Upload}
                onClick={() => importInputRef.current?.click()}
                loading={importBusy}
              >
                Импорт
              </Button>
              <Button icon={Plus} onClick={openCreate}>
                Новая услуга
              </Button>
              <input
                ref={importInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="sr-only"
                aria-label="Выбрать файл каталога услуг"
                onChange={(event) => void previewFile(event.target.files?.[0])}
              />
            </div>
          ) : undefined
        }
      />

      <Toolbar>
        <SearchInput
          value={search}
          onChange={(value) => {
            setActivePath([]);
            setParam({ q: value, page: null }, { replace: true });
          }}
          placeholder="Название или категория…"
          className="w-full sm:w-72"
        />
        {canManage && (
          <Button
            variant="secondary"
            icon={ShieldCheck}
            disabled={!visibilityConfigQuery.isSuccess}
            onClick={() => setFolderListOpen(true)}
          >
            Папки
          </Button>
        )}
        {!isOwner && (
          <Button
            variant="secondary"
            icon={showAllServices ? EyeOff : Eye}
            onClick={() => {
              setShowAllServices((value) => !value);
              setParam({ page: null }, { replace: true });
            }}
            aria-pressed={showAllServices}
          >
            {showAllServices ? 'По роли' : 'Все услуги'}
          </Button>
        )}
      </Toolbar>

      {!search && activePath.length > 0 && (
        <nav aria-label="Путь в каталоге" className="flex flex-wrap items-center gap-2 text-sm text-ink-2">
          <button type="button" className="hover:text-accent" onClick={() => setActivePath([])}>
            Все услуги
          </button>
          {activePath.map((part, index) => (
            <span key={`${part}-${index}`} className="flex items-center gap-2">
              <span aria-hidden="true">/</span>
              <button
                type="button"
                className={index === activePath.length - 1 ? 'font-semibold text-ink' : 'hover:text-accent'}
                onClick={() => setActivePath((path) => path.slice(0, index + 1))}
              >
                {part}
              </button>
            </span>
          ))}
        </nav>
      )}

      {!search && folders.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {folders.map((folder) => (
            <button
              key={folder}
              type="button"
              onClick={() => setActivePath((path) => [...path, folder])}
              className="flex items-center gap-3 rounded-xl border border-line bg-surface-1 px-4 py-3 text-left hover:bg-surface-2"
            >
              <Wrench className="h-4 w-4 text-accent" aria-hidden="true" />
              <span className="font-medium text-ink">{folder}</span>
              <span className="ml-auto text-xs text-ink-3">Папка</span>
            </button>
          ))}
        </div>
      )}

      {canManage && visibilityConfigQuery.isError && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 rounded-lg bg-bad-soft px-4 py-3 text-sm text-bad-text"
        >
          Не удалось загрузить настройки ролей и папок.
          <Button variant="secondary" size="sm" onClick={() => void visibilityConfigQuery.refetch()}>
            Повторить
          </Button>
        </div>
      )}

      <DataTable
        rows={visibleServices}
        rowKey={(s) => s.id}
        columns={columns}
        caption="Прайс-лист услуг"
        isLoading={isLoading}
        isError={isError}
        onRetry={() => refetch()}
        isFetching={isFetching}
        emptyState={{
          icon: Wrench,
          title: search
            ? 'Ничего не найдено'
            : preferredOnly
              ? 'Для вашей роли пока нет предпочтительных услуг'
              : 'Услуг пока нет',
          description: search
            ? `По запросу «${search}» услуг нет — попробуйте другое название`
            : preferredOnly
              ? 'Покажите полный каталог или попросите владельца настроить видимость.'
              : 'Добавьте первую услугу, чтобы выбирать её в чеке',
          action:
            !search && preferredOnly
              ? { label: 'Показать все услуги', onClick: () => setShowAllServices(true) }
              : canManage && !search
                ? { label: 'Добавить услугу', onClick: openCreate }
                : undefined,
        }}
      />

      {!search && total > 10000 && <p className="text-sm text-ink-3">Показаны первые 10 000 услуг.</p>}

      <Modal
        isOpen={folderListOpen}
        onClose={() => setFolderListOpen(false)}
        title="Папки услуг"
        description="Выберите папку, чтобы настроить роли для неё и вложенных папок."
      >
        <div className="max-h-[60vh] overflow-y-auto">
          {(visibilityConfigQuery.data?.categoryPaths ?? []).map((path) => (
            <button
              key={path}
              type="button"
              onClick={() => {
                setFolderListOpen(false);
                openVisibilityEditor({ kind: 'category', path });
              }}
              className="flex w-full items-center gap-2 border-b border-line py-2.5 text-left text-sm text-ink hover:bg-surface-2 focus-ring"
              style={{ paddingLeft: `${12 + Math.max(0, path.split('/').length - 1) * 16}px` }}
            >
              <ShieldCheck className="h-4 w-4 flex-shrink-0 text-accent" aria-hidden="true" />
              <span className="truncate">{path.split('/').pop()}</span>
              <span className="ml-auto text-xs text-ink-3">{path}</span>
            </button>
          ))}
          {(visibilityConfigQuery.data?.categoryPaths.length ?? 0) === 0 && (
            <p className="py-4 text-sm text-ink-3">Папок пока нет</p>
          )}
        </div>
      </Modal>

      <Modal
        isOpen={!!visibilityTarget}
        onClose={() => setVisibilityTarget(null)}
        title="Предпочтительная видимость"
        description={visibilityTarget?.kind === 'service' ? visibilityTarget.label : visibilityTarget?.path}
        footer={
          <>
            <Button variant="secondary" onClick={() => setVisibilityTarget(null)}>
              Отмена
            </Button>
            <Button
              variant="secondary"
              disabled={
                !visibilityRuleActive ||
                !visibilityConfigQuery.isSuccess ||
                saveVisibilityRule.isPending ||
                resetVisibilityRule.isPending
              }
              onClick={() => visibilityTarget && resetVisibilityRule.mutate(visibilityTarget)}
            >
              Наследовать / Все роли
            </Button>
            <Button
              loading={saveVisibilityRule.isPending}
              disabled={!visibilityRuleActive || !visibilityConfigQuery.isSuccess || resetVisibilityRule.isPending}
              onClick={() =>
                visibilityTarget && saveVisibilityRule.mutate({ target: visibilityTarget, roleIds: visibilityRoleIds })
              }
            >
              Сохранить
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-ink-2">
            Правило меняет только список каталога: любая услуга остаётся доступна для добавления в чек.
            {visibilityTarget?.kind === 'category'
              ? ' Вложенные папки наследуют правило; ближайшая папка важнее родителя.'
              : ''}
          </p>
          {visibilityConfigQuery.isLoading ? <p className="text-sm text-ink-3">Загружаем роли…</p> : null}
          {visibilityConfigQuery.isError ? (
            <p className="text-sm text-danger">Не удалось загрузить роли для настройки.</p>
          ) : null}
          <Checkbox
            label="Задать список ролей для этого объекта"
            checked={visibilityRuleActive}
            onChange={(event) => setVisibilityRuleActive(event.target.checked)}
          />
          <div className="grid gap-2 sm:grid-cols-2">
            {(visibilityConfigQuery.data?.roles ?? []).map((role) => (
              <Checkbox
                key={role.id}
                label={role.name}
                checked={visibilityRoleIds.includes(role.id)}
                disabled={!visibilityRuleActive}
                onChange={(event) =>
                  setVisibilityRoleIds((current) =>
                    event.target.checked ? [...current, role.id] : current.filter((id) => id !== role.id),
                  )
                }
              />
            ))}
          </div>
          {visibilityRuleActive && visibilityRoleIds.length === 0 && (
            <p className="text-sm text-ink-3">Пустой список скроет объект из режима «По роли» для всех сотрудников.</p>
          )}
        </div>
      </Modal>

      <Modal
        isOpen={modalOpen}
        onClose={closeModal}
        title={editingService ? 'Редактировать услугу' : 'Новая услуга'}
        description={editingService ? editingService.name : 'Услуга появится в списке для выбора в чеке'}
        footer={
          <>
            <Button variant="secondary" onClick={closeModal} disabled={saving}>
              Отмена
            </Button>
            <Button type="submit" form={FORM_ID} loading={saving}>
              {editingService ? 'Сохранить' : 'Создать'}
            </Button>
          </>
        }
      >
        <form id={FORM_ID} onSubmit={handleSubmit} className="space-y-4">
          <Field label="Название" htmlFor="service-name" required>
            <Input
              id="service-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Например: Замена масла"
              autoComplete="off"
              required
            />
          </Field>

          <Field
            label="Категория"
            htmlFor="service-category"
            hint="Путь папки через «/», например: Диагностика/Двигатель/Работы"
          >
            <Input
              id="service-category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="Без категории"
              autoComplete="off"
            />
          </Field>

          <Field label="Тип цены" htmlFor="service-price-type">
            <select
              id="service-price-type"
              value={priceType}
              onChange={(e) => setPriceType(e.target.value as 'fixed' | 'range')}
              className="w-full rounded-lg border border-line bg-surface-1 px-3 py-2 text-ink"
            >
              <option value="fixed">Фиксированная</option>
              <option value="range">Диапазон</option>
            </select>
          </Field>

          {priceType === 'fixed' ? (
            <Field label="Цена, ₽" htmlFor="service-price" required>
              <Input
                id="service-price"
                inputMode="decimal"
                value={defaultPrice}
                onChange={(e) => setDefaultPrice(e.target.value)}
                placeholder="0"
                className="tabular-nums"
              />
            </Field>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="От, ₽" htmlFor="service-price-min" required>
                <Input
                  id="service-price-min"
                  inputMode="decimal"
                  value={minPrice}
                  onChange={(e) => setMinPrice(e.target.value)}
                  placeholder="Минимум"
                  className="tabular-nums"
                />
              </Field>
              <Field label="До, ₽" htmlFor="service-price-max" required>
                <Input
                  id="service-price-max"
                  inputMode="decimal"
                  value={maxPrice}
                  onChange={(e) => setMaxPrice(e.target.value)}
                  placeholder="Максимум"
                  className="tabular-nums"
                />
              </Field>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label="Особый % мастера"
              htmlFor="service-percent"
              hint="Если заполнено — используется вместо стандартного процента мастера"
            >
              <Input
                id="service-percent"
                inputMode="decimal"
                value={masterPercent}
                onChange={(e) => setMasterPercent(e.target.value)}
                placeholder="Стандартный"
                className="tabular-nums"
              />
            </Field>
            <Field
              label="Гарантия, дней"
              htmlFor="service-warranty"
              hint="Дней с момента продажи; пусто — без гарантии"
            >
              <Input
                id="service-warranty"
                inputMode="numeric"
                value={warrantyDays}
                onChange={(e) => setWarrantyDays(e.target.value)}
                placeholder="Без гарантии"
                className="tabular-nums"
              />
            </Field>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        title="Удалить услугу"
        message={`Удалить «${deleteTarget?.name ?? ''}»? Это действие нельзя отменить.`}
        confirmText="Удалить"
        variant="danger"
      />

      <Modal
        isOpen={!!historyTarget}
        onClose={() => setHistoryTarget(null)}
        title="История цены"
        description={historyTarget?.name}
      >
        {historyQuery.isLoading ? <p className="py-4 text-sm text-ink-3">Загружаем историю…</p> : null}
        {historyQuery.isError ? (
          <p role="alert" className="py-4 text-sm text-danger">
            Не удалось загрузить историю цены.
          </p>
        ) : null}
        {historyQuery.isSuccess && historyQuery.data.length === 0 ? (
          <p className="py-4 text-sm text-ink-3">Записей пока нет.</p>
        ) : null}
        <ol className="max-h-[55vh] space-y-3 overflow-y-auto">
          {historyQuery.data?.map((entry) => (
            <li key={entry.id} className="rounded-lg border border-line p-3">
              <div className="flex items-start justify-between gap-3">
                <span className="font-medium text-ink">
                  {entry.priceType === 'range'
                    ? `Диапазон ${entry.minPrice}–${entry.maxPrice} ₽`
                    : `Фиксированная ${entry.defaultPrice} ₽`}
                </span>
                <span className="text-xs text-ink-3">v{entry.version}</span>
              </div>
              <p className="mt-1 text-xs text-ink-3">
                {new Date(entry.changedAt).toLocaleString('ru-RU')} · {entry.changedByName || 'Система'} ·{' '}
                {entry.source === 'baseline'
                  ? 'Снимок при включении контроля цен'
                  : entry.source === 'create'
                    ? 'Создание услуги'
                    : 'Изменение цены'}
              </p>
            </li>
          ))}
        </ol>
      </Modal>

      <Modal
        isOpen={!!importPreview}
        onClose={() => {
          if (!importBusy) {
            setImportPreview(null);
            setImportRequestId(null);
          }
        }}
        title="Предварительный просмотр импорта"
        description="Сервер сверил строки с вашим каталогом. Подтвердите только полностью корректный файл."
        footer={
          <>
            <Button
              variant="secondary"
              disabled={importBusy}
              onClick={() => {
                setImportPreview(null);
                setImportRequestId(null);
              }}
            >
              Отмена
            </Button>
            <Button
              disabled={!importPreview || importPreview.summary.errors > 0 || importBusy}
              loading={importBusy}
              onClick={() => void confirmImport()}
            >
              Подтвердить импорт
            </Button>
          </>
        }
      >
        {importPreview && (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2 text-center text-sm">
              <div className="rounded-lg bg-surface-2 p-3">
                <strong className="block text-lg">{importPreview.summary.totalRows}</strong>строк
              </div>
              <div className="rounded-lg bg-surface-2 p-3">
                <strong className="block text-lg">{importPreview.summary.create}</strong>создать
              </div>
              <div className="rounded-lg bg-surface-2 p-3">
                <strong className="block text-lg">{importPreview.summary.update}</strong>обновить
              </div>
            </div>
            <div className="max-h-[45vh] space-y-2 overflow-y-auto">
              {importPreview.rows.map((row) => (
                <div
                  key={row.sourceRow}
                  className={`rounded-lg border p-3 text-sm ${row.action === 'error' ? 'border-bad-soft bg-bad-soft/30' : 'border-line'}`}
                >
                  <div className="flex justify-between gap-2">
                    <span className="font-medium text-ink">{row.name}</span>
                    <span className="shrink-0 text-xs text-ink-3">Строка {row.sourceRow}</span>
                  </div>
                  <p className="mt-1 text-xs text-ink-2">
                    {row.category || 'Без категории'} ·{' '}
                    {row.action === 'create'
                      ? 'Создать'
                      : row.action === 'update'
                        ? 'Обновить существующую'
                        : row.message}
                  </p>
                </div>
              ))}
            </div>
            {importPreview.errors.length > 0 && (
              <p role="alert" className="text-sm text-danger">
                Есть ошибки. Исправьте файл и загрузите его снова; ни одна строка не будет применена.
              </p>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
