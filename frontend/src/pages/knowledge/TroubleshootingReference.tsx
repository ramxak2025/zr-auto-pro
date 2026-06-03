import { useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Wrench,
  ArrowLeft,
  Plus,
  Pencil,
  Trash2,
  X,
  Search,
  Loader2,
  AlertTriangle,
  Tag as TagIcon,
  Eye,
  EyeOff,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { knowledgeApi } from '../../api/services';
import type { Troubleshooting, TroubleshootingSeverity } from '../../types';
import Modal from '../../components/Modal';
import ConfirmDialog from '../../components/ConfirmDialog';
import EmptyState from '../../components/EmptyState';
import MarkdownView from '../../components/MarkdownView';

const TKEY = {
  list: (search: string, system: string, carMake: string, tag: string) =>
    ['knowledge', 'troubleshooting', { search, system, carMake, tag }] as const,
  item: (id: string) => ['knowledge', 'troubleshooting', 'item', id] as const,
};

const SEVERITY_LABEL: Record<TroubleshootingSeverity, string> = {
  low: 'Низкая',
  med: 'Средняя',
  high: 'Высокая',
};

const SEVERITY_BADGE: Record<TroubleshootingSeverity, string> = {
  low: 'badge-gray',
  med: 'badge-warning',
  high: 'badge-red',
};

type View = { mode: 'list' } | { mode: 'detail'; id: string };

export default function TroubleshootingReference({ isManager }: { isManager: boolean }) {
  const queryClient = useQueryClient();
  const [view, setView] = useState<View>({ mode: 'list' });

  // Filters
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [system, setSystem] = useState('');
  const [carMake, setCarMake] = useState('');
  const [tag, setTag] = useState('');

  const [editor, setEditor] = useState<Troubleshooting | 'new' | null>(null);

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSearchChange = (value: string) => {
    setSearchInput(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setSearch(value.trim()), 300);
  };

  const { data: items = [], isLoading } = useQuery({
    queryKey: TKEY.list(search, system, carMake, tag),
    queryFn: async () =>
      (
        await knowledgeApi.listTroubleshooting({
          search: search || undefined,
          system: system || undefined,
          carMake: carMake || undefined,
          tag: tag || undefined,
        })
      ).data,
  });

  // Derive filter facets from the loaded results (no dedicated facets endpoint).
  const systems = useMemo(
    () => Array.from(new Set(items.map((i) => i.system).filter((s): s is string => !!s))).sort(),
    [items],
  );
  const makes = useMemo(
    () => Array.from(new Set(items.map((i) => i.carMake).filter((m): m is string => !!m))).sort(),
    [items],
  );
  const tags = useMemo(() => Array.from(new Set(items.flatMap((i) => i.tags))).sort(), [items]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['knowledge', 'troubleshooting'] });

  if (view.mode === 'detail') {
    return (
      <TroubleshootingDetail
        id={view.id}
        isManager={isManager}
        onBack={() => setView({ mode: 'list' })}
        onEdit={(item) => setEditor(item)}
        editor={editor}
        onCloseEditor={() => setEditor(null)}
        onAfterMutation={invalidate}
        onDeleted={() => setView({ mode: 'list' })}
      />
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[14rem]">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="search"
            value={searchInput}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Поиск по симптому, причине, решению…"
            className="input pl-10"
          />
        </div>
        {isManager && (
          <button onClick={() => setEditor('new')} className="btn-primary btn-sm">
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">Добавить</span>
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <FilterSelect label="Система" value={system} options={systems} onChange={setSystem} allLabel="Все системы" />
        <FilterSelect label="Марка" value={carMake} options={makes} onChange={setCarMake} allLabel="Все марки" />
        <FilterSelect label="Тег" value={tag} options={tags} onChange={setTag} allLabel="Все теги" />
        {(system || carMake || tag) && (
          <button
            onClick={() => {
              setSystem('');
              setCarMake('');
              setTag('');
            }}
            className="btn-ghost btn-sm self-end text-gray-500"
          >
            <X className="h-3.5 w-3.5" /> Сбросить
          </button>
        )}
      </div>

      {/* Results */}
      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-primary-500" />
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={Wrench}
          title="Ничего не найдено"
          description={
            search || system || carMake || tag
              ? 'Попробуйте изменить запрос или сбросить фильтры.'
              : isManager
                ? 'Создайте первую запись о типовой неисправности.'
                : 'Справочник пока пуст.'
          }
          action={
            isManager && !search && !system && !carMake && !tag
              ? { label: 'Добавить запись', onClick: () => setEditor('new') }
              : undefined
          }
        />
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <TroubleshootingRow key={item.id} item={item} onOpen={() => setView({ mode: 'detail', id: item.id })} />
          ))}
        </div>
      )}

      {isManager && editor && view.mode === 'list' && (
        <TroubleshootingEditorModal
          item={editor === 'new' ? null : editor}
          onClose={() => setEditor(null)}
          onSaved={() => {
            setEditor(null);
            invalidate();
          }}
        />
      )}
    </div>
  );
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
  allLabel,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
  allLabel: string;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-gray-400">{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="input py-1.5 text-sm">
        <option value="">{allLabel}</option>
        {/* Keep the active value selectable even if it's not in the current result set. */}
        {value && !options.includes(value) && <option value={value}>{value}</option>}
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </div>
  );
}

function TroubleshootingRow({ item, onOpen }: { item: Troubleshooting; onOpen: () => void }) {
  return (
    <button onClick={onOpen} className="card-interactive w-full p-4 text-left">
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        {item.severity && (
          <span className={`${SEVERITY_BADGE[item.severity]} gap-1`}>
            <AlertTriangle className="h-3 w-3" /> {SEVERITY_LABEL[item.severity]}
          </span>
        )}
        {item.system && <span className="badge-blue">{item.system}</span>}
        {item.carMake && <span className="badge-gray">{item.carMake}</span>}
      </div>
      <h3 className="text-sm font-semibold text-gray-900">{item.title}</h3>
      {item.symptom && <p className="mt-1 text-xs text-gray-500 line-clamp-2">{item.symptom}</p>}
      {item.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {item.tags.slice(0, 5).map((t) => (
            <span
              key={t}
              className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500"
            >
              <TagIcon className="h-3 w-3" /> {t}
            </span>
          ))}
        </div>
      )}
    </button>
  );
}

// ───────────────────────────────────────────────────────────────────────
//  Detail
// ───────────────────────────────────────────────────────────────────────
function TroubleshootingDetail({
  id,
  isManager,
  onBack,
  onEdit,
  editor,
  onCloseEditor,
  onAfterMutation,
  onDeleted,
}: {
  id: string;
  isManager: boolean;
  onBack: () => void;
  onEdit: (item: Troubleshooting) => void;
  editor: Troubleshooting | 'new' | null;
  onCloseEditor: () => void;
  onAfterMutation: () => void;
  onDeleted: () => void;
}) {
  const queryClient = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const { data: item, isLoading } = useQuery({
    queryKey: TKEY.item(id),
    queryFn: async () => (await knowledgeApi.getTroubleshooting(id)).data,
  });

  const deleteMutation = useMutation({
    mutationFn: () => knowledgeApi.deleteTroubleshooting(id),
    onSuccess: () => {
      toast.success('Запись удалена');
      onAfterMutation();
      onDeleted();
    },
    onError: () => toast.error('Не удалось удалить'),
  });

  if (isLoading || !item) {
    return (
      <div className="space-y-6">
        <button onClick={onBack} className="btn-ghost btn-sm -ml-2">
          <ArrowLeft className="h-4 w-4" /> К справочнику
        </button>
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-primary-500" />
        </div>
      </div>
    );
  }

  return (
    // pb-24 on mobile keeps the bottom of the solution card / tags clear of the
    // floating bottom tab bar; md:pb-0 restores desktop spacing.
    <div className="space-y-6 pb-24 md:pb-0">
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="btn-ghost btn-sm -ml-2">
          <ArrowLeft className="h-4 w-4" /> К справочнику
        </button>
        {isManager && (
          <div className="flex items-center gap-2">
            <button onClick={() => onEdit(item)} className="btn-secondary btn-sm">
              <Pencil className="h-4 w-4" />
              <span className="hidden sm:inline">Изменить</span>
            </button>
            <button onClick={() => setConfirmDelete(true)} className="btn-ghost btn-sm text-red-600">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      <article className="card p-6 sm:p-8">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {item.severity && (
            <span className={`${SEVERITY_BADGE[item.severity]} gap-1`}>
              <AlertTriangle className="h-3 w-3" /> Серьёзность: {SEVERITY_LABEL[item.severity]}
            </span>
          )}
          {item.system && <span className="badge-blue">{item.system}</span>}
          {item.carMake && <span className="badge-gray">{item.carMake}</span>}
        </div>

        <h1 className="text-2xl font-bold text-gray-900">{item.title}</h1>

        <div className="mt-6 space-y-5">
          <Section title="Симптом" tone="amber">
            <p className="text-[15px] leading-relaxed text-gray-800">{item.symptom || '—'}</p>
          </Section>
          <Section title="Причина" tone="rose">
            <p className="text-[15px] leading-relaxed text-gray-800">{item.cause || '—'}</p>
          </Section>
          <Section title="Решение" tone="green">
            {item.solution ? (
              <MarkdownView>{item.solution}</MarkdownView>
            ) : (
              <p className="text-sm italic text-gray-400">Не заполнено.</p>
            )}
          </Section>
        </div>

        {item.tags.length > 0 && (
          <div className="mt-6 flex flex-wrap gap-1.5 border-t border-gray-100 pt-5">
            {item.tags.map((t) => (
              <span
                key={t}
                className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-600"
              >
                <TagIcon className="h-3 w-3" /> {t}
              </span>
            ))}
          </div>
        )}
      </article>

      {isManager && editor && editor !== 'new' && (
        <TroubleshootingEditorModal
          item={editor}
          onClose={onCloseEditor}
          onSaved={() => {
            onCloseEditor();
            onAfterMutation();
            queryClient.invalidateQueries({ queryKey: TKEY.item(id) });
          }}
        />
      )}

      <ConfirmDialog
        isOpen={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => deleteMutation.mutate()}
        title="Удалить запись?"
        message="Запись будет удалена без возможности восстановления."
        confirmText="Удалить"
        variant="danger"
      />
    </div>
  );
}

function Section({
  title,
  tone,
  children,
}: {
  title: string;
  tone: 'amber' | 'rose' | 'green';
  children: React.ReactNode;
}) {
  const toneClasses: Record<string, string> = {
    amber: 'border-amber-200 bg-amber-50/60',
    rose: 'border-rose-200 bg-rose-50/60',
    green: 'border-green-200 bg-green-50/60',
  };
  const labelClasses: Record<string, string> = {
    amber: 'text-amber-700',
    rose: 'text-rose-700',
    green: 'text-green-700',
  };
  return (
    <div className={`rounded-xl border ${toneClasses[tone]} p-4`}>
      <h3 className={`mb-2 text-xs font-semibold uppercase tracking-wide ${labelClasses[tone]}`}>{title}</h3>
      {children}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────
//  Editor (create / edit) — manager
// ───────────────────────────────────────────────────────────────────────
function TroubleshootingEditorModal({
  item,
  onClose,
  onSaved,
}: {
  item: Troubleshooting | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!item;
  const [title, setTitle] = useState(item?.title ?? '');
  const [system, setSystem] = useState(item?.system ?? '');
  const [carMake, setCarMake] = useState(item?.carMake ?? '');
  const [symptom, setSymptom] = useState(item?.symptom ?? '');
  const [cause, setCause] = useState(item?.cause ?? '');
  const [solution, setSolution] = useState(item?.solution ?? '');
  const [severity, setSeverity] = useState<TroubleshootingSeverity | ''>(item?.severity ?? '');
  const [tagsInput, setTagsInput] = useState((item?.tags ?? []).join(', '));
  const [showPreview, setShowPreview] = useState(false);

  const saveMutation = useMutation({
    mutationFn: () => {
      const tags = tagsInput
        .split(',')
        .map((t) => t.trim())
        .filter((t) => t.length > 0);
      const payload = {
        title: title.trim(),
        system: system.trim() || null,
        carMake: carMake.trim() || null,
        symptom: symptom.trim(),
        cause: cause.trim(),
        solution,
        severity: severity || null,
        tags,
      };
      return isEdit
        ? knowledgeApi.updateTroubleshooting(item!.id, payload)
        : knowledgeApi.createTroubleshooting(payload);
    },
    onSuccess: () => {
      toast.success(isEdit ? 'Запись обновлена' : 'Запись создана');
      onSaved();
    },
    onError: () => toast.error('Не удалось сохранить'),
  });

  return (
    <Modal isOpen onClose={onClose} title={isEdit ? 'Редактирование неисправности' : 'Новая неисправность'} size="xl">
      <div className="space-y-4">
        <div>
          <label className="label">Название (симптом кратко)</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Например: Двигатель троит на холостых"
            className="input"
            autoFocus
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="label">Система</label>
            <input
              value={system}
              onChange={(e) => setSystem(e.target.value)}
              placeholder="Двигатель"
              className="input"
            />
          </div>
          <div>
            <label className="label">Марка авто</label>
            <input
              value={carMake}
              onChange={(e) => setCarMake(e.target.value)}
              placeholder="Lada / все"
              className="input"
            />
          </div>
          <div>
            <label className="label">Серьёзность</label>
            <select
              value={severity}
              onChange={(e) => setSeverity(e.target.value as TroubleshootingSeverity | '')}
              className="input"
            >
              <option value="">Не указана</option>
              <option value="low">Низкая</option>
              <option value="med">Средняя</option>
              <option value="high">Высокая</option>
            </select>
          </div>
        </div>

        <div>
          <label className="label">Симптом</label>
          <textarea
            value={symptom}
            onChange={(e) => setSymptom(e.target.value)}
            placeholder="Как проявляется неисправность"
            rows={2}
            className="input resize-y"
          />
        </div>
        <div>
          <label className="label">Причина</label>
          <textarea
            value={cause}
            onChange={(e) => setCause(e.target.value)}
            placeholder="Вероятная причина"
            rows={2}
            className="input resize-y"
          />
        </div>

        {/* Solution markdown */}
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label className="label mb-0">Решение (Markdown)</label>
            <button type="button" onClick={() => setShowPreview((v) => !v)} className="btn-ghost btn-sm">
              {showPreview ? (
                <>
                  <EyeOff className="h-3.5 w-3.5" /> Скрыть превью
                </>
              ) : (
                <>
                  <Eye className="h-3.5 w-3.5" /> Превью
                </>
              )}
            </button>
          </div>
          <div className={showPreview ? 'grid gap-3 lg:grid-cols-2' : ''}>
            <textarea
              value={solution}
              onChange={(e) => setSolution(e.target.value)}
              placeholder="Пошаговое решение в **markdown**…"
              rows={8}
              className="input resize-y font-mono text-[13px] leading-relaxed"
            />
            {showPreview && (
              <div className="max-h-[16rem] overflow-y-auto rounded-lg border border-gray-200 bg-gray-50/50 p-4">
                {solution.trim() ? (
                  <MarkdownView>{solution}</MarkdownView>
                ) : (
                  <p className="text-sm italic text-gray-400">Превью появится здесь…</p>
                )}
              </div>
            )}
          </div>
        </div>

        <div>
          <label className="label">Теги (через запятую)</label>
          <input
            value={tagsInput}
            onChange={(e) => setTagsInput(e.target.value)}
            placeholder="зажигание, форсунки, диагностика"
            className="input"
          />
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-gray-100 pt-4">
          <button onClick={onClose} className="btn-secondary">
            Отмена
          </button>
          <button
            onClick={() => saveMutation.mutate()}
            disabled={!title.trim() || saveMutation.isPending}
            className="btn-primary"
          >
            {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {isEdit ? 'Сохранить' : 'Создать'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
