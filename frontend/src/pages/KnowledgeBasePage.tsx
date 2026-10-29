import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams, type To } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BookOpen,
  ChevronRight,
  FileText,
  Folder,
  FolderPlus,
  GraduationCap,
  Home,
  Pin,
  Plus,
  Search,
  ShieldCheck,
  Wrench,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { knowledgeApi } from '../api/services';
import type { KnowledgeArticle, KnowledgeArticleType, KnowledgeCategory, KnowledgeCourse } from '../types';
import { formatDateShort } from '../../../shared/utils/formatters';
import PageHeader from '../components/PageHeader';
import EmptyState from '../components/EmptyState';
import QueryState from '../components/QueryState';
import SearchInput from '../components/SearchInput';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { SkeletonCard } from '../ui/Skeleton';
import { Tabs, TabPanel, type TabItem } from '../ui/Tabs';
import { Toolbar } from '../ui/Toolbar';
import { cn } from '../ui/cn';
import { focusRing } from '../ui/tokens';
import ArticleReader from '../components/knowledge/ArticleReader';
import ArticleEditorModal from '../components/knowledge/ArticleEditorModal';
import FolderManagerModal from '../components/knowledge/FolderManagerModal';
import { KEY } from '../components/knowledge/keys';
import { ArticleTypeBadge, CoverPlaceholder, InlineError, SectionHeading, TileLink } from '../components/knowledge/ui';
import { pluralRu } from '../components/knowledge/utils';
import LearningCenter, { CourseEditorModal } from './knowledge/LearningCenter';
import TroubleshootingReference from './knowledge/TroubleshootingReference';

// ───────────────────────────────────────────────────────────────────────
//  База знаний. Состояние — в URL (F5, «Назад», пересылка ссылки):
//    ?tab=knowledge|regulations|learning|troubleshooting
//    &folder=<id>      — открытая папка (статьи/регламенты)
//    &article=<id>     — читалка статьи (поверх любой вкладки)
//    &course=<id>&lesson=<id> — учебный центр
//    &issue=<id>       — карточка неисправности
//    &q=<текст>        — глобальный поиск (≥ 2 символов)
// ───────────────────────────────────────────────────────────────────────

type Section = 'knowledge' | 'regulations' | 'learning' | 'troubleshooting';
const SECTIONS: Section[] = ['knowledge', 'regulations', 'learning', 'troubleshooting'];

const SECTION_TYPE: Record<'knowledge' | 'regulations', KnowledgeArticleType> = {
  knowledge: 'article',
  regulations: 'regulation',
};

const TAB_ITEMS: TabItem<Section>[] = [
  { key: 'knowledge', label: 'База знаний', icon: BookOpen },
  { key: 'regulations', label: 'Регламенты', icon: ShieldCheck },
  { key: 'learning', label: 'Учебный центр', icon: GraduationCap },
  { key: 'troubleshooting', label: 'Диагностика', icon: Wrench },
];

type ParamPatch = Record<string, string | null | undefined>;

function applyPatch(base: URLSearchParams, patch: ParamPatch): URLSearchParams {
  const next = new URLSearchParams(base);
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined || v === '') next.delete(k);
    else next.set(k, v);
  }
  return next;
}

export default function KnowledgeBasePage() {
  const { hasPermission } = useAuth();
  const queryClient = useQueryClient();
  // Мутации базы знаний — ключ knowledge_manage (backend knowledge/*; волна
  // Битрикс24). Чтение открыто всем сотрудникам.
  const isManager = hasPermission('knowledge_manage');

  const [params, setParams] = useSearchParams();
  const rawTab = params.get('tab');
  const section: Section = SECTIONS.includes(rawTab as Section) ? (rawTab as Section) : 'knowledge';
  const folderId = params.get('folder');
  const articleId = params.get('article');
  const courseId = params.get('course');
  const lessonId = params.get('lesson');
  const issueId = params.get('issue');
  const search = (params.get('q') ?? '').trim();

  const patch = useCallback(
    (changes: ParamPatch, opts?: { replace?: boolean }) => {
      setParams((prev) => applyPatch(prev, changes), { replace: opts?.replace });
    },
    [setParams],
  );
  const hrefFor = useCallback(
    (changes: ParamPatch): To => {
      const s = applyPatch(params, changes).toString();
      return { search: s ? `?${s}` : '' };
    },
    [params],
  );

  const isArticleSection = section === 'knowledge' || section === 'regulations';
  const sectionType: KnowledgeArticleType | null = isArticleSection ? SECTION_TYPE[section] : null;
  const searchActive = search.length >= 2;

  // ── Data ────────────────────────────────────────────────────────────
  const {
    data: categories = [],
    isError: categoriesError,
    refetch: refetchCategories,
    isFetching: categoriesFetching,
  } = useQuery({
    queryKey: KEY.categories,
    queryFn: async () => (await knowledgeApi.listCategories()).data,
    staleTime: 5 * 60 * 1000,
  });

  // Fetch the whole article set for the active section type once; the folder
  // view filters it client-side by `categoryId`. Slim payloads → cheap.
  const {
    data: articles = [],
    isLoading: articlesLoading,
    isError: articlesError,
    refetch: refetchArticles,
    isFetching: articlesFetching,
  } = useQuery({
    queryKey: sectionType ? KEY.articlesByType(sectionType) : ['knowledge', 'articles', 'none'],
    queryFn: async () => (await knowledgeApi.listArticles({ type: sectionType! })).data,
    enabled: sectionType !== null,
  });

  const {
    data: searchResults,
    isFetching: searchFetching,
    isError: searchError,
    refetch: refetchSearch,
  } = useQuery({
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
    if (folderId && categories.length > 0 && !categoryById.has(folderId)) patch({ folder: null }, { replace: true });
  }, [folderId, categories.length, categoryById, patch]);

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
  const [courseEditorOpen, setCourseEditorOpen] = useState(false);
  const [issueEditorOpen, setIssueEditorOpen] = useState(false);

  const invalidateLists = () => {
    if (sectionType) queryClient.invalidateQueries({ queryKey: KEY.articlesByType(sectionType) });
    queryClient.invalidateQueries({ queryKey: ['knowledge', 'articles'] });
    queryClient.invalidateQueries({ queryKey: ['knowledge', 'search'] });
  };

  const goToSection = (next: Section) =>
    patch({ tab: next === 'knowledge' ? null : next, folder: null, course: null, lesson: null, issue: null });

  // ── Reader (full-page) ──────────────────────────────────────────────
  if (articleId) {
    return (
      <ArticleReader
        articleId={articleId}
        isManager={isManager}
        onBack={() => patch({ article: null })}
        onEdit={(article) => setEditorArticle(article)}
        editorArticle={editorArticle}
        categories={categories}
        onCloseEditor={() => setEditorArticle(null)}
        onAfterMutation={invalidateLists}
        onDeleted={() => patch({ article: null })}
      />
    );
  }

  // ── Заголовок: «Назад» для вложенных экранов, действия — по вкладке ──
  const inLesson = section === 'learning' && !!courseId && !!lessonId;
  const inCourse = section === 'learning' && !!courseId && !lessonId;
  const inIssue = section === 'troubleshooting' && !!issueId;
  const backTo = inLesson
    ? () => patch({ lesson: null })
    : inCourse
      ? () => patch({ course: null })
      : inIssue
        ? () => patch({ issue: null })
        : undefined;
  const subtitle = inLesson
    ? 'Учебный центр · урок'
    : inCourse
      ? 'Учебный центр · курс'
      : inIssue
        ? 'Диагностика · неисправность'
        : 'Регламенты, учебный центр и справочные материалы';

  let actions: React.ReactNode;
  if (isManager && !searchActive) {
    if (isArticleSection) {
      actions = (
        <>
          <Button variant="secondary" icon={FolderPlus} onClick={() => setFolderManager({ presetParent: folderId })}>
            Папки
          </Button>
          <Button icon={Plus} onClick={() => setEditorArticle('new')}>
            {section === 'regulations' ? 'Новый регламент' : 'Новая статья'}
          </Button>
        </>
      );
    } else if (section === 'learning' && !courseId) {
      actions = (
        <Button icon={Plus} onClick={() => setCourseEditorOpen(true)}>
          Новый курс
        </Button>
      );
    } else if (section === 'troubleshooting' && !issueId) {
      actions = (
        <Button icon={Plus} onClick={() => setIssueEditorOpen(true)}>
          Новая запись
        </Button>
      );
    }
  }

  const rootLabel = section === 'regulations' ? 'Регламенты' : 'Все папки';
  const isRoot = !folderId;

  return (
    <div className="space-y-5">
      <PageHeader title="База знаний" icon={GraduationCap} subtitle={subtitle} backTo={backTo} actions={actions} />

      {/* Глобальный поиск — по статьям, регламентам, папкам и курсам сразу */}
      {!backTo && (
        <Toolbar>
          <SearchInput
            value={search}
            onChange={(v) => patch({ q: v.trim() || null }, { replace: true })}
            placeholder="Поиск по статьям, регламентам, папкам и курсам…"
            aria-label="Поиск по базе знаний"
            className="w-full lg:w-[28rem]"
          />
        </Toolbar>
      )}

      {searchActive ? (
        <SearchResultsPanel
          results={searchResults}
          loading={searchFetching && !searchResults}
          isError={searchError && !searchResults}
          onRetry={() => refetchSearch()}
          isFetching={searchFetching}
          query={search}
          articleHref={(id) => hrefFor({ article: id })}
          categoryHref={(id) => hrefFor({ q: null, tab: null, folder: id })}
          courseHref={(id) => hrefFor({ q: null, tab: 'learning', course: id })}
        />
      ) : (
        <>
          {!backTo && (
            <Tabs<Section>
              items={TAB_ITEMS}
              value={section}
              onChange={goToSection}
              aria-label="Разделы базы знаний"
              idPrefix="kb"
            />
          )}

          <TabPanel idPrefix="kb" tabKey="learning" active={section === 'learning'}>
            <LearningCenter
              isManager={isManager}
              categories={categories}
              onCreateCourse={() => setCourseEditorOpen(true)}
              nav={{
                courseId,
                lessonId,
                courseHref: (id) => hrefFor({ course: id, lesson: null }),
                lessonHref: (cId, lId) => hrefFor({ course: cId, lesson: lId }),
                onBackToCourses: () => patch({ course: null, lesson: null }),
              }}
            />
          </TabPanel>

          <TabPanel idPrefix="kb" tabKey="troubleshooting" active={section === 'troubleshooting'}>
            <TroubleshootingReference
              isManager={isManager}
              createOpen={issueEditorOpen}
              onCloseCreate={() => setIssueEditorOpen(false)}
              nav={{
                issueId,
                issueHref: (id) => hrefFor({ issue: id }),
                onBackToList: () => patch({ issue: null }),
              }}
            />
          </TabPanel>

          {isArticleSection && (
            <TabPanel idPrefix="kb" tabKey={section} active>
              <div className="space-y-6">
                {/* Крошки папок */}
                <nav aria-label="Папки" className="flex flex-wrap items-center gap-1 text-sm">
                  <Link
                    to={hrefFor({ folder: null })}
                    aria-current={isRoot ? 'page' : undefined}
                    className={cn(
                      'inline-flex h-8 items-center gap-1.5 rounded-md px-2 transition-colors',
                      focusRing,
                      isRoot ? 'font-semibold text-ink' : 'text-ink-3 hover:bg-surface-3 hover:text-ink',
                    )}
                  >
                    <Home className="h-3.5 w-3.5" aria-hidden="true" />
                    {rootLabel}
                  </Link>
                  {breadcrumb.map((c) => {
                    const current = c.id === folderId;
                    return (
                      <span key={c.id} className="flex items-center gap-1">
                        <ChevronRight className="h-3.5 w-3.5 text-ink-4" aria-hidden="true" />
                        <Link
                          to={hrefFor({ folder: c.id })}
                          aria-current={current ? 'page' : undefined}
                          className={cn(
                            'inline-flex h-8 items-center rounded-md px-2 transition-colors',
                            focusRing,
                            current ? 'font-semibold text-ink' : 'text-ink-3 hover:bg-surface-3 hover:text-ink',
                          )}
                        >
                          {c.name}
                        </Link>
                      </span>
                    );
                  })}
                </nav>

                {categoriesError && (
                  <InlineError
                    message="Не удалось загрузить папки"
                    onRetry={() => refetchCategories()}
                    loading={categoriesFetching}
                  />
                )}

                {articlesLoading ? (
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <SkeletonCard key={i} lines={1} />
                    ))}
                  </div>
                ) : articlesError ? (
                  <QueryState
                    isLoading={false}
                    isError
                    onRetry={refetchArticles}
                    isFetching={articlesFetching}
                    errorTitle="Не удалось загрузить материалы"
                  >
                    {null}
                  </QueryState>
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
                      <section aria-labelledby="kb-folders">
                        <SectionHeading
                          icon={Folder}
                          title="Папки"
                          count={subfolders.length || undefined}
                          actions={
                            isManager ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                icon={FolderPlus}
                                onClick={() => setFolderManager({ presetParent: folderId })}
                              >
                                Новая папка
                              </Button>
                            ) : undefined
                          }
                        />
                        {subfolders.length > 0 ? (
                          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                            {subfolders.map((cat) => (
                              <li key={cat.id}>
                                <FolderTile
                                  category={cat}
                                  articleCount={countDirectArticles(cat.id)}
                                  subfolderCount={(childrenByParent.get(cat.id) ?? []).length}
                                  to={hrefFor({ folder: cat.id })}
                                />
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="text-sm text-ink-3">Подпапок нет</p>
                        )}
                      </section>
                    )}

                    {/* Pinned articles */}
                    {pinned.length > 0 && (
                      <section aria-labelledby="kb-pinned">
                        <SectionHeading icon={Pin} title="Закреплённые" count={pinned.length} />
                        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                          {pinned.map((a) => (
                            <li key={a.id}>
                              <ArticleCard article={a} to={hrefFor({ article: a.id })} />
                            </li>
                          ))}
                        </ul>
                      </section>
                    )}

                    {/* Articles in this folder */}
                    {rest.length > 0 && (
                      <section aria-labelledby="kb-articles">
                        <SectionHeading
                          icon={FileText}
                          title={section === 'regulations' ? 'Регламенты' : 'Материалы'}
                          count={rest.length}
                        />
                        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                          {rest.map((a) => (
                            <li key={a.id}>
                              <ArticleCard article={a} to={hrefFor({ article: a.id })} />
                            </li>
                          ))}
                        </ul>
                      </section>
                    )}
                  </>
                )}
              </div>
            </TabPanel>
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

          {/* Новый курс — кнопка в шапке, модалка здесь */}
          {isManager && courseEditorOpen && (
            <CourseEditorModal
              course={null}
              categories={categories}
              onClose={() => setCourseEditorOpen(false)}
              onSaved={() => setCourseEditorOpen(false)}
            />
          )}
        </>
      )}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────
//  Folder tile
// ───────────────────────────────────────────────────────────────────────
function FolderTile({
  category,
  articleCount,
  subfolderCount,
  to,
}: {
  category: KnowledgeCategory;
  articleCount: number;
  subfolderCount: number;
  to: To;
}) {
  const parts: string[] = [];
  if (subfolderCount > 0)
    parts.push(`${subfolderCount} ${pluralRu(subfolderCount, 'подпапка', 'подпапки', 'подпапок')}`);
  if (articleCount > 0) parts.push(`${articleCount} ${pluralRu(articleCount, 'материал', 'материала', 'материалов')}`);
  return (
    <TileLink to={to} className="flex items-center gap-3 p-3.5">
      <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-surface-3 text-ink-2">
        <Folder className="h-5 w-5" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-ink group-hover:text-accent-text">
          {category.name}
        </span>
        <span className="block text-xs tabular-nums text-ink-3">{parts.length > 0 ? parts.join(' · ') : 'Пусто'}</span>
      </span>
      <ChevronRight
        className="h-4 w-4 flex-shrink-0 text-ink-4 transition-transform duration-150 group-hover:translate-x-0.5"
        aria-hidden="true"
      />
    </TileLink>
  );
}

// ───────────────────────────────────────────────────────────────────────
//  Article card (browse / search)
// ───────────────────────────────────────────────────────────────────────
function ArticleCard({ article, to }: { article: KnowledgeArticle; to: To }) {
  const isRegulation = article.type === 'regulation';
  return (
    <TileLink to={to} className="flex h-full flex-col overflow-hidden">
      {article.coverImage && (
        <img src={article.coverImage} alt="" className="h-28 w-full object-cover" loading="lazy" />
      )}
      <div className="flex flex-1 flex-col p-4">
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <ArticleTypeBadge regulation={isRegulation} size="sm" />
          {isRegulation && article.mandatory && (
            <Badge tone="bad" size="sm">
              Обязательно
            </Badge>
          )}
          {!article.published && <Badge size="sm">Черновик</Badge>}
        </div>
        <h3 className="line-clamp-2 text-sm font-semibold leading-5 text-ink group-hover:text-accent-text">
          {article.title}
        </h3>
        {article.excerpt && <p className="mt-1 line-clamp-2 text-xs leading-4 text-ink-3">{article.excerpt}</p>}
        <p className="mt-auto flex items-center gap-2 pt-3 text-xs text-ink-3">
          {article.categoryName && <span className="truncate font-medium">{article.categoryName}</span>}
          {article.categoryName && <span aria-hidden="true">·</span>}
          <span className="whitespace-nowrap tabular-nums">{formatDateShort(article.updatedAt)}</span>
        </p>
      </div>
    </TileLink>
  );
}

// ───────────────────────────────────────────────────────────────────────
//  Search results panel (ranked: articles / categories / courses)
// ───────────────────────────────────────────────────────────────────────
function SearchResultsPanel({
  results,
  loading,
  isError,
  onRetry,
  isFetching,
  query,
  articleHref,
  categoryHref,
  courseHref,
}: {
  results:
    | { query: string; articles: KnowledgeArticle[]; categories: KnowledgeCategory[]; courses: KnowledgeCourse[] }
    | undefined;
  loading: boolean;
  isError: boolean;
  onRetry: () => void;
  isFetching: boolean;
  query: string;
  articleHref: (id: string) => To;
  categoryHref: (id: string) => To;
  courseHref: (id: string) => To;
}) {
  if (loading) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true">
        {Array.from({ length: 3 }).map((_, i) => (
          <SkeletonCard key={i} lines={2} />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <QueryState isLoading={false} isError onRetry={onRetry} isFetching={isFetching} errorTitle="Поиск не удался">
        {null}
      </QueryState>
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
    <div className="space-y-6" aria-live="polite">
      <p className="text-sm text-ink-3">
        Найдено <span className="font-medium tabular-nums text-ink">{total}</span> по запросу «
        <span className="font-medium text-ink">{query}</span>»
      </p>

      {categories.length > 0 && (
        <section aria-label="Папки">
          <SectionHeading icon={Folder} title="Папки" count={categories.length} />
          <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {categories.map((c) => (
              <li key={c.id}>
                <TileLink to={categoryHref(c.id)} className="flex items-center gap-3 p-3">
                  <Folder className="h-4 w-4 flex-shrink-0 text-ink-3" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink group-hover:text-accent-text">
                    {c.name}
                  </span>
                  <ChevronRight className="h-4 w-4 flex-shrink-0 text-ink-4" aria-hidden="true" />
                </TileLink>
              </li>
            ))}
          </ul>
        </section>
      )}

      {articles.length > 0 && (
        <section aria-label="Статьи и регламенты">
          <SectionHeading icon={FileText} title="Статьи и регламенты" count={articles.length} />
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {articles.map((a) => (
              <li key={a.id}>
                <ArticleCard article={a} to={articleHref(a.id)} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {courses.length > 0 && (
        <section aria-label="Курсы">
          <SectionHeading icon={GraduationCap} title="Курсы" count={courses.length} />
          <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {courses.map((c) => (
              <li key={c.id}>
                <TileLink to={courseHref(c.id)} className="flex items-center gap-3 p-3">
                  {c.coverImage ? (
                    <img src={c.coverImage} alt="" className="h-9 w-9 flex-shrink-0 rounded-md object-cover" />
                  ) : (
                    <CoverPlaceholder icon={GraduationCap} className="h-9 w-9 flex-shrink-0 rounded-md" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink group-hover:text-accent-text">
                      {c.title}
                    </span>
                    {typeof c.progressPercent === 'number' && (
                      <span className="block text-xs tabular-nums text-ink-3">
                        Прогресс {Math.round(c.progressPercent)}%
                      </span>
                    )}
                  </span>
                  <ChevronRight className="h-4 w-4 flex-shrink-0 text-ink-4" aria-hidden="true" />
                </TileLink>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
