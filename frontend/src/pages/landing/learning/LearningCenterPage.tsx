import { useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowRight, Check, Monitor, Search, Smartphone, X } from 'lucide-react';
import LearningShell, { LearningBreadcrumb } from './LearningShell';
import LearningImage from './LearningImage';
import { learningLessons, lessonHref, resolveLearningStep } from './content';
import { rankLearningLessons, MAX_LEARNING_QUERY_LENGTH } from './search';
import { learningTopics, platformLabels, resolveLearningPlatform, resolveLearningTopic } from './topics';
import { readLearningProgress } from './progress';

export default function LearningCenterPage() {
  const [params, setParams] = useSearchParams();
  const query = (params.get('q') ?? '').slice(0, MAX_LEARNING_QUERY_LENGTH);
  const platform = resolveLearningPlatform(params.get('platform'));
  const legacyTopic = params.get('topic') ?? '';
  const group = resolveLearningTopic(params.get('group') ?? '') ?? resolveLearningTopic(legacyTopic);
  const category = group ? '' : legacyTopic;
  const [progress] = useState(readLearningProgress);
  const searchRef = useRef<HTMLInputElement>(null);
  const available = learningLessons.filter((lesson) => !platform || lesson.platform === platform);
  const found = rankLearningLessons(learningLessons, query, { platform, topic: group, category });
  const last = available.find(
    (lesson) => lesson.slug === progress.lastLesson && !progress.lessons[lesson.slug]?.complete,
  );
  const nextLesson = available.find((lesson) => !progress.lessons[lesson.slug]?.complete);
  const hasCompletedLesson = available.some((lesson) => progress.lessons[lesson.slug]?.complete);
  const featured = last ?? nextLesson ?? available[0];
  const featuredStep = last
    ? resolveLearningStep(String(progress.lessons[last.slug]?.step ?? 1), featured?.steps.length ?? 1) + 1
    : 1;
  let featuredHeading = featured?.platform === 'desktop' ? 'С чего начать на компьютере?' : 'Первый раз в приложении?';
  let featuredDescription =
    featured?.platform === 'desktop'
      ? 'Откройте урок по нужной задаче. Шаги показаны в веб-версии Autexa на компьютере.'
      : 'Начните с навигации и данных компании. Затем добавьте клиента, услугу и оформите первый чек.';
  let featuredAction = 'Начать с первого урока';
  if (last) {
    featuredHeading = 'Продолжите с того же места';
    featuredDescription = featured?.title ?? '';
    featuredAction = `Продолжить · шаг ${featuredStep}`;
  } else if (!nextLesson) {
    featuredHeading = 'Все уроки пройдены';
    featuredDescription = 'Повторите первый урок или выберите нужную задачу в списке ниже.';
    featuredAction = 'Повторить первый урок';
  } else if (hasCompletedLesson) {
    featuredHeading = 'Следующий урок';
    featuredDescription = featured?.title ?? '';
    featuredAction = 'Открыть следующий урок';
  }
  const updateSearch = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (key === 'group') next.delete('topic');
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  return (
    <LearningShell title="Пошаговые уроки">
      <LearningBreadcrumb />
      <div className="learning-index-heading">
        <h1>
          Разберитесь в Autexa. <span>Шаг за шагом.</span>
        </h1>
        <p>Найдите свою задачу. Откройте нужный шаг и повторяйте действия по настоящим экранам Autexa.</p>
      </div>
      <nav className="learning-platforms" aria-label="Платформа обучения">
        {(['', 'desktop', 'mobile'] as const).map((item) => (
          <button
            key={item || 'all'}
            type="button"
            aria-pressed={(platform ?? '') === item}
            onClick={() => updateSearch('platform', item)}
          >
            {item ? platformLabels[item] : 'Все'}
          </button>
        ))}
      </nav>
      <section className="learning-catalog" aria-labelledby="learning-lessons-title">
        <div className="learning-catalog-head">
          <h2 id="learning-lessons-title">Чему научимся</h2>
          <p>{available.length} уроков · можно начать с любого</p>
        </div>
        <div className="learning-search">
          <Search size={20} aria-hidden="true" />
          <input
            ref={searchRef}
            type="search"
            maxLength={MAX_LEARNING_QUERY_LENGTH}
            value={query}
            onChange={(event) => updateSearch('q', event.target.value)}
            aria-label="Найти урок"
            placeholder="Клиент, услуга, чек…"
          />
          {query && (
            <button
              type="button"
              aria-label="Очистить поиск"
              onClick={() => {
                updateSearch('q', '');
                searchRef.current?.focus({ preventScroll: true });
              }}
            >
              <X size={19} aria-hidden="true" />
            </button>
          )}
        </div>
        <nav className="learning-topic-nav" aria-label="Темы обучения">
          <button type="button" aria-pressed={!group && !category} onClick={() => updateSearch('group', '')}>
            Все темы
          </button>
          {learningTopics.map((topic) => {
            const count = available.filter((lesson) => lesson.topic === topic.id).length;
            return (
              <button
                key={topic.id}
                type="button"
                aria-pressed={group === topic.id}
                onClick={() => updateSearch('group', topic.id)}
              >
                {topic.title}
                <span>{count}</span>
              </button>
            );
          })}
        </nav>
        {featured && !query && !group && !category && (
          <section
            className={`learning-feature${featured.platform === 'desktop' ? ' is-desktop' : ''}`}
            aria-labelledby="learning-start-title"
          >
            <div className="learning-feature-copy">
              <h2 id="learning-start-title">{featuredHeading}</h2>
              <p>{featuredDescription}</p>
              <Link className="learning-button learning-primary" to={lessonHref(featured.slug, featuredStep, params)}>
                {featuredAction}
                <ArrowRight size={19} aria-hidden="true" />
              </Link>
              <span className="learning-feature-caption">Шагов: {featured.steps.length}</span>
            </div>
            <div className="learning-feature-screen">
              <LearningImage
                assetId={featured.steps[featuredStep - 1].asset}
                hotspot={featured.steps[featuredStep - 1].hotspot}
                annotation={featured.steps[featuredStep - 1].annotation}
                stepNumber={featuredStep}
                preview
              />
            </div>
          </section>
        )}
        {(query || group || category) && (
          <p className="learning-search-result" role="status">
            Найдено уроков: {found.length}
          </p>
        )}
        <div className="learning-task-groups">
          {(query.trim()
            ? [{ id: 'results', title: 'Результаты поиска', description: '', tasks: found }]
            : learningTopics.map((topic) => ({
                ...topic,
                tasks: found.filter((result) => result.lesson.topic === topic.id),
              }))
          ).map((topic) => {
            const tasks = topic.tasks;
            if (!tasks.length) return null;
            return (
              <section className="learning-task-group" key={topic.id} aria-labelledby={`learning-topic-${topic.id}`}>
                <div className="learning-task-group-heading">
                  <h3 id={`learning-topic-${topic.id}`}>{topic.title}</h3>
                  <p>{topic.description}</p>
                </div>
                <ul className="learning-lesson-list">
                  {tasks.map(({ lesson, step: matchedStep }) => {
                    const saved = progress.lessons[lesson.slug];
                    const complete = saved?.complete;
                    const savedStep = resolveLearningStep(String(saved?.step ?? 1), lesson.steps.length) + 1;
                    const linkedStep = query.trim() ? matchedStep : complete ? 1 : savedStep;
                    return (
                      <li key={lesson.slug}>
                        <Link to={lessonHref(lesson.slug, linkedStep, params)} className="learning-lesson-row">
                          <span
                            className={`learning-lesson-marker${complete ? ' is-complete' : ''}`}
                            role="img"
                            aria-label={complete ? 'Пройден' : platformLabels[lesson.platform]}
                          >
                            {complete ? (
                              <Check size={20} aria-hidden="true" />
                            ) : lesson.platform === 'desktop' ? (
                              <Monitor size={20} aria-hidden="true" />
                            ) : (
                              <Smartphone size={20} aria-hidden="true" />
                            )}
                          </span>
                          <span className="learning-lesson-row-copy">
                            <strong>{lesson.title}</strong>
                            <span>{lesson.description}</span>
                            <small>
                              {platformLabels[lesson.platform]} ·{' '}
                              {learningTopics.find((item) => item.id === lesson.topic)?.title} · {lesson.category} ·
                              Шагов: {lesson.steps.length}
                              {complete ? ' · Пройден' : saved ? ` · Шаг ${savedStep}` : ''}
                            </small>
                            {query.trim() && (
                              <span className="learning-matched-step">
                                Шаг {matchedStep}: {lesson.steps[matchedStep - 1].title}
                                <span className="learning-matched-action">{lesson.steps[matchedStep - 1].action}</span>
                              </span>
                            )}
                          </span>
                          <ArrowRight size={21} aria-hidden="true" />
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
        {found.length === 0 && (
          <div className="learning-no-results">
            <h3>
              {!query && platform === 'desktop' && !available.length
                ? 'Уроки для компьютера готовятся'
                : 'Такого урока пока нет'}
            </h3>
            <p>Попробуйте «клиент», «услуга» или «чек».</p>
            <button
              className="learning-button"
              type="button"
              onClick={() => {
                const next = new URLSearchParams(params);
                next.delete('q');
                next.delete('topic');
                next.delete('group');
                setParams(next, { replace: true });
                searchRef.current?.focus({ preventScroll: true });
              }}
            >
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
