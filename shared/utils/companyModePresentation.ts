/** User-facing explanations only: these descriptions never change mode rules. */
export const attendanceModePresentation = {
  admin: {
    title: 'Отмечает администратор',
    description: 'Администратор отмечает сотрудников в расписании.',
    steps: ['Администратор', 'Отметка в графике', 'Приход учтён'],
  },
  manual: {
    title: 'Сотрудник отмечается сам',
    description: 'Кнопка открытия и закрытия рабочей смены на главной.',
    steps: ['Сотрудник', 'Кнопка смены', 'Приход учтён'],
  },
  nfc: {
    title: 'Отметка по NFC',
    description: 'Телефон считывает метку, установленную в автосервисе.',
    steps: ['Сотрудник', 'Телефон к метке', 'Приход учтён'],
  },
} as const;
export const companyModeFlows = {
  posCashier: ['Мастер оформляет', 'Заказ-наряд', 'Кассир принимает оплату'],
  posDirect: ['Сотрудник оформляет', 'Чек', 'Принимает оплату по правам'],
  paymentRoles: ['Право в роли', 'Сотрудник', 'Принимает оплату'],
  paymentList: ['Выбран в списке', 'Сотрудник', 'Принимает оплату'],
  clientsShared: ['Клиент', 'Любой филиал', 'Общая карточка'],
  clientsSeparate: ['Филиал', 'Свой список', 'Свои клиенты'],
} as const;
