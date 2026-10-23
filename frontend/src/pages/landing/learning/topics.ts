export const learningTopics = [
  { id: 'work', title: 'Работа', description: 'Продажи, чеки и запись на обслуживание' },
  { id: 'clients', title: 'Клиенты', description: 'Клиенты, автомобили и общение' },
  { id: 'stock', title: 'Склад', description: 'Товары, услуги и поставщики' },
  { id: 'money', title: 'Деньги', description: 'Оплата, расходы и отчёты' },
  { id: 'company', title: 'Компания', description: 'Сотрудники, доступ и настройки' },
] as const;

export type LearningTopic = (typeof learningTopics)[number]['id'];
export type LearningPlatform = 'mobile' | 'desktop';
export const platformLabels: Record<LearningPlatform, string> = { mobile: 'Приложение', desktop: 'Компьютер' };

export function resolveLearningPlatform(value: string | null): LearningPlatform | undefined {
  return value === 'desktop' || value === 'mobile' ? value : undefined;
}

export function resolveLearningTopic(value: string): LearningTopic | undefined {
  return learningTopics.find((topic) => topic.id === value || topic.title === value)?.id;
}
