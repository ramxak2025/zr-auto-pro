import { useId, useRef, useState } from 'react';
import { Link, type To } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import {
  Check,
  CheckCircle2,
  ChevronRight,
  Circle,
  Eye,
  EyeOff,
  GraduationCap,
  ImagePlus,
  ListChecks,
  Pencil,
  PlayCircle,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { knowledgeApi, uploadsApi } from '../../api/services';
import type { KnowledgeCategory, KnowledgeCourse, KnowledgeLesson, KnowledgeQuizQuestion } from '../../types';
import Modal from '../../components/Modal';
import ConfirmDialog from '../../components/ConfirmDialog';
import EmptyState from '../../components/EmptyState';
import QueryState from '../../components/QueryState';
import MarkdownView from '../../components/MarkdownView';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { Card, CardHeader } from '../../ui/Card';
import { Checkbox } from '../../ui/Checkbox';
import { Field } from '../../ui/Field';
import { IconButton } from '../../ui/IconButton';
import { Input } from '../../ui/Input';
import { RadioGroup } from '../../ui/RadioGroup';
import { Select } from '../../ui/Select';
import { Skeleton, SkeletonCard, SkeletonText } from '../../ui/Skeleton';
import { Textarea } from '../../ui/Textarea';
import { cn } from '../../ui/cn';
import { focusRing } from '../../ui/tokens';
import { CKEY } from '../../components/knowledge/keys';
import { CoverPlaceholder, InlineError, ProgressBar, TileLink } from '../../components/knowledge/ui';
import { articleTitleClass, articleType } from '../../components/knowledge/articleTypography';
import { pluralRu } from '../../components/knowledge/utils';

// ───────────────────────────────────────────────────────────────────────
//  Учебный центр: сетка курсов → курс (уроки + прогресс) → урок (markdown +
//  тест). Какой экран показать, решает СТРАНИЦА по query-параметрам
//  (?tab=learning&course=…&lesson=…): F5, «Назад» и пересылка ссылки
//  работают. Компонент чистый по навигации — получает id и ссылки.
// ───────────────────────────────────────────────────────────────────────

export interface LearningNav {
  courseId: string | null;
  lessonId: string | null;
  courseHref: (courseId: string) => To;
  lessonHref: (courseId: string, lessonId: string) => To;
  onBackToCourses: () => void;
}

const pctFmt = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });

function lessonsLabel(completed: number, total: number): string {
  return `${completed} из ${total} ${pluralRu(total, 'урока', 'уроков', 'уроков')}`;
}

export default function LearningCenter({
  isManager,
  categories,
  nav,
  onCreateCourse,
}: {
  isManager: boolean;
  categories: KnowledgeCategory[];
  nav: LearningNav;
  /** Открыть модалку нового курса (кнопка живёт в PageHeader страницы). */
  onCreateCourse: () => void;
}) {
  if (nav.courseId && nav.lessonId) {
    return <LessonView courseId={nav.courseId} lessonId={nav.lessonId} />;
  }
  if (nav.courseId) {
    return (
      <CourseDetail
        courseId={nav.courseId}
        isManager={isManager}
        categories={categories}
        lessonHref={(lessonId) => nav.lessonHref(nav.courseId!, lessonId)}
        onDeleted={nav.onBackToCourses}
      />
    );
  }
  return <CourseGrid isManager={isManager} courseHref={nav.courseHref} onCreateCourse={onCreateCourse} />;
}

// ───────────────────────────────────────────────────────────────────────
//  Course grid
// ───────────────────────────────────────────────────────────────────────
function CourseGrid({
  isManager,
  courseHref,
  onCreateCourse,
}: {
  isManager: boolean;
  courseHref: (courseId: string) => To;
  onCreateCourse: () => void;
}) {
  const {
    data: courses = [],
    isLoading,
    isError,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: CKEY.courses,
    queryFn: async () => (await knowledgeApi.listCourses()).data,
  });

  if (isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
        {Array.from({ length: 3 }).map((_, i) => (
          <SkeletonCard key={i} lines={3} />
        ))}
      </div>
    );
  }

  return (
    <QueryState
      isLoading={false}
      isError={isError}
      onRetry={refetch}
      isFetching={isFetching}
      errorTitle="Не удалось загрузить курсы"
      isEmpty={courses.length === 0}
      empty={{
        icon: GraduationCap,
        title: 'Курсов пока нет',
        description: isManager
          ? 'Создайте первый обучающий курс с уроками и тестами для команды.'
          : 'Обучающие материалы скоро появятся.',
        action: isManager ? { label: 'Создать курс', onClick: onCreateCourse } : undefined,
      }}
      minHeight="py-14"
    >
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="Курсы">
        {courses.map((c) => (
          <li key={c.id}>
            <CourseCard course={c} to={courseHref(c.id)} />
          </li>
        ))}
      </ul>
    </QueryState>
  );
}

function CourseCard({ course, to }: { course: KnowledgeCourse; to: To }) {
  return (
    <TileLink to={to} className="flex h-full flex-col overflow-hidden">
      {course.coverImage ? (
        <img src={course.coverImage} alt="" className="h-32 w-full object-cover" loading="lazy" />
      ) : (
        <CoverPlaceholder icon={GraduationCap} className="h-32 w-full" />
      )}
      <div className="flex flex-1 flex-col p-4">
        {(course.completed || !course.published) && (
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            {course.completed && (
              <Badge tone="ok" icon={Check}>
                Пройден
              </Badge>
            )}
            {!course.published && <Badge>Черновик</Badge>}
          </div>
        )}
        <h3 className="line-clamp-2 text-sm font-semibold text-ink group-hover:text-accent-text">{course.title}</h3>
        {course.description && <p className="mt-1 line-clamp-2 text-xs text-ink-3">{course.description}</p>}
        <div className="mt-auto pt-4">
          <ProgressBar percent={course.progressPercent} label={`Прогресс курса «${course.title}»`} />
          <p className="mt-1.5 text-xs tabular-nums text-ink-3">
            {lessonsLabel(course.completedLessons, course.lessonCount)}
          </p>
        </div>
      </div>
    </TileLink>
  );
}

// ───────────────────────────────────────────────────────────────────────
//  Course detail — lessons list + progress
// ───────────────────────────────────────────────────────────────────────
function CourseDetail({
  courseId,
  isManager,
  categories,
  lessonHref,
  onDeleted,
}: {
  courseId: string;
  isManager: boolean;
  categories: KnowledgeCategory[];
  lessonHref: (lessonId: string) => To;
  onDeleted: () => void;
}) {
  const queryClient = useQueryClient();
  const [courseEditor, setCourseEditor] = useState(false);
  const [lessonEditor, setLessonEditor] = useState<KnowledgeLesson | 'new' | null>(null);
  const [confirmDeleteCourse, setConfirmDeleteCourse] = useState(false);
  const [confirmDeleteLesson, setConfirmDeleteLesson] = useState<string | null>(null);

  const {
    data: course,
    isLoading,
    isError,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: CKEY.course(courseId),
    queryFn: async () => (await knowledgeApi.getCourse(courseId)).data,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: CKEY.course(courseId) });
    queryClient.invalidateQueries({ queryKey: CKEY.courses });
  };

  const deleteCourseMutation = useMutation({
    mutationFn: () => knowledgeApi.deleteCourse(courseId),
    onSuccess: () => {
      toast.success('Курс удалён');
      queryClient.invalidateQueries({ queryKey: CKEY.courses });
      onDeleted();
    },
    onError: () => toast.error('Не удалось удалить курс'),
  });

  const deleteLessonMutation = useMutation({
    mutationFn: (id: string) => knowledgeApi.deleteLesson(id),
    onSuccess: () => {
      toast.success('Урок удалён');
      invalidate();
      setConfirmDeleteLesson(null);
    },
    onError: () => toast.error('Не удалось удалить урок'),
  });

  if (isLoading) {
    return (
      <div className="space-y-5" aria-busy="true">
        <Card padding="md">
          <Skeleton className="h-7 w-2/3" />
          <SkeletonText lines={2} className="mt-3 max-w-xl" />
          <Skeleton className="mt-5 h-1.5 w-full" />
        </Card>
        <SkeletonCard lines={4} />
      </div>
    );
  }

  if (isError || !course) {
    return (
      <Card padding="md">
        <QueryState
          isLoading={false}
          isError
          onRetry={refetch}
          isFetching={isFetching}
          errorTitle="Не удалось загрузить курс"
        >
          {null}
        </QueryState>
      </Card>
    );
  }

  const lessons = course.lessons ?? [];

  return (
    // pb-24 on mobile keeps the last lesson row / «Добавить урок» clear of the
    // floating bottom tab bar; md:pb-0 restores desktop spacing.
    <div className="space-y-5 pb-24 md:pb-0">
      {/* Карточка курса */}
      <Card padding="none" className="overflow-hidden">
        {course.coverImage && <img src={course.coverImage} alt="" className="max-h-56 w-full object-cover" />}
        <div className="px-5 py-5 sm:px-8 sm:py-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              {(course.completed || !course.published) && (
                <div className="mb-3 flex flex-wrap items-center gap-1.5">
                  {course.completed && (
                    <Badge tone="ok" icon={Check}>
                      Курс пройден
                    </Badge>
                  )}
                  {!course.published && <Badge>Черновик</Badge>}
                </div>
              )}
              <h2 className={articleTitleClass}>{course.title}</h2>
              {course.description && (
                <p className="mt-2 max-w-[70ch] text-sm leading-relaxed text-ink-2">{course.description}</p>
              )}
            </div>
            {isManager && (
              <div className="flex flex-shrink-0 items-center gap-2">
                <Button variant="secondary" icon={Pencil} onClick={() => setCourseEditor(true)}>
                  Изменить курс
                </Button>
                <IconButton
                  label="Удалить курс"
                  icon={Trash2}
                  variant="danger"
                  onClick={() => setConfirmDeleteCourse(true)}
                />
              </div>
            )}
          </div>
          <div className="mt-5 max-w-xl">
            <div className="mb-1.5 flex items-baseline justify-between gap-3">
              <span className="text-sm tabular-nums text-ink-2">
                {lessonsLabel(course.completedLessons, course.lessonCount)}
              </span>
              <span className="text-sm font-semibold tabular-nums text-ink">
                {pctFmt.format(course.progressPercent)}%
              </span>
            </div>
            <ProgressBar percent={course.progressPercent} label="Прогресс курса" />
          </div>
        </div>
      </Card>

      {/* Уроки */}
      <Card padding="none">
        <CardHeader
          as="h3"
          title="Уроки"
          subtitle={`${lessons.length} ${pluralRu(lessons.length, 'урок', 'урока', 'уроков')}`}
          divider={lessons.length > 0}
          actions={
            isManager ? (
              <Button icon={Plus} onClick={() => setLessonEditor('new')}>
                Добавить урок
              </Button>
            ) : undefined
          }
        />
        {lessons.length === 0 ? (
          <p className="px-5 pb-8 pt-2 text-center text-sm text-ink-3">
            {isManager ? 'В курсе пока нет уроков. Добавьте первый.' : 'Уроки скоро появятся.'}
          </p>
        ) : (
          <ol className="divide-y divide-line">
            {lessons.map((lesson, i) => (
              <li key={lesson.id} className="flex items-center gap-2 px-3 py-1.5 sm:px-4">
                <Link
                  to={lessonHref(lesson.id)}
                  className={cn(
                    'flex min-h-[40px] min-w-0 flex-1 items-center gap-3 rounded-lg px-1 py-1 text-left transition-colors hover:bg-surface-2',
                    focusRing,
                  )}
                >
                  {lesson.completed ? (
                    <CheckCircle2 className="h-5 w-5 flex-shrink-0 text-ok" aria-label="Пройден" />
                  ) : (
                    <Circle className="h-5 w-5 flex-shrink-0 text-ink-4" aria-hidden="true" />
                  )}
                  <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-surface-3 text-xs font-semibold tabular-nums text-ink-3">
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{lesson.title}</span>
                  {lesson.hasQuiz && (
                    <Badge tone="accent" size="sm" icon={ListChecks} className="hidden sm:inline-flex">
                      Тест
                    </Badge>
                  )}
                  <ChevronRight className="h-4 w-4 flex-shrink-0 text-ink-4" aria-hidden="true" />
                </Link>
                {isManager && (
                  <div className="flex flex-shrink-0 items-center">
                    <IconButton
                      label={`Изменить урок «${lesson.title}»`}
                      icon={Pencil}
                      size="sm"
                      onClick={() => setLessonEditor(lesson)}
                    />
                    <IconButton
                      label={`Удалить урок «${lesson.title}»`}
                      icon={Trash2}
                      size="sm"
                      variant="danger"
                      onClick={() => setConfirmDeleteLesson(lesson.id)}
                    />
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}
      </Card>

      {/* Course editor */}
      {isManager && courseEditor && (
        <CourseEditorModal
          course={course}
          categories={categories}
          onClose={() => setCourseEditor(false)}
          onSaved={() => {
            setCourseEditor(false);
            invalidate();
          }}
        />
      )}

      {/* Lesson editor */}
      {isManager && lessonEditor && (
        <LessonEditorModal
          courseId={courseId}
          lesson={lessonEditor === 'new' ? null : lessonEditor}
          nextSortOrder={lessons.length}
          onClose={() => setLessonEditor(null)}
          onSaved={() => {
            setLessonEditor(null);
            invalidate();
          }}
        />
      )}

      <ConfirmDialog
        isOpen={confirmDeleteCourse}
        onClose={() => setConfirmDeleteCourse(false)}
        onConfirm={() => deleteCourseMutation.mutate()}
        title="Удалить курс?"
        message="Курс и все его уроки будут удалены без возможности восстановления."
        confirmText="Удалить"
        variant="danger"
        loading={deleteCourseMutation.isPending}
      />
      <ConfirmDialog
        isOpen={!!confirmDeleteLesson}
        onClose={() => setConfirmDeleteLesson(null)}
        onConfirm={() => confirmDeleteLesson && deleteLessonMutation.mutate(confirmDeleteLesson)}
        title="Удалить урок?"
        message="Урок будет удалён без возможности восстановления."
        confirmText="Удалить"
        variant="danger"
        loading={deleteLessonMutation.isPending}
      />
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────
//  Lesson view — markdown + quiz
// ───────────────────────────────────────────────────────────────────────
function LessonView({ courseId, lessonId }: { courseId: string; lessonId: string }) {
  const queryClient = useQueryClient();

  // We read the lesson from the already-loaded course detail to avoid a second
  // round trip — getCourse returns the full lessons[] incl. quiz questions.
  const {
    data: course,
    isLoading,
    isError,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: CKEY.course(courseId),
    queryFn: async () => (await knowledgeApi.getCourse(courseId)).data,
  });

  const lesson = course?.lessons?.find((l) => l.id === lessonId);

  // Quiz answer state: index per question (-1 = unanswered).
  const [answers, setAnswers] = useState<number[]>([]);
  const [quizError, setQuizError] = useState<{ correct: number; total: number } | null>(null);

  const completeMutation = useMutation({
    mutationFn: (payload?: number[]) => knowledgeApi.completeLesson(lessonId, payload),
    onSuccess: (res) => {
      setQuizError(null);
      queryClient.invalidateQueries({ queryKey: CKEY.course(courseId) });
      queryClient.invalidateQueries({ queryKey: CKEY.courses });
      if (res.data.courseCompleted) {
        toast.success('Курс пройден!');
      } else {
        toast.success('Урок завершён');
      }
    },
    onError: (err: unknown) => {
      const axErr = err as AxiosError<{ correct?: number; total?: number; message?: string }>;
      const data = axErr.response?.data;
      if (axErr.response?.status === 400 && data && typeof data.total === 'number') {
        setQuizError({ correct: data.correct ?? 0, total: data.total });
        toast.error('Есть ошибки — проверьте ответы');
      } else {
        toast.error('Не удалось завершить урок');
      }
    },
  });

  if (isLoading) {
    return (
      <Card className="mx-auto w-full max-w-3xl px-5 py-6 sm:px-10 sm:py-8" aria-busy="true">
        <Skeleton className="h-8 w-2/3" />
        <SkeletonText lines={6} className="mt-8 max-w-[70ch]" />
      </Card>
    );
  }

  if (isError || !course) {
    return (
      <Card padding="md" className="mx-auto w-full max-w-3xl">
        <QueryState
          isLoading={false}
          isError
          onRetry={refetch}
          isFetching={isFetching}
          errorTitle="Не удалось загрузить урок"
        >
          {null}
        </QueryState>
      </Card>
    );
  }

  if (!lesson) {
    return (
      <Card padding="md" className="mx-auto w-full max-w-3xl">
        <EmptyState icon={PlayCircle} title="Урок не найден" description="Возможно, его удалили из курса." />
      </Card>
    );
  }

  const quiz = lesson.quiz ?? [];
  const hasQuiz = lesson.hasQuiz && quiz.length > 0;
  const allAnswered = hasQuiz && quiz.every((_, i) => answers[i] != null && answers[i] >= 0);

  const setAnswer = (qIndex: number, optIndex: number) => {
    setAnswers((prev) => {
      const next = [...prev];
      next[qIndex] = optIndex;
      return next;
    });
    setQuizError(null);
  };

  const onComplete = () => {
    if (hasQuiz) {
      completeMutation.mutate(answers);
    } else {
      completeMutation.mutate(undefined);
    }
  };

  return (
    // pb-24 on mobile keeps the «Сдать тест»/«Отметить как пройденный» button
    // clear of the floating bottom tab bar; md:pb-0 restores desktop spacing.
    <div className="pb-24 md:pb-0">
      <Card as="article" padding="none" className="mx-auto w-full max-w-3xl">
        <div className="px-5 py-6 sm:px-10 sm:py-8">
          <p className="mb-3 text-xs text-ink-3">
            Курс: <span className="font-medium text-ink-2">{course.title}</span>
          </p>
          {(lesson.completed || hasQuiz) && (
            <div className="mb-4 flex flex-wrap items-center gap-1.5">
              {lesson.completed && (
                <Badge tone="ok" icon={Check}>
                  Пройден
                </Badge>
              )}
              {hasQuiz && (
                <Badge tone="accent" icon={ListChecks}>
                  Тест в конце
                </Badge>
              )}
            </div>
          )}
          <h2 className={articleTitleClass}>{lesson.title}</h2>

          <div className="mt-8">
            {lesson.body ? (
              <MarkdownView>{lesson.body}</MarkdownView>
            ) : (
              <p className={articleType.empty}>Содержимое не заполнено.</p>
            )}
          </div>

          {/* Quiz */}
          {hasQuiz && (
            <section className="mt-10 max-w-[70ch] border-t border-line pt-6" aria-labelledby="lesson-quiz">
              <h3 id="lesson-quiz" className="mb-5 flex items-center gap-2 text-lg font-semibold text-ink">
                <ListChecks className="h-5 w-5 text-accent" aria-hidden="true" /> Проверочный тест
              </h3>
              <div className="space-y-6">
                {quiz.map((q, qi) => (
                  <RadioGroup
                    key={qi}
                    label={`${qi + 1}. ${q.question}`}
                    value={answers[qi] != null && answers[qi] >= 0 ? String(answers[qi]) : null}
                    onChange={(v) => setAnswer(qi, Number(v))}
                    options={q.options.map((opt, oi) => ({ value: String(oi), label: opt }))}
                  />
                ))}
              </div>

              {quizError && (
                <InlineError
                  className="mt-5"
                  message={`Правильных ответов: ${quizError.correct} из ${quizError.total}. Чтобы завершить урок, нужно ответить верно на все вопросы.`}
                />
              )}
            </section>
          )}

          {/* Complete action */}
          <div className="mt-10 max-w-[70ch] border-t border-line pt-5">
            {lesson.completed ? (
              <div
                className="flex items-center gap-2.5 rounded-lg border border-ok/20 bg-ok-soft px-4 py-3 text-sm font-medium text-ok-text"
                role="status"
              >
                <Check className="h-4 w-4" aria-hidden="true" /> Урок пройден
              </div>
            ) : (
              <>
                <Button
                  icon={Check}
                  onClick={onComplete}
                  loading={completeMutation.isPending}
                  disabled={hasQuiz && !allAnswered}
                >
                  {hasQuiz ? 'Сдать тест и завершить' : 'Отметить как пройденный'}
                </Button>
                {hasQuiz && !allAnswered && (
                  <p className="mt-2 text-xs text-ink-3">Ответьте на все вопросы, чтобы сдать тест.</p>
                )}
              </>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────
//  Course editor (create / edit) — manager
// ───────────────────────────────────────────────────────────────────────
export function CourseEditorModal({
  course,
  categories,
  onClose,
  onSaved,
}: {
  course: KnowledgeCourse | null;
  categories: KnowledgeCategory[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const uid = useId();
  const queryClient = useQueryClient();
  const isEdit = !!course;
  const [title, setTitle] = useState(course?.title ?? '');
  const [description, setDescription] = useState(course?.description ?? '');
  const [categoryId, setCategoryId] = useState(course?.categoryId ?? '');
  const [coverImage, setCoverImage] = useState<string | null>(course?.coverImage ?? null);
  const [published, setPublished] = useState(course?.published ?? true);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [titleError, setTitleError] = useState('');
  const coverInputRef = useRef<HTMLInputElement>(null);

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = {
        title: title.trim(),
        description: description.trim(),
        categoryId: categoryId || null,
        coverImage: coverImage || null,
        published,
      };
      return isEdit ? knowledgeApi.updateCourse(course!.id, payload) : knowledgeApi.createCourse(payload);
    },
    onSuccess: () => {
      toast.success(isEdit ? 'Курс обновлён' : 'Курс создан');
      queryClient.invalidateQueries({ queryKey: CKEY.courses });
      onSaved();
    },
    onError: () => toast.error('Не удалось сохранить курс'),
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

  const submit = () => {
    if (!title.trim()) {
      setTitleError('Введите название курса');
      return;
    }
    saveMutation.mutate();
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={isEdit ? 'Редактирование курса' : 'Новый курс'}
      size="lg"
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
        <Field label="Название курса" htmlFor={`${uid}-title`} required error={titleError || undefined}>
          <Input
            id={`${uid}-title`}
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              if (titleError) setTitleError('');
            }}
            placeholder="Например: Приёмка автомобиля"
            invalid={!!titleError}
            autoFocus
          />
        </Field>
        <Field label="Описание" htmlFor={`${uid}-desc`}>
          <Textarea
            id={`${uid}-desc`}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Краткое описание курса"
            rows={3}
          />
        </Field>
        <Field label="Категория" htmlFor={`${uid}-cat`}>
          <Select id={`${uid}-cat`} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">Без категории</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Обложка">
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
        <div className="border-t border-line pt-4">
          <Checkbox
            label="Опубликовано"
            description={published ? 'Курс виден всем сотрудникам.' : 'Черновик — виден только редакторам.'}
            checked={published}
            onChange={(e) => setPublished(e.target.checked)}
          />
        </div>
      </div>
    </Modal>
  );
}

// ───────────────────────────────────────────────────────────────────────
//  Lesson editor + quiz builder — manager
// ───────────────────────────────────────────────────────────────────────
function LessonEditorModal({
  courseId,
  lesson,
  nextSortOrder,
  onClose,
  onSaved,
}: {
  courseId: string;
  lesson: KnowledgeLesson | null;
  nextSortOrder: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const uid = useId();
  const isEdit = !!lesson;
  const [title, setTitle] = useState(lesson?.title ?? '');
  const [body, setBody] = useState(lesson?.body ?? '');
  const [showPreview, setShowPreview] = useState(false);
  const [hasQuiz, setHasQuiz] = useState(lesson?.hasQuiz ?? false);
  const [titleError, setTitleError] = useState('');
  const [quiz, setQuiz] = useState<QuizDraft[]>(() =>
    (lesson?.quiz ?? []).map((q) => ({
      question: q.question,
      options: q.options.length ? [...q.options] : ['', ''],
      correctIndex: q.correctIndex ?? 0,
    })),
  );

  const saveMutation = useMutation({
    mutationFn: () => {
      // Build a clean quiz payload: drop empty questions/options.
      const cleanedQuiz: KnowledgeQuizQuestion[] = quiz
        .map((q) => ({
          question: q.question.trim(),
          options: q.options.map((o) => o.trim()).filter((o) => o.length > 0),
          correctIndex: q.correctIndex,
        }))
        .filter((q) => q.question.length > 0 && q.options.length >= 2)
        // Re-clamp correctIndex in case trailing blank options were filtered out.
        .map((q) => ({
          ...q,
          correctIndex: Math.min(q.correctIndex, q.options.length - 1),
        }));

      const payload = {
        title: title.trim(),
        body,
        sortOrder: lesson?.sortOrder ?? nextSortOrder,
        quiz: hasQuiz && cleanedQuiz.length > 0 ? cleanedQuiz : null,
      };
      return isEdit ? knowledgeApi.updateLesson(lesson!.id, payload) : knowledgeApi.createLesson(courseId, payload);
    },
    onSuccess: () => {
      toast.success(isEdit ? 'Урок обновлён' : 'Урок создан');
      onSaved();
    },
    onError: () => toast.error('Не удалось сохранить урок'),
  });

  const quizValid =
    !hasQuiz ||
    quiz.some((q) => q.question.trim().length > 0 && q.options.filter((o) => o.trim().length > 0).length >= 2);

  const addQuestion = () => setQuiz((prev) => [...prev, { question: '', options: ['', ''], correctIndex: 0 }]);

  const updateQuestion = (qi: number, patch: Partial<QuizDraft>) =>
    setQuiz((prev) => prev.map((q, i) => (i === qi ? { ...q, ...patch } : q)));

  const removeQuestion = (qi: number) => setQuiz((prev) => prev.filter((_, i) => i !== qi));

  const submit = () => {
    if (!title.trim()) {
      setTitleError('Введите название урока');
      return;
    }
    if (!quizValid) {
      toast.error('Заполните хотя бы один вопрос с двумя вариантами или выключите тест');
      return;
    }
    saveMutation.mutate();
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={isEdit ? 'Редактирование урока' : 'Новый урок'}
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
        <Field label="Название урока" htmlFor={`${uid}-title`} required error={titleError || undefined}>
          <Input
            id={`${uid}-title`}
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              if (titleError) setTitleError('');
            }}
            placeholder="Например: Внешний осмотр кузова"
            invalid={!!titleError}
            autoFocus
          />
        </Field>

        {/* Body */}
        <Field label="Содержание (Markdown)" htmlFor={`${uid}-body`}>
          <div className={showPreview ? 'grid gap-3 lg:grid-cols-2' : ''}>
            <Textarea
              id={`${uid}-body`}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={'# Заголовок\n\nТекст урока в **markdown**…'}
              rows={12}
              className="font-mono text-[13px] leading-relaxed"
            />
            {showPreview && (
              <div className="max-h-[20rem] overflow-y-auto rounded-lg border border-line bg-surface-2 p-4">
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
        </Field>

        {/* Quiz builder */}
        <div className="border-t border-line pt-4">
          <Checkbox
            label="Добавить проверочный тест"
            description="Урок засчитывается, только если все ответы верны."
            checked={hasQuiz}
            onChange={(e) => {
              setHasQuiz(e.target.checked);
              if (e.target.checked && quiz.length === 0) addQuestion();
            }}
          />

          {hasQuiz && (
            <div className="mt-4 space-y-4">
              {quiz.map((q, qi) => (
                <fieldset key={qi} className="rounded-lg border border-line bg-surface-2 p-4">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <legend className="float-left text-xs font-semibold text-ink-3">Вопрос {qi + 1}</legend>
                    <IconButton
                      label={`Удалить вопрос ${qi + 1}`}
                      icon={Trash2}
                      size="sm"
                      variant="danger"
                      onClick={() => removeQuestion(qi)}
                    />
                  </div>
                  <Input
                    value={q.question}
                    onChange={(e) => updateQuestion(qi, { question: e.target.value })}
                    placeholder="Текст вопроса"
                    aria-label={`Текст вопроса ${qi + 1}`}
                    className="mb-3"
                  />
                  <p className="mb-2 text-xs text-ink-3">Отметьте правильный вариант радиокнопкой.</p>
                  <div className="space-y-2">
                    {q.options.map((opt, oi) => (
                      <div key={oi} className="flex items-center gap-2">
                        <input
                          type="radio"
                          name={`${uid}-correct-${qi}`}
                          checked={q.correctIndex === oi}
                          onChange={() => updateQuestion(qi, { correctIndex: oi })}
                          className="h-4 w-4 flex-shrink-0 cursor-pointer accent-accent"
                          aria-label={`Вариант ${oi + 1} — правильный ответ`}
                        />
                        <Input
                          size="sm"
                          value={opt}
                          onChange={(e) =>
                            updateQuestion(qi, {
                              options: q.options.map((o, idx) => (idx === oi ? e.target.value : o)),
                            })
                          }
                          placeholder={`Вариант ${oi + 1}`}
                          aria-label={`Вариант ${oi + 1}`}
                          className="flex-1"
                        />
                        {q.options.length > 2 && (
                          <IconButton
                            label={`Убрать вариант ${oi + 1}`}
                            icon={X}
                            size="sm"
                            onClick={() =>
                              updateQuestion(qi, {
                                options: q.options.filter((_, idx) => idx !== oi),
                                correctIndex:
                                  q.correctIndex >= oi && q.correctIndex > 0 ? q.correctIndex - 1 : q.correctIndex,
                              })
                            }
                          />
                        )}
                      </div>
                    ))}
                  </div>
                  {q.options.length < 6 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={Plus}
                      className="mt-2"
                      onClick={() => updateQuestion(qi, { options: [...q.options, ''] })}
                    >
                      Вариант
                    </Button>
                  )}
                </fieldset>
              ))}
              <Button variant="secondary" size="sm" icon={Plus} onClick={addQuestion}>
                Добавить вопрос
              </Button>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

interface QuizDraft {
  question: string;
  options: string[];
  correctIndex: number;
}
