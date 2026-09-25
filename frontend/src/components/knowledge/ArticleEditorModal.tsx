import { useId, useMemo, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { AlertCircle, Eye, EyeOff, ImagePlus, Paperclip, RefreshCw, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { knowledgeApi, uploadsApi } from '../../api/services';
import type {
  KnowledgeArticle,
  KnowledgeArticleType,
  KnowledgeAttachment,
  KnowledgeBlock,
  KnowledgeCategory,
} from '../../types';
import Modal from '../Modal';
import MarkdownView from '../MarkdownView';
import { Button } from '../../ui/Button';
import { Checkbox } from '../../ui/Checkbox';
import { Field } from '../../ui/Field';
import { IconButton } from '../../ui/IconButton';
import { Input } from '../../ui/Input';
import { SegmentedControl } from '../../ui/SegmentedControl';
import { Select } from '../../ui/Select';
import { Textarea } from '../../ui/Textarea';
import BlockEditor from './BlockEditor';
import { articleType } from './articleTypography';
import { errMessage, flattenCategories, formatBytes, indentedName, sanitizeBlocks } from './utils';

/**
 * Article editor (create / edit) — manager only.
 * Two content modes share one save: rich BLOCKS (079) and markdown BODY.
 * We send both; the reader prefers non-empty blocks and falls back to body.
 */
export default function ArticleEditorModal({
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
  const uid = useId();
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
  const [titleError, setTitleError] = useState('');

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

  const submit = () => {
    if (!title.trim()) {
      setTitleError('Введите заголовок');
      return;
    }
    saveMutation.mutate();
  };

  const isRegulation = type === 'regulation';

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={isEdit ? 'Редактирование материала' : 'Новый материал'}
      description={isRegulation ? 'Регламент — сотрудники должны отметить ознакомление.' : undefined}
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
      <div className="space-y-5">
        <Field label="Заголовок" htmlFor={`${uid}-title`} required error={titleError || undefined}>
          <Input
            id={`${uid}-title`}
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              if (titleError) setTitleError('');
            }}
            placeholder="Например: Регламент приёмки автомобиля"
            invalid={!!titleError}
            autoFocus
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Тип" htmlFor={`${uid}-type`}>
            <SegmentedControl
              aria-label="Тип материала"
              fullWidth
              value={type}
              onChange={setType}
              options={[
                { value: 'article', label: 'Статья' },
                { value: 'regulation', label: 'Регламент' },
              ]}
            />
          </Field>
          <Field label="Папка" htmlFor={`${uid}-folder`}>
            <Select id={`${uid}-folder`} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">Без папки</option>
              {categoryOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {indentedName(c)}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {/* Content — blocks (rich) OR markdown */}
        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-medium text-ink-2" id={`${uid}-content-label`}>
              Содержание
            </span>
            <SegmentedControl
              size="sm"
              aria-label="Формат содержания"
              value={contentMode}
              onChange={setContentMode}
              options={[
                { value: 'blocks', label: 'Блоки' },
                { value: 'markdown', label: 'Markdown' },
              ]}
            />
          </div>

          {contentMode === 'blocks' ? (
            <>
              <BlockEditor blocks={blocks} onChange={setBlocks} />
              <p className="mt-2 text-xs text-ink-3">
                Блоки показываются в этом порядке. Если блоков нет — читателю показывается Markdown-содержание.
              </p>
            </>
          ) : (
            <div>
              <div className={showPreview ? 'grid gap-3 lg:grid-cols-2' : ''}>
                <Textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder={'# Заголовок\n\nПоддерживается **markdown**: списки, таблицы, ссылки, цитаты…'}
                  rows={14}
                  aria-labelledby={`${uid}-content-label`}
                  className="font-mono text-[13px] leading-relaxed"
                />
                {showPreview && (
                  <div className="max-h-[22rem] overflow-y-auto rounded-lg border border-line bg-surface-2 p-4">
                    {body.trim() ? (
                      <MarkdownView>{body}</MarkdownView>
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
            </div>
          )}
        </div>

        {/* Cover image */}
        <Field label="Обложка" hint="Показывается над заголовком статьи и на карточке в списке.">
          {coverImage ? (
            <div className="relative inline-block">
              <img src={coverImage} alt="" className="h-28 rounded-lg border border-line object-cover" />
              <IconButton
                label="Убрать обложку"
                icon={X}
                size="sm"
                variant="secondary"
                onClick={() => setCoverImage(null)}
                className="absolute -right-2 -top-2 rounded-full"
              />
            </div>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              icon={ImagePlus}
              onClick={() => coverInputRef.current?.click()}
              loading={uploadingCover}
            >
              Загрузить обложку
            </Button>
          )}
          <input
            ref={coverInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            aria-hidden="true"
            tabIndex={-1}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleCoverUpload(f);
              e.target.value = '';
            }}
          />
        </Field>

        {/* Attachments */}
        <Field label="Вложения">
          {attachments.length > 0 && (
            <ul className="mb-2 space-y-2">
              {attachments.map((att, i) => (
                <li
                  key={`${att.url}-${i}`}
                  className="flex items-center gap-3 rounded-lg border border-line px-3 py-2 text-sm"
                >
                  <Paperclip className="h-4 w-4 flex-shrink-0 text-ink-3" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate text-ink">{att.name}</span>
                  {att.size ? <span className="text-xs tabular-nums text-ink-3">{formatBytes(att.size)}</span> : null}
                  <IconButton
                    label={`Убрать вложение ${att.name}`}
                    icon={X}
                    size="sm"
                    onClick={() => setAttachments((prev) => prev.filter((_, idx) => idx !== i))}
                  />
                </li>
              ))}
            </ul>
          )}
          <Button
            variant="secondary"
            size="sm"
            icon={Paperclip}
            onClick={() => attachInputRef.current?.click()}
            loading={uploadingAttachment}
          >
            Добавить файл
          </Button>
          <input
            ref={attachInputRef}
            type="file"
            className="hidden"
            aria-hidden="true"
            tabIndex={-1}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleAttachmentUpload(f);
              e.target.value = '';
            }}
          />
        </Field>

        {/* Car make (contextual KB) */}
        <Field
          label="Марка авто"
          htmlFor={`${uid}-make`}
          hint="Необязательно. Материал будет предлагаться в контексте этой марки; пусто — для всех."
        >
          <Input
            id={`${uid}-make`}
            value={carMake}
            onChange={(e) => setCarMake(e.target.value)}
            placeholder="Например: Lada"
          />
        </Field>

        {/* Regulation-specific options */}
        {isRegulation && (
          <fieldset className="space-y-3 rounded-lg border border-warn/30 bg-warn-soft/60 p-4">
            <legend className="px-1 text-sm font-semibold text-warn-text">Параметры регламента</legend>
            <Checkbox
              label={
                <span className="inline-flex items-center gap-1.5">
                  <AlertCircle className="h-4 w-4 text-warn" aria-hidden="true" /> Обязательно для ознакомления
                </span>
              }
              checked={mandatory}
              onChange={(e) => setMandatory(e.target.checked)}
            />
            <Field label="Срок ознакомления" htmlFor={`${uid}-due`} className="max-w-xs">
              <Input id={`${uid}-due`} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </Field>
            {isEdit && (
              <Checkbox
                label={
                  <span className="inline-flex items-center gap-1.5">
                    <RefreshCw className="h-4 w-4 text-ink-3" aria-hidden="true" /> Поднять версию
                  </span>
                }
                description="Все сотрудники должны будут ознакомиться заново."
                checked={bumpVersion}
                onChange={(e) => setBumpVersion(e.target.checked)}
              />
            )}
          </fieldset>
        )}

        {/* Toggles */}
        <div className="flex flex-wrap gap-x-6 gap-y-3 border-t border-line pt-4">
          <Checkbox
            label="Закрепить"
            description="Показывать первым в папке."
            checked={pinned}
            onChange={(e) => setPinned(e.target.checked)}
          />
          <Checkbox
            label="Опубликовано"
            description={published ? 'Виден всем сотрудникам.' : 'Черновик — виден только редакторам.'}
            checked={published}
            onChange={(e) => setPublished(e.target.checked)}
          />
        </div>
      </div>
    </Modal>
  );
}
