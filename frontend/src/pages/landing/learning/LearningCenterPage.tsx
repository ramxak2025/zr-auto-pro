import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowRight, Check, Search, X } from 'lucide-react';
import LearningShell, { LearningBreadcrumb } from './LearningShell';
import LearningImage from './LearningImage';
import { learningLessons, lessonHref, resolveLearningStep, searchLessons } from './content';
import { readLearningProgress } from './progress';

export default function LearningCenterPage() {
  const [params, setParams] = useSearchParams();
  const query = params.get('q') ?? '';
  const category = params.get('topic') ?? '';
  const [progress] = useState(readLearningProgress);
  const found = searchLessons(query, category);
  const categories = [...new Set(learningLessons.map((lesson) => lesson.category))];
  const last = learningLessons.find(
    (lesson) => lesson.slug === progress.lastLesson && !progress.lessons[lesson.slug]?.complete,
  );
  const nextLesson = learningLessons.find((lesson) => !progress.lessons[lesson.slug]?.complete);
  const hasCompletedLesson = learningLessons.some((lesson) => progress.lessons[lesson.slug]?.complete);
  const featured = last ?? nextLesson ?? learningLessons[0];
  const featuredStep = last
    ? resolveLearningStep(String(progress.lessons[last.slug]?.step ?? 1), featured.steps.length) + 1
    : 1;
  let featuredHeading = 'Первый раз в приложении?';
  let featuredDescription =
    'Начните с навигации и данных компании. Затем добавьте клиента, услугу и оформите первый чек.';
  let featuredAction = 'Начать с первого урока';
  if (last) {
    featuredHeading = 'Продолжите с того же места';
    featuredDescription = featured.title;
    featuredAction = `Продолжить · шаг ${featuredStep}`;
  } else if (!nextLesson) {
    featuredHeading = 'Все уроки пройдены';
    featuredDescription = 'Повторите первый урок или выберите нужную задачу в списке ниже.';
    featuredAction = 'Повторить первый урок';
  } else if (hasCompletedLesson) {
    featuredHeading = 'Следующий урок';
    featuredDescription = featured.title;
    featuredAction = 'Открыть следующий урок';
  }
  const updateSearch = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  return (
    <LearningShell title="Пошаговые уроки">
      <LearningBreadcrumb />
      <div className="learning-index-heading">
        <h1>
          Разберитесь в Autexa.
          <br />
          <span>Шаг за шагом.</span>
        </h1>
        <p>Первые шаги в мобильном приложении Autexa. Выберите задачу и повторяйте в своём темпе.</p>
      </div>
      {!query && !category && (
        <section className="learning-feature" aria-labelledby="learning-start-title">
          <div className="learning-feature-copy">
            <h2 id="learning-start-title">{featuredHeading}</h2>
            <p>{featuredDescription}</p>
            <Link className="learning-button learning-primary" to={lessonHref(featured.slug, featuredStep)}>
              {featuredAction}
              <ArrowRight size={19} aria-hidden="true" />
            </Link>
            <span className="learning-feature-caption">Шагов: {featured.steps.length}</span>
          </div>
          <div className="learning-feature-screen">
            <LearningImage assetId={featured.steps[featuredStep - 1]?.asset ?? featured.steps[0].asset} preview />
          </div>
        </section>
      )}
      <section className="learning-catalog" aria-labelledby="learning-lessons-title">
        <div className="learning-catalog-head">
          <h2 id="learning-lessons-title">Чему научимся</h2>
          <p>{learningLessons.length} уроков · можно начать с любого</p>
        </div>
        <div className="learning-search">
          <Search size={20} aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => updateSearch('q', event.target.value)}
            aria-label="Найти урок"
            placeholder="Клиент, услуга, чек…"
          />
          {query && (
            <button type="button" aria-label="Очистить поиск" onClick={() => updateSearch('q', '')}>
              <X size={19} aria-hidden="true" />
            </button>
          )}
        </div>
        <div className="learning-topics" role="group" aria-label="Задачи обучения">
          {['', ...categories].map((item) => (
            <button
              key={item}
              type="button"
              aria-pressed={category === item}
              onClick={() => updateSearch('topic', item)}
            >
              {item || 'Все уроки'}
            </button>
          ))}
        </div>
        {(query || category) && (
          <p className="learning-search-result" role="status">
            Найдено уроков: {found.length}
          </p>
        )}
        <ol className="learning-lesson-list">
          {found.map((lesson) => {
            const saved = progress.lessons[lesson.slug];
            const complete = saved?.complete;
            const savedStep = resolveLearningStep(String(saved?.step ?? 1), lesson.steps.length) + 1;
            return (
              <li key={lesson.slug}>
                <Link to={lessonHref(lesson.slug, complete ? 1 : savedStep)} className="learning-lesson-row">
                  <span className={`learning-lesson-number ${complete ? 'is-complete' : ''}`}>
                    {complete ? <Check size={20} aria-label="Пройден" /> : learningLessons.indexOf(lesson) + 1}
                  </span>
                  <span className="learning-lesson-row-copy">
                    <strong>{lesson.title}</strong>
                    <span>{lesson.description}</span>
                    <small>
                      Шагов: {lesson.steps.length}
                      {complete ? ' · Пройден' : saved ? ` · Шаг ${savedStep}` : ''}
                    </small>
                  </span>
                  <ArrowRight size={21} aria-hidden="true" />
                </Link>
              </li>
            );
          })}
        </ol>
        {found.length === 0 && (
          <div className="learning-no-results">
            <h3>Такого урока пока нет</h3>
            <p>Попробуйте «клиент», «услуга» или «чек».</p>
            <button className="learning-button" type="button" onClick={() => setParams({})}>
              Показать все уроки
            </button>
          </div>
        )}
        <p className="learning-local-note">Прогресс сохраняется в этом браузере, если его настройки это позволяют.</p>
      </section>
      <p className="learning-training-note">
        На скриншотах — учебные данные. Вид разделов и доступные действия зависят от роли и настроек компании.
      </p>
    </LearningShell>
  );
}
