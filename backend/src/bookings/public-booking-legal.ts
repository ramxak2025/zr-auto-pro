import { createHash } from 'crypto';

interface BookingContactLinks {
  phone?: string;
  instagram?: string;
  whatsapp?: string;
  vk?: string;
  telegram?: string;
}

export const PUBLIC_BOOKING_LEGAL_TEMPLATE_VERSION = '1';

export interface BookingLegalTenant {
  name: string;
  legal_name: string | null;
  inn: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
}

export interface BookingLegalContext {
  tenant: BookingLegalTenant;
  pageAddress: string;
  pageContacts: string;
  links?: BookingContactLinks;
}

export interface BookingLegalDocuments {
  operator: { name: string; requisites: string; contact: string };
  policyText: string;
  consentText: string;
  consentVersion: string;
}

function publicContactLine(context: BookingLegalContext): string {
  const links = context.links ?? {};
  return [
    context.tenant.phone,
    context.tenant.email,
    context.pageContacts,
    links.instagram,
    links.whatsapp,
    links.vk,
    links.telegram,
  ]
    .map((value) => value?.trim())
    .filter((value): value is string => !!value)
    .filter((value, index, values) => values.indexOf(value) === index)
    .join('; ');
}

function uuidV5FromTemplate(content: string): string {
  const namespace = Buffer.from('39b7b420-fd5c-5f4e-8897-44e34429030b'.replace(/-/g, ''), 'hex');
  const bytes = createHash('sha1').update(namespace).update(content).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function buildPublicBookingLegalDocuments(context: BookingLegalContext): BookingLegalDocuments {
  const operatorName = context.tenant.legal_name?.trim() || context.tenant.name.trim();
  const inn = context.tenant.inn?.trim() || '';
  const address = context.tenant.address?.trim() || context.pageAddress.trim();
  const contacts = publicContactLine(context);
  const operator = {
    name: operatorName,
    requisites: inn ? `ИНН ${inn}` : 'ИНН в профиле компании не указан',
    contact: contacts,
  };
  const identity = [
    `Оператор: ${operator.name}`,
    operator.requisites,
    `Адрес оператора: ${address}`,
    ...(context.pageAddress.trim() && context.pageAddress.trim() !== address
      ? [`Адрес автосервиса: ${context.pageAddress.trim()}`]
      : []),
    `Контакты: ${contacts}`,
  ].join('\n');
  const policyText = [
    `Политика обработки персональных данных при онлайн-записи. Версия ${PUBLIC_BOOKING_LEGAL_TEMPLATE_VERSION}.`,
    identity,
    '',
    'Цель: принять, рассмотреть и организовать заявку на запись, а также связаться с заявителем по этой заявке.',
    'Обрабатываемые сведения: имя, номер телефона, выбранные услуги, желаемые дата и время, комментарий, если он указан, и запись о согласии.',
    'Действия с данными: получение, запись, систематизация, хранение, уточнение, извлечение, использование, блокирование и удаление в информационной системе онлайн-записи.',
    'Заявку могут видеть сотрудники автосервиса, которым предоставлен доступ к управлению записями.',
    'Заявка и связанная с ней запись сохраняются в Autexa до удаления данных автосервиса; подтверждённая запись также отображается во внутреннем календаре. Уничтожение этих данных выполняется при удалении данных автосервиса из системы.',
    contacts
      ? `По вопросам обработки данных, реализации прав или отзыва согласия обратитесь к оператору: ${contacts}.`
      : '',
    'Федеральный закон № 152-ФЗ «О персональных данных», статьи 9 и 18.1: https://mintrud.gov.ru/docs/laws/130.',
    'Шаблон подготовлен для онлайн-заявки и не заменяет проверку оператором под его фактические процессы и основания обработки.',
    'Технические вопросы по работе платформы Autexa: info@autexa.pw · https://autexa.pw/privacy.',
  ]
    .filter(Boolean)
    .join('\n');
  const consentText = [
    `Отдельное согласие на обработку персональных данных. Версия ${PUBLIC_BOOKING_LEGAL_TEMPLATE_VERSION}.`,
    identity,
    '',
    `Я даю оператору «${operator.name}» согласие на обработку моего имени, номера телефона, выбранных услуг, желаемых даты и времени, моего комментария, если он указан, и записи о согласии для рассмотрения и организации заявки и связи со мной по ней.`,
    'Согласие распространяется на получение, запись, систематизацию, хранение, извлечение, использование, блокирование и удаление этих сведений.',
    'Согласие оформляется отдельно от других документов. Оно действует до удаления заявки и связанных с ней записей из Autexa; отзыв согласия не отменяет уже выполненные до отзыва действия с данными.',
    contacts ? `Для отзыва согласия и обращений по данным свяжитесь с оператором: ${contacts}.` : '',
    'Справка: Федеральный закон № 152-ФЗ, статья 9: https://mintrud.gov.ru/docs/laws/130.',
  ]
    .filter(Boolean)
    .join('\n');
  const consentVersion = uuidV5FromTemplate(
    JSON.stringify({
      templateVersion: PUBLIC_BOOKING_LEGAL_TEMPLATE_VERSION,
      operator,
      address,
      policyText,
      consentText,
    }),
  );
  return { operator, policyText, consentText, consentVersion };
}
