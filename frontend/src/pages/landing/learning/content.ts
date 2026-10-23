import type { LearningAsset, LearningCaptureId } from './assets';

export interface LearningStep {
  title: string;
  action: string;
  result: string;
  asset: LearningCaptureId;
  hotspot?: LearningAsset['hotspot'];
  note?: string;
}

export interface LearningLesson {
  slug: string;
  title: string;
  description: string;
  category: string;
  prerequisite?: string;
  steps: LearningStep[];
}

// All lessons follow reviewed native iPhone captures from the training account.
export const learningLessons: LearningLesson[] = [
  {
    slug: 'pervye-shagi',
    title: 'Освоиться в приложении',
    category: 'Начало',
    description: 'Главные разделы и данные компании.',
    steps: [
      {
        title: 'Откройте «Ещё»',
        action: 'Нажмите «Ещё» в нижнем меню.',
        result: 'Откроется список доступных вам разделов.',
        asset: 'home-navigation',
        hotspot: { x: 0.8, y: 0.89, width: 0.13, height: 0.06 },
      },
      {
        title: 'Найдите настройки компании',
        action: 'Прокрутите меню «Ещё» вниз и выберите «Настройки компании».',
        result: 'Откроются основные данные компании.',
        asset: 'more-menu-company',
        hotspot: { x: 0.04, y: 0.79, width: 0.92, height: 0.074 },
        note: 'Этот раздел доступен сотрудникам с правом управления компанией.',
      },
      {
        title: 'Проверьте данные компании',
        action: 'Проверьте название, контакты и часовой пояс.',
        result: 'Вы знаете, где менять данные компании. Сохраняйте настройки только после внесения нужных изменений.',
        asset: 'company-settings',
        hotspot: { x: 0.08, y: 0.43, width: 0.84, height: 0.3 },
      },
    ],
  },
  {
    slug: 'dobavit-klienta',
    title: 'Добавить клиента',
    category: 'Клиенты',
    description: 'Сохранить имя, при необходимости — телефон, и найти клиента в списке.',
    steps: [
      {
        title: 'Откройте клиентов',
        action: 'В меню «Ещё» выберите «Клиенты».',
        result: 'Откроется поиск клиента по госномеру.',
        asset: 'more-menu',
        hotspot: { x: 0.04, y: 0.44, width: 0.92, height: 0.074 },
      },
      {
        title: 'Создайте нового клиента',
        action: 'Нажмите синий «+» в правом верхнем углу.',
        result: 'Откроется форма нового клиента.',
        asset: 'clients-list',
        hotspot: { x: 0.88, y: 0.08, width: 0.09, height: 0.045 },
      },
      {
        title: 'Заполните контакты',
        action: 'Укажите ФИО. Телефон добавьте, если хотите находить клиента по номеру.',
        result: 'Данные появятся в форме.',
        asset: 'client-form-ready',
        hotspot: { x: 0.08, y: 0.218, width: 0.84, height: 0.136 },
        note: 'Телефон и автомобиль необязательны. В примере заполнены только имя и учебный телефон.',
      },
      {
        title: 'Сохраните клиента',
        action: 'Прокрутите форму вниз и нажмите «Создать».',
        result: 'Форма закроется. Клиент сохранён.',
        asset: 'client-form-submit',
        hotspot: { x: 0.69, y: 0.874, width: 0.22, height: 0.045 },
      },
      {
        title: 'Откройте список клиентов',
        action: 'Нажмите значок двух людей слева от «+» в верхнем углу.',
        result: 'Вместо поиска по госномеру появится список клиентов.',
        asset: 'clients-list',
        hotspot: { x: 0.77, y: 0.08, width: 0.09, height: 0.045 },
      },
      {
        title: 'Проверьте результат',
        action: 'Найдите созданного клиента в списке.',
        result: 'Клиента можно выбрать при оформлении чека.',
        asset: 'clients-list-created',
        hotspot: { x: 0.04, y: 0.371, width: 0.92, height: 0.075 },
      },
    ],
  },
  {
    slug: 'dobavit-uslugu',
    title: 'Добавить услугу',
    category: 'Услуги',
    description: 'Создать услугу с фиксированной ценой.',
    steps: [
      {
        title: 'Откройте услуги',
        action: 'Откройте «Ещё», прокрутите меню вниз и выберите «Услуги».',
        result: 'Откроется каталог услуг.',
        asset: 'more-menu-company',
        hotspot: { x: 0.04, y: 0.106, width: 0.92, height: 0.073 },
      },
      {
        title: 'Добавьте новую услугу',
        action: 'Нажмите «+ Новая».',
        result: 'Откроется форма услуги.',
        asset: 'services-list',
      },
      {
        title: 'Укажите название и цену',
        action: 'Введите название, оставьте тип цены «Фиксированная» и укажите цену по умолчанию.',
        result: 'Эта цена будет подставляться при добавлении услуги в чек.',
        asset: 'service-form-ready',
        hotspot: { x: 0.08, y: 0.5, width: 0.84, height: 0.05 },
        note: 'В примере — «Замена масла» за 700 ₽. Дополнительные поля оставлены без изменений.',
      },
      {
        title: 'Сохраните услугу',
        action: 'Нажмите «Создать».',
        result: 'Услуга появится в каталоге.',
        asset: 'service-form-ready',
        hotspot: { x: 0.69, y: 0.903, width: 0.22, height: 0.045 },
      },
      {
        title: 'Проверьте результат',
        action: 'Найдите созданную услугу в каталоге.',
        result: 'Услугу можно добавить в чек с сохранённой ценой.',
        asset: 'services-list-created',
      },
    ],
  },
  {
    slug: 'sozdat-chek',
    title: 'Оформить чек',
    category: 'Касса',
    description: 'Продажа в кассе: клиент, услуга и наличная оплата.',
    prerequisite:
      'Сначала добавьте клиента с телефоном и услугу. Урок показывает обычную продажу за наличные. В режиме заказ-нарядов шаги и права отличаются.',
    steps: [
      {
        title: 'Откройте кассу',
        action: 'Нажмите синюю кнопку с сумкой по центру нижнего меню.',
        result: 'Откроется форма нового чека.',
        asset: 'home-navigation',
        hotspot: { x: 0.43, y: 0.89, width: 0.15, height: 0.06 },
      },
      {
        title: 'Включите поиск по телефону',
        action: 'В блоке «Информация о клиенте» нажмите «ТЕЛ».',
        result: 'Появится поле поиска клиента по телефону.',
        asset: 'check-empty',
      },
      {
        title: 'Выберите клиента',
        action: 'Введите телефон сохранённого клиента и нажмите на найденную строку с его именем.',
        result: 'Клиент будет прикреплён к чеку.',
        asset: 'client-picker',
        note: 'В примере найден Алексей Смирнов с учебным телефоном. Введите телефон своего клиента.',
      },
      {
        title: 'Откройте выбор услуги',
        action: 'Прокрутите чек до блока «Услуги» и нажмите синий «+» справа от заголовка.',
        result: 'Откроется окно «Добавить услугу».',
        asset: 'check-with-client',
        hotspot: { x: 0.82, y: 0.795, width: 0.08, height: 0.037 },
      },
      {
        title: 'Выберите услугу',
        action: 'Выберите сохранённую услугу в каталоге.',
        result: 'Услуга и её цена появятся в чеке.',
        asset: 'service-picker',
      },
      {
        title: 'Проверьте чек',
        action: 'Сверьте выбранную услугу, исполнителя и сумму «К оплате».',
        result: 'Чек готов к выбору способа оплаты.',
        asset: 'check-total',
        note: 'В примере исполнитель «Учебный» подставился автоматически, итог — 700 ₽.',
      },
      {
        title: 'Откройте способы оплаты',
        action: 'Прокрутите ниже до блока «Оплата» и нажмите на поле «Способ оплаты».',
        result: 'Откроется список способов оплаты.',
        asset: 'payment-open-control',
      },
      {
        title: 'Выберите наличные',
        action: 'Выберите «Наличные», если клиент рассчитался наличными.',
        result: 'В чеке будет выбран способ «Наличные».',
        asset: 'payment-methods',
      },
      {
        title: 'Укажите полученную сумму',
        action: 'В поле «Клиент дал» введите сумму полученных наличных.',
        result: 'В примере указано 700 ₽ — ровно сумма чека.',
        asset: 'check-ready-to-submit',
        hotspot: { x: 0.66, y: 0.563, width: 0.25, height: 0.043 },
      },
      {
        title: 'Завершите оформление',
        action: 'Проверьте сумму и нажмите «Пробить» с итогом чека.',
        result: 'После успешного сохранения появится подтверждение.',
        asset: 'check-ready-to-submit',
        hotspot: { x: 0.03, y: 0.807, width: 0.94, height: 0.058 },
      },
      {
        title: 'Проверьте подтверждение',
        action: 'Убедитесь, что появилось сообщение «Чек успешно создан», и нажмите «ОК».',
        result: 'Чек сохранён. Его можно открыть в журнале.',
        asset: 'check-created',
      },
    ],
  },
  {
    slug: 'nayti-chek',
    title: 'Найти оформленный чек',
    category: 'Касса',
    description: 'Открыть журнал и проверить детали.',
    steps: [
      {
        title: 'Откройте журнал',
        action: 'Нажмите «Журнал» в нижнем меню.',
        result: 'Откроется список оформленных чеков.',
        asset: 'home-after-sale',
        hotspot: { x: 0.62, y: 0.89, width: 0.14, height: 0.06 },
      },
      {
        title: 'Найдите нужный чек',
        action: 'Выберите нужный чек в списке.',
        result: 'Откроются детали выбранного чека.',
        asset: 'journal-with-training-check',
        note: 'Если чеков много, используйте поиск по клиенту, телефону, госномеру или номеру чека.',
      },
      {
        title: 'Проверьте детали',
        action: 'Сверьте клиента, услугу и сумму. Способ оплаты указан вверху: в примере — «Наличные».',
        result: 'Вы нашли чек и проверили сохранённые данные.',
        asset: 'check-details',
      },
    ],
  },
];

export function lessonHref(slug: string, step = 1): string {
  return `/obuchenie/${slug}?step=${step}`;
}

export function resolveLearningStep(value: string | null, count: number): number {
  if (!value || !/^\d+$/.test(value)) return 0;
  return Math.max(0, Math.min(count - 1, Number(value) - 1));
}

export function searchLessons(query: string, category = ''): LearningLesson[] {
  const normalize = (text: string) => text.toLocaleLowerCase('ru').replace(/ё/g, 'е');
  const words = normalize(query).trim().split(/\s+/).filter(Boolean);
  return learningLessons.filter((lesson) => {
    const text = normalize(
      [
        lesson.title,
        lesson.description,
        lesson.category,
        ...lesson.steps.flatMap((step) => [step.title, step.action, step.result]),
      ].join(' '),
    );
    return (!category || lesson.category === category) && words.every((word) => text.includes(word));
  });
}
