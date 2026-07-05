/**
 * Конфиг лендинга — ЕДИНСТВЕННОЕ место, которое правится при появлении контактов.
 *
 * Пока все контакты undefined — вместо кнопки «Получить доступ» лендинг
 * показывает «Войти» (→ /login). Как только появится хотя бы один контакт,
 * primary-CTA автоматически станет «Получить доступ» и поведёт на него.
 */

export interface LandingContacts {
  /** username без @ или полная ссылка t.me */
  telegram?: string;
  /** номер в международном формате, например '79991234567' */
  whatsapp?: string;
  /** телефон для tel:-ссылки, например '+7 999 123-45-67' */
  phone?: string;
}

export const LANDING_CONTACTS: LandingContacts = {
  telegram: undefined,
  whatsapp: undefined,
  phone: undefined,
};

/** Ссылка для кнопки «Получить доступ»; null — контактов нет, рендерим «Войти». */
export function getAccessContactUrl(contacts: LandingContacts = LANDING_CONTACTS): string | null {
  if (contacts.telegram) {
    return contacts.telegram.startsWith('http')
      ? contacts.telegram
      : `https://t.me/${contacts.telegram.replace(/^@/, '')}`;
  }
  if (contacts.whatsapp) {
    return `https://wa.me/${contacts.whatsapp.replace(/\D/g, '')}`;
  }
  if (contacts.phone) {
    return `tel:${contacts.phone.replace(/[^\d+]/g, '')}`;
  }
  return null;
}
