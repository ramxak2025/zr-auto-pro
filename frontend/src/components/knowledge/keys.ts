import type { KnowledgeArticleType } from '../../types';

/**
 * Ключи react-query базы знаний (конвенция: ['knowledge', <resource>, ...args]).
 * НЕ МЕНЯТЬ: на эти ключи завязаны инвалидации в редакторах и мобильный клиент
 * их зеркалит. Фаза B перенесла их из KnowledgeBasePage без изменений.
 */
export const KEY = {
  categories: ['knowledge', 'categories'] as const,
  articlesByType: (type: KnowledgeArticleType) => ['knowledge', 'articles', { type }] as const,
  article: (id: string) => ['knowledge', 'article', id] as const,
  search: (q: string) => ['knowledge', 'search', q] as const,
  acks: (id: string) => ['knowledge', 'acks', id] as const,
  pendingCount: ['knowledge', 'regulations', 'pending-count'] as const,
};

/** Ключи учебного центра (LearningCenter). */
export const CKEY = {
  courses: ['knowledge', 'courses'] as const,
  course: (id: string) => ['knowledge', 'course', id] as const,
};
