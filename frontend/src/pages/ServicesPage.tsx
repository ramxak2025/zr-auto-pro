import { useState, type FormEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Wrench, Pencil, Trash2, Eye, EyeOff, ShieldCheck } from 'lucide-react';
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
  Pagination,
  SearchInput,
  Toolbar,
} from '../ui';
import type { DataTableColumn } from '../ui';
import type { Service, PaginatedResponse, ServiceVisibilityConfig } from '../types';
import { normalizeServiceCategoryPath } from '../../../shared/utils/normalizeServiceCategoryPath';
import { countLabel, formatPercent, parseNumberInput } from '../components/warehouse/format';
import { pageParam, useUrlParams } from '../components/warehouse/useUrlParams';

const LIMIT = 20;
const FORM_ID = 'service-form';

interface ServicePayload {
  name: string;
  category?: string;
  defaultPrice: number;
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
  const page = pageParam(params);

  // Модалка формы
  const [modalOpen, setModalOpen] = useState(false);
  const [editingService, setEditingService] = useState<Service | null>(null);
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [defaultPrice, setDefaultPrice] = useState('');
  const [masterPercent, setMasterPercent] = useState('');
  const [warrantyDays, setWarrantyDays] = useState('');

  const [deleteTarget, setDeleteTarget] = useState<Service | null>(null);
  const [visibilityTarget, setVisibilityTarget] = useState<
    { kind: 'service'; id: string; label: string } | { kind: 'category'; path: string } | null
  >(null);
  const [visibilityRoleIds, setVisibilityRoleIds] = useState<string[]>([]);
  const [visibilityRuleActive, setVisibilityRuleActive] = useState(false);
  const [folderListOpen, setFolderListOpen] = useState(false);

  const { data, isLoading, isError, isFetching, refetch } = useQuery<PaginatedResponse<Service>>({
    queryKey: ['services', { search, page, limit: LIMIT, category: undefined, preferredOnly }],
    queryFn: async () => {
      const res = await servicesApi.getAll({ search, page, limit: LIMIT, preferredOnly });
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

  const openCreate = () => {
    setEditingService(null);
    setName('');
    setCategory('');
    setDefaultPrice('');
    setMasterPercent('');
    setWarrantyDays('');
    setModalOpen(true);
  };

  const openEdit = (service: Service) => {
    setEditingService(service);
    setName(service.name);
    setCategory(service.category || '');
    setDefaultPrice(String(service.defaultPrice));
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
    const price = parseNumberInput(defaultPrice);
    if (price === null || price < 0) {
      toast.error('Введите цену по умолчанию');
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
      defaultPrice: price,
      masterPercent: pct,
      warrantyDays: wdParsed === null ? null : Math.max(0, Math.floor(wdParsed)),
    };
    if (editingService) updateMutation.mutate({ id: editingService.id, payload });
    else createMutation.mutate(payload);
  };

  const services = data?.data ?? [];
  const total = data?.total ?? 0;
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
      render: (s) => <Money value={s.defaultPrice} className="font-medium text-ink" />,
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
            width: 148,
            render: (s) => (
              <span className="inline-flex items-center justify-end gap-1">
                <IconButton
                  label={`Настроить видимость: ${s.name}`}
                  icon={ShieldCheck}
                  size="sm"
                  disabled={!visibilityConfigQuery.isSuccess}
                  onClick={() => openVisibilityEditor({ kind: 'service', id: s.id, label: s.name })}
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
            <Button icon={Plus} onClick={openCreate}>
              Новая услуга
            </Button>
          ) : undefined
        }
      />

      <Toolbar>
        <SearchInput
          value={search}
          onChange={(value) => setParam({ q: value, page: null }, { replace: true })}
          placeholder="Название услуги…"
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
        rows={services}
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

      <Pagination page={page} total={total} limit={LIMIT} onChange={(p) => setParam({ page: p === 1 ? null : p })} />

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

          <Field label="Категория" htmlFor="service-category" hint="Например: Диагностика, ТО, Ходовая">
            <Input
              id="service-category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="Без категории"
              autoComplete="off"
            />
          </Field>

          <Field label="Цена по умолчанию, ₽" htmlFor="service-price" required>
            <Input
              id="service-price"
              inputMode="decimal"
              value={defaultPrice}
              onChange={(e) => setDefaultPrice(e.target.value)}
              placeholder="0"
              className="tabular-nums"
            />
          </Field>

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
    </div>
  );
}
