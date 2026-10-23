import type { LearningLesson } from './content';
import { learningTopics, type LearningPlatform, type LearningTopic } from './topics';

export const MAX_LEARNING_QUERY_LENGTH = 180;
const stopWords = new Set([
  'как',
  'что',
  'где',
  'мне',
  'для',
  'это',
  'или',
  'при',
  'на',
  'по',
  'и',
  'в',
  'с',
  'из',
  'провести',
  'посмотреть',
  'узнать',
  'пожалуйста',
]);
const synonymGroups = [
  ['оприходовать', 'оприходование', 'поставка', 'приёмка', 'поступление', 'приход'],
  ['продажа', 'чек', 'заказнаряд', 'касса'],
  ['мастер', 'сотрудник', 'персонал', 'исполнитель'],
  ['прибыль', 'деньги', 'денег', 'доход', 'финансы'],
  ['клиент', 'покупатель'],
  ['добавить', 'создать', 'добавление', 'создание'],
];

function stem(word: string): string {
  return word.length < 5
    ? word
    : word.replace(
        /(иями|ами|ями|ого|ему|ому|ить|ать|ять|еть|ов|ев|ей|ия|ие|ий|ый|ой|ая|ую|ам|ям|ах|ях|ом|ем|ы|и|а|я|у|ю|е|ь)$/u,
        '',
      );
}

export function learningSearchWords(value: string): string[] {
  return (
    value
      .toLocaleLowerCase('ru')
      .replace(/ё/g, 'е')
      .replace(/заказ[\s-]+наряд/gu, 'заказнаряд')
      .match(/[\p{L}\p{N}]+/gu) ?? []
  );
}

const synonyms = synonymGroups.map((group) => new Set(group.flatMap((word) => learningSearchWords(word).map(stem))));

// At most one insertion, deletion, substitution or adjacent transposition. No input-derived regex.
function oneEdit(a: string, b: string): boolean {
  if (a.length < 5 || b.length < 5 || Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  if (a.length === b.length) {
    return (
      a.slice(i + 1) === b.slice(i + 1) || (a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2))
    );
  }
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
}

function match(word: string, candidate: string): number {
  if (word === candidate) return 1;
  const a = stem(word);
  const b = stem(candidate);
  if (a.length >= 3 && a === b) return 0.9;
  if (synonyms.some((group) => group.has(a) && group.has(b))) return 0.72;
  return oneEdit(word, candidate) || oneEdit(a, b) ? 0.6 : 0;
}

export interface LearningSearchResult {
  lesson: LearningLesson;
  step: number;
  score: number;
}

export function rankLearningLessons(
  lessons: LearningLesson[],
  query: string,
  filters: { platform?: LearningPlatform; topic?: LearningTopic; category?: string } = {},
): LearningSearchResult[] {
  const words = [
    ...new Set(learningSearchWords(query.slice(0, MAX_LEARNING_QUERY_LENGTH)).filter((word) => !stopWords.has(word))),
  ].slice(0, 12);
  const results: LearningSearchResult[] = [];
  for (const lesson of lessons) {
    if (
      (filters.platform && lesson.platform !== filters.platform) ||
      (filters.topic && lesson.topic !== filters.topic) ||
      (filters.category && lesson.category !== filters.category)
    )
      continue;
    const topic = learningTopics.find((item) => item.id === lesson.topic)?.title ?? '';
    const common: [string, number][] = [
      [lesson.title, 10],
      [lesson.category + ' ' + topic, 3],
      [lesson.description, 2],
      [lesson.prerequisite ?? '', 1],
    ];
    let best: LearningSearchResult | undefined;
    for (const [index, step] of lesson.steps.entries()) {
      const fields = [...common, [step.title, 8], [step.action, 7], [step.result, 2], [step.note ?? '', 1]] as [
        string,
        number,
      ][];
      const scores = words.map((word) =>
        Math.max(
          0,
          ...fields.map(
            ([value, weight]) =>
              Math.max(0, ...learningSearchWords(value).map((candidate) => match(word, candidate))) * weight,
          ),
        ),
      );
      if (scores.some((score) => score === 0)) continue;
      const score = scores.reduce((sum, value) => sum + value, 0);
      if (!best || score > best.score) best = { lesson, step: index + 1, score };
    }
    if (best) results.push(best);
  }
  return results.sort((a, b) => b.score - a.score || lessons.indexOf(a.lesson) - lessons.indexOf(b.lesson));
}
