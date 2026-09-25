import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  CalendarClock,
  Check,
  Eye,
  GraduationCap,
  Paperclip,
  Pencil,
  RefreshCw,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  Users as UsersIcon,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { knowledgeApi } from '../../api/services';
import type { KnowledgeArticle, KnowledgeCategory } from '../../types';
import { formatDateShort, formatDateTime } from '../../../../shared/utils/formatters';
import PageHeader from '../PageHeader';
import ConfirmDialog from '../ConfirmDialog';
import QueryState from '../QueryState';
import MarkdownView from '../MarkdownView';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { IconButton } from '../../ui/IconButton';
import { Skeleton, SkeletonText } from '../../ui/Skeleton';
import { cn } from '../../ui/cn';
import { focusRing } from '../../ui/tokens';
import ArticleBlocksReader from './ArticleBlocks';
import ArticleEditorModal from './ArticleEditorModal';
import AcksModal from './AcksModal';
import { KEY } from './keys';
import { ArticleTypeBadge } from './ui';
import { articleTitleClass, articleType } from './articleTypography';
import { formatBytes, pluralizeViews } from './utils';

/**
 * Читалка статьи / регламента — одноколоночный документ (max-w-3xl, колонка
 * текста ≤ 70 символов). H1 страницы остаётся «База знаний» (PageHeader с
 * «Назад»), заголовок материала — h2 крупным кеглем; заголовки внутри текста
 * идут по шкале системы (articleTypography.ts).
 */
export default function ArticleReader({
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

  const {
    data: article,
    isLoading,
    isError,
    refetch,
    isFetching,
  } = useQuery({
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

  const isRegulation = article?.type === 'regulation';
  const subtitle = article
    ? `${isRegulation ? 'Регламент' : 'Статья'}${article.categoryName ? ` · ${article.categoryName}` : ''}`
    : undefined;

  const header = (
    <PageHeader
      title="База знаний"
      icon={GraduationCap}
      subtitle={subtitle}
      backTo={onBack}
      actions={
        isManager && article ? (
          <>
            {isRegulation && (
              <Button variant="secondary" icon={UsersIcon} onClick={() => setAcksOpen(true)}>
                Кто ознакомился
              </Button>
            )}
            <Button variant="secondary" icon={Pencil} onClick={() => onEdit(article)}>
              Изменить
            </Button>
            <IconButton label="Удалить статью" icon={Trash2} variant="danger" onClick={() => setConfirmDelete(true)} />
          </>
        ) : undefined
      }
    />
  );

  if (isError && !article) {
    return (
      <div className="space-y-5">
        {header}
        <Card className="mx-auto w-full max-w-3xl" padding="md">
          <QueryState
            isLoading={false}
            isError
            onRetry={refetch}
            isFetching={isFetching}
            errorTitle="Не удалось загрузить статью"
          >
            {null}
          </QueryState>
        </Card>
      </div>
    );
  }

  if (isLoading || !article) {
    return (
      <div className="space-y-5">
        {header}
        <Card className="mx-auto w-full max-w-3xl px-5 py-6 sm:px-10 sm:py-8" aria-busy="true">
          <div className="flex gap-2">
            <Skeleton className="h-[22px] w-20" />
            <Skeleton className="h-[22px] w-32" />
          </div>
          <Skeleton className="mt-5 h-8 w-3/4" />
          <Skeleton variant="text" className="mt-3 w-40" />
          <SkeletonText lines={6} className="mt-8 max-w-[70ch]" />
        </Card>
      </div>
    );
  }

  const hasBlocks = !!article.blocks && article.blocks.length > 0;

  return (
    // pb-24 on mobile keeps the regulation «Ознакомлен» button (and feedback
    // buttons) clear of the floating bottom tab bar; md:pb-0 restores desktop.
    <div className="space-y-5 pb-24 md:pb-0">
      {header}

      <Card as="article" padding="none" className="mx-auto w-full max-w-3xl overflow-hidden">
        {article.coverImage && <img src={article.coverImage} alt="" className="max-h-72 w-full object-cover" />}
        <div className="px-5 py-6 sm:px-10 sm:py-8">
          {/* Meta */}
          <div className="mb-4 flex flex-wrap items-center gap-1.5">
            <ArticleTypeBadge regulation={isRegulation} />
            {article.categoryName && <Badge outline>{article.categoryName}</Badge>}
            {article.carMake && <Badge tone="info">{article.carMake}</Badge>}
            {isRegulation && article.mandatory && (
              <Badge tone="bad" icon={AlertCircle}>
                Обязательно
              </Badge>
            )}
            {isRegulation && article.dueDate && (
              <Badge tone="warn" icon={CalendarClock}>
                Срок: {formatDateShort(article.dueDate)}
              </Badge>
            )}
            {typeof article.version === 'number' && article.version > 1 && <Badge>Версия {article.version}</Badge>}
            {!article.published && <Badge>Черновик</Badge>}
          </div>

          <h2 className={articleTitleClass}>{article.title}</h2>
          <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-3">
            <span>Обновлено {formatDateTime(article.updatedAt)}</span>
            {typeof article.viewCount === 'number' && (
              <span className="inline-flex items-center gap-1 tabular-nums">
                <Eye className="h-3.5 w-3.5" aria-hidden="true" /> {article.viewCount}{' '}
                {pluralizeViews(article.viewCount)}
              </span>
            )}
          </p>

          {/* Regulation acknowledgment — version-aware re-ack */}
          {isRegulation && (
            <div className="mt-6 max-w-[70ch]">
              {article.acknowledged ? (
                <div
                  className="flex items-center gap-2.5 rounded-lg border border-ok/20 bg-ok-soft px-4 py-3 text-sm font-medium text-ok-text"
                  role="status"
                >
                  <Check className="h-4 w-4 flex-shrink-0" aria-hidden="true" /> Вы ознакомлены с этой версией
                  регламента
                </div>
              ) : (
                <div className="space-y-3">
                  {typeof article.version === 'number' && article.version > 1 && (
                    <div
                      className="flex items-start gap-2.5 rounded-lg border border-warn/20 bg-warn-soft px-4 py-3 text-sm text-warn-text"
                      role="status"
                    >
                      <RefreshCw className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
                      <span>Регламент обновлён до версии {article.version} — ознакомьтесь заново.</span>
                    </div>
                  )}
                  <Button icon={Check} onClick={() => ackMutation.mutate()} loading={ackMutation.isPending}>
                    Ознакомлен
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* Body — block content (079) takes priority; markdown is the fallback */}
          <div className="mt-8">
            {hasBlocks ? (
              <ArticleBlocksReader blocks={article.blocks!} />
            ) : article.body ? (
              <MarkdownView>{article.body}</MarkdownView>
            ) : (
              <p className={articleType.empty}>Содержимое не заполнено.</p>
            )}
          </div>

          {/* Attachments */}
          {article.attachments && article.attachments.length > 0 && (
            <section className="mt-10 max-w-[70ch] border-t border-line pt-6" aria-labelledby="kb-attachments">
              <h3 id="kb-attachments" className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-ink">
                <Paperclip className="h-4 w-4 text-ink-3" aria-hidden="true" /> Вложения
                <span className="font-normal tabular-nums text-ink-3">{article.attachments.length}</span>
              </h3>
              <ul className="space-y-2">
                {article.attachments.map((att, i) => (
                  <li key={`${att.url}-${i}`}>
                    <a
                      href={att.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={cn(
                        'flex items-center gap-3 rounded-lg border border-line px-3 py-2.5 text-sm transition-colors hover:border-line-strong hover:bg-surface-2',
                        focusRing,
                      )}
                    >
                      <Paperclip className="h-4 w-4 flex-shrink-0 text-ink-3" aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate font-medium text-ink">{att.name}</span>
                      {att.size ? (
                        <span className="text-xs tabular-nums text-ink-3">{formatBytes(att.size)}</span>
                      ) : null}
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Helpfulness feedback */}
          <div className="mt-10 max-w-[70ch] border-t border-line pt-5">
            <div className="flex flex-wrap items-center gap-3">
              <span id="kb-feedback-label" className="text-sm font-medium text-ink-2">
                Статья была полезной?
              </span>
              <div className="flex items-center gap-2" role="group" aria-labelledby="kb-feedback-label">
                <Button
                  variant={article.myFeedback === true ? 'soft' : 'secondary'}
                  size="sm"
                  icon={ThumbsUp}
                  aria-pressed={article.myFeedback === true}
                  aria-label="Полезно"
                  onClick={() => feedbackMutation.mutate(true)}
                  disabled={feedbackMutation.isPending}
                  className="tabular-nums"
                >
                  {article.helpfulCount ?? 0}
                </Button>
                <Button
                  variant={article.myFeedback === false ? 'soft' : 'secondary'}
                  size="sm"
                  icon={ThumbsDown}
                  aria-pressed={article.myFeedback === false}
                  aria-label="Не полезно"
                  onClick={() => feedbackMutation.mutate(false)}
                  disabled={feedbackMutation.isPending}
                  className="tabular-nums"
                >
                  {article.notHelpfulCount ?? 0}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </Card>

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
        loading={deleteMutation.isPending}
      />
    </div>
  );
}
