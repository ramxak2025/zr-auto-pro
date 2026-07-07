/**
 * Конфиг лендинга. Сам НОМЕР живёт в src/config/contacts.ts — единственном
 * источнике для всего фронта (лендинг, FeatureGate, TariffPage); здесь только
 * лендинг-специфика: какие каналы включены и тексты первых сообщений.
 *
 * Если все контакты вдруг станут undefined — CTA автоматически откатится
 * на «Войти» (→ /login), как было до появления контактов.
 */
import { SUPPORT_WHATSAPP_PHONE, getWhatsAppChatUrl } from '../../config/contacts';

export interface LandingContacts {
  /** телефон в формате '+79991234567', username без @ или полная ссылка t.me */
  telegram?: string;
  /** номер в международном формате, например '79991234567' */
  whatsapp?: string;
  /** телефон для tel:-ссылки, например '+7 999 123-45-67' */
  phone?: string;
}

export const LANDING_CONTACTS: LandingContacts = {
  telegram: `+${SUPPORT_WHATSAPP_PHONE}`,
  whatsapp: SUPPORT_WHATSAPP_PHONE,
  phone: undefined,
};

/** Текст первого сообщения в WhatsApp для CTA «Получить доступ». */
export const WHATSAPP_ACCESS_MESSAGE = 'Здравствуйте! Хочу подключить Autexa для своего автосервиса';

/** Текст первого сообщения в WhatsApp для «Скачать через поддержку». */
export const WHATSAPP_INSTALL_MESSAGE = 'Здравствуйте! Хочу установить приложение Autexa';

/** Текст первого сообщения в WhatsApp для CTA «Подключить» на карточке тарифа. */
export function getPlanConnectMessage(planName: string): string {
  return `Здравствуйте! Хочу попробовать Autexa 14 дней бесплатно, тариф «${planName}»`;
}

/** Текст первого сообщения в WhatsApp для «Обсудить внедрение» (внедрение под ключ). */
export const WHATSAPP_IMPLEMENTATION_MESSAGE = 'Здравствуйте! Хочу обсудить внедрение Autexa под ключ';

/** Ссылка на WhatsApp с предзаполненным сообщением; null — номера нет. */
export function getWhatsAppUrl(
  message: string = WHATSAPP_ACCESS_MESSAGE,
  contacts: LandingContacts = LANDING_CONTACTS,
): string | null {
  if (!contacts.whatsapp) return null;
  return getWhatsAppChatUrl(message, contacts.whatsapp);
}

/** Ссылка на Telegram (по телефону — t.me/+7…, по username — t.me/name); null — контакта нет. */
export function getTelegramUrl(contacts: LandingContacts = LANDING_CONTACTS): string | null {
  if (!contacts.telegram) return null;
  if (contacts.telegram.startsWith('http')) return contacts.telegram;
  if (contacts.telegram.startsWith('+')) return `https://t.me/${contacts.telegram}`;
  return `https://t.me/${contacts.telegram.replace(/^@/, '')}`;
}

/** Ссылка для primary-CTA «Получить доступ»; null — контактов нет, рендерим «Войти». */
export function getAccessContactUrl(contacts: LandingContacts = LANDING_CONTACTS): string | null {
  const whatsapp = getWhatsAppUrl(WHATSAPP_ACCESS_MESSAGE, contacts);
  if (whatsapp) return whatsapp;
  const telegram = getTelegramUrl(contacts);
  if (telegram) return telegram;
  if (contacts.phone) {
    return `tel:${contacts.phone.replace(/[^\d+]/g, '')}`;
  }
  return null;
}
