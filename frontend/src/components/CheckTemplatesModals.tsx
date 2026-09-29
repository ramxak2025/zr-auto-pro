import { ReactNode, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Check as CheckIcon,
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Pencil,
  Plus,
  Settings2,
  Trash2,
  X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { checkTemplatesApi, type CheckTemplateServiceInput } from '../api/services';
import { expandServiceQuantities } from '../../../shared/utils/checkLines';
import { useAuth } from '../contexts/AuthContext';
import Modal from './Modal';
import ConfirmDialog from './ConfirmDialog';
import EmptyState from './EmptyState';
import { UserRole } from '../types';
import type { CheckTemplate, CheckTemplateFolder } from '../types';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Checkbox } from '../ui/Checkbox';
import { Field } from '../ui/Field';
import { IconButton } from '../ui/IconButton';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { cn } from '../ui/cn';
import { focusRing } from '../ui/tokens';

/**
 * Шаблоны чеков на web — parity с mobile (round 8): личные шаблоны + личные
 * вложенные папки + общие шаблоны (userId NULL, правит только owner-class).
 *
 * Правила зеркалят backend `check-templates.service.ts` (единственный
 * настоящий страж):
 *   • личный шаблон — полный CRUD автору, любая роль;
 *   • общий шаблон — update/delete только owner-class (director/admin/
 *     superadmin); для остальных кнопки правки скрыты;
 *   • shared=true при создании — только owner-class (у остальных чекбокс
 *     не показывается, сервер всё равно бы создал личный);
 *   • папки строго личные (дерево через parentId), общие шаблоны вне папок.
 *
 * Ошибки бэкенда показываем дословно — его 403/404-тексты точнее наших.
 */

// ── Дерево папок ───────────────────────────────────────────────────────────

interface FolderNode extends CheckTemplateFolder {
  children: FolderNode[];
}

function buildFolderTree(folders: CheckTemplateFolder[]): FolderNode[] {
  const byId = new Map<string, FolderNode>();
  for (const f of folders) byId.set(f.id, { ...f, children: [] });
  const roots: FolderNode[] = [];
  byId.forEach((node) => {
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  });
  const sortRec = (list: FolderNode[]) => {
    list.sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, 'ru'));
    for (const n of list) sortRec(n.children);
  };
  sortRec(roots);
  return roots;
}

function flattenTree(nodes: FolderNode[], depth = 0): Array<{ id: string; name: string; depth: number }> {
  const out: Array<{ id: string; name: string; depth: number }> = [];
  for (const n of nodes) {
    out.push({ id: n.id, name: n.name, depth });
    out.push(...flattenTree(n.children, depth + 1));
  }
  return out;
}

function isSharedTemplate(t: CheckTemplate): boolean {
  return t.isShared ?? t.userId == null;
}

function templateSummary(t: CheckTemplate): string {
  const parts: string[] = [];
  // Считаем строки так, как их получит Касса: старая строка «×2» при применении даёт две услуги.
  const serviceCount = expandServiceQuantities(t.services).length;
  if (serviceCount > 0) parts.push(`услуг: ${serviceCount}`);
  if (t.products.length > 0) parts.push(`товаров: ${t.products.length}`);
  return parts.join(' · ') || 'Пустой шаблон';
}

// Общие данные. Оба модала переиспользуют одни query-ключи — React Query
// дедуплицирует; staleTime 60с как у остальных справочников кассы.
function useTemplatesData() {
  const templatesQuery = useQuery<CheckTemplate[]>({
    queryKey: ['check-templates'],
    queryFn: async () => (await checkTemplatesApi.list()).data,
    staleTime: 60_000,
  });
  const foldersQuery = useQuery<CheckTemplateFolder[]>({
    queryKey: ['check-template-folders'],
    queryFn: async () => (await checkTemplatesApi.folders.list()).data,
    staleTime: 60_000,
  });
  return {
    templates: templatesQuery.data ?? [],
    folders: foldersQuery.data ?? [],
    isLoading: templatesQuery.isLoading || foldersQuery.isLoading,
    isError: templatesQuery.isError || foldersQuery.isError,
    isFetching: templatesQuery.isFetching || foldersQuery.isFetching,
    refetch: () => {
      templatesQuery.refetch();
      foldersQuery.refetch();
    },
  };
}

const sharedBadge = (
  <Badge tone="accent" size="sm">
    Общий
  </Badge>
);

const rowBtn = 'flex w-full items-center gap-2.5 rounded-lg py-2.5 pr-3 text-left transition-colors hover:bg-surface-3';

// ── Picker + управление ─────────────────────────────────────────────────────

interface TemplatePickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Применить шаблон в форму чека (замещает строки — как на mobile). */
  onApply: (template: CheckTemplate) => void;
}

export function TemplatePickerModal({ isOpen, onClose, onApply }: TemplatePickerModalProps) {
  const queryClient = useQueryClient();
  const { isRole } = useAuth();
  // Owner-class зеркалит OWNER_CLASS_ROLES бэкенда.
  const isOwnerClass = isRole(UserRole.DIRECTOR, UserRole.ADMIN, UserRole.SUPERADMIN);

  const { templates, folders, isLoading, isError, isFetching, refetch } = useTemplatesData();

  const [mode, setMode] = useState<'pick' | 'manage'>('pick');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Управление: инлайн-создание / переименование
  const [creatingIn, setCreatingIn] = useState<{ parentId: string | null } | null>(null);
  const [newFolderName, setNewFolderName] = useState('');
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [folderDraft, setFolderDraft] = useState('');
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [templateDraft, setTemplateDraft] = useState('');
  // Подтверждения удаления — ConfirmDialog вместо window.confirm.
  const [deleteFolderTarget, setDeleteFolderTarget] = useState<FolderNode | null>(null);
  const [deleteTemplateTarget, setDeleteTemplateTarget] = useState<CheckTemplate | null>(null);

  useEffect(() => {
    if (isOpen) {
      setMode('pick');
      setCreatingIn(null);
      setEditingFolderId(null);
      setEditingTemplateId(null);
    }
  }, [isOpen]);

  const folderTree = useMemo(() => buildFolderTree(folders), [folders]);
  const flatFolders = useMemo(() => flattenTree(folderTree), [folderTree]);

  const templatesByFolder = useMemo(() => {
    const map = new Map<string, CheckTemplate[]>();
    for (const t of templates) {
      if (isSharedTemplate(t) || !t.folderId) continue;
      const list = map.get(t.folderId) ?? [];
      list.push(t);
      map.set(t.folderId, list);
    }
    return map;
  }, [templates]);
  const rootPersonal = useMemo(() => templates.filter((t) => !isSharedTemplate(t) && !t.folderId), [templates]);
  const sharedTemplates = useMemo(() => templates.filter((t) => isSharedTemplate(t)), [templates]);

  // Количество шаблонов в поддереве папки — бейдж в списке выбора.
  const subtreeCount = (node: FolderNode): number =>
    (templatesByFolder.get(node.id)?.length ?? 0) + node.children.reduce((sum, c) => sum + subtreeCount(c), 0);

  const toggleFolder = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // ── Мутации управления ────────────────────────────────────────────────
  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['check-templates'] });
    queryClient.invalidateQueries({ queryKey: ['check-template-folders'] });
  };
  const onErr = (fallback: string) => (err: any) => toast.error(err?.response?.data?.message ?? fallback);

  const createFolderMutation = useMutation({
    mutationFn: (data: { name: string; parentId: string | null }) => checkTemplatesApi.folders.create(data),
    onSuccess: () => {
      invalidateAll();
      setCreatingIn(null);
      setNewFolderName('');
    },
    onError: onErr('Не удалось создать папку'),
  });
  const renameFolderMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => checkTemplatesApi.folders.update(id, { name }),
    onSuccess: () => {
      invalidateAll();
      setEditingFolderId(null);
    },
    onError: onErr('Не удалось переименовать папку'),
  });
  const removeFolderMutation = useMutation({
    mutationFn: (id: string) => checkTemplatesApi.folders.remove(id),
    onSuccess: invalidateAll,
    onError: onErr('Не удалось удалить папку'),
  });
  const renameTemplateMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => checkTemplatesApi.update(id, { name }),
    onSuccess: () => {
      invalidateAll();
      setEditingTemplateId(null);
    },
    onError: onErr('Не удалось переименовать шаблон'),
  });
  const moveTemplateMutation = useMutation({
    mutationFn: ({ id, folderId }: { id: string; folderId: string | null }) =>
      checkTemplatesApi.update(id, { folderId }),
    onSuccess: invalidateAll,
    onError: onErr('Не удалось переместить шаблон'),
  });
  const removeTemplateMutation = useMutation({
    mutationFn: (id: string) => checkTemplatesApi.remove(id),
    onSuccess: invalidateAll,
    onError: onErr('Не удалось удалить шаблон'),
  });

  const startCreateFolder = (parentId: string | null) => {
    setNewFolderName('');
    setCreatingIn({ parentId });
    if (parentId) setExpanded((prev) => new Set(prev).add(parentId));
  };
  const submitCreateFolder = () => {
    const name = newFolderName.trim();
    if (!name || createFolderMutation.isPending) return;
    createFolderMutation.mutate({ name, parentId: creatingIn?.parentId ?? null });
  };
  const submitRenameFolder = () => {
    const name = folderDraft.trim();
    if (!editingFolderId || !name || renameFolderMutation.isPending) return;
    renameFolderMutation.mutate({ id: editingFolderId, name });
  };
  const submitRenameTemplate = () => {
    const name = templateDraft.trim();
    if (!editingTemplateId || !name || renameTemplateMutation.isPending) return;
    renameTemplateMutation.mutate({ id: editingTemplateId, name });
  };

  // ── Рендер: выбор шаблона ─────────────────────────────────────────────
  const renderPickTemplateRow = (t: CheckTemplate, depth: number) => (
    <li key={t.id}>
      <button
        type="button"
        onClick={() => onApply(t)}
        className={cn(rowBtn, 'group', focusRing)}
        style={{ paddingLeft: 12 + depth * 18 }}
      >
        <FileText className="h-4 w-4 flex-shrink-0 text-ink-4 group-hover:text-accent" aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-ink">{t.name}</span>
            {isSharedTemplate(t) && sharedBadge}
          </span>
          <span className="block text-xs text-ink-3">{templateSummary(t)}</span>
        </span>
        <ChevronRight className="h-4 w-4 flex-shrink-0 text-ink-4 group-hover:text-accent" aria-hidden="true" />
      </button>
    </li>
  );

  const renderPickFolder = (node: FolderNode, depth: number): ReactNode => {
    const open = expanded.has(node.id);
    const inFolder = templatesByFolder.get(node.id) ?? [];
    const count = subtreeCount(node);
    return (
      <li key={node.id}>
        <button
          type="button"
          onClick={() => toggleFolder(node.id)}
          aria-expanded={open}
          className={cn(rowBtn, focusRing)}
          style={{ paddingLeft: 12 + depth * 18 }}
        >
          <ChevronRight
            className={cn(
              'h-3.5 w-3.5 flex-shrink-0 text-ink-4 transition-transform duration-150',
              open && 'rotate-90',
            )}
            aria-hidden="true"
          />
          {open ? (
            <FolderOpen className="h-4 w-4 flex-shrink-0 text-warn" aria-hidden="true" />
          ) : (
            <Folder className="h-4 w-4 flex-shrink-0 text-warn" aria-hidden="true" />
          )}
          <span className="flex-1 truncate text-sm font-medium text-ink">{node.name}</span>
          <Badge size="sm" className="tabular-nums">
            {count}
          </Badge>
        </button>
        {open && (
          <ul>
            {node.children.map((c) => renderPickFolder(c, depth + 1))}
            {inFolder.map((t) => renderPickTemplateRow(t, depth + 1))}
            {node.children.length === 0 && inFolder.length === 0 && (
              <li className="py-1.5 text-xs text-ink-3" style={{ paddingLeft: 12 + (depth + 1) * 18 + 26 }}>
                Пусто
              </li>
            )}
          </ul>
        )}
      </li>
    );
  };

  // ── Рендер: инлайн-редактор имени (создание / переименование) ────────
  const inlineNameEditor = (
    value: string,
    onChange: (v: string) => void,
    onSubmit: () => void,
    onCancel: () => void,
    pending: boolean,
    placeholder: string,
  ) => (
    <div className="flex min-w-0 flex-1 items-center gap-1.5">
      <Input
        type="text"
        size="sm"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onSubmit();
          }
          if (e.key === 'Escape') onCancel();
        }}
        autoFocus
        maxLength={120}
        placeholder={placeholder}
        aria-label={placeholder}
      />
      <IconButton
        label="Сохранить"
        icon={CheckIcon}
        size="sm"
        variant="soft"
        onClick={onSubmit}
        disabled={pending || !value.trim()}
      />
      <IconButton label="Отмена" icon={X} size="sm" onClick={onCancel} />
    </div>
  );

  // ── Рендер: управление папками (дерево с действиями) ─────────────────
  const renderManageFolder = (node: FolderNode, depth: number): ReactNode => {
    const open = expanded.has(node.id);
    return (
      <li key={node.id}>
        <div
          className="group flex items-center gap-1 rounded-lg py-1 pr-1 hover:bg-surface-3"
          style={{ paddingLeft: 8 + depth * 18 }}
        >
          {editingFolderId === node.id ? (
            <>
              <Folder className="ml-1 h-4 w-4 flex-shrink-0 text-warn" aria-hidden="true" />
              {inlineNameEditor(
                folderDraft,
                setFolderDraft,
                submitRenameFolder,
                () => setEditingFolderId(null),
                renameFolderMutation.isPending,
                'Название папки',
              )}
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => toggleFolder(node.id)}
                aria-expanded={open}
                className={cn('flex min-w-0 flex-1 items-center gap-2 rounded py-1.5 text-left', focusRing)}
              >
                <ChevronRight
                  className={cn(
                    'h-3.5 w-3.5 flex-shrink-0 text-ink-4 transition-transform duration-150',
                    open && 'rotate-90',
                  )}
                  aria-hidden="true"
                />
                {open ? (
                  <FolderOpen className="h-4 w-4 flex-shrink-0 text-warn" aria-hidden="true" />
                ) : (
                  <Folder className="h-4 w-4 flex-shrink-0 text-warn" aria-hidden="true" />
                )}
                <span className="truncate text-sm font-medium text-ink">{node.name}</span>
              </button>
              <div className="flex flex-shrink-0 items-center">
                <IconButton
                  label="Создать подпапку"
                  icon={FolderPlus}
                  size="sm"
                  onClick={() => startCreateFolder(node.id)}
                />
                <IconButton
                  label="Переименовать папку"
                  icon={Pencil}
                  size="sm"
                  onClick={() => {
                    setFolderDraft(node.name);
                    setEditingFolderId(node.id);
                  }}
                />
                <IconButton
                  label="Удалить папку"
                  icon={Trash2}
                  size="sm"
                  variant="danger"
                  onClick={() => setDeleteFolderTarget(node)}
                />
              </div>
            </>
          )}
        </div>
        {creatingIn?.parentId === node.id && (
          <div className="flex items-center gap-1 py-1" style={{ paddingLeft: 8 + (depth + 1) * 18 }}>
            <FolderPlus className="h-4 w-4 flex-shrink-0 text-warn" aria-hidden="true" />
            {inlineNameEditor(
              newFolderName,
              setNewFolderName,
              submitCreateFolder,
              () => setCreatingIn(null),
              createFolderMutation.isPending,
              'Название подпапки',
            )}
          </div>
        )}
        {open && node.children.length > 0 && <ul>{node.children.map((c) => renderManageFolder(c, depth + 1))}</ul>}
      </li>
    );
  };

  // ── Рендер: управление шаблонами (плоский список) ─────────────────────
  const renderManageTemplateRow = (t: CheckTemplate) => {
    const shared = isSharedTemplate(t);
    const canEdit = !shared || isOwnerClass; // 403 для мастеров на общих — кнопки прячем
    return (
      <li key={t.id} className="flex items-center gap-2 rounded-lg px-2 py-2 hover:bg-surface-3">
        <FileText className="h-4 w-4 flex-shrink-0 text-ink-4" aria-hidden="true" />
        {editingTemplateId === t.id ? (
          inlineNameEditor(
            templateDraft,
            setTemplateDraft,
            submitRenameTemplate,
            () => setEditingTemplateId(null),
            renameTemplateMutation.isPending,
            'Название шаблона',
          )
        ) : (
          <>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium text-ink">{t.name}</span>
                {shared && sharedBadge}
              </div>
              <p className="text-xs text-ink-3">{templateSummary(t)}</p>
            </div>
            {/* Перемещение по папкам — только личные (общие вне папок by design) */}
            {!shared && (
              <Select
                size="sm"
                aria-label={`Папка шаблона «${t.name}»`}
                value={t.folderId ?? ''}
                onChange={(e) => moveTemplateMutation.mutate({ id: t.id, folderId: e.target.value || null })}
                disabled={moveTemplateMutation.isPending}
                className="w-32 flex-shrink-0 sm:w-40"
              >
                <option value="">Без папки</option>
                {flatFolders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {'  '.repeat(f.depth)}
                    {f.name}
                  </option>
                ))}
              </Select>
            )}
            {canEdit && (
              <div className="flex flex-shrink-0 items-center">
                <IconButton
                  label="Переименовать шаблон"
                  icon={Pencil}
                  size="sm"
                  onClick={() => {
                    setTemplateDraft(t.name);
                    setEditingTemplateId(t.id);
                  }}
                />
                <IconButton
                  label="Удалить шаблон"
                  icon={Trash2}
                  size="sm"
                  variant="danger"
                  onClick={() => setDeleteTemplateTarget(t)}
                />
              </div>
            )}
          </>
        )}
      </li>
    );
  };

  const isEmpty = templates.length === 0 && folders.length === 0;

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title={mode === 'pick' ? 'Шаблоны чеков' : 'Управление шаблонами'}
        description={mode === 'pick' ? 'Шаблон заменит текущие строки услуг и товаров' : undefined}
        size="lg"
        footer={
          mode === 'pick' ? (
            <Button variant="ghost" icon={Settings2} onClick={() => setMode('manage')} className="mr-auto">
              Управлять шаблонами и папками
            </Button>
          ) : (
            <Button variant="ghost" icon={ArrowLeft} onClick={() => setMode('pick')} className="mr-auto">
              К выбору шаблона
            </Button>
          )
        }
      >
        {isError ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center" role="alert">
            <p className="text-sm text-ink-2">Не удалось загрузить шаблоны</p>
            <Button variant="secondary" size="sm" onClick={refetch} loading={isFetching}>
              Повторить
            </Button>
          </div>
        ) : isLoading ? (
          <p className="py-8 text-center text-sm text-ink-3" role="status">
            Загружаем шаблоны…
          </p>
        ) : mode === 'pick' ? (
          isEmpty ? (
            <EmptyState
              compact
              icon={FileText}
              title="Нет сохранённых шаблонов"
              description="Добавьте услуги и товары в чек, затем нажмите «Сохранить как шаблон»"
            />
          ) : (
            <ul className="-mx-2">
              {folderTree.map((node) => renderPickFolder(node, 0))}
              {rootPersonal.map((t) => renderPickTemplateRow(t, 0))}
              {sharedTemplates.map((t) => renderPickTemplateRow(t, 0))}
            </ul>
          )
        ) : (
          <div className="space-y-5">
            {/* Папки */}
            <section aria-labelledby="tpl-folders">
              <div className="mb-1 flex items-center justify-between">
                <h3 id="tpl-folders" className="text-xs font-semibold uppercase tracking-wide text-ink-3">
                  Папки
                </h3>
                <Button variant="ghost" size="sm" icon={Plus} onClick={() => startCreateFolder(null)}>
                  Новая папка
                </Button>
              </div>
              {creatingIn !== null && creatingIn.parentId === null && (
                <div className="flex items-center gap-1 py-1 pl-2">
                  <FolderPlus className="h-4 w-4 flex-shrink-0 text-warn" aria-hidden="true" />
                  {inlineNameEditor(
                    newFolderName,
                    setNewFolderName,
                    submitCreateFolder,
                    () => setCreatingIn(null),
                    createFolderMutation.isPending,
                    'Название папки',
                  )}
                </div>
              )}
              {folderTree.length === 0 && creatingIn === null ? (
                <p className="py-2 pl-2 text-xs text-ink-3">Нет папок — создайте первую</p>
              ) : (
                <ul>{folderTree.map((node) => renderManageFolder(node, 0))}</ul>
              )}
            </section>

            {/* Шаблоны */}
            <section aria-labelledby="tpl-list">
              <h3 id="tpl-list" className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-3">
                Шаблоны
              </h3>
              {templates.length === 0 ? (
                <p className="py-2 pl-2 text-xs text-ink-3">Нет шаблонов</p>
              ) : (
                <ul>{templates.map((t) => renderManageTemplateRow(t))}</ul>
              )}
            </section>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        isOpen={!!deleteFolderTarget}
        onClose={() => setDeleteFolderTarget(null)}
        onConfirm={() => deleteFolderTarget && removeFolderMutation.mutate(deleteFolderTarget.id)}
        title="Удалить папку"
        message={`Удалить папку «${deleteFolderTarget?.name ?? ''}»? Подпапки удалятся, шаблоны из них останутся без папки.`}
        confirmText="Удалить"
        variant="danger"
        loading={removeFolderMutation.isPending}
      />
      <ConfirmDialog
        isOpen={!!deleteTemplateTarget}
        onClose={() => setDeleteTemplateTarget(null)}
        onConfirm={() => deleteTemplateTarget && removeTemplateMutation.mutate(deleteTemplateTarget.id)}
        title="Удалить шаблон"
        message={`Удалить шаблон «${deleteTemplateTarget?.name ?? ''}»? Это действие нельзя отменить.`}
        confirmText="Удалить"
        variant="danger"
        loading={removeTemplateMutation.isPending}
      />
    </>
  );
}

// ── Сохранение текущего чека как шаблона ────────────────────────────────────

interface SaveTemplateModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Уже смапленные строки формы (только с catalog-id, как на mobile). Одна строка = одна услуга, без количества. */
  services: CheckTemplateServiceInput[];
  products: CheckTemplate['products'];
}

export function SaveTemplateModal({ isOpen, onClose, services, products }: SaveTemplateModalProps) {
  const queryClient = useQueryClient();
  const { isRole } = useAuth();
  const isOwnerClass = isRole(UserRole.DIRECTOR, UserRole.ADMIN, UserRole.SUPERADMIN);

  const { folders } = useTemplatesData();
  const flatFolders = useMemo(() => flattenTree(buildFolderTree(folders)), [folders]);

  const [name, setName] = useState('');
  const [folderId, setFolderId] = useState('');
  const [shared, setShared] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setName('');
      setFolderId('');
      setShared(false);
    }
  }, [isOpen]);

  const createMutation = useMutation({
    mutationFn: () =>
      checkTemplatesApi.create({
        name: name.trim(),
        services,
        products,
        // Общий шаблон нельзя поместить в личную папку — сервер отвергнет.
        folderId: shared ? undefined : folderId || undefined,
        shared: shared || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['check-templates'] });
      toast.success('Шаблон сохранён');
      onClose();
    },
    onError: (err: any) => toast.error(err?.response?.data?.message ?? 'Не удалось сохранить шаблон'),
  });

  const composition: string[] = [];
  if (services.length > 0) composition.push(`услуг: ${services.length}`);
  if (products.length > 0) composition.push(`товаров: ${products.length}`);
  const canSave = !!name.trim() && services.length + products.length > 0;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Сохранить как шаблон"
      description={`Состав: ${composition.join(' · ') || 'пусто'}`}
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={createMutation.isPending}>
            Отмена
          </Button>
          <Button onClick={() => createMutation.mutate()} disabled={!canSave} loading={createMutation.isPending}>
            Сохранить
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSave && !createMutation.isPending) createMutation.mutate();
        }}
      >
        <Field label="Название" htmlFor="tpl-name" required>
          <Input
            id="tpl-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            maxLength={120}
            placeholder="Например: ТО-1 (масло + фильтры)"
          />
        </Field>
        {!shared && (
          <Field label="Папка" htmlFor="tpl-folder">
            <Select id="tpl-folder" value={folderId} onChange={(e) => setFolderId(e.target.value)}>
              <option value="">Без папки</option>
              {flatFolders.map((f) => (
                <option key={f.id} value={f.id}>
                  {'  '.repeat(f.depth)}
                  {f.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {isOwnerClass && (
          <Checkbox
            label="Общий шаблон"
            description="Виден всем сотрудникам. Хранится вне личных папок; менять его сможет только руководитель."
            checked={shared}
            onChange={(e) => setShared(e.target.checked)}
            className="w-full rounded-lg border border-line bg-surface-2 px-3 py-2.5"
          />
        )}
        {/* Enter в поле названия сохраняет — невидимый submit для формы */}
        <button type="submit" className="sr-only" tabIndex={-1} aria-hidden="true">
          Сохранить
        </button>
      </form>
    </Modal>
  );
}
