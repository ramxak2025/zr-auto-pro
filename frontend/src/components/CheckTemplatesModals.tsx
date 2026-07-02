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
import { checkTemplatesApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import Modal from './Modal';
import { UserRole } from '../types';
import type { CheckTemplate, CheckTemplateFolder } from '../types';

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
  if (t.services.length > 0) parts.push(`услуг: ${t.services.length}`);
  if (t.products.length > 0) parts.push(`товаров: ${t.products.length}`);
  return parts.join(' · ') || 'Пустой шаблон';
}

// Общие данные. Оба модала переиспользуют одни query-ключи — React Query
// дедуплицирует; staleTime 60с как у остальных справочников кассы.
function useTemplatesData() {
  const { data: templates = [] } = useQuery<CheckTemplate[]>({
    queryKey: ['check-templates'],
    queryFn: async () => (await checkTemplatesApi.list()).data,
    staleTime: 60_000,
  });
  const { data: folders = [] } = useQuery<CheckTemplateFolder[]>({
    queryKey: ['check-template-folders'],
    queryFn: async () => (await checkTemplatesApi.folders.list()).data,
    staleTime: 60_000,
  });
  return { templates, folders };
}

const sharedBadge = (
  <span className="text-[9px] font-bold uppercase tracking-wider bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full flex-shrink-0">
    Общий
  </span>
);

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

  const { templates, folders } = useTemplatesData();

  const [mode, setMode] = useState<'pick' | 'manage'>('pick');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Управление: инлайн-создание / переименование
  const [creatingIn, setCreatingIn] = useState<{ parentId: string | null } | null>(null);
  const [newFolderName, setNewFolderName] = useState('');
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [folderDraft, setFolderDraft] = useState('');
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [templateDraft, setTemplateDraft] = useState('');

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

  const confirmDeleteFolder = (node: FolderNode) => {
    if (window.confirm(`Удалить папку «${node.name}»? Подпапки удалятся, шаблоны из них останутся без папки.`)) {
      removeFolderMutation.mutate(node.id);
    }
  };
  const confirmDeleteTemplate = (t: CheckTemplate) => {
    if (window.confirm(`Удалить шаблон «${t.name}»?`)) {
      removeTemplateMutation.mutate(t.id);
    }
  };

  // ── Рендер: выбор шаблона ─────────────────────────────────────────────
  const renderPickTemplateRow = (t: CheckTemplate, depth: number) => (
    <button
      key={t.id}
      type="button"
      onClick={() => onApply(t)}
      className="w-full flex items-center gap-2.5 py-2.5 pr-3 rounded-lg hover:bg-primary-50 text-left transition-colors group"
      style={{ paddingLeft: 12 + depth * 18 }}
    >
      <FileText className="w-4 h-4 text-gray-400 group-hover:text-primary-500 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-900 truncate">{t.name}</span>
          {isSharedTemplate(t) && sharedBadge}
        </div>
        <p className="text-xs text-gray-400">{templateSummary(t)}</p>
      </div>
      <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-primary-400 flex-shrink-0" />
    </button>
  );

  const renderPickFolder = (node: FolderNode, depth: number): ReactNode => {
    const open = expanded.has(node.id);
    const inFolder = templatesByFolder.get(node.id) ?? [];
    const count = subtreeCount(node);
    return (
      <div key={node.id}>
        <button
          type="button"
          onClick={() => toggleFolder(node.id)}
          className="w-full flex items-center gap-2.5 py-2.5 pr-3 rounded-lg hover:bg-gray-50 text-left transition-colors"
          style={{ paddingLeft: 12 + depth * 18 }}
        >
          <ChevronRight
            className={`w-3.5 h-3.5 text-gray-400 transition-transform flex-shrink-0 ${open ? 'rotate-90' : ''}`}
          />
          {open ? (
            <FolderOpen className="w-4 h-4 text-amber-500 flex-shrink-0" />
          ) : (
            <Folder className="w-4 h-4 text-amber-500 flex-shrink-0" />
          )}
          <span className="flex-1 text-sm font-medium text-gray-900 truncate">{node.name}</span>
          <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full flex-shrink-0">{count}</span>
        </button>
        {open && (
          <div>
            {node.children.map((c) => renderPickFolder(c, depth + 1))}
            {inFolder.map((t) => renderPickTemplateRow(t, depth + 1))}
            {node.children.length === 0 && inFolder.length === 0 && (
              <p className="text-xs text-gray-400 italic py-1.5" style={{ paddingLeft: 12 + (depth + 1) * 18 + 26 }}>
                Пусто
              </p>
            )}
          </div>
        )}
      </div>
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
    <div className="flex items-center gap-1.5 flex-1 min-w-0">
      <input
        type="text"
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
        className="input text-sm py-1.5 flex-1 min-w-0"
      />
      <button
        type="button"
        onClick={onSubmit}
        disabled={pending || !value.trim()}
        className="p-1.5 rounded-lg text-green-600 hover:bg-green-50 disabled:opacity-40"
        title="Сохранить"
      >
        <CheckIcon className="w-4 h-4" />
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100"
        title="Отмена"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );

  // ── Рендер: управление папками (дерево с действиями) ─────────────────
  const renderManageFolder = (node: FolderNode, depth: number): ReactNode => {
    const open = expanded.has(node.id);
    return (
      <div key={node.id}>
        <div
          className="flex items-center gap-1 py-1.5 pr-2 rounded-lg hover:bg-gray-50 group"
          style={{ paddingLeft: 8 + depth * 18 }}
        >
          {editingFolderId === node.id ? (
            <>
              <Folder className="w-4 h-4 text-amber-500 flex-shrink-0 ml-1" />
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
                className="flex items-center gap-2 flex-1 min-w-0 py-1 text-left"
              >
                <ChevronRight
                  className={`w-3.5 h-3.5 text-gray-400 transition-transform flex-shrink-0 ${open ? 'rotate-90' : ''}`}
                />
                {open ? (
                  <FolderOpen className="w-4 h-4 text-amber-500 flex-shrink-0" />
                ) : (
                  <Folder className="w-4 h-4 text-amber-500 flex-shrink-0" />
                )}
                <span className="text-sm font-medium text-gray-900 truncate">{node.name}</span>
              </button>
              <div className="flex items-center flex-shrink-0">
                <button
                  type="button"
                  onClick={() => startCreateFolder(node.id)}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-primary-600 hover:bg-primary-50"
                  title="Создать подпапку"
                >
                  <FolderPlus className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setFolderDraft(node.name);
                    setEditingFolderId(node.id);
                  }}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-primary-600 hover:bg-primary-50"
                  title="Переименовать"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => confirmDeleteFolder(node)}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50"
                  title="Удалить папку"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </>
          )}
        </div>
        {creatingIn?.parentId === node.id && (
          <div className="flex items-center gap-1 py-1" style={{ paddingLeft: 8 + (depth + 1) * 18 }}>
            <FolderPlus className="w-4 h-4 text-amber-500 flex-shrink-0" />
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
        {open && node.children.map((c) => renderManageFolder(c, depth + 1))}
      </div>
    );
  };

  // ── Рендер: управление шаблонами (плоский список) ─────────────────────
  const renderManageTemplateRow = (t: CheckTemplate) => {
    const shared = isSharedTemplate(t);
    const canEdit = !shared || isOwnerClass; // 403 для мастеров на общих — кнопки прячем
    return (
      <div key={t.id} className="flex items-center gap-2 py-2 px-2 rounded-lg hover:bg-gray-50">
        <FileText className="w-4 h-4 text-gray-400 flex-shrink-0" />
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
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-gray-900 truncate">{t.name}</span>
                {shared && sharedBadge}
              </div>
              <p className="text-xs text-gray-400">{templateSummary(t)}</p>
            </div>
            {/* Перемещение по папкам — только личные (общие вне папок by design) */}
            {!shared && (
              <select
                value={t.folderId ?? ''}
                onChange={(e) => moveTemplateMutation.mutate({ id: t.id, folderId: e.target.value || null })}
                disabled={moveTemplateMutation.isPending}
                className="input text-xs py-1.5 w-32 sm:w-40 flex-shrink-0"
                title="Папка шаблона"
              >
                <option value="">Без папки</option>
                {flatFolders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {'  '.repeat(f.depth)}
                    {f.name}
                  </option>
                ))}
              </select>
            )}
            {canEdit && (
              <div className="flex items-center flex-shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setTemplateDraft(t.name);
                    setEditingTemplateId(t.id);
                  }}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-primary-600 hover:bg-primary-50"
                  title="Переименовать"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => confirmDeleteTemplate(t)}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50"
                  title="Удалить шаблон"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </>
        )}
      </div>
    );
  };

  const isEmpty = templates.length === 0 && folders.length === 0;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={mode === 'pick' ? 'Шаблоны чеков' : 'Управление шаблонами'}
      size="lg"
    >
      {mode === 'pick' ? (
        <div>
          {isEmpty ? (
            <div className="text-center py-8 text-gray-400">
              <FileText className="w-10 h-10 mx-auto mb-3 opacity-50" />
              <p className="text-sm font-medium">Нет сохранённых шаблонов</p>
              <p className="text-xs mt-1">Добавьте услуги и товары в чек, затем нажмите «Сохранить как шаблон»</p>
            </div>
          ) : (
            <div className="-mx-2">
              {folderTree.map((node) => renderPickFolder(node, 0))}
              {rootPersonal.map((t) => renderPickTemplateRow(t, 0))}
              {sharedTemplates.map((t) => renderPickTemplateRow(t, 0))}
            </div>
          )}
          <div className="mt-4 pt-3 border-t border-gray-100">
            <button
              type="button"
              onClick={() => setMode('manage')}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium text-gray-500 hover:text-primary-600 hover:bg-primary-50 transition-colors"
            >
              <Settings2 className="w-4 h-4" />
              Управлять шаблонами и папками
            </button>
          </div>
        </div>
      ) : (
        <div>
          <button
            type="button"
            onClick={() => setMode('pick')}
            className="flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-primary-600 mb-3"
          >
            <ArrowLeft className="w-4 h-4" />К выбору шаблона
          </button>

          {/* Папки */}
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Папки</h3>
            <button
              type="button"
              onClick={() => startCreateFolder(null)}
              className="flex items-center gap-1 text-sm font-medium text-primary-600 hover:text-primary-700"
            >
              <Plus className="w-3.5 h-3.5" />
              Новая папка
            </button>
          </div>
          {creatingIn !== null && creatingIn.parentId === null && (
            <div className="flex items-center gap-1 py-1 pl-2">
              <FolderPlus className="w-4 h-4 text-amber-500 flex-shrink-0" />
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
            <p className="text-xs text-gray-400 italic py-2 pl-2">Нет папок — создайте первую</p>
          ) : (
            <div>{folderTree.map((node) => renderManageFolder(node, 0))}</div>
          )}

          {/* Шаблоны */}
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mt-5 mb-1">Шаблоны</h3>
          {templates.length === 0 ? (
            <p className="text-xs text-gray-400 italic py-2 pl-2">Нет шаблонов</p>
          ) : (
            <div>{templates.map((t) => renderManageTemplateRow(t))}</div>
          )}
        </div>
      )}
    </Modal>
  );
}

// ── Сохранение текущего чека как шаблона ────────────────────────────────────

interface SaveTemplateModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Уже смапленные строки формы (только с catalog-id, как на mobile). */
  services: CheckTemplate['services'];
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

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Сохранить как шаблон" size="md">
      <p className="text-xs text-gray-400 mb-3">Состав: {composition.join(' · ') || 'пусто'}</p>
      <div className="space-y-3">
        <div>
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5 block">Название</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            maxLength={120}
            placeholder="Например: ТО-1 (масло + фильтры)"
            className="input w-full text-sm"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (name.trim() && !createMutation.isPending) createMutation.mutate();
              }
            }}
          />
        </div>
        {!shared && (
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5 block">Папка</label>
            <select value={folderId} onChange={(e) => setFolderId(e.target.value)} className="input w-full text-sm">
              <option value="">Без папки</option>
              {flatFolders.map((f) => (
                <option key={f.id} value={f.id}>
                  {'  '.repeat(f.depth)}
                  {f.name}
                </option>
              ))}
            </select>
          </div>
        )}
        {isOwnerClass && (
          <label className="flex items-start gap-2 cursor-pointer rounded-lg px-3 py-2.5 border border-gray-200 bg-gray-50">
            <input
              type="checkbox"
              checked={shared}
              onChange={(e) => setShared(e.target.checked)}
              className="w-4 h-4 mt-0.5 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
            />
            <div>
              <span className="text-sm font-medium text-gray-700">Общий шаблон</span>
              <p className="text-[11px] text-gray-400 mt-0.5">
                Виден всем сотрудникам. Хранится вне личных папок; менять его сможет только руководитель.
              </p>
            </div>
          </label>
        )}
      </div>
      <div className="flex gap-2 mt-5">
        <button type="button" onClick={onClose} className="btn-secondary flex-1">
          Отмена
        </button>
        <button
          type="button"
          onClick={() => createMutation.mutate()}
          disabled={createMutation.isPending || !name.trim() || services.length + products.length === 0}
          className="btn-primary flex-1 disabled:opacity-50"
        >
          {createMutation.isPending ? 'Сохранение...' : 'Сохранить'}
        </button>
      </div>
    </Modal>
  );
}
