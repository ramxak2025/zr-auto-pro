import type { LearningLesson, LearningStep } from './content';
import type { DesktopCaptureId } from './desktop-assets';

export interface DesktopLearningLesson extends Omit<LearningLesson, 'slug' | 'platform' | 'steps'> {
  slug: `desktop-${string}`;
  platform: 'desktop';
  featureIds: string[];
  steps: (Omit<LearningStep, 'asset'> & { asset: DesktopCaptureId })[];
}

// Reviewed read-only overview; broader feature workflows are integrated only with genuine captures.
export const desktopLearningLessons: DesktopLearningLesson[] = [
  {
    slug: 'desktop-pervye-shagi',
    platform: 'desktop',
    topic: 'work',
    featureIds: ['dashboard', 'clients'],
    category: 'Главная',
    title: 'Ориентироваться в десктопной версии',
    description: 'Найдите основные рабочие разделы, переход к клиентам и ежедневные показатели на главной странице.',
    availability: 'Состав меню и доступ к разделам зависят от роли и прав.',
    steps: [
      {
        title: 'Найдите рабочие разделы',
        action: 'Посмотрите на левую панель и найдите «Касса», «Записи» и «Журнал».',
        result: 'Узнаете, где расположены основные разделы ежедневной работы.',
        asset: 'desktop-dashboard-overview',
        hotspot: {
          x: 0.01,
          y: 0.09,
          width: 0.18,
          height: 0.27,
        },
        annotation: {
          kind: 'focus',
          label: 'Рабочие разделы',
          placement: 'below',
        },
      },
      {
        title: 'Проверьте показатели за день',
        action:
          'Посмотрите на карточки «Выручка сегодня» и «Касса сегодня». В этом учебном примере показаны 700 ₽ и 1 чек.',
        result: 'Будете знать, где смотреть выручку и число чеков за день, а также сумму кассы.',
        asset: 'desktop-dashboard-overview',
        hotspot: {
          x: 0.216,
          y: 0.19,
          width: 0.77,
          height: 0.14,
        },
        annotation: {
          kind: 'focus',
          label: 'Дневные показатели',
          placement: 'below',
        },
      },
      {
        title: 'Перейдите к клиентам',
        action: 'Нажмите «Найти клиента».',
        result: 'При переходе откроется список клиентов.',
        asset: 'desktop-dashboard-overview',
        hotspot: {
          x: 0.685,
          y: 0.108,
          width: 0.119,
          height: 0.052,
        },
        annotation: {
          kind: 'click',
          label: 'Найти клиента',
          placement: 'below',
        },
      },
      {
        title: 'Найдите карточку клиента',
        action: 'Проверьте список и поле поиска клиентов.',
        result: 'В учебном примере в списке видна карточка Алексея Смирнова; поле поиска находится над списком.',
        asset: 'desktop-clients-overview',
        hotspot: {
          x: 0.213,
          y: 0.195,
          width: 0.244,
          height: 0.045,
        },
        annotation: {
          kind: 'focus',
          label: 'Поиск клиентов',
          placement: 'below',
        },
      },
    ],
  },
];
