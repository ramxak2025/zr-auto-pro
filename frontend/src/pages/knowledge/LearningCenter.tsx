import { useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import {
  GraduationCap,
  ArrowLeft,
  Plus,
  Pencil,
  Trash2,
  X,
  Check,
  Loader2,
  ImagePlus,
  Eye,
  EyeOff,
  CheckCircle2,
  Circle,
  ListChecks,
  ChevronRight,
  PlayCircle,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { knowledgeApi, uploadsApi } from '../../api/services';
import type { KnowledgeCourse, KnowledgeLesson, KnowledgeQuizQuestion, KnowledgeCategory } from '../../types';
import Modal from '../../components/Modal';
import ConfirmDialog from '../../components/ConfirmDialog';
import EmptyState from '../../components/EmptyState';
import MarkdownView from '../../components/MarkdownView';

// ───────────────────────────────────────────────────────────────────────
//  Query keys
// ───────────────────────────────────────────────────────────────────────
const CKEY = {
  courses: ['knowledge', 'courses'] as const,
  course: (id: string) => ['knowledge', 'course', id] as const,
};

type LearningView =
  | { mode: 'grid' }
  | { mode: 'course'; courseId: string }
  | { mode: 'lesson'; courseId: string; lessonId: string };

export default function LearningCenter({
  isManager,
  categories,
}: {
  isManager: boolean;
  categories: KnowledgeCategory[];
}) {
  const [view, setView] = useState<LearningView>({ mode: 'grid' });

  if (view.mode === 'course') {
    return (
      <CourseDetail
        courseId={view.courseId}
        isManager={isManager}
        categories={categories}
        onBack={() => setView({ mode: 'grid' })}
        onOpenLesson={(lessonId) => setView({ mode: 'lesson', courseId: view.courseId, lessonId })}
      />
    );
  }

  if (view.mode === 'lesson') {
    return (
      <LessonView
        courseId={view.courseId}
        lessonId={view.lessonId}
        onBack={() => setView({ mode: 'course', courseId: view.courseId })}
      />
    );
  }

  return (
    <CourseGrid
      isManager={isManager}
      categories={categories}
      onOpenCourse={(courseId) => setView({ mode: 'course', courseId })}
    />
  );
}

// ───────────────────────────────────────────────────────────────────────
//  Course grid
// ───────────────────────────────────────────────────────────────────────
function CourseGrid({
  isManager,
  categories,
  onOpenCourse,
}: {
  isManager: boolean;
  categories: KnowledgeCategory[];
  onOpenCourse: (courseId: string) => void;
}) {
  const [editor, setEditor] = useState<KnowledgeCourse | 'new' | null>(null);

  const { data: courses = [], isLoading } = useQuery({
    queryKey: CKEY.courses,
    queryFn: async () => (await knowledgeApi.listCourses()).data,
  });

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-primary-500" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {isManager && (
        <div className="flex justify-end">
          <button onClick={() => setEditor('new')} className="btn-primary btn-sm">
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">Новый курс</span>
          </button>
        </div>
      )}

      {courses.length === 0 ? (
        <EmptyState
          icon={GraduationCap}
          title="Курсов пока нет"
          description={
            isManager
              ? 'Создайте первый обучающий курс с уроками и тестами для команды.'
              : 'Обучающие материалы скоро появятся.'
          }
          action={isManager ? { label: 'Создать курс', onClick: () => setEditor('new') } : undefined}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {courses.map((c) => (
            <CourseCard key={c.id} course={c} onOpen={() => onOpenCourse(c.id)} />
          ))}
        </div>
      )}

      {isManager && editor && (
        <CourseEditorModal
          course={editor === 'new' ? null : editor}
          categories={categories}
          onClose={() => setEditor(null)}
          onSaved={() => setEditor(null)}
        />
      )}
    </div>
  );
}

function CourseCard({ course, onOpen }: { course: KnowledgeCourse; onOpen: () => void }) {
  return (
    <button onClick={onOpen} className="card-interactive flex flex-col overflow-hidden text-left">
      {course.coverImage ? (
        <img src={course.coverImage} alt="" className="h-32 w-full object-cover" loading="lazy" />
      ) : (
        <div className="flex h-32 w-full items-center justify-center bg-gradient-to-br from-primary-50 to-primary-100">
          <GraduationCap className="h-10 w-10 text-primary-400" />
        </div>
      )}
      <div className="flex flex-1 flex-col p-4">
        <div className="mb-1.5 flex items-center gap-2">
          {course.completed && (
            <span className="badge-green gap-1">
              <Check className="h-3 w-3" /> Пройден
            </span>
          )}
          {!course.published && <span className="badge-gray">Черновик</span>}
        </div>
        <h3 className="text-sm font-semibold text-gray-900 line-clamp-2">{course.title}</h3>
        {course.description && <p className="mt-1 text-xs text-gray-500 line-clamp-2">{course.description}</p>}
        <div className="mt-auto pt-3">
          <ProgressBar percent={course.progressPercent} />
          <p className="mt-1.5 text-xs text-gray-400">
            {course.completedLessons} из {course.lessonCount} уроков
          </p>
        </div>
      </div>
    </button>
  );
}

function ProgressBar({ percent }: { percent: number }) {
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
      <div
        className={`h-full rounded-full transition-all ${clamped >= 100 ? 'bg-green-500' : 'bg-primary-500'}`}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────
//  Course detail — lessons list + progress
// ───────────────────────────────────────────────────────────────────────
function CourseDetail({
  courseId,
  isManager,
  categories,
  onBack,
  onOpenLesson,
}: {
  courseId: string;
  isManager: boolean;
  categories: KnowledgeCategory[];
  onBack: () => void;
  onOpenLesson: (lessonId: string) => void;
}) {
  const queryClient = useQueryClient();
  const [courseEditor, setCourseEditor] = useState(false);
  const [lessonEditor, setLessonEditor] = useState<KnowledgeLesson | 'new' | null>(null);
  const [confirmDeleteCourse, setConfirmDeleteCourse] = useState(false);
  const [confirmDeleteLesson, setConfirmDeleteLesson] = useState<string | null>(null);

  const { data: course, isLoading } = useQuery({
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
      onBack();
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

  if (isLoading || !course) {
    return (
      <div className="space-y-6">
        <button onClick={onBack} className="btn-ghost btn-sm -ml-2">
          <ArrowLeft className="h-4 w-4" /> К курсам
        </button>
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-primary-500" />
        </div>
      </div>
    );
  }

  const lessons = course.lessons ?? [];

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="btn-ghost btn-sm -ml-2">
          <ArrowLeft className="h-4 w-4" /> К курсам
        </button>
        {isManager && (
          <div className="flex items-center gap-2">
            <button onClick={() => setCourseEditor(true)} className="btn-secondary btn-sm">
              <Pencil className="h-4 w-4" />
              <span className="hidden sm:inline">Изменить курс</span>
            </button>
            <button onClick={() => setConfirmDeleteCourse(true)} className="btn-ghost btn-sm text-red-600">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      {/* Header card */}
      <div className="card overflow-hidden">
        {course.coverImage && <img src={course.coverImage} alt="" className="max-h-56 w-full object-cover" />}
        <div className="p-6">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            {course.completed && (
              <span className="badge-green gap-1">
                <Check className="h-3 w-3" /> Курс пройден
              </span>
            )}
            {!course.published && <span className="badge-gray">Черновик</span>}
          </div>
          <h1 className="text-2xl font-bold text-gray-900">{course.title}</h1>
          {course.description && <p className="mt-2 text-sm text-gray-600">{course.description}</p>}
          <div className="mt-4">
            <div className="mb-1.5 flex items-baseline justify-between">
              <span className="text-sm font-medium text-gray-700">
                {course.completedLessons} из {course.lessonCount} уроков
              </span>
              <span className="text-sm font-semibold text-primary-600">{Math.round(course.progressPercent)}%</span>
            </div>
            <ProgressBar percent={course.progressPercent} />
          </div>
        </div>
      </div>

      {/* Lessons */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-500">Уроки</h2>
          {isManager && (
            <button onClick={() => setLessonEditor('new')} className="btn-secondary btn-sm">
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">Добавить урок</span>
            </button>
          )}
        </div>

        {lessons.length === 0 ? (
          <div className="card p-6 text-center text-sm text-gray-400">
            {isManager ? 'В курсе пока нет уроков. Добавьте первый.' : 'Уроки скоро появятся.'}
          </div>
        ) : (
          <div className="card divide-y divide-gray-100 overflow-hidden">
            {lessons.map((lesson, i) => (
              <div key={lesson.id} className="flex items-center gap-3 px-4 py-3">
                <button onClick={() => onOpenLesson(lesson.id)} className="flex flex-1 items-center gap-3 text-left">
                  {lesson.completed ? (
                    <CheckCircle2 className="h-5 w-5 flex-shrink-0 text-green-500" />
                  ) : (
                    <Circle className="h-5 w-5 flex-shrink-0 text-gray-300" />
                  )}
                  <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-semibold text-gray-500">
                    {i + 1}
                  </span>
                  <span className="flex-1 truncate text-sm font-medium text-gray-800">{lesson.title}</span>
                  {lesson.hasQuiz && (
                    <span className="badge-blue gap-1">
                      <ListChecks className="h-3 w-3" /> Тест
                    </span>
                  )}
                  <ChevronRight className="h-4 w-4 flex-shrink-0 text-gray-300" />
                </button>
                {isManager && (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setLessonEditor(lesson)}
                      className="p-1 text-gray-400 hover:text-primary-600"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => setConfirmDeleteLesson(lesson.id)}
                      className="p-1 text-gray-400 hover:text-red-600"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

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
      />
      <ConfirmDialog
        isOpen={!!confirmDeleteLesson}
        onClose={() => setConfirmDeleteLesson(null)}
        onConfirm={() => confirmDeleteLesson && deleteLessonMutation.mutate(confirmDeleteLesson)}
        title="Удалить урок?"
        message="Урок будет удалён без возможности восстановления."
        confirmText="Удалить"
        variant="danger"
      />
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────
//  Lesson view — markdown + quiz
// ───────────────────────────────────────────────────────────────────────
function LessonView({ courseId, lessonId, onBack }: { courseId: string; lessonId: string; onBack: () => void }) {
  const queryClient = useQueryClient();

  // We read the lesson from the already-loaded course detail to avoid a second
  // round trip — getCourse returns the full lessons[] incl. quiz questions.
  const { data: course, isLoading } = useQuery({
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
        toast.success('Курс пройден! 🎉');
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

  if (isLoading || !course) {
    return (
      <div className="space-y-6">
        <button onClick={onBack} className="btn-ghost btn-sm -ml-2">
          <ArrowLeft className="h-4 w-4" /> К урокам
        </button>
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-primary-500" />
        </div>
      </div>
    );
  }

  if (!lesson) {
    return (
      <div className="space-y-6">
        <button onClick={onBack} className="btn-ghost btn-sm -ml-2">
          <ArrowLeft className="h-4 w-4" /> К урокам
        </button>
        <EmptyState icon={PlayCircle} title="Урок не найден" />
      </div>
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
    <div className="space-y-6">
      <button onClick={onBack} className="btn-ghost btn-sm -ml-2">
        <ArrowLeft className="h-4 w-4" /> К урокам
      </button>

      <article className="card p-6 sm:p-8">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {lesson.completed && (
            <span className="badge-green gap-1">
              <Check className="h-3 w-3" /> Пройден
            </span>
          )}
          {hasQuiz && (
            <span className="badge-blue gap-1">
              <ListChecks className="h-3 w-3" /> Тест в конце
            </span>
          )}
        </div>
        <h1 className="text-2xl font-bold text-gray-900">{lesson.title}</h1>

        <div className="mt-6">
          {lesson.body ? (
            <MarkdownView>{lesson.body}</MarkdownView>
          ) : (
            <p className="text-sm italic text-gray-400">Содержимое не заполнено.</p>
          )}
        </div>

        {/* Quiz */}
        {hasQuiz && (
          <div className="mt-8 border-t border-gray-100 pt-6">
            <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-gray-900">
              <ListChecks className="h-5 w-5 text-primary-500" /> Проверочный тест
            </h2>
            <div className="space-y-5">
              {quiz.map((q, qi) => (
                <div key={qi}>
                  <p className="mb-2 text-sm font-medium text-gray-800">
                    {qi + 1}. {q.question}
                  </p>
                  <div className="space-y-2">
                    {q.options.map((opt, oi) => {
                      const selected = answers[qi] === oi;
                      return (
                        <label
                          key={oi}
                          className={`flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2.5 text-sm transition-colors ${
                            selected
                              ? 'border-primary-400 bg-primary-50 text-primary-800'
                              : 'border-gray-200 text-gray-700 hover:bg-gray-50'
                          }`}
                        >
                          <input
                            type="radio"
                            name={`q-${qi}`}
                            checked={selected}
                            onChange={() => setAnswer(qi, oi)}
                            className="h-4 w-4 text-primary-600 focus:ring-primary-500"
                          />
                          <span>{opt}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            {quizError && (
              <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
                Правильных ответов: {quizError.correct} из {quizError.total}. Чтобы завершить урок, нужно ответить верно
                на все вопросы.
              </div>
            )}
          </div>
        )}

        {/* Complete action */}
        <div className="mt-8 border-t border-gray-100 pt-5">
          {lesson.completed ? (
            <div className="flex items-center gap-2 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm font-medium text-green-700">
              <Check className="h-5 w-5" /> Урок пройден
            </div>
          ) : (
            <button
              onClick={onComplete}
              disabled={completeMutation.isPending || (hasQuiz && !allAnswered)}
              className="btn-primary"
            >
              {completeMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4" />
              )}
              {hasQuiz ? 'Сдать тест и завершить' : 'Отметить как пройденный'}
            </button>
          )}
          {hasQuiz && !lesson.completed && !allAnswered && (
            <p className="mt-2 text-xs text-gray-400">Ответьте на все вопросы, чтобы сдать тест.</p>
          )}
        </div>
      </article>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────
//  Course editor (create / edit) — manager
// ───────────────────────────────────────────────────────────────────────
function CourseEditorModal({
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
  const queryClient = useQueryClient();
  const isEdit = !!course;
  const [title, setTitle] = useState(course?.title ?? '');
  const [description, setDescription] = useState(course?.description ?? '');
  const [categoryId, setCategoryId] = useState(course?.categoryId ?? '');
  const [coverImage, setCoverImage] = useState<string | null>(course?.coverImage ?? null);
  const [published, setPublished] = useState(course?.published ?? true);
  const [uploadingCover, setUploadingCover] = useState(false);
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

  return (
    <Modal isOpen onClose={onClose} title={isEdit ? 'Редактирование курса' : 'Новый курс'} size="lg">
      <div className="space-y-4">
        <div>
          <label className="label">Название курса</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Например: Приёмка автомобиля"
            className="input"
            autoFocus
          />
        </div>
        <div>
          <label className="label">Описание</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Краткое описание курса"
            rows={3}
            className="input resize-y"
          />
        </div>
        <div>
          <label className="label">Категория</label>
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="input">
            <option value="">Без категории</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
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
        <div className="border-t border-gray-100 pt-4">
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
  const isEdit = !!lesson;
  const [title, setTitle] = useState(lesson?.title ?? '');
  const [body, setBody] = useState(lesson?.body ?? '');
  const [showPreview, setShowPreview] = useState(false);
  const [hasQuiz, setHasQuiz] = useState(lesson?.hasQuiz ?? false);
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
  const canSave = title.trim().length > 0 && quizValid && !saveMutation.isPending;

  const addQuestion = () => setQuiz((prev) => [...prev, { question: '', options: ['', ''], correctIndex: 0 }]);

  const updateQuestion = (qi: number, patch: Partial<QuizDraft>) =>
    setQuiz((prev) => prev.map((q, i) => (i === qi ? { ...q, ...patch } : q)));

  const removeQuestion = (qi: number) => setQuiz((prev) => prev.filter((_, i) => i !== qi));

  return (
    <Modal isOpen onClose={onClose} title={isEdit ? 'Редактирование урока' : 'Новый урок'} size="xl">
      <div className="space-y-4">
        <div>
          <label className="label">Название урока</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Например: Внешний осмотр кузова"
            className="input"
            autoFocus
          />
        </div>

        {/* Body */}
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label className="label mb-0">Содержание (Markdown)</label>
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
              placeholder="# Заголовок&#10;&#10;Текст урока в **markdown**…"
              rows={12}
              className="input resize-y font-mono text-[13px] leading-relaxed"
            />
            {showPreview && (
              <div className="max-h-[20rem] overflow-y-auto rounded-lg border border-gray-200 bg-gray-50/50 p-4">
                {body.trim() ? (
                  <MarkdownView>{body}</MarkdownView>
                ) : (
                  <p className="text-sm italic text-gray-400">Превью появится здесь…</p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Quiz builder */}
        <div className="border-t border-gray-100 pt-4">
          <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-gray-700">
            <input
              type="checkbox"
              checked={hasQuiz}
              onChange={(e) => {
                setHasQuiz(e.target.checked);
                if (e.target.checked && quiz.length === 0) addQuestion();
              }}
              className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
            />
            <ListChecks className="h-4 w-4 text-gray-400" /> Добавить проверочный тест
          </label>

          {hasQuiz && (
            <div className="mt-4 space-y-4">
              {quiz.map((q, qi) => (
                <div key={qi} className="rounded-xl border border-gray-200 p-4">
                  <div className="mb-2 flex items-center gap-2">
                    <span className="text-xs font-semibold text-gray-400">Вопрос {qi + 1}</span>
                    <button
                      type="button"
                      onClick={() => removeQuestion(qi)}
                      className="ml-auto text-gray-400 hover:text-red-600"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <input
                    value={q.question}
                    onChange={(e) => updateQuestion(qi, { question: e.target.value })}
                    placeholder="Текст вопроса"
                    className="input mb-3"
                  />
                  <p className="mb-1.5 text-xs text-gray-500">Отметьте правильный вариант радиокнопкой</p>
                  <div className="space-y-2">
                    {q.options.map((opt, oi) => (
                      <div key={oi} className="flex items-center gap-2">
                        <input
                          type="radio"
                          name={`correct-${qi}`}
                          checked={q.correctIndex === oi}
                          onChange={() => updateQuestion(qi, { correctIndex: oi })}
                          className="h-4 w-4 flex-shrink-0 text-primary-600 focus:ring-primary-500"
                          title="Правильный ответ"
                        />
                        <input
                          value={opt}
                          onChange={(e) =>
                            updateQuestion(qi, {
                              options: q.options.map((o, idx) => (idx === oi ? e.target.value : o)),
                            })
                          }
                          placeholder={`Вариант ${oi + 1}`}
                          className="input flex-1 py-1.5"
                        />
                        {q.options.length > 2 && (
                          <button
                            type="button"
                            onClick={() =>
                              updateQuestion(qi, {
                                options: q.options.filter((_, idx) => idx !== oi),
                                correctIndex:
                                  q.correctIndex >= oi && q.correctIndex > 0 ? q.correctIndex - 1 : q.correctIndex,
                              })
                            }
                            className="flex-shrink-0 text-gray-400 hover:text-red-600"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  {q.options.length < 6 && (
                    <button
                      type="button"
                      onClick={() => updateQuestion(qi, { options: [...q.options, ''] })}
                      className="btn-ghost btn-sm mt-2"
                    >
                      <Plus className="h-3.5 w-3.5" /> Вариант
                    </button>
                  )}
                </div>
              ))}
              <button type="button" onClick={addQuestion} className="btn-secondary btn-sm">
                <Plus className="h-4 w-4" /> Добавить вопрос
              </button>
            </div>
          )}
        </div>

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

interface QuizDraft {
  question: string;
  options: string[];
  correctIndex: number;
}
