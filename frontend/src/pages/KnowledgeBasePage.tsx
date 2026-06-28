import { useEffect, useMemo, useRef, useState } from 'react';
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
  Folder,
  Eye,
  EyeOff,
  Loader2,
  ImagePlus,
  ChevronRight,
  FileText,
  GraduationCap,
  ThumbsUp,
  ThumbsDown,
  AlertCircle,
  CalendarClock,
  RefreshCw,
  Home,
  Blocks,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../contexts/AuthContext';
import { knowledgeApi, uploadsApi } from '../api/services';
import type {
  KnowledgeArticle,
  KnowledgeArticleType,
  KnowledgeAttachment,
  KnowledgeBlock,
  KnowledgeCategory,
  KnowledgeCourse,
} from '../types';
import { UserRole } from '../types';
import { formatDateTime, formatDateShort } from '../../../shared/utils/formatters';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import EmptyState from '../components/EmptyState';
import MarkdownView from '../components/MarkdownView';
import ArticleBlocksReader from '../components/knowledge/ArticleBlocks';
import BlockEditor from '../components/knowledge/BlockEditor';
import LearningCenter from './knowledge/LearningCenter';

// ───────────────────────────────────────────────────────────────────────
//  Query keys (shared convention: ['knowledge', <resource>, ...args])
// ───────────────────────────────────────────────────────────────────────
const KEY = {
  categories: ['knowledge', 'categories'] as const,
  articlesByType: (type: KnowledgeArticleType) => ['knowledge', 'articles', { type }] as const,
  article: (id: string) => ['knowledge', 'article', id] as const,
  search: (q: string) => ['knowledge', 'search', q] as const,
  acks: (id: string) => ['knowledge', 'acks', id] as const,
  pendingCount: ['knowledge', 'regulations', 'pending-count'] as const,
};

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '';
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} КБ`;
  return `${(kb / 1024).toFixed(1)} МБ`;
}

/** Russian plural for «просмотр / просмотра / просмотров». */
function pluralizeViews(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'просмотр';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'просмотра';
  return 'просмотров';
}

/** Pull a human message out of an axios-style error (NestJS validation may return string[]). */
function errMessage(err: unknown, fallback: string): string {
  const m = (err as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message;
  if (Array.isArray(m)) return m.filter(Boolean).join(', ') || fallback;
  return m || fallback;
}

type View = { mode: 'browse' } | { mode: 'reader'; id: string };
/** The three KB pillars. «База знаний» / «Регламенты» are folder-browsed article sets. */
type Section = 'knowledge' | 'regulations' | 'learning';

const SECTION_TYPE: Record<'knowledge' | 'regulations', KnowledgeArticleType> = {
  knowledge: 'article',
  regulations: 'regulation',
};

export default function KnowledgeBasePage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isManager = !!user && [UserRole.DIRECTOR, UserRole.ADMIN, UserRole.SUPERADMIN].includes(user.role);

  const [section, setSection] = useState<Section>('knowledge');
  const [view, setView] = useState<View>({ mode: 'browse' });
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [folderId, setFolderId] = useState<string | null>(null);
  const [learningCourseId, setLearningCourseId] = useState<string | null>(null);

  // Debounce the search input → query param.
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSearchChange = (value: string) => {
    setSearchInput(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setSearch(value.trim()), 300);
  };
  const clearSearch = () => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    setSearchInput('');
    setSearch('');
  };

  const isArticleSection = section === 'knowledge' || section === 'regulations';
  const sectionType: KnowledgeArticleType | null = isArticleSection ? SECTION_TYPE[section] : null;
  const searchActive = search.length >= 2;

  // ── Data ────────────────────────────────────────────────────────────
  const { data: categories = [] } = useQuery({
    queryKey: KEY.categories,
    queryFn: async () => (await knowledgeApi.listCategories()).data,
    staleTime: 5 * 60 * 1000,
  });

  // Fetch the whole article set for the active section type once; the folder
  // view filters it client-side by `categoryId`. Slim payloads → cheap.
  const { data: articles = [], isLoading: articlesLoading } = useQuery({
    queryKey: sectionType ? KEY.articlesByType(sectionType) : ['knowledge', 'articles', 'none'],
    queryFn: async () => (await knowledgeApi.listArticles({ type: sectionType! })).data,
    enabled: sectionType !== null,
  });

  const { data: searchResults, isFetching: searchFetching } = useQuery({
    queryKey: KEY.search(search),
    queryFn: async () => (await knowledgeApi.search(search)).data,
    enabled: searchActive,
    placeholderData: (prev) => prev,
  });

  // ── Category tree (parentId) ────────────────────────────────────────
  const categoryById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const childrenByParent = useMemo(() => {
    const m = new Map<string | null, KnowledgeCategory[]>();
    for (const c of categories) {
      const p = c.parentId ?? null;
      if (!m.has(p)) m.set(p, []);
      m.get(p)!.push(c);
    }
    for (const list of m.values()) list.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'ru'));
    return m;
  }, [categories]);

  // Breadcrumb path root → current folder.
  const breadcrumb = useMemo(() => {
    const path: KnowledgeCategory[] = [];
    const seen = new Set<string>();
    let cur = folderId ? categoryById.get(folderId) : undefined;
    while (cur && !seen.has(cur.id)) {
      path.unshift(cur);
      seen.add(cur.id);
      cur = cur.parentId ? categoryById.get(cur.parentId) : undefined;
    }
    return path;
  }, [folderId, categoryById]);

  // If the open folder was deleted (children orphan to root), fall back to root.
  useEffect(() => {
    if (folderId && categories.length > 0 && !categoryById.has(folderId)) setFolderId(null);
  }, [folderId, categories.length, categoryById]);

  const subfolders = childrenByParent.get(folderId) ?? [];
  const folderArticles = useMemo(
    () => articles.filter((a) => (a.categoryId ?? null) === folderId),
    [articles, folderId],
  );
  const pinned = useMemo(() => folderArticles.filter((a) => a.pinned), [folderArticles]);
  const rest = useMemo(() => folderArticles.filter((a) => !a.pinned), [folderArticles]);

  const countDirectArticles = (catId: string) => articles.filter((a) => (a.categoryId ?? null) === catId).length;

  // ── Modal state ─────────────────────────────────────────────────────
  const [editorArticle, setEditorArticle] = useState<KnowledgeArticle | 'new' | null>(null);
  const [folderManager, setFolderManager] = useState<{ presetParent: string | null } | null>(null);

  const invalidateLists = () => {
    if (sectionType) queryClient.invalidateQueries({ queryKey: KEY.articlesByType(sectionType) });
    queryClient.invalidateQueries({ queryKey: ['knowledge', 'articles'] });
    queryClient.invalidateQueries({ queryKey: ['knowledge', 'search'] });
  };

  const goToSection = (next: Section) => {
    setSection(next);
    setFolderId(null);
  };

  // ── Reader (full-page) ──────────────────────────────────────────────
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
            <p className="text-sm text-gray-500">Регламенты, учебный центр и справочные материалы</p>
          </div>
        </div>
        {isManager && isArticleSection && !searchActive && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setFolderManager({ presetParent: folderId })}
              className="btn-secondary btn-sm"
              title="Папки"
            >
              <FolderPlus className="h-4 w-4" />
              <span className="hidden sm:inline">Папки</span>
            </button>
            <button onClick={() => setEditorArticle('new')} className="btn-primary btn-sm">
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">{section === 'regulations' ? 'Новый регламент' : 'Новая статья'}</span>
            </button>
          </div>
        )}
      </div>

      {/* Smart global search */}
      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <input
          type="search"
          value={searchInput}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Поиск по статьям, регламентам, папкам и курсам…"
          className="input pl-10 pr-10"
        />
        {searchInput && (
          <button
            onClick={clearSearch}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            aria-label="Очистить"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {searchActive ? (
        <SearchResultsPanel
          results={searchResults}
          loading={searchFetching && !searchResults}
          query={search}
          onOpenArticle={(id) => setView({ mode: 'reader', id })}
          onOpenCategory={(id) => {
            clearSearch();
            goToSection('knowledge');
            setFolderId(id);
          }}
          onOpenCourse={(id) => {
            clearSearch();
            setLearningCourseId(id);
            setSection('learning');
          }}
        />
      ) : (
        <>
          {/* Section tabs */}
          <div className="flex gap-1 rounded-xl bg-gray-100 p-1">
            <SectionTab
              label="База знаний"
              icon={BookOpen}
              active={section === 'knowledge'}
              onClick={() => goToSection('knowledge')}
            />
            <SectionTab
              label="Регламенты"
              icon={ShieldCheck}
              active={section === 'regulations'}
              onClick={() => goToSection('regulations')}
            />
            <SectionTab
              label="Учебный центр"
              icon={GraduationCap}
              active={section === 'learning'}
              onClick={() => goToSection('learning')}
            />
          </div>

          {section === 'learning' && (
            <LearningCenter
              key={learningCourseId ?? 'grid'}
              isManager={isManager}
              categories={categories}
              initialCourseId={learningCourseId ?? undefined}
            />
          )}

          {isArticleSection && (
            <div className="space-y-5">
              {/* Breadcrumbs */}
              <nav className="flex flex-wrap items-center gap-1 text-sm">
                <button
                  onClick={() => setFolderId(null)}
                  className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 transition-colors ${
                    folderId === null ? 'font-semibold text-gray-900' : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  <Home className="h-3.5 w-3.5" />
                  {section === 'regulations' ? 'Регламенты' : 'Все папки'}
                </button>
                {breadcrumb.map((c) => (
                  <span key={c.id} className="flex items-center gap-1">
                    <ChevronRight className="h-3.5 w-3.5 text-gray-300" />
                    <button
                      onClick={() => setFolderId(c.id)}
                      className={`rounded-lg px-2 py-1 transition-colors ${
                        c.id === folderId ? 'font-semibold text-gray-900' : 'text-gray-500 hover:text-gray-700'
                      }`}
                    >
                      {c.name}
                    </button>
                  </span>
                ))}
              </nav>

              {articlesLoading ? (
                <div className="flex justify-center py-16">
                  <Loader2 className="h-6 w-6 animate-spin text-primary-500" />
                </div>
              ) : subfolders.length === 0 && folderArticles.length === 0 ? (
                <EmptyState
                  icon={section === 'regulations' ? ShieldCheck : BookOpen}
                  title="Здесь пока пусто"
                  description={
                    isManager ? 'Создайте папку или добавьте первый материал.' : 'В этом разделе пока нет материалов.'
                  }
                  action={
                    isManager
                      ? {
                          label: section === 'regulations' ? 'Новый регламент' : 'Новая статья',
                          onClick: () => setEditorArticle('new'),
                        }
                      : undefined
                  }
                />
              ) : (
                <>
                  {/* Subfolders */}
                  {(subfolders.length > 0 || isManager) && (
                    <section>
                      <div className="mb-2.5 flex items-center justify-between">
                        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-gray-500">
                          <Folder className="h-4 w-4" /> Папки
                        </h2>
                        {isManager && (
                          <button
                            onClick={() => setFolderManager({ presetParent: folderId })}
                            className="btn-ghost btn-sm text-primary-600"
                          >
                            <FolderPlus className="h-4 w-4" /> Новая папка
                          </button>
                        )}
                      </div>
                      {subfolders.length > 0 ? (
                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                          {subfolders.map((cat) => (
                            <FolderTile
                              key={cat.id}
                              category={cat}
                              articleCount={countDirectArticles(cat.id)}
                              subfolderCount={(childrenByParent.get(cat.id) ?? []).length}
                              onOpen={() => setFolderId(cat.id)}
                            />
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-gray-400">Подпапок нет</p>
                      )}
                    </section>
                  )}

                  {/* Pinned articles */}
                  {pinned.length > 0 && (
                    <section>
                      <h2 className="mb-2.5 flex items-center gap-1.5 text-sm font-semibold text-gray-500">
                        <Pin className="h-4 w-4" /> Закреплённые
                      </h2>
                      <div className="grid gap-3 sm:grid-cols-2">
                        {pinned.map((a) => (
                          <ArticleCard key={a.id} article={a} onOpen={() => setView({ mode: 'reader', id: a.id })} />
                        ))}
                      </div>
                    </section>
                  )}

                  {/* Articles in this folder */}
                  {rest.length > 0 && (
                    <section>
                      <h2 className="mb-2.5 text-sm font-semibold text-gray-500">
                        {section === 'regulations' ? 'Регламенты' : 'Материалы'}
                      </h2>
                      <div className="grid gap-3 sm:grid-cols-2">
                        {rest.map((a) => (
                          <ArticleCard key={a.id} article={a} onOpen={() => setView({ mode: 'reader', id: a.id })} />
                        ))}
                      </div>
                    </section>
                  )}
                </>
              )}
            </div>
          )}

          {/* Author modal */}
          {isManager && isArticleSection && editorArticle && (
            <ArticleEditorModal
              article={editorArticle === 'new' ? null : editorArticle}
              categories={categories}
              defaultType={sectionType ?? 'article'}
              defaultCategoryId={folderId}
              onClose={() => setEditorArticle(null)}
              onSaved={() => {
                setEditorArticle(null);
                invalidateLists();
              }}
            />
          )}

          {/* Folder manager */}
          {isManager && folderManager && (
            <FolderManagerModal
              presetParent={folderManager.presetParent}
              categories={categories}
              childrenByParent={childrenByParent}
              onClose={() => setFolderManager(null)}
            />
          )}
        </>
      )}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────
//  Section tab
// ───────────────────────────────────────────────────────────────────────
function SectionTab({
  label,
  icon: Icon,
  active,
  onClick,
}: {
  label: string;
  icon: typeof FileText;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-sm font-medium transition-colors ${
        active ? 'bg-white text-primary-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
      }`}
    >
      <Icon className="h-4 w-4" />
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

// ───────────────────────────────────────────────────────────────────────
//  Folder tile
// ───────────────────────────────────────────────────────────────────────
function FolderTile({
  category,
  articleCount,
  subfolderCount,
  onOpen,
}: {
  category: KnowledgeCategory;
  articleCount: number;
  subfolderCount: number;
  onOpen: () => void;
}) {
  const parts: string[] = [];
  if (subfolderCount > 0) parts.push(`${subfolderCount} подпапк${subfolderCount === 1 ? 'а' : 'и'}`);
  if (articleCount > 0) parts.push(`${articleCount} матер.`);
  return (
    <button onClick={onOpen} className="card-interactive flex items-center gap-3 p-4 text-left">
      <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
        <Folder className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-gray-900">{category.name}</span>
        <span className="block text-xs text-gray-400">{parts.length > 0 ? parts.join(' · ') : 'Пусто'}</span>
      </span>
      <ChevronRight className="h-4 w-4 flex-shrink-0 text-gray-300" />
    </button>
  );
}

// ───────────────────────────────────────────────────────────────────────
//  Article card (browse)
// ───────────────────────────────────────────────────────────────────────
function ArticleCard({ article, onOpen }: { article: KnowledgeArticle; onOpen: () => void }) {
  const isRegulation = article.type === 'regulation';
  return (
    <button onClick={onOpen} className="card-interactive flex flex-col overflow-hidden text-left">
      {article.coverImage && (
        <img src={article.coverImage} alt="" className="h-28 w-full object-cover" loading="lazy" />
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
        {article.excerpt && <p className="mt-1 text-xs text-gray-500 line-clamp-2">{article.excerpt}</p>}
        {article.categoryName && (
          <p className="mt-auto pt-2 text-xs font-medium text-gray-400">{article.categoryName}</p>
        )}
      </div>
    </button>
  );
}

// ───────────────────────────────────────────────────────────────────────
//  Search results panel (ranked: articles / categories / courses)
// ───────────────────────────────────────────────────────────────────────
function SearchResultsPanel({
  results,
  loading,
  query,
  onOpenArticle,
  onOpenCategory,
  onOpenCourse,
}: {
  results:
    | { query: string; articles: KnowledgeArticle[]; categories: KnowledgeCategory[]; courses: KnowledgeCourse[] }
    | undefined;
  loading: boolean;
  query: string;
  onOpenArticle: (id: string) => void;
  onOpenCategory: (id: string) => void;
  onOpenCourse: (id: string) => void;
}) {
  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-primary-500" />
      </div>
    );
  }

  const articles = results?.articles ?? [];
  const categories = results?.categories ?? [];
  const courses = results?.courses ?? [];
  const total = articles.length + categories.length + courses.length;

  if (total === 0) {
    return (
      <EmptyState
        icon={Search}
        title="Ничего не найдено"
        description={`По запросу «${query}» ничего не нашлось. Попробуйте изменить формулировку.`}
      />
    );
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-gray-500">
        Результаты по запросу «<span className="font-medium text-gray-700">{query}</span>»
      </p>

      {categories.length > 0 && (
        <section>
          <h2 className="mb-2.5 flex items-center gap-1.5 text-sm font-semibold text-gray-500">
            <Folder className="h-4 w-4" /> Папки ({categories.length})
          </h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {categories.map((c) => (
              <button
                key={c.id}
                onClick={() => onOpenCategory(c.id)}
                className="card-interactive flex items-center gap-3 p-3 text-left"
              >
                <Folder className="h-4 w-4 flex-shrink-0 text-amber-500" />
                <span className="flex-1 truncate text-sm font-medium text-gray-800">{c.name}</span>
                <ChevronRight className="h-4 w-4 flex-shrink-0 text-gray-300" />
              </button>
            ))}
          </div>
        </section>
      )}

      {articles.length > 0 && (
        <section>
          <h2 className="mb-2.5 flex items-center gap-1.5 text-sm font-semibold text-gray-500">
            <FileText className="h-4 w-4" /> Статьи и регламенты ({articles.length})
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {articles.map((a) => (
              <ArticleCard key={a.id} article={a} onOpen={() => onOpenArticle(a.id)} />
            ))}
          </div>
        </section>
      )}

      {courses.length > 0 && (
        <section>
          <h2 className="mb-2.5 flex items-center gap-1.5 text-sm font-semibold text-gray-500">
            <GraduationCap className="h-4 w-4" /> Курсы ({courses.length})
          </h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {courses.map((c) => (
              <button
                key={c.id}
                onClick={() => onOpenCourse(c.id)}
                className="card-interactive flex items-center gap-3 p-3 text-left"
              >
                <GraduationCap className="h-4 w-4 flex-shrink-0 text-primary-500" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-gray-800">{c.title}</span>
                  {typeof c.progressPercent === 'number' && (
                    <span className="block text-xs text-gray-400">Прогресс {c.progressPercent}%</span>
                  )}
                </span>
                <ChevronRight className="h-4 w-4 flex-shrink-0 text-gray-300" />
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
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
      // The response carries the version that was acknowledged — sync it so a
      // later in-place version bump is detected correctly.
      queryClient.setQueryData<KnowledgeArticle>(KEY.article(articleId), (prev) =>
        prev
          ? {
              ...prev,
              acknowledged: !!res.data.acknowledgedAt,
              version: res.data.version ?? prev.version,
            }
          : prev,
      );
      queryClient.invalidateQueries({ queryKey: KEY.acks(articleId) });
      queryClient.invalidateQueries({ queryKey: KEY.pendingCount });
      toast.success('Отмечено: ознакомлен');
    },
    onError: () => toast.error('Не удалось отметить'),
  });

  const feedbackMutation = useMutation({
    mutationFn: (helpful: boolean) => knowledgeApi.articleFeedback(articleId, helpful),
    onSuccess: (res) => {
      queryClient.setQueryData<KnowledgeArticle>(KEY.article(articleId), (prev) =>
        prev
          ? {
              ...prev,
              helpfulCount: res.data.helpfulCount,
              notHelpfulCount: res.data.notHelpfulCount,
              myFeedback: res.data.myFeedback,
            }
          : prev,
      );
    },
    onError: () => toast.error('Не удалось отправить оценку'),
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
  const hasBlocks = !!article.blocks && article.blocks.length > 0;

  return (
    // pb-24 on mobile keeps the regulation «Ознакомлен» button (and feedback
    // buttons) clear of the floating bottom tab bar; md:pb-0 restores desktop.
    <div className="space-y-6 pb-24 md:pb-0">
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
        {article.coverImage && <img src={article.coverImage} alt="" className="max-h-64 w-full object-cover" />}
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
            {article.carMake && <span className="badge-blue">{article.carMake}</span>}
            {isRegulation && article.mandatory && (
              <span className="badge-red gap-1">
                <AlertCircle className="h-3 w-3" /> Обязательно
              </span>
            )}
            {isRegulation && article.dueDate && (
              <span className="badge-warning gap-1">
                <CalendarClock className="h-3 w-3" /> Срок: {formatDateShort(article.dueDate)}
              </span>
            )}
            {typeof article.version === 'number' && article.version > 1 && (
              <span className="badge-gray">Версия {article.version}</span>
            )}
            {!article.published && <span className="badge-gray">Черновик</span>}
          </div>

          <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">{article.title}</h1>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-400">
            <span>Обновлено {formatDateTime(article.updatedAt)}</span>
            {typeof article.viewCount === 'number' && (
              <span className="inline-flex items-center gap-1">
                <Eye className="h-3.5 w-3.5" /> {article.viewCount} {pluralizeViews(article.viewCount)}
              </span>
            )}
          </p>

          {/* Regulation acknowledgment banner — version-aware re-ack */}
          {isRegulation && (
            <div className="mt-5">
              {article.acknowledged ? (
                <div className="flex items-center gap-2 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm font-medium text-green-700">
                  <Check className="h-5 w-5" /> Вы ознакомлены с этой версией регламента
                </div>
              ) : (
                <div className="space-y-3">
                  {typeof article.version === 'number' && article.version > 1 && (
                    <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
                      <RefreshCw className="mt-0.5 h-4 w-4 flex-shrink-0" />
                      <span>Регламент обновлён до версии {article.version} — ознакомьтесь заново.</span>
                    </div>
                  )}
                  <button onClick={() => ackMutation.mutate()} disabled={ackMutation.isPending} className="btn-primary">
                    {ackMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Check className="h-4 w-4" />
                    )}
                    Ознакомлен
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Body — block content (079) takes priority; markdown is the fallback */}
          <div className="mt-6">
            {hasBlocks ? (
              <ArticleBlocksReader blocks={article.blocks!} />
            ) : article.body ? (
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
                    {att.size ? <span className="text-xs text-gray-400">{formatBytes(att.size)}</span> : null}
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Helpfulness feedback */}
          <div className="mt-8 border-t border-gray-100 pt-5">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm font-medium text-gray-600">Статья была полезной?</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => feedbackMutation.mutate(true)}
                  disabled={feedbackMutation.isPending}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
                    article.myFeedback === true
                      ? 'border-green-300 bg-green-50 text-green-700'
                      : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  <ThumbsUp className="h-4 w-4" />
                  {typeof article.helpfulCount === 'number' ? article.helpfulCount : 0}
                </button>
                <button
                  onClick={() => feedbackMutation.mutate(false)}
                  disabled={feedbackMutation.isPending}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
                    article.myFeedback === false
                      ? 'border-red-300 bg-red-50 text-red-700'
                      : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  <ThumbsDown className="h-4 w-4" />
                  {typeof article.notHelpfulCount === 'number' ? article.notHelpfulCount : 0}
                </button>
              </div>
            </div>
          </div>
        </div>
      </article>

      {/* Acks panel */}
      {isManager && acksOpen && <AcksModal articleId={articleId} onClose={() => setAcksOpen(false)} />}

      {/* Editor modal (from reader) */}
      {isManager && editorArticle && (
        <ArticleEditorModal
          article={editorArticle === 'new' ? null : editorArticle}
          categories={categories}
          defaultType={article.type}
          defaultCategoryId={article.categoryId ?? null}
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
                {data.totalAudience > 0 ? Math.round((data.acknowledgedCount / data.totalAudience) * 100) : 0}%
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
              <div
                className="h-full rounded-full bg-green-500 transition-all"
                style={{
                  width: `${data.totalAudience > 0 ? (data.acknowledgedCount / data.totalAudience) * 100 : 0}%`,
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
                  <li key={a.userId} className="flex items-center justify-between rounded-lg bg-green-50 px-3 py-2">
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
                  <li key={p.userId} className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-600">
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
//  Two content modes share one save: rich BLOCKS (079) and markdown BODY.
//  We send both; the reader prefers non-empty blocks and falls back to body.
// ───────────────────────────────────────────────────────────────────────
function ArticleEditorModal({
  article,
  categories,
  defaultType,
  defaultCategoryId,
  onClose,
  onSaved,
}: {
  article: KnowledgeArticle | null;
  categories: KnowledgeCategory[];
  defaultType: KnowledgeArticleType;
  defaultCategoryId: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!article;
  const [title, setTitle] = useState(article?.title ?? '');
  const [body, setBody] = useState(article?.body ?? '');
  const [blocks, setBlocks] = useState<KnowledgeBlock[]>(article?.blocks ?? []);
  const [contentMode, setContentMode] = useState<'blocks' | 'markdown'>(
    article?.blocks && article.blocks.length > 0 ? 'blocks' : 'markdown',
  );
  const [type, setType] = useState<KnowledgeArticleType>(article?.type ?? defaultType);
  const [categoryId, setCategoryId] = useState<string>(article?.categoryId ?? defaultCategoryId ?? '');
  const [coverImage, setCoverImage] = useState<string | null>(article?.coverImage ?? null);
  const [attachments, setAttachments] = useState<KnowledgeAttachment[]>(article?.attachments ?? []);
  const [pinned, setPinned] = useState(article?.pinned ?? false);
  const [published, setPublished] = useState(article?.published ?? true);
  const [mandatory, setMandatory] = useState(article?.mandatory ?? false);
  const [dueDate, setDueDate] = useState(article?.dueDate ? article.dueDate.slice(0, 10) : '');
  const [carMake, setCarMake] = useState(article?.carMake ?? '');
  const [bumpVersion, setBumpVersion] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);

  const coverInputRef = useRef<HTMLInputElement>(null);
  const attachInputRef = useRef<HTMLInputElement>(null);

  // Categories flattened with indentation so subfolders are pickable.
  const categoryOptions = useMemo(() => flattenCategories(categories), [categories]);

  const saveMutation = useMutation({
    mutationFn: () => {
      // Drop empty blocks so a half-filled block never trips server validation;
      // send [] to clear blocks (→ reader falls back to the markdown body).
      const cleanBlocks = sanitizeBlocks(blocks);
      const payload = {
        title: title.trim(),
        body,
        blocks: cleanBlocks,
        type,
        categoryId: categoryId || null,
        coverImage: coverImage || null,
        attachments,
        pinned,
        published,
        carMake: carMake.trim() || null,
        // Regulation-only fields; harmless for plain articles.
        mandatory: type === 'regulation' ? mandatory : false,
        dueDate: type === 'regulation' && dueDate ? dueDate : null,
        ...(isEdit && type === 'regulation' && bumpVersion ? { bumpVersion: true } : {}),
      };
      return isEdit ? knowledgeApi.updateArticle(article!.id, payload) : knowledgeApi.createArticle(payload);
    },
    onSuccess: () => {
      toast.success(isEdit ? 'Статья обновлена' : 'Статья создана');
      onSaved();
    },
    onError: (err) => toast.error(errMessage(err, 'Не удалось сохранить')),
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
    <Modal isOpen onClose={onClose} title={isEdit ? 'Редактирование' : 'Новый материал'} size="xl">
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
            <label className="label">Папка</label>
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="input">
              <option value="">Без папки</option>
              {categoryOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {`${'  '.repeat(c.depth)}${c.name}`}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Content — blocks (rich) OR markdown */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <label className="label mb-0">Содержание</label>
            <div className="flex rounded-lg border border-gray-200 p-0.5">
              <button
                type="button"
                onClick={() => setContentMode('blocks')}
                className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-semibold ${
                  contentMode === 'blocks' ? 'bg-primary-600 text-white' : 'text-gray-500'
                }`}
              >
                <Blocks className="h-3.5 w-3.5" /> Блоки
              </button>
              <button
                type="button"
                onClick={() => setContentMode('markdown')}
                className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-semibold ${
                  contentMode === 'markdown' ? 'bg-primary-600 text-white' : 'text-gray-500'
                }`}
              >
                <FileText className="h-3.5 w-3.5" /> Markdown
              </button>
            </div>
          </div>

          {contentMode === 'blocks' ? (
            <>
              <BlockEditor blocks={blocks} onChange={setBlocks} />
              <p className="mt-2 text-xs text-gray-400">
                Блоки рендерятся в этом порядке. Если блоков нет — показывается Markdown-содержание.
              </p>
            </>
          ) : (
            <div>
              <div className="mb-1.5 flex items-center justify-end">
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
          )}
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
              {uploadingCover ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
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
                  {att.size ? <span className="text-xs text-gray-400">{formatBytes(att.size)}</span> : null}
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
            {uploadingAttachment ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
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

        {/* Car make (contextual KB) */}
        <div>
          <label className="label">Марка авто (необязательно)</label>
          <input
            value={carMake}
            onChange={(e) => setCarMake(e.target.value)}
            placeholder="Например: Lada — оставьте пустым для всех марок"
            className="input"
          />
        </div>

        {/* Regulation-specific options */}
        {type === 'regulation' && (
          <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/40 p-4">
            <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-gray-700">
              <input
                type="checkbox"
                checked={mandatory}
                onChange={(e) => setMandatory(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
              />
              <AlertCircle className="h-4 w-4 text-amber-500" /> Обязательно для ознакомления
            </label>
            <div>
              <label className="label">Срок ознакомления</label>
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="input" />
            </div>
            {isEdit && (
              <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={bumpVersion}
                  onChange={(e) => setBumpVersion(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                />
                <RefreshCw className="h-4 w-4 text-gray-400" /> Поднять версию — потребовать повторное ознакомление
              </label>
            )}
          </div>
        )}

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
            {published ? <Eye className="h-4 w-4 text-gray-400" /> : <EyeOff className="h-4 w-4 text-gray-400" />}
            Опубликовано
          </label>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 border-t border-gray-100 pt-4">
          <button onClick={onClose} className="btn-secondary">
            Отмена
          </button>
          <button onClick={() => saveMutation.mutate()} disabled={!canSave} className="btn-primary">
            {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {isEdit ? 'Сохранить' : 'Создать'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ───────────────────────────────────────────────────────────────────────
//  Folder manager — create subfolders, rename, move (parentId), delete.
//  Surfaces the server's 400 cycle-rejection as a friendly message.
// ───────────────────────────────────────────────────────────────────────
function FolderManagerModal({
  presetParent,
  categories,
  childrenByParent,
  onClose,
}: {
  presetParent: string | null;
  categories: KnowledgeCategory[];
  childrenByParent: Map<string | null, KnowledgeCategory[]>;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [newName, setNewName] = useState('');
  const [newParent, setNewParent] = useState<string>(presetParent ?? '');
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const options = useMemo(() => flattenCategories(categories), [categories]);
  const invalidate = () => queryClient.invalidateQueries({ queryKey: KEY.categories });

  const createMutation = useMutation({
    mutationFn: (vars: { name: string; parentId: string | null }) =>
      knowledgeApi.createCategory({ name: vars.name, parentId: vars.parentId }),
    onSuccess: () => {
      invalidate();
      setNewName('');
    },
    onError: (err) => toast.error(errMessage(err, 'Не удалось создать папку')),
  });

  const renameMutation = useMutation({
    mutationFn: (vars: { id: string; name: string }) => knowledgeApi.updateCategory(vars.id, { name: vars.name }),
    onSuccess: () => {
      invalidate();
      setEditing(null);
    },
    onError: (err) => toast.error(errMessage(err, 'Не удалось переименовать')),
  });

  const moveMutation = useMutation({
    mutationFn: (vars: { id: string; parentId: string | null }) =>
      knowledgeApi.updateCategory(vars.id, { parentId: vars.parentId }),
    onSuccess: () => invalidate(),
    onError: (err) => toast.error(errMessage(err, 'Нельзя переместить папку внутрь самой себя или своей подпапки')),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => knowledgeApi.deleteCategory(id),
    onSuccess: () => {
      invalidate();
      queryClient.invalidateQueries({ queryKey: ['knowledge', 'articles'] });
      setConfirmDeleteId(null);
    },
    onError: (err) => toast.error(errMessage(err, 'Не удалось удалить папку')),
  });

  // Descendant set for a category — invalid move targets (would create a cycle).
  const descendantsOf = (id: string): Set<string> => {
    const out = new Set<string>();
    const stack = [...(childrenByParent.get(id) ?? [])];
    while (stack.length) {
      const c = stack.pop()!;
      if (out.has(c.id)) continue;
      out.add(c.id);
      stack.push(...(childrenByParent.get(c.id) ?? []));
    }
    return out;
  };

  return (
    <>
      <Modal isOpen onClose={onClose} title="Папки базы знаний" size="lg">
        <div className="space-y-4">
          {/* Create */}
          <div className="rounded-xl border border-gray-200 bg-gray-50/60 p-3">
            <label className="label">Новая папка</label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newName.trim())
                    createMutation.mutate({ name: newName.trim(), parentId: newParent || null });
                }}
                placeholder="Название папки"
                className="input flex-1"
              />
              <select value={newParent} onChange={(e) => setNewParent(e.target.value)} className="input sm:w-52">
                <option value="">В корне</option>
                {options.map((c) => (
                  <option key={c.id} value={c.id}>
                    {`${'  '.repeat(c.depth)}${c.name}`}
                  </option>
                ))}
              </select>
              <button
                onClick={() =>
                  newName.trim() && createMutation.mutate({ name: newName.trim(), parentId: newParent || null })
                }
                disabled={!newName.trim() || createMutation.isPending}
                className="btn-primary"
              >
                <Plus className="h-4 w-4" /> <span className="hidden sm:inline">Добавить</span>
              </button>
            </div>
          </div>

          {/* Tree list */}
          <div className="divide-y divide-gray-100 rounded-lg border border-gray-200">
            {options.length === 0 ? (
              <p className="px-3 py-4 text-center text-sm text-gray-400">Папок пока нет</p>
            ) : (
              options.map((cat) => {
                const forbidden = descendantsOf(cat.id);
                return (
                  <div key={cat.id} className="flex items-center gap-2 px-3 py-2.5">
                    <span style={{ width: cat.depth * 16 }} className="flex-shrink-0" />
                    <Folder className="h-4 w-4 flex-shrink-0 text-amber-500" />
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
                            editing.name.trim() && renameMutation.mutate({ id: cat.id, name: editing.name.trim() })
                          }
                          className="text-green-600 hover:text-green-700"
                        >
                          <Check className="h-4 w-4" />
                        </button>
                        <button onClick={() => setEditing(null)} className="text-gray-400 hover:text-gray-600">
                          <X className="h-4 w-4" />
                        </button>
                      </>
                    ) : (
                      <>
                        <span className="flex-1 truncate text-sm text-gray-800">{cat.name}</span>
                        {/* Move under another folder */}
                        <select
                          value={cat.parentId ?? ''}
                          onChange={(e) => moveMutation.mutate({ id: cat.id, parentId: e.target.value || null })}
                          title="Переместить в…"
                          className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs text-gray-600 focus:border-primary-500 focus:outline-none"
                        >
                          <option value="">Корень</option>
                          {options
                            .filter((o) => o.id !== cat.id && !forbidden.has(o.id))
                            .map((o) => (
                              <option key={o.id} value={o.id}>
                                {`${'  '.repeat(o.depth)}${o.name}`}
                              </option>
                            ))}
                        </select>
                        <button
                          onClick={() => setEditing({ id: cat.id, name: cat.name })}
                          className="text-gray-400 hover:text-primary-600"
                          title="Переименовать"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => setConfirmDeleteId(cat.id)}
                          className="text-gray-400 hover:text-red-600"
                          title="Удалить"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </>
                    )}
                  </div>
                );
              })
            )}
          </div>
          <p className="text-xs text-gray-400">
            Удаление папки не удаляет материалы и подпапки — они перемещаются в корень.
          </p>
        </div>
      </Modal>

      <ConfirmDialog
        isOpen={!!confirmDeleteId}
        onClose={() => setConfirmDeleteId(null)}
        onConfirm={() => confirmDeleteId && deleteMutation.mutate(confirmDeleteId)}
        title="Удалить папку?"
        message="Материалы и вложенные папки сохранятся и переместятся в корень базы знаний."
        confirmText="Удалить"
        variant="danger"
      />
    </>
  );
}

// ───────────────────────────────────────────────────────────────────────
//  Helpers
// ───────────────────────────────────────────────────────────────────────

/** Flatten the category tree depth-first, carrying a depth for indentation. */
function flattenCategories(categories: KnowledgeCategory[]): (KnowledgeCategory & { depth: number })[] {
  const childrenByParent = new Map<string | null, KnowledgeCategory[]>();
  for (const c of categories) {
    const p = c.parentId ?? null;
    if (!childrenByParent.has(p)) childrenByParent.set(p, []);
    childrenByParent.get(p)!.push(c);
  }
  for (const list of childrenByParent.values())
    list.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'ru'));

  const out: (KnowledgeCategory & { depth: number })[] = [];
  const seen = new Set<string>();
  const walk = (parent: string | null, depth: number) => {
    for (const c of childrenByParent.get(parent) ?? []) {
      if (seen.has(c.id)) continue; // guard against any malformed cyclic data
      seen.add(c.id);
      out.push({ ...c, depth });
      walk(c.id, depth + 1);
    }
  };
  walk(null, 0);
  // Any orphans whose parent isn't in the set (shouldn't happen) — append at root.
  for (const c of categories) if (!seen.has(c.id)) out.push({ ...c, depth: 0 });
  return out;
}

/** Drop empty/whitespace-only blocks so partial blocks never fail validation. */
function sanitizeBlocks(blocks: KnowledgeBlock[]): KnowledgeBlock[] {
  return blocks.filter((b) => {
    if (b.type === 'text' || b.type === 'heading') return b.text.trim().length > 0;
    if (b.type === 'image') return b.url.trim().length > 0;
    if (b.type === 'video') return b.url.trim().length > 0;
    return false;
  });
}
