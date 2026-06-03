import { useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  BookOpen,
  Search,
  Pin,
  ShieldCheck,
  Plus,
  Pencil,
  Trash2,
  X,
  ArrowLeft,
  Paperclip,
  Check,
  Users as UsersIcon,
  FolderPlus,
  Eye,
  EyeOff,
  Loader2,
  ImagePlus,
  ChevronRight,
  FileText,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../contexts/AuthContext';
import { knowledgeApi, uploadsApi } from '../api/services';
import type {
  KnowledgeArticle,
  KnowledgeArticleType,
  KnowledgeAttachment,
  KnowledgeCategory,
} from '../types';
import { UserRole } from '../types';
import { formatDateTime } from '../../../shared/utils/formatters';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import EmptyState from '../components/EmptyState';
import MarkdownView from '../components/MarkdownView';

// ───────────────────────────────────────────────────────────────────────
//  Query keys (shared convention: ['knowledge', <resource>, ...args])
// ───────────────────────────────────────────────────────────────────────
const KEY = {
  categories: ['knowledge', 'categories'] as const,
  articles: (categoryId: string | null, type: KnowledgeArticleType | null, search: string) =>
    ['knowledge', 'articles', { categoryId, type, search }] as const,
  article: (id: string) => ['knowledge', 'article', id] as const,
  acks: (id: string) => ['knowledge', 'acks', id] as const,
  pendingCount: ['knowledge', 'regulations', 'pending-count'] as const,
};

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '';
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} КБ`;
  return `${(kb / 1024).toFixed(1)} МБ`;
}

type View = { mode: 'browse' } | { mode: 'reader'; id: string };

export default function KnowledgeBasePage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isManager =
    !!user &&
    [UserRole.DIRECTOR, UserRole.ADMIN, UserRole.SUPERADMIN].includes(user.role);

  const [view, setView] = useState<View>({ mode: 'browse' });
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [activeType, setActiveType] = useState<KnowledgeArticleType | null>(null);

  // Debounce the search input → query param.
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSearchChange = (value: string) => {
    setSearchInput(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setSearch(value.trim()), 300);
  };

  // ── Data ────────────────────────────────────────────────────────────
  const { data: categories = [] } = useQuery({
    queryKey: KEY.categories,
    queryFn: async () => (await knowledgeApi.listCategories()).data,
    staleTime: 5 * 60 * 1000,
  });

  const { data: articles = [], isLoading: articlesLoading } = useQuery({
    queryKey: KEY.articles(activeCategory, activeType, search),
    queryFn: async () =>
      (
        await knowledgeApi.listArticles({
          categoryId: activeCategory || undefined,
          type: activeType || undefined,
          search: search || undefined,
        })
      ).data,
  });

  const pinned = useMemo(() => articles.filter((a) => a.pinned), [articles]);
  const recent = useMemo(() => articles.filter((a) => !a.pinned), [articles]);

  // ── Author modal state ──────────────────────────────────────────────
  const [editorArticle, setEditorArticle] = useState<KnowledgeArticle | 'new' | null>(null);
  const [categoryManagerOpen, setCategoryManagerOpen] = useState(false);

  const invalidateLists = () =>
    queryClient.invalidateQueries({ queryKey: ['knowledge', 'articles'] });

  if (view.mode === 'reader') {
    return (
      <ArticleReader
        articleId={view.id}
        isManager={isManager}
        onBack={() => setView({ mode: 'browse' })}
        onEdit={(article) => setEditorArticle(article)}
        editorArticle={editorArticle}
        categories={categories}
        onCloseEditor={() => setEditorArticle(null)}
        onAfterMutation={invalidateLists}
        onDeleted={() => setView({ mode: 'browse' })}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="page-header">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-50">
            <BookOpen className="h-5 w-5 text-primary-600" />
          </div>
          <div>
            <h1 className="page-title">База знаний</h1>
            <p className="text-sm text-gray-500">Статьи, инструкции и регламенты автосервиса</p>
          </div>
        </div>
        {isManager && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCategoryManagerOpen(true)}
              className="btn-secondary btn-sm"
              title="Категории"
            >
              <FolderPlus className="h-4 w-4" />
              <span className="hidden sm:inline">Категории</span>
            </button>
            <button onClick={() => setEditorArticle('new')} className="btn-primary btn-sm">
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">Новая статья</span>
            </button>
          </div>
        )}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <input
          type="search"
          value={searchInput}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Поиск по статьям и регламентам…"
          className="input pl-10"
        />
      </div>

      {/* Type + category filters */}
      <div className="flex flex-wrap gap-2">
        <TypeChip label="Всё" active={activeType === null} onClick={() => setActiveType(null)} />
        <TypeChip
          label="Статьи"
          active={activeType === 'article'}
          onClick={() => setActiveType('article')}
        />
        <TypeChip
          label="Регламенты"
          active={activeType === 'regulation'}
          onClick={() => setActiveType('regulation')}
        />
      </div>

      <div className="flex flex-col gap-6 lg:flex-row">
        {/* Category sidebar */}
        <aside className="lg:w-56 lg:flex-shrink-0">
          <div className="card overflow-hidden">
            <button
              onClick={() => setActiveCategory(null)}
              className={`flex w-full items-center justify-between px-4 py-2.5 text-sm transition-colors ${
                activeCategory === null
                  ? 'bg-primary-50 font-semibold text-primary-700'
                  : 'text-gray-700 hover:bg-gray-50'
              }`}
            >
              Все категории
            </button>
            {categories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setActiveCategory(cat.id)}
                className={`flex w-full items-center justify-between border-t border-gray-100 px-4 py-2.5 text-sm transition-colors ${
                  activeCategory === cat.id
                    ? 'bg-primary-50 font-semibold text-primary-700'
                    : 'text-gray-700 hover:bg-gray-50'
                }`}
              >
                <span className="truncate">{cat.name}</span>
                <ChevronRight className="h-4 w-4 flex-shrink-0 text-gray-300" />
              </button>
            ))}
            {categories.length === 0 && (
              <p className="border-t border-gray-100 px-4 py-3 text-xs text-gray-400">
                Категорий пока нет
              </p>
            )}
          </div>
        </aside>

        {/* Articles */}
        <div className="flex-1 space-y-6">
          {articlesLoading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-primary-500" />
            </div>
          ) : articles.length === 0 ? (
            <EmptyState
              icon={BookOpen}
              title="Ничего не найдено"
              description={
                search
                  ? 'Попробуйте изменить запрос или выбрать другую категорию.'
                  : isManager
                    ? 'Создайте первую статью, чтобы наполнить базу знаний.'
                    : 'В этой категории пока нет материалов.'
              }
              action={
                isManager && !search
                  ? { label: 'Создать статью', onClick: () => setEditorArticle('new') }
                  : undefined
              }
            />
          ) : (
            <>
              {pinned.length > 0 && (
                <section>
                  <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-gray-500">
                    <Pin className="h-4 w-4" /> Закреплённые
                  </h2>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {pinned.map((a) => (
                      <ArticleCard
                        key={a.id}
                        article={a}
                        onOpen={() => setView({ mode: 'reader', id: a.id })}
                      />
                    ))}
                  </div>
                </section>
              )}
              <section>
                {pinned.length > 0 && (
                  <h2 className="mb-3 text-sm font-semibold text-gray-500">Все материалы</h2>
                )}
                <div className="grid gap-3 sm:grid-cols-2">
                  {recent.map((a) => (
                    <ArticleCard
                      key={a.id}
                      article={a}
                      onOpen={() => setView({ mode: 'reader', id: a.id })}
                    />
                  ))}
                </div>
              </section>
            </>
          )}
        </div>
      </div>

      {/* Author modal (from browse view) */}
      {isManager && editorArticle && (
        <ArticleEditorModal
          article={editorArticle === 'new' ? null : editorArticle}
          categories={categories}
          onClose={() => setEditorArticle(null)}
          onSaved={() => {
            setEditorArticle(null);
            invalidateLists();
          }}
        />
      )}

      {/* Category manager modal */}
      {isManager && (
        <CategoryManagerModal
          isOpen={categoryManagerOpen}
          onClose={() => setCategoryManagerOpen(false)}
          categories={categories}
        />
      )}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────
//  Type filter chip
// ───────────────────────────────────────────────────────────────────────
function TypeChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`press-soft rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
        active
          ? 'bg-primary-600 text-white'
          : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
      }`}
    >
      {label}
    </button>
  );
}

// ───────────────────────────────────────────────────────────────────────
//  Article card (browse)
// ───────────────────────────────────────────────────────────────────────
function ArticleCard({
  article,
  onOpen,
}: {
  article: KnowledgeArticle;
  onOpen: () => void;
}) {
  const isRegulation = article.type === 'regulation';
  return (
    <button
      onClick={onOpen}
      className="card-interactive flex flex-col overflow-hidden text-left"
    >
      {article.coverImage && (
        <img
          src={article.coverImage}
          alt=""
          className="h-28 w-full object-cover"
          loading="lazy"
        />
      )}
      <div className="flex flex-1 flex-col p-4">
        <div className="mb-1.5 flex items-center gap-2">
          {isRegulation ? (
            <span className="badge-warning gap-1">
              <ShieldCheck className="h-3 w-3" /> Регламент
            </span>
          ) : (
            <span className="badge-blue gap-1">
              <FileText className="h-3 w-3" /> Статья
            </span>
          )}
          {!article.published && <span className="badge-gray">Черновик</span>}
        </div>
        <h3 className="text-sm font-semibold text-gray-900 line-clamp-2">{article.title}</h3>
        {article.excerpt && (
          <p className="mt-1 text-xs text-gray-500 line-clamp-2">{article.excerpt}</p>
        )}
        {article.categoryName && (
          <p className="mt-auto pt-2 text-xs font-medium text-gray-400">{article.categoryName}</p>
        )}
      </div>
    </button>
  );
}

// ───────────────────────────────────────────────────────────────────────
//  Reader
// ───────────────────────────────────────────────────────────────────────
function ArticleReader({
  articleId,
  isManager,
  onBack,
  onEdit,
  editorArticle,
  categories,
  onCloseEditor,
  onAfterMutation,
  onDeleted,
}: {
  articleId: string;
  isManager: boolean;
  onBack: () => void;
  onEdit: (a: KnowledgeArticle) => void;
  editorArticle: KnowledgeArticle | 'new' | null;
  categories: KnowledgeCategory[];
  onCloseEditor: () => void;
  onAfterMutation: () => void;
  onDeleted: () => void;
}) {
  const queryClient = useQueryClient();
  const [acksOpen, setAcksOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const { data: article, isLoading } = useQuery({
    queryKey: KEY.article(articleId),
    queryFn: async () => (await knowledgeApi.getArticle(articleId)).data,
  });

  const ackMutation = useMutation({
    mutationFn: () => knowledgeApi.acknowledge(articleId),
    onSuccess: (res) => {
      // Optimistically update the cached article so the green ✓ appears instantly.
      queryClient.setQueryData<KnowledgeArticle>(KEY.article(articleId), (prev) =>
        prev ? { ...prev, acknowledged: !!res.data.acknowledgedAt } : prev,
      );
      queryClient.invalidateQueries({ queryKey: KEY.acks(articleId) });
      queryClient.invalidateQueries({ queryKey: KEY.pendingCount });
      toast.success('Отмечено: ознакомлен');
    },
    onError: () => toast.error('Не удалось отметить'),
  });

  const deleteMutation = useMutation({
    mutationFn: () => knowledgeApi.deleteArticle(articleId),
    onSuccess: () => {
      toast.success('Статья удалена');
      onAfterMutation();
      onDeleted();
    },
    onError: () => toast.error('Не удалось удалить'),
  });

  if (isLoading || !article) {
    return (
      <div className="space-y-6">
        <button onClick={onBack} className="btn-ghost btn-sm -ml-2">
          <ArrowLeft className="h-4 w-4" /> Назад
        </button>
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-primary-500" />
        </div>
      </div>
    );
  }

  const isRegulation = article.type === 'regulation';

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="btn-ghost btn-sm -ml-2">
          <ArrowLeft className="h-4 w-4" /> Назад
        </button>
        {isManager && (
          <div className="flex items-center gap-2">
            {isRegulation && (
              <button onClick={() => setAcksOpen(true)} className="btn-secondary btn-sm">
                <UsersIcon className="h-4 w-4" />
                <span className="hidden sm:inline">Кто ознакомился</span>
              </button>
            )}
            <button onClick={() => onEdit(article)} className="btn-secondary btn-sm">
              <Pencil className="h-4 w-4" />
              <span className="hidden sm:inline">Изменить</span>
            </button>
            <button onClick={() => setConfirmDelete(true)} className="btn-ghost btn-sm text-red-600">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      <article className="card overflow-hidden">
        {article.coverImage && (
          <img src={article.coverImage} alt="" className="max-h-64 w-full object-cover" />
        )}
        <div className="p-6 sm:p-8">
          {/* Meta */}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {isRegulation ? (
              <span className="badge-warning gap-1">
                <ShieldCheck className="h-3 w-3" /> Регламент
              </span>
            ) : (
              <span className="badge-blue gap-1">
                <FileText className="h-3 w-3" /> Статья
              </span>
            )}
            {article.categoryName && <span className="badge-gray">{article.categoryName}</span>}
            {!article.published && <span className="badge-gray">Черновик</span>}
          </div>

          <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">{article.title}</h1>
          <p className="mt-1.5 text-xs text-gray-400">
            Обновлено {formatDateTime(article.updatedAt)}
          </p>

          {/* Regulation acknowledgment banner */}
          {isRegulation && (
            <div className="mt-5">
              {article.acknowledged ? (
                <div className="flex items-center gap-2 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm font-medium text-green-700">
                  <Check className="h-5 w-5" /> Вы ознакомлены с этим регламентом
                </div>
              ) : (
                <button
                  onClick={() => ackMutation.mutate()}
                  disabled={ackMutation.isPending}
                  className="btn-primary"
                >
                  {ackMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Check className="h-4 w-4" />
                  )}
                  Ознакомлен
                </button>
              )}
            </div>
          )}

          {/* Body */}
          <div className="mt-6">
            {article.body ? (
              <MarkdownView>{article.body}</MarkdownView>
            ) : (
              <p className="text-sm italic text-gray-400">Содержимое не заполнено.</p>
            )}
          </div>

          {/* Attachments */}
          {article.attachments && article.attachments.length > 0 && (
            <div className="mt-8 border-t border-gray-100 pt-5">
              <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-gray-700">
                <Paperclip className="h-4 w-4" /> Вложения
              </h3>
              <div className="space-y-2">
                {article.attachments.map((att, i) => (
                  <a
                    key={`${att.url}-${i}`}
                    href={att.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 rounded-lg border border-gray-200 px-3 py-2.5 text-sm transition-colors hover:bg-gray-50"
                  >
                    <Paperclip className="h-4 w-4 flex-shrink-0 text-gray-400" />
                    <span className="flex-1 truncate text-gray-800">{att.name}</span>
                    {att.size ? (
                      <span className="text-xs text-gray-400">{formatBytes(att.size)}</span>
                    ) : null}
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      </article>

      {/* Acks panel */}
      {isManager && acksOpen && (
        <AcksModal articleId={articleId} onClose={() => setAcksOpen(false)} />
      )}

      {/* Editor modal (from reader) */}
      {isManager && editorArticle && (
        <ArticleEditorModal
          article={editorArticle === 'new' ? null : editorArticle}
          categories={categories}
          onClose={onCloseEditor}
          onSaved={() => {
            onCloseEditor();
            onAfterMutation();
            queryClient.invalidateQueries({ queryKey: KEY.article(articleId) });
          }}
        />
      )}

      <ConfirmDialog
        isOpen={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => deleteMutation.mutate()}
        title="Удалить статью?"
        message="Статья будет удалена без возможности восстановления."
        confirmText="Удалить"
        variant="danger"
      />
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────
//  «Кто ознакомился» — acknowledgment panel (manager)
// ───────────────────────────────────────────────────────────────────────
function AcksModal({ articleId, onClose }: { articleId: string; onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: KEY.acks(articleId),
    queryFn: async () => (await knowledgeApi.listAcks(articleId)).data,
  });

  return (
    <Modal isOpen onClose={onClose} title="Кто ознакомился" size="md">
      {isLoading || !data ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-primary-500" />
        </div>
      ) : (
        <div className="space-y-5">
          {/* Progress */}
          <div>
            <div className="mb-1.5 flex items-baseline justify-between">
              <span className="text-sm font-medium text-gray-700">
                {data.acknowledgedCount} из {data.totalAudience} ознакомлены
              </span>
              <span className="text-sm font-semibold text-green-600">
                {data.totalAudience > 0
                  ? Math.round((data.acknowledgedCount / data.totalAudience) * 100)
                  : 0}
                %
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
              <div
                className="h-full rounded-full bg-green-500 transition-all"
                style={{
                  width: `${
                    data.totalAudience > 0
                      ? (data.acknowledgedCount / data.totalAudience) * 100
                      : 0
                  }%`,
                }}
              />
            </div>
          </div>

          {/* Acknowledged list */}
          <div>
            <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">
              <Check className="h-3.5 w-3.5 text-green-500" /> Ознакомлены ({data.acknowledged.length})
            </h4>
            {data.acknowledged.length === 0 ? (
              <p className="text-sm text-gray-400">Пока никто не ознакомился.</p>
            ) : (
              <ul className="space-y-1.5">
                {data.acknowledged.map((a) => (
                  <li
                    key={a.userId}
                    className="flex items-center justify-between rounded-lg bg-green-50 px-3 py-2"
                  >
                    <span className="text-sm font-medium text-gray-800">{a.userName}</span>
                    <span className="text-xs text-gray-500">{formatDateTime(a.acknowledgedAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Pending list */}
          {data.pending.length > 0 && (
            <div>
              <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">
                <X className="h-3.5 w-3.5 text-gray-300" /> Ожидают ({data.pending.length})
              </h4>
              <ul className="space-y-1.5">
                {data.pending.map((p) => (
                  <li
                    key={p.userId}
                    className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-600"
                  >
                    {p.userName}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

// ───────────────────────────────────────────────────────────────────────
//  Article editor (create / edit) — manager only
// ───────────────────────────────────────────────────────────────────────
function ArticleEditorModal({
  article,
  categories,
  onClose,
  onSaved,
}: {
  article: KnowledgeArticle | null;
  categories: KnowledgeCategory[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!article;
  const [title, setTitle] = useState(article?.title ?? '');
  const [body, setBody] = useState(article?.body ?? '');
  const [type, setType] = useState<KnowledgeArticleType>(article?.type ?? 'article');
  const [categoryId, setCategoryId] = useState<string>(article?.categoryId ?? '');
  const [coverImage, setCoverImage] = useState<string | null>(article?.coverImage ?? null);
  const [attachments, setAttachments] = useState<KnowledgeAttachment[]>(
    article?.attachments ?? [],
  );
  const [pinned, setPinned] = useState(article?.pinned ?? false);
  const [published, setPublished] = useState(article?.published ?? true);
  const [showPreview, setShowPreview] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);

  const coverInputRef = useRef<HTMLInputElement>(null);
  const attachInputRef = useRef<HTMLInputElement>(null);

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = {
        title: title.trim(),
        body,
        type,
        categoryId: categoryId || null,
        coverImage: coverImage || null,
        attachments,
        pinned,
        published,
      };
      return isEdit
        ? knowledgeApi.updateArticle(article!.id, payload)
        : knowledgeApi.createArticle(payload);
    },
    onSuccess: () => {
      toast.success(isEdit ? 'Статья обновлена' : 'Статья создана');
      onSaved();
    },
    onError: () => toast.error('Не удалось сохранить'),
  });

  const handleCoverUpload = async (file: File) => {
    setUploadingCover(true);
    try {
      const res = await uploadsApi.upload(file);
      setCoverImage(res.data.url);
    } catch {
      toast.error('Не удалось загрузить обложку');
    } finally {
      setUploadingCover(false);
    }
  };

  const handleAttachmentUpload = async (file: File) => {
    setUploadingAttachment(true);
    try {
      const res = await uploadsApi.upload(file);
      setAttachments((prev) => [
        ...prev,
        { url: res.data.url, name: res.data.originalname || file.name, size: res.data.size },
      ]);
    } catch {
      toast.error('Не удалось загрузить вложение');
    } finally {
      setUploadingAttachment(false);
    }
  };

  const canSave = title.trim().length > 0 && !saveMutation.isPending;

  return (
    <Modal isOpen onClose={onClose} title={isEdit ? 'Редактирование' : 'Новая статья'} size="xl">
      <div className="space-y-4">
        {/* Title */}
        <div>
          <label className="label">Заголовок</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Например: Регламент приёмки автомобиля"
            className="input"
            autoFocus
          />
        </div>

        {/* Type + category */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label">Тип</label>
            <div className="flex rounded-lg border border-gray-200 p-1">
              <button
                type="button"
                onClick={() => setType('article')}
                className={`flex-1 rounded-md py-1.5 text-sm font-medium transition-colors ${
                  type === 'article' ? 'bg-primary-600 text-white' : 'text-gray-600'
                }`}
              >
                Статья
              </button>
              <button
                type="button"
                onClick={() => setType('regulation')}
                className={`flex-1 rounded-md py-1.5 text-sm font-medium transition-colors ${
                  type === 'regulation' ? 'bg-primary-600 text-white' : 'text-gray-600'
                }`}
              >
                Регламент
              </button>
            </div>
          </div>
          <div>
            <label className="label">Категория</label>
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="input"
            >
              <option value="">Без категории</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Body — markdown editor + live preview */}
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label className="label mb-0">Содержание (Markdown)</label>
            <button
              type="button"
              onClick={() => setShowPreview((v) => !v)}
              className="btn-ghost btn-sm"
            >
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
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="# Заголовок&#10;&#10;Поддерживается **markdown**: списки, таблицы, ссылки, цитаты…"
              rows={14}
              className="input resize-y font-mono text-[13px] leading-relaxed"
            />
            {showPreview && (
              <div className="max-h-[22rem] overflow-y-auto rounded-lg border border-gray-200 bg-gray-50/50 p-4">
                {body.trim() ? (
                  <MarkdownView>{body}</MarkdownView>
                ) : (
                  <p className="text-sm italic text-gray-400">Превью появится здесь…</p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Cover image */}
        <div>
          <label className="label">Обложка</label>
          {coverImage ? (
            <div className="relative inline-block">
              <img src={coverImage} alt="" className="h-28 rounded-lg object-cover" />
              <button
                type="button"
                onClick={() => setCoverImage(null)}
                className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-white text-gray-500 shadow ring-1 ring-gray-200 hover:text-red-600"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => coverInputRef.current?.click()}
              disabled={uploadingCover}
              className="btn-secondary btn-sm"
            >
              {uploadingCover ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ImagePlus className="h-4 w-4" />
              )}
              Загрузить обложку
            </button>
          )}
          <input
            ref={coverInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleCoverUpload(f);
              e.target.value = '';
            }}
          />
        </div>

        {/* Attachments */}
        <div>
          <label className="label">Вложения</label>
          {attachments.length > 0 && (
            <div className="mb-2 space-y-2">
              {attachments.map((att, i) => (
                <div
                  key={`${att.url}-${i}`}
                  className="flex items-center gap-3 rounded-lg border border-gray-200 px-3 py-2 text-sm"
                >
                  <Paperclip className="h-4 w-4 flex-shrink-0 text-gray-400" />
                  <span className="flex-1 truncate text-gray-800">{att.name}</span>
                  {att.size ? (
                    <span className="text-xs text-gray-400">{formatBytes(att.size)}</span>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setAttachments((prev) => prev.filter((_, idx) => idx !== i))}
                    className="text-gray-400 hover:text-red-600"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={() => attachInputRef.current?.click()}
            disabled={uploadingAttachment}
            className="btn-secondary btn-sm"
          >
            {uploadingAttachment ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Paperclip className="h-4 w-4" />
            )}
            Добавить файл
          </button>
          <input
            ref={attachInputRef}
            type="file"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleAttachmentUpload(f);
              e.target.value = '';
            }}
          />
        </div>

        {/* Toggles */}
        <div className="flex flex-wrap gap-4 border-t border-gray-100 pt-4">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={pinned}
              onChange={(e) => setPinned(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
            />
            <Pin className="h-4 w-4 text-gray-400" /> Закрепить
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={published}
              onChange={(e) => setPublished(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
            />
            {published ? (
              <Eye className="h-4 w-4 text-gray-400" />
            ) : (
              <EyeOff className="h-4 w-4 text-gray-400" />
            )}
            Опубликовано
          </label>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 border-t border-gray-100 pt-4">
          <button onClick={onClose} className="btn-secondary">
            Отмена
          </button>
          <button
            onClick={() => saveMutation.mutate()}
            disabled={!canSave}
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

// ───────────────────────────────────────────────────────────────────────
//  Category manager — add / rename / delete (manager only)
// ───────────────────────────────────────────────────────────────────────
function CategoryManagerModal({
  isOpen,
  onClose,
  categories,
}: {
  isOpen: boolean;
  onClose: () => void;
  categories: KnowledgeCategory[];
}) {
  const queryClient = useQueryClient();
  const [newName, setNewName] = useState('');
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: KEY.categories });

  const createMutation = useMutation({
    mutationFn: (name: string) => knowledgeApi.createCategory({ name }),
    onSuccess: () => {
      invalidate();
      setNewName('');
    },
    onError: () => toast.error('Не удалось создать категорию'),
  });

  const renameMutation = useMutation({
    mutationFn: (vars: { id: string; name: string }) =>
      knowledgeApi.updateCategory(vars.id, { name: vars.name }),
    onSuccess: () => {
      invalidate();
      setEditing(null);
    },
    onError: () => toast.error('Не удалось переименовать'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => knowledgeApi.deleteCategory(id),
    onSuccess: () => {
      invalidate();
      queryClient.invalidateQueries({ queryKey: ['knowledge', 'articles'] });
      setConfirmDeleteId(null);
    },
    onError: () => toast.error('Не удалось удалить категорию'),
  });

  return (
    <>
      <Modal isOpen={isOpen} onClose={onClose} title="Категории" size="md">
        <div className="space-y-4">
          {/* Add */}
          <div className="flex gap-2">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newName.trim()) createMutation.mutate(newName.trim());
              }}
              placeholder="Новая категория"
              className="input flex-1"
            />
            <button
              onClick={() => newName.trim() && createMutation.mutate(newName.trim())}
              disabled={!newName.trim() || createMutation.isPending}
              className="btn-primary"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>

          {/* List */}
          <div className="divide-y divide-gray-100 rounded-lg border border-gray-200">
            {categories.length === 0 ? (
              <p className="px-3 py-4 text-center text-sm text-gray-400">Категорий пока нет</p>
            ) : (
              categories.map((cat) => (
                <div key={cat.id} className="flex items-center gap-2 px-3 py-2.5">
                  {editing?.id === cat.id ? (
                    <>
                      <input
                        value={editing.name}
                        onChange={(e) => setEditing({ id: cat.id, name: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && editing.name.trim())
                            renameMutation.mutate({ id: cat.id, name: editing.name.trim() });
                        }}
                        className="input flex-1 py-1.5"
                        autoFocus
                      />
                      <button
                        onClick={() =>
                          editing.name.trim() &&
                          renameMutation.mutate({ id: cat.id, name: editing.name.trim() })
                        }
                        className="text-green-600 hover:text-green-700"
                      >
                        <Check className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => setEditing(null)}
                        className="text-gray-400 hover:text-gray-600"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="flex-1 truncate text-sm text-gray-800">{cat.name}</span>
                      <button
                        onClick={() => setEditing({ id: cat.id, name: cat.name })}
                        className="text-gray-400 hover:text-primary-600"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => setConfirmDeleteId(cat.id)}
                        className="text-gray-400 hover:text-red-600"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        isOpen={!!confirmDeleteId}
        onClose={() => setConfirmDeleteId(null)}
        onConfirm={() => confirmDeleteId && deleteMutation.mutate(confirmDeleteId)}
        title="Удалить категорию?"
        message="Статьи этой категории останутся, но потеряют привязку к ней."
        confirmText="Удалить"
        variant="danger"
      />
    </>
  );
}
