import { useEffect, useRef } from 'react';
import { Link, useNavigate, useNavigationType, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check } from 'lucide-react';
import LearningShell, { LearningBreadcrumb } from './LearningShell';
import LearningImage from './LearningImage';
import { learningAssets } from './assets';
import { learningLessons, lessonHref, resolveLearningStep } from './content';
import { saveLearningProgress } from './progress';

export default function LearningLessonPage() {
  const { lesson: slug } = useParams<{ lesson: string }>();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const navigationType = useNavigationType();
  const lesson = learningLessons.find((item) => item.slug === slug);
  const index = resolveLearningStep(params.get('step'), lesson?.steps.length ?? 1);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const previousStep = useRef({ slug, index });

  useEffect(() => {
    if (!lesson) return;
    const canonical = String(index + 1);
    if (params.get('step') !== canonical) {
      const next = new URLSearchParams(params);
      next.set('step', canonical);
      setParams(next, { replace: true });
    }
    saveLearningProgress(lesson.slug, index + 1);
  }, [lesson, index, params, setParams]);

  useEffect(() => {
    const stepChanged = previousStep.current.slug !== slug || previousStep.current.index !== index;
    previousStep.current = { slug, index };
    if (!stepChanged) return;
    headingRef.current?.focus({ preventScroll: true });
    if (navigationType !== 'POP') stageRef.current?.scrollIntoView({ block: 'start', behavior: 'auto' });
  }, [slug, index, navigationType]);

  if (!lesson)
    return (
      <LearningShell title="Урок не найден">
        <LearningBreadcrumb />
        <div className="learning-not-found">
          <h1>Урок не найден</h1>
          <p>Ссылка могла измениться. Выберите задачу в списке уроков.</p>
          <Link to="/obuchenie" className="learning-button learning-primary">
            Все уроки
            <ArrowRight size={18} aria-hidden="true" />
          </Link>
        </div>
      </LearningShell>
    );

  const step = lesson.steps[index];
  const last = index === lesson.steps.length - 1;
  return (
    <LearningShell title={lesson.title}>
      <LearningBreadcrumb title={lesson.title} />
      <div className="learning-lesson-heading">
        <h1>{lesson.title}</h1>
        <span>
          Шаг {index + 1} из {lesson.steps.length}
        </span>
      </div>
      <div className="learning-workspace">
        <aside className="learning-rail">
          <Link to="/obuchenie" className="learning-rail-back">
            <ArrowLeft size={16} aria-hidden="true" />
            Все уроки
          </Link>
          <nav aria-label="Шаги урока">
            <ol>
              {lesson.steps.map((item, i) => (
                <li key={`${lesson.slug}-${i}`}>
                  <Link to={lessonHref(lesson.slug, i + 1)} aria-current={i === index ? 'step' : undefined}>
                    <span>{i + 1}</span>
                    {item.title}
                  </Link>
                </li>
              ))}
            </ol>
          </nav>
          {lesson.prerequisite && <p>{lesson.prerequisite}</p>}
        </aside>
        <div className="learning-stage" ref={stageRef}>
          <LearningImage key={step.asset} assetId={step.asset} hotspot={step.hotspot} />
          <p>Учебный экран · тестовые данные</p>
        </div>
        <section className="learning-instruction" aria-labelledby="learning-step-title">
          <p className="learning-step-count">
            Шаг {index + 1} / {lesson.steps.length}
          </p>
          <h2 id="learning-step-title" ref={headingRef} tabIndex={-1}>
            {step.title}
          </h2>
          <p className="learning-action">{step.action}</p>
          <div className="learning-expected">
            <Check size={18} aria-hidden="true" />
            <p>{step.result}</p>
          </div>
          {step.note && <p className="learning-step-note">{step.note}</p>}
          {index === 0 && lesson.prerequisite && (
            <details className="learning-prerequisite">
              <summary>Перед началом</summary>
              <p>{lesson.prerequisite}</p>
            </details>
          )}
          <nav className="learning-step-controls" aria-label="Переход между шагами">
            {index > 0 ? (
              <Link className="learning-button" to={lessonHref(lesson.slug, index)}>
                <ArrowLeft size={18} aria-hidden="true" />
                <span>Назад</span>
              </Link>
            ) : (
              <Link className="learning-button" to="/obuchenie">
                <ArrowLeft size={18} aria-hidden="true" />
                <span>Уроки</span>
              </Link>
            )}
            {last ? (
              <button
                type="button"
                className="learning-button learning-primary"
                onClick={() => {
                  saveLearningProgress(lesson.slug, index + 1, true);
                  navigate('/obuchenie');
                }}
              >
                Завершить
                <Check size={18} aria-hidden="true" />
              </button>
            ) : (
              <Link className="learning-button learning-primary" to={lessonHref(lesson.slug, index + 2)}>
                Дальше
                <ArrowRight size={18} aria-hidden="true" />
              </Link>
            )}
          </nav>
          <nav className="learning-thumbnails" aria-label="Быстрый выбор шага">
            {lesson.steps.map((item, i) => {
              const asset = learningAssets[item.asset];
              return (
                <Link
                  key={i}
                  to={lessonHref(lesson.slug, i + 1)}
                  aria-current={i === index ? 'step' : undefined}
                  aria-label={`Шаг ${i + 1}: ${item.title}`}
                >
                  {asset && <img src={asset.src} width={48} height={64} alt="" loading="lazy" decoding="async" />}
                  <span>{i + 1}</span>
                </Link>
              );
            })}
          </nav>
        </section>
      </div>
      <p className="learning-training-note">
        Это инструкция: нажатия на скриншот увеличивают изображение. Действия выполняйте в приложении Autexa.
      </p>
    </LearningShell>
  );
}
