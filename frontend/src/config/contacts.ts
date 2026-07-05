/**
 * Контакты поддержки — ЕДИНСТВЕННЫЙ источник номера WhatsApp для всего фронта:
 * лендинг (pages/landing/config.ts), FeatureGate, TariffPage.
 * Смена номера — правка только этого файла.
 *
 * Модуль без зависимостей: его тянут и lazy-чанк лендинга, и авторизованный
 * бандл — на размер чанков не влияет.
 */

/** Номер WhatsApp в международном формате без «+», например '79991234567'. */
export const SUPPORT_WHATSAPP_PHONE = '79884444436';

/** Ссылка на чат WhatsApp с предзаполненным первым сообщением. */
export function getWhatsAppChatUrl(message: string, phone: string = SUPPORT_WHATSAPP_PHONE): string {
  return `https://wa.me/${phone.replace(/\D/g, '')}?text=${encodeURIComponent(message)}`;
}
