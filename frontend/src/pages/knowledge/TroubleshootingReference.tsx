import { useId, useMemo, useState } from 'react';
import { type To } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Eye, EyeOff, Pencil, Tag as TagIcon, Trash2, Wrench, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { knowledgeApi } from '../../api/services';
import type { Troubleshooting, TroubleshootingSeverity } from '../../types';
import Modal from '../../components/Modal';
import ConfirmDialog from '../../components/ConfirmDialog';
import QueryState from '../../components/QueryState';
import MarkdownView from '../../components/MarkdownView';
import SearchInput from '../../components/SearchInput';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { Field } from '../../ui/Field';
import { IconButton } from '../../ui/IconButton';
import { Input } from '../../ui/Input';
import { Select } from '../../ui/Select';
import { Skeleton, SkeletonCard, SkeletonText } from '../../ui/Skeleton';
import { Textarea } from '../../ui/Textarea';
import { Toolbar } from '../../ui/Toolbar';
import { cn } from '../../ui/cn';
import { type Tone } from '../../ui/tokens';
import { TileLink } from '../../components/knowledge/ui';
import { articleTitleClass, articleType } from '../../components/knowledge/articleTypography';

// ───────────────────────────────────────────────────────────────────────
//  Справочник типовых неисправностей («Диагностика»): симптом → причина →
//  решение. Список с фильтрами-фасетами и карточка записи. Какой экран
//  показать, решает СТРАНИЦА по ?issue=… — как у статей и курсов.
// ───────────────────────────────────────────────────────────────────────

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

// Серьёзность — по смыслу: низкая нейтральна, средняя требует внимания, высокая — критична.
const SEVERITY_TONE: Record<TroubleshootingSeverity, Tone> = {
  low: 'neutral',
  med: 'warn',
  high: 'bad',
};

export interface TroubleshootingNav {
  issueId: string | null;
  issueHref: (id: string) => To;
  onBackToList: () => void;
}

export default function TroubleshootingReference({
  isManager,
  nav,
  createOpen,
  onCloseCreate,
}: {
  isManager: boolean;
  nav: TroubleshootingNav;
  /** Модалка новой записи — кнопка живёт в PageHeader страницы. */
  createOpen: boolean;
  onCloseCreate: () => void;
}) {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['knowledge', 'troubleshooting'] });

  if (nav.issueId) {
    return (
      <TroubleshootingDetail
        id={nav.issueId}
        isManager={isManager}
        onAfterMutation={invalidate}
        onDeleted={nav.onBackToList}
      />
    );
  }
  return (
    <TroubleshootingList
      isManager={isManager}
      issueHref={nav.issueHref}
      createOpen={createOpen}
      onCloseCreate={onCloseCreate}
      onAfterMutation={invalidate}
    />
  );
}

function TroubleshootingList({
  isManager,
  issueHref,
  createOpen,
  onCloseCreate,
  onAfterMutation,
}: {
  isManager: boolean;
  issueHref: (id: string) => To;
  createOpen: boolean;
  onCloseCreate: () => void;
  onAfterMutation: () => void;
}) {
  // Filters
  const [search, setSearch] = useState('');
  const [system, setSystem] = useState('');
  const [carMake, setCarMake] = useState('');
  const [tag, setTag] = useState('');

  const {
    data: items = [],
    isLoading,
    isError,
    refetch,
    isFetching,
  } = useQuery({
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
    placeholderData: (prev) => prev,
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

  const hasFilters = !!(search || system || carMake || tag);

  return (
    <div className="space-y-4">
      <Toolbar
        end={
          hasFilters ? (
            <Button
              variant="ghost"
              size="sm"
              icon={X}
              onClick={() => {
                setSearch('');
                setSystem('');
                setCarMake('');
                setTag('');
              }}
            >
              Сбросить
            </Button>
          ) : undefined
        }
      >
        <SearchInput
          value={search}
          onChange={(v) => setSearch(v.trim())}
          placeholder="Симптом, причина, решение…"
          aria-label="Поиск по справочнику неисправностей"
          className="w-full sm:w-72"
        />
        <FacetSelect label="Система" value={system} options={systems} onChange={setSystem} allLabel="Все системы" />
        <FacetSelect label="Марка" value={carMake} options={makes} onChange={setCarMake} allLabel="Все марки" />
        <FacetSelect label="Тег" value={tag} options={tags} onChange={setTag} allLabel="Все теги" />
      </Toolbar>

      {isLoading ? (
        <div className="space-y-3" aria-busy="true">
          {Array.from({ length: 3 }).map((_, i) => (
            <SkeletonCard key={i} lines={2} />
          ))}
        </div>
      ) : (
        <QueryState
          isLoading={false}
          isError={isError}
          onRetry={refetch}
          isFetching={isFetching}
          errorTitle="Не удалось загрузить справочник"
          isEmpty={items.length === 0}
          empty={{
            icon: Wrench,
            title: hasFilters ? 'Ничего не найдено' : 'Справочник пока пуст',
            description: hasFilters
              ? 'Попробуйте изменить запрос или сбросить фильтры.'
              : isManager
                ? 'Создайте первую запись о типовой неисправности.'
                : 'Записи о типовых неисправностях появятся здесь.',
          }}
          minHeight="py-14"
        >
          <ul className="space-y-3" aria-label="Неисправности">
            {items.map((item) => (
              <li key={item.id}>
                <TroubleshootingRow item={item} to={issueHref(item.id)} />
              </li>
            ))}
          </ul>
        </QueryState>
      )}

      {isManager && createOpen && (
        <TroubleshootingEditorModal
          item={null}
          onClose={onCloseCreate}
          onSaved={() => {
            onCloseCreate();
            onAfterMutation();
          }}
        />
      )}
    </div>
  );
}

function FacetSelect({
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
    <Select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className="w-40">
      <option value="">{allLabel}</option>
      {/* Keep the active value selectable even if it's not in the current result set. */}
      {value && !options.includes(value) && <option value={value}>{value}</option>}
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </Select>
  );
}

function SeverityBadge({ severity, prefix }: { severity: TroubleshootingSeverity; prefix?: string }) {
  return (
    <Badge tone={SEVERITY_TONE[severity]} icon={AlertTriangle}>
      {prefix}
      {SEVERITY_LABEL[severity]}
    </Badge>
  );
}

function TroubleshootingRow({ item, to }: { item: Troubleshooting; to: To }) {
  return (
    <TileLink to={to} className="block p-4">
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
        {item.severity && <SeverityBadge severity={item.severity} />}
        {item.system && <Badge tone="info">{item.system}</Badge>}
        {item.carMake && <Badge outline>{item.carMake}</Badge>}
      </div>
      <h3 className="text-sm font-semibold text-ink group-hover:text-accent-text">{item.title}</h3>
      {item.symptom && <p className="mt-1 line-clamp-2 text-xs text-ink-3">{item.symptom}</p>}
      {item.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {item.tags.slice(0, 5).map((t) => (
            <span
              key={t}
              className="inline-flex items-center gap-1 rounded-md bg-surface-3 px-1.5 py-0.5 text-2xs text-ink-2"
            >
              <TagIcon className="h-3 w-3 text-ink-3" aria-hidden="true" /> {t}
            </span>
          ))}
        </div>
      )}
    </TileLink>
  );
}

// ───────────────────────────────────────────────────────────────────────
//  Detail
// ───────────────────────────────────────────────────────────────────────
function TroubleshootingDetail({
  id,
  isManager,
  onAfterMutation,
  onDeleted,
}: {
  id: string;
  isManager: boolean;
  onAfterMutation: () => void;
  onDeleted: () => void;
}) {
  const queryClient = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);

  const {
    data: item,
    isLoading,
    isError,
    refetch,
    isFetching,
  } = useQuery({
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

  if (isLoading) {
    return (
      <Card className="mx-auto w-full max-w-3xl px-5 py-6 sm:px-10 sm:py-8" aria-busy="true">
        <Skeleton className="h-8 w-2/3" />
        <SkeletonText lines={5} className="mt-8 max-w-[70ch]" />
      </Card>
    );
  }

  if (isError || !item) {
    return (
      <Card padding="md" className="mx-auto w-full max-w-3xl">
        <QueryState
          isLoading={false}
          isError
          onRetry={refetch}
          isFetching={isFetching}
          errorTitle="Не удалось загрузить запись"
        >
          {null}
        </QueryState>
      </Card>
    );
  }

  return (
    // pb-24 on mobile keeps the bottom of the solution card / tags clear of the
    // floating bottom tab bar; md:pb-0 restores desktop spacing.
    <div className="pb-24 md:pb-0">
      <Card as="article" padding="none" className="mx-auto w-full max-w-3xl">
        <div className="px-5 py-6 sm:px-10 sm:py-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="mb-4 flex flex-wrap items-center gap-1.5">
                {item.severity && <SeverityBadge severity={item.severity} prefix="Серьёзность: " />}
                {item.system && <Badge tone="info">{item.system}</Badge>}
                {item.carMake && <Badge outline>{item.carMake}</Badge>}
              </div>
              <h2 className={articleTitleClass}>{item.title}</h2>
            </div>
            {isManager && (
              <div className="flex flex-shrink-0 items-center gap-2">
                <Button variant="secondary" icon={Pencil} onClick={() => setEditorOpen(true)}>
                  Изменить
                </Button>
                <IconButton
                  label="Удалить запись"
                  icon={Trash2}
                  variant="danger"
                  onClick={() => setConfirmDelete(true)}
                />
              </div>
            )}
          </div>

          <dl className="mt-8 max-w-[70ch] space-y-6">
            <DetailSection title="Симптом">
              <p className="whitespace-pre-wrap">{item.symptom || '—'}</p>
            </DetailSection>
            <DetailSection title="Причина">
              <p className="whitespace-pre-wrap">{item.cause || '—'}</p>
            </DetailSection>
            <DetailSection title="Решение" highlight>
              {item.solution ? (
                <MarkdownView headingBase={4}>{item.solution}</MarkdownView>
              ) : (
                <p className={articleType.empty}>Не заполнено.</p>
              )}
            </DetailSection>
          </dl>

          {item.tags.length > 0 && (
            <div className="mt-8 flex max-w-[70ch] flex-wrap gap-1.5 border-t border-line pt-5" aria-label="Теги">
              {item.tags.map((t) => (
                <span
                  key={t}
                  className="inline-flex items-center gap-1 rounded-md bg-surface-3 px-2 py-1 text-xs text-ink-2"
                >
                  <TagIcon className="h-3 w-3 text-ink-3" aria-hidden="true" /> {t}
                </span>
              ))}
            </div>
          )}
        </div>
      </Card>

      {isManager && editorOpen && (
        <TroubleshootingEditorModal
          item={item}
          onClose={() => setEditorOpen(false)}
          onSaved={() => {
            setEditorOpen(false);
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
        loading={deleteMutation.isPending}
      />
    </div>
  );
}

/** Секция карточки «Симптом / Причина / Решение»: подпись-термин + текст. */
function DetailSection({
  title,
  highlight = false,
  children,
}: {
  title: string;
  highlight?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={cn(highlight && 'rounded-lg border border-line bg-surface-2 p-4 sm:p-5')}>
      <dt className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-3">{title}</dt>
      <dd className={cn(articleType.body, 'max-w-none')}>{children}</dd>
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
  const uid = useId();
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
  const [titleError, setTitleError] = useState('');

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

  const submit = () => {
    if (!title.trim()) {
      setTitleError('Введите название');
      return;
    }
    saveMutation.mutate();
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={isEdit ? 'Редактирование неисправности' : 'Новая неисправность'}
      size="xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saveMutation.isPending}>
            Отмена
          </Button>
          <Button onClick={submit} loading={saveMutation.isPending}>
            {isEdit ? 'Сохранить' : 'Создать'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Название (симптом кратко)" htmlFor={`${uid}-title`} required error={titleError || undefined}>
          <Input
            id={`${uid}-title`}
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              if (titleError) setTitleError('');
            }}
            placeholder="Например: Двигатель троит на холостых"
            invalid={!!titleError}
            autoFocus
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Система" htmlFor={`${uid}-system`}>
            <Input
              id={`${uid}-system`}
              value={system}
              onChange={(e) => setSystem(e.target.value)}
              placeholder="Двигатель"
            />
          </Field>
          <Field label="Марка авто" htmlFor={`${uid}-make`}>
            <Input
              id={`${uid}-make`}
              value={carMake}
              onChange={(e) => setCarMake(e.target.value)}
              placeholder="Lada / все"
            />
          </Field>
          <Field label="Серьёзность" htmlFor={`${uid}-severity`}>
            <Select
              id={`${uid}-severity`}
              value={severity}
              onChange={(e) => setSeverity(e.target.value as TroubleshootingSeverity | '')}
            >
              <option value="">Не указана</option>
              <option value="low">Низкая</option>
              <option value="med">Средняя</option>
              <option value="high">Высокая</option>
            </Select>
          </Field>
        </div>

        <Field label="Симптом" htmlFor={`${uid}-symptom`}>
          <Textarea
            id={`${uid}-symptom`}
            value={symptom}
            onChange={(e) => setSymptom(e.target.value)}
            placeholder="Как проявляется неисправность"
            rows={2}
          />
        </Field>
        <Field label="Причина" htmlFor={`${uid}-cause`}>
          <Textarea
            id={`${uid}-cause`}
            value={cause}
            onChange={(e) => setCause(e.target.value)}
            placeholder="Вероятная причина"
            rows={2}
          />
        </Field>

        {/* Solution markdown */}
        <Field label="Решение (Markdown)" htmlFor={`${uid}-solution`}>
          <div className={showPreview ? 'grid gap-3 lg:grid-cols-2' : ''}>
            <Textarea
              id={`${uid}-solution`}
              value={solution}
              onChange={(e) => setSolution(e.target.value)}
              placeholder="Пошаговое решение в **markdown**…"
              rows={8}
              className="font-mono text-[13px] leading-relaxed"
            />
            {showPreview && (
              <div className="max-h-[16rem] overflow-y-auto rounded-lg border border-line bg-surface-2 p-4">
                {solution.trim() ? (
                  <MarkdownView headingBase={4}>{solution}</MarkdownView>
                ) : (
                  <p className={articleType.empty}>Превью появится здесь…</p>
                )}
              </div>
            )}
          </div>
          <div className="mt-1.5 flex justify-end">
            <Button
              variant="ghost"
              size="sm"
              icon={showPreview ? EyeOff : Eye}
              onClick={() => setShowPreview((v) => !v)}
              aria-pressed={showPreview}
            >
              {showPreview ? 'Скрыть превью' : 'Превью'}
            </Button>
          </div>
        </Field>

        <Field label="Теги" htmlFor={`${uid}-tags`} hint="Через запятую: зажигание, форсунки, диагностика">
          <Input
            id={`${uid}-tags`}
            value={tagsInput}
            onChange={(e) => setTagsInput(e.target.value)}
            placeholder="зажигание, форсунки"
          />
        </Field>
      </div>
    </Modal>
  );
}
