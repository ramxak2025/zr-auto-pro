import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus,
  Folder,
  FolderPlus,
  ChevronRight,
  Wrench,
  Pencil,
  Trash2,
  Eye,
  EyeOff,
  ShieldCheck,
  Download,
  Upload,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { servicesApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import HeaderActionMenu from '../components/HeaderActionMenu';
import {
  Button,
  Checkbox,
  ConfirmDialog,
  Field,
  IconButton,
  Input,
  Modal,
  Money,
  PageHeader,
  SearchInput,
  Toolbar,
} from '../ui';
import type {
  Service,
  ServiceVisibilityConfig,
  ServicePriceHistoryEntry,
  ServiceFolder,
  ServiceExecutionHistoryEntry,
} from '../types';
import { normalizeServiceCategoryPath } from '../../../shared/utils/normalizeServiceCategoryPath';
import { countLabel, parseNumberInput } from '../components/warehouse/format';
import { useUrlParams } from '../components/warehouse/useUrlParams';
import type { ServiceImportPreview } from '../../../shared/api/types';
import {
  assertNoServiceWorkbookFormulas,
  assertServiceWorkbookSafe,
  parseServiceImportMatrix,
  serviceExportMatrix,
} from '../../../shared/utils/serviceSpreadsheet';
import { loadAllPages } from '../../../shared/utils/loadAllPages';
import { serviceBrowserLevel } from '../../../shared/utils/serviceBrowser';
import { servicePriceFormValue, preservePlaceholderServicePrice } from '../../../shared/utils/servicePrices';

const FORM_ID = 'service-form';

interface ServicePayload {
  name: string;
  category?: string;
  priceType: 'fixed' | 'range';
  defaultPrice: number;
  minPrice?: number;
  maxPrice?: number;
  masterPercent?: number | null;
  masterPayMode: 'percent' | 'fixed';
  masterFixedAmount: number | null;
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
  const [masterPayMode, setMasterPayMode] = useState<'percent' | 'fixed'>('percent');
  const [masterFixedAmount, setMasterFixedAmount] = useState('');
  const [confirmPrice, setConfirmPrice] = useState(false);
  const [warrantyDays, setWarrantyDays] = useState('');

  const [deleteTarget, setDeleteTarget] = useState<Service | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const [importPreview, setImportPreview] = useState<ServiceImportPreview | null>(null);
  const [importRequestId, setImportRequestId] = useState<string | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [historyTarget, setHistoryTarget] = useState<Service | null>(null);
  const [historyTab, setHistoryTab] = useState<'work' | 'prices'>('work');
  const [historyPage, setHistoryPage] = useState(1);
  useEffect(() => {
    setHistoryPage(1);
    setHistoryTab('work');
  }, [historyTarget?.id]);
  const executionQuery = useQuery({
    queryKey: ['service-executions', historyTarget?.id, historyPage],
    queryFn: async () =>
      historyTarget
        ? (await servicesApi.executionHistory(historyTarget.id, { page: historyPage, limit: 20 })).data
        : null,
    enabled: !!historyTarget && historyTab === 'work',
  });
  const folderQuery = useQuery<ServiceFolder[]>({
    queryKey: ['service-folders'],
    queryFn: async () => (await servicesApi.folders.list()).data,
  });
  const [folderEditor, setFolderEditor] = useState<{ path: string | null; name: string; parentPath: string } | null>(
    null,
  );
  const [folderBusy, setFolderBusy] = useState(false);
  const [deleteFolder, setDeleteFolder] = useState<string | null>(null);
  const saveFolder = async () => {
    if (!folderEditor || !folderEditor.name.trim() || folderBusy) return;
    setFolderBusy(true);
    try {
      if (folderEditor.path)
        await servicesApi.folders.rename(folderEditor.path, folderEditor.name.trim(), folderEditor.parentPath);
      else await servicesApi.folders.create([...activePath, folderEditor.name.trim()].join('/'));
      setActivePath([]);
      setFolderEditor(null);
      invalidateServiceLists();
      void queryClient.invalidateQueries({ queryKey: ['service-folders'] });
    } catch {
      toast.error('Не удалось сохранить папку. Проверьте название и повторите.');
    } finally {
      setFolderBusy(false);
    }
  };

  const historyQuery = useQuery<ServicePriceHistoryEntry[]>({
    queryKey: ['service-price-history', historyTarget?.id],
    queryFn: async () => {
      if (!historyTarget) return [];
      return (await servicesApi.priceHistory(historyTarget.id)).data;
    },
    enabled: !!historyTarget && historyTab === 'prices',
  });
  const [visibilityTarget, setVisibilityTarget] = useState<
    { kind: 'service'; id: string; label: string } | { kind: 'category'; path: string } | null
  >(null);
  const [visibilityRoleIds, setVisibilityRoleIds] = useState<string[]>([]);
  const [visibilityRuleActive, setVisibilityRuleActive] = useState(false);
  const [folderListOpen, setFolderListOpen] = useState(false);

  const { data, isLoading, isError, refetch } = useQuery<Service[]>({
    queryKey: ['services', { preferredOnly }],
    queryFn: () =>
      loadAllPages(async (page, limit) => (await servicesApi.getAll({ page, limit, preferredOnly })).data, 500),
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
    mutationFn: ({ id, payload }: { id: string; payload: Partial<ServicePayload> }) => servicesApi.update(id, payload),
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
    setConfirmPrice(false);
    setName('');
    setCategory(activePath.join('/'));
    setDefaultPrice('');
    setPriceType('fixed');
    setMinPrice('');
    setMaxPrice('');
    setMasterPercent('');
    setMasterPayMode('percent');
    setMasterFixedAmount('');
    setWarrantyDays('');
    setModalOpen(true);
  };

  const openEdit = (service: Service) => {
    setEditingService(service);
    setConfirmPrice(false);
    setName(service.name);
    setCategory(service.category || '');
    setDefaultPrice(String(service.defaultPrice));
    setPriceType(service.priceType ?? 'fixed');
    setMinPrice(String(service.minPrice ?? service.defaultPrice));
    setMaxPrice(String(service.maxPrice ?? service.defaultPrice));
    setMasterPercent(service.masterPercent != null ? String(service.masterPercent) : '');
    setMasterPayMode(service.masterPayMode ?? 'percent');
    setMasterFixedAmount(service.masterFixedAmount != null ? String(service.masterFixedAmount) : '');
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
    if (masterPayMode === 'percent' && pctRaw !== '' && (pct === null || pct < 0 || pct > 100)) {
      toast.error('Процент мастера — число от 0 до 100');
      return;
    }
    const fixedAmount = parseNumberInput(masterFixedAmount.trim());
    if (masterPayMode === 'fixed' && (fixedAmount === null || fixedAmount < 0 || fixedAmount > 9999999999.99)) {
      toast.error('Укажите фикс мастеру в рублях. Для нуля введите 0.');
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
      masterPayMode,
      masterFixedAmount: masterPayMode === 'fixed' ? fixedAmount : null,
      warrantyDays: wdParsed === null ? null : Math.max(0, Math.floor(wdParsed)),
    };
    if (editingService) {
      const updatePayload = {
        name: payload.name,
        category: payload.category,
        masterPercent: payload.masterPercent,
        masterPayMode: payload.masterPayMode,
        masterFixedAmount: payload.masterFixedAmount,
        warrantyDays: payload.warrantyDays,
        ...(preservePlaceholderServicePrice(editingService, pricePolicy, confirmPrice) ? {} : pricePolicy),
      };
      updateMutation.mutate({ id: editingService.id, payload: updatePayload });
    } else createMutation.mutate(payload);
  };

  const services = useMemo(() => data ?? [], [data]);
  const total = services.length;
  const [activePath, setActivePath] = useState<string[]>([]);
  const { folders, currentServices: visibleServices } = useMemo(
    () => serviceBrowserLevel(services, folderQuery.data ?? [], activePath, search),
    [services, folderQuery.data, activePath, search],
  );
  const saving = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Услуги"
        subtitle={data ? `${countLabel(total, ['услуга', 'услуги', 'услуг'])} в прайс-листе` : undefined}
        actions={
          canManage ? (
            <div className="flex flex-wrap gap-2">
              <Button icon={Plus} onClick={openCreate}>
                Новая услуга
              </Button>
              <HeaderActionMenu
                label="Каталог"
                items={[
                  { key: 'export', label: 'Excel', icon: Download, onSelect: () => void exportCatalog() },
                  {
                    key: 'import',
                    label: 'Импорт',
                    icon: Upload,
                    onSelect: () => importInputRef.current?.click(),
                    loading: importBusy,
                  },
                  {
                    key: 'visibility',
                    label: 'Видимость по ролям',
                    icon: ShieldCheck,
                    disabled: !visibilityConfigQuery.isSuccess,
                    onSelect: () => setFolderListOpen(true),
                    selectTiming: 'after-close',
                  },
                ]}
              />
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
        toolbar={
          <>
            <Toolbar>
              <div className="w-full sm:w-auto">
                <SearchInput
                  value={search}
                  onChange={(value) => {
                    setParam({ q: value, page: null }, { replace: true });
                  }}
                  placeholder="Поиск во всех папках"
                  className="w-full sm:w-72"
                />
              </div>
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
          </>
        }
      />

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

      <section className="overflow-hidden rounded-2xl border border-line bg-surface-1">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            <h2 className="font-semibold text-ink">
              {search ? 'Результаты поиска' : (activePath[activePath.length - 1] ?? 'Каталог услуг')}
            </h2>
            <p className="mt-1 text-xs text-ink-3">
              {search
                ? `${visibleServices.length} найдено во всём каталоге`
                : `${folders.length} папок · ${visibleServices.length} услуг`}
            </p>
          </div>
          {canManage && !search && (
            <div className="flex gap-1">
              {activePath.length > 0 && (
                <>
                  <IconButton
                    icon={Pencil}
                    label="Переименовать папку"
                    onClick={() =>
                      setFolderEditor({
                        path: activePath.join('/'),
                        name: activePath[activePath.length - 1] ?? '',
                        parentPath: activePath.slice(0, -1).join('/'),
                      })
                    }
                  />
                  <IconButton
                    icon={Trash2}
                    label="Удалить папку"
                    variant="danger"
                    onClick={() => setDeleteFolder(activePath.join('/'))}
                  />
                </>
              )}
              <Button
                variant="secondary"
                size="sm"
                icon={FolderPlus}
                onClick={() => setFolderEditor({ path: null, name: '', parentPath: activePath.join('/') })}
              >
                Новая папка
              </Button>
            </div>
          )}
        </div>
        {folderQuery.isError && (
          <div role="alert" className="p-4 text-sm text-ink-2">
            Не удалось загрузить папки.{' '}
            <Button variant="ghost" onClick={() => void folderQuery.refetch()}>
              Повторить
            </Button>
          </div>
        )}
        {isLoading ? (
          <div role="status" className="animate-pulse space-y-3 p-5">
            {[1, 2, 3, 4].map((n) => (
              <div key={n} className="h-12 rounded-lg bg-surface-3" />
            ))}
          </div>
        ) : isError ? (
          <div role="alert" className="p-5">
            Не удалось загрузить каталог.{' '}
            <Button variant="secondary" onClick={() => void refetch()}>
              Повторить
            </Button>
          </div>
        ) : (
          <div className="divide-y divide-line">
            {!search &&
              folders.map(([folder, count]) => (
                <button
                  key={folder}
                  type="button"
                  onClick={() => setActivePath((path) => [...path, folder])}
                  className="flex min-h-16 w-full items-center gap-4 px-5 py-4 text-left transition-colors hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                >
                  <Folder className="h-6 w-6 shrink-0 text-accent" />
                  <span className="min-w-0 flex-1">
                    <span className="block break-words font-medium text-ink">{folder}</span>
                    <span className="text-xs text-ink-3">
                      {count ? countLabel(count, ['услуга', 'услуги', 'услуг']) : 'Пустая папка'}
                    </span>
                  </span>
                  <ChevronRight className="h-4 w-4 text-ink-3" />
                </button>
              ))}
            {visibleServices.map((service) => (
              <div key={service.id} className="flex items-center gap-2 px-3 py-2 sm:px-5">
                <button
                  type="button"
                  onClick={() => setHistoryTarget(service)}
                  className="flex min-h-14 min-w-0 flex-1 flex-col items-start gap-2 rounded-lg p-2 sm:flex-row sm:items-center sm:gap-3 text-left hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                >
                  <Wrench className="hidden h-5 w-5 shrink-0 text-ink-3 sm:block" />
                  <span className="min-w-0 w-full flex-1 sm:w-auto">
                    <span className="block break-words font-medium text-ink">{service.name}</span>
                    {search && <span className="block text-xs text-ink-3">{service.category || 'Без папки'}</span>}
                  </span>
                  <span className="shrink-0 text-right text-sm font-semibold tabular-nums text-ink">
                    {service.priceType === 'range' ? (
                      <>
                        <Money value={service.minPrice ?? service.defaultPrice} /> –{' '}
                        <Money value={service.maxPrice ?? service.defaultPrice} />
                      </>
                    ) : (
                      <Money value={service.defaultPrice} />
                    )}
                  </span>
                  <ChevronRight className="hidden h-4 w-4 shrink-0 text-ink-3 sm:block" />
                </button>
              </div>
            ))}
            {folders.length === 0 && visibleServices.length === 0 && (
              <div className="px-5 py-12 text-center">
                <p className="font-medium text-ink">{search ? 'Ничего не найдено' : 'Папка пока пуста'}</p>
                <p className="mt-2 text-sm text-ink-3">
                  {search
                    ? 'Попробуйте другое название услуги или папки.'
                    : canManage
                      ? 'Добавьте услугу или создайте подпапку.'
                      : 'В этой папке пока нет услуг.'}
                </p>
                {canManage && !search && (
                  <Button className="mt-4" icon={Plus} onClick={openCreate}>
                    Добавить услугу
                  </Button>
                )}
              </div>
            )}
          </div>
        )}
      </section>

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

      <Modal
        isOpen={!!folderEditor}
        onClose={() => setFolderEditor(null)}
        title={folderEditor?.path ? 'Переименовать папку' : 'Новая папка'}
        footer={
          <Button onClick={() => void saveFolder()} loading={folderBusy} disabled={!folderEditor?.name.trim()}>
            Сохранить
          </Button>
        }
      >
        <Field label="Название">
          <Input
            autoFocus
            value={folderEditor?.name ?? ''}
            onChange={(event) =>
              setFolderEditor((current) => (current ? { ...current, name: event.target.value } : current))
            }
            onKeyDown={(event) => {
              if (event.key === 'Enter') void saveFolder();
            }}
          />
        </Field>
        {folderEditor?.path && (
          <Field label="Родительская папка" hint="Пустое поле — корень каталога">
            <Input
              value={folderEditor.parentPath}
              onChange={(event) =>
                setFolderEditor((current) => (current ? { ...current, parentPath: event.target.value } : current))
              }
            />
          </Field>
        )}
      </Modal>
      <ConfirmDialog
        isOpen={!!deleteFolder}
        onClose={() => setDeleteFolder(null)}
        title="Удалить папку?"
        message="Услуги из этой папки и подпапок будут перемещены в родительскую папку. История и цены сохранятся."
        onConfirm={async () => {
          if (!deleteFolder) return;
          try {
            await servicesApi.folders.remove(deleteFolder);
            setDeleteFolder(null);
            setActivePath([]);
            invalidateServiceLists();
            void queryClient.invalidateQueries({ queryKey: ['service-folders'] });
          } catch {
            toast.error('Не удалось удалить папку');
          }
        }}
      />

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

          {editingService?.priceIsPlaceholder && (
            <label className="flex min-h-11 items-center gap-3 text-sm text-ink-2">
              <input
                type="checkbox"
                checked={confirmPrice}
                onChange={(e) => setConfirmPrice(e.target.checked)}
                className="h-5 w-5"
              />
              Подтвердить текущую цену — сейчас она предварительная
            </label>
          )}
          <Field label="Начисление мастеру" htmlFor="service-pay-mode">
            <select
              id="service-pay-mode"
              value={masterPayMode}
              onChange={(e) => setMasterPayMode(e.target.value as 'percent' | 'fixed')}
              className="w-full rounded-lg border border-line bg-surface-1 px-3 py-2 text-ink"
            >
              <option value="percent">Процент</option>
              <option value="fixed">Фикс в рублях</option>
            </select>
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {masterPayMode === 'fixed' ? (
              <Field
                label="Фикс мастеру, ₽"
                htmlFor="service-fixed-pay"
                required
                hint="За каждое выполнение, независимо от цены и скидки"
              >
                <Input
                  id="service-fixed-pay"
                  inputMode="decimal"
                  value={masterFixedAmount}
                  onChange={(e) => setMasterFixedAmount(e.target.value)}
                  placeholder="Например, 300"
                  className="tabular-nums"
                />
              </Field>
            ) : (
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
            )}
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
        title={historyTarget?.name ?? 'Услуга'}
        description={historyTarget?.category || 'Без папки'}
      >
        <div className="mb-5 flex items-center justify-between gap-3">
          <div className="text-xl font-semibold tabular-nums text-ink">
            {historyTarget?.priceType === 'range'
              ? `${historyTarget.minPrice}–${historyTarget.maxPrice} ₽`
              : `${historyTarget?.defaultPrice} ₽`}
          </div>
          {canManage && historyTarget && (
            <div className="flex gap-1">
              <IconButton
                icon={ShieldCheck}
                label="Видимость услуги"
                onClick={() =>
                  openVisibilityEditor({ kind: 'service', id: historyTarget.id, label: historyTarget.name })
                }
              />
              <IconButton
                icon={Pencil}
                label="Изменить услугу"
                onClick={() => {
                  openEdit(historyTarget);
                  setHistoryTarget(null);
                }}
              />
              <IconButton
                icon={Trash2}
                label="Удалить услугу"
                variant="danger"
                onClick={() => {
                  setDeleteTarget(historyTarget);
                  setHistoryTarget(null);
                }}
              />
            </div>
          )}
        </div>
        {historyTarget?.warrantyDays && (
          <p className="mb-3 text-sm text-ink-2">Гарантия: {historyTarget.warrantyDays} дн.</p>
        )}
        {canManage && historyTarget?.masterPayMode === 'fixed' && (
          <p className="mb-3 text-sm text-ink-2">
            Мастеру: {historyTarget.masterFixedAmount?.toLocaleString('ru-RU')} ₽ за выполнение
          </p>
        )}
        {canManage && historyTarget?.masterPayMode !== 'fixed' && historyTarget?.masterPercent != null && (
          <p className="mb-3 text-sm text-ink-2">Процент мастера: {historyTarget.masterPercent}%</p>
        )}
        <div className="mb-4 flex gap-2" role="tablist" aria-label="История услуги">
          <Button
            role="tab"
            aria-selected={historyTab === 'work'}
            variant={historyTab === 'work' ? 'primary' : 'secondary'}
            onClick={() => setHistoryTab('work')}
          >
            Выполнение
          </Button>
          <Button
            role="tab"
            aria-selected={historyTab === 'prices'}
            variant={historyTab === 'prices' ? 'primary' : 'secondary'}
            onClick={() => setHistoryTab('prices')}
          >
            Изменения прайса
          </Button>
        </div>
        {historyTab === 'work' && (
          <div>
            {executionQuery.isLoading && (
              <p role="status" className="py-4 text-sm text-ink-3">
                Загружаем выполненные работы…
              </p>
            )}
            {executionQuery.isError && (
              <p role="alert">
                Не удалось загрузить работы.{' '}
                <Button variant="ghost" onClick={() => void executionQuery.refetch()}>
                  Повторить
                </Button>
              </p>
            )}
            {executionQuery.isSuccess && executionQuery.data?.data.length === 0 && (
              <p className="py-6 text-sm text-ink-3">В доступных чеках эта услуга ещё не выполнялась.</p>
            )}
            <ol className="divide-y divide-line">
              {executionQuery.data?.data.map((entry: ServiceExecutionHistoryEntry) => (
                <li key={entry.id} className="py-3">
                  <a
                    className="flex justify-between gap-3 text-sm font-medium text-accent hover:underline focus-visible:outline"
                    href={`/checks/${entry.checkId}${entry.clientId ? `?clientId=${entry.clientId}` : ''}`}
                  >
                    <span>Чек №{entry.checkNumber}</span>
                    <Money value={entry.price} />
                  </a>
                  <p className="mt-1 text-xs text-ink-3">
                    {new Date(entry.date).toLocaleString('ru-RU')} · {entry.executorName || 'Исполнитель не указан'}
                  </p>
                </li>
              ))}
            </ol>
            {(executionQuery.data?.total ?? 0) > 20 && (
              <div className="mt-4 flex justify-between">
                <Button
                  variant="secondary"
                  disabled={historyPage === 1}
                  onClick={() => setHistoryPage((page) => page - 1)}
                >
                  Назад
                </Button>
                <Button
                  variant="secondary"
                  disabled={historyPage * 20 >= (executionQuery.data?.total ?? 0)}
                  onClick={() => setHistoryPage((page) => page + 1)}
                >
                  Далее
                </Button>
              </div>
            )}
          </div>
        )}
        {historyTab === 'prices' && (
          <>
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
          </>
        )}
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
