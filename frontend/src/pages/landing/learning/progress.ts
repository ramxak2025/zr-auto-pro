import { learningLessons } from './content';

export const LEARNING_PROGRESS_KEY = 'autexa.public-learning.v1';
export interface LearningProgress {
  lessons: Record<string, { step: number; complete: boolean }>;
  lastLesson?: string;
}

export function readLearningProgress(): LearningProgress {
  try {
    const raw: unknown = JSON.parse(window.localStorage.getItem(LEARNING_PROGRESS_KEY) ?? '{}');
    if (!raw || typeof raw !== 'object' || !('lessons' in raw)) return { lessons: {} };
    const source = raw.lessons;
    const lessons: LearningProgress['lessons'] = {};
    if (source && typeof source === 'object') {
      for (const lesson of learningLessons) {
        const item: unknown = (source as Record<string, unknown>)[lesson.slug];
        if (!item || typeof item !== 'object' || !('step' in item)) continue;
        if (typeof item.step !== 'number' || !Number.isInteger(item.step)) continue;
        lessons[lesson.slug] = {
          step: Math.min(lesson.steps.length, Math.max(1, item.step)),
          complete: 'complete' in item && item.complete === true,
        };
      }
    }
    const lastLesson =
      'lastLesson' in raw &&
      typeof raw.lastLesson === 'string' &&
      learningLessons.some((lesson) => lesson.slug === raw.lastLesson)
        ? raw.lastLesson
        : undefined;
    return { lessons, lastLesson };
  } catch {
    // Private browsing, blocked storage and old/corrupt data must never block a lesson.
    return { lessons: {} };
  }
}

export function saveLearningProgress(slug: string, step: number, complete = false): boolean {
  const lesson = learningLessons.find((item) => item.slug === slug);
  if (!lesson) return false;
  try {
    const progress = readLearningProgress();
    progress.lessons[slug] = {
      step: Math.max(1, Math.min(lesson.steps.length, step)),
      complete: complete || progress.lessons[slug]?.complete === true,
    };
    progress.lastLesson = slug;
    window.localStorage.setItem(LEARNING_PROGRESS_KEY, JSON.stringify(progress));
    return true;
  } catch {
    // Saving is best effort; the URL remains sufficient to continue reading.
    return false;
  }
}
