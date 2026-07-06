import { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { getTelegramUrl, getWhatsAppUrl, WHATSAPP_INSTALL_MESSAGE } from '../config';

const LINK_CLS = 'font-medium text-primary-600 transition-colors hover:text-primary-700';

const WA_INSTALL_URL = getWhatsAppUrl(WHATSAPP_INSTALL_MESSAGE);
const TG_URL = getTelegramUrl();

/**
 * Упоминания WhatsApp/Telegram в ответах превращаем в живые ссылки, а
 * «сравнение тарифов» — в Link на отдельную страницу /tarify (полное
 * сравнение переехало с главной туда). Текст остаётся ровно тем, что
 * в content.ts, меняется только разметка.
 *
 * Используется в FAQ главной (Faq.tsx) и на странице /voprosy.
 */
export function linkifyContacts(text: string): ReactNode {
  const parts = text.split(/(WhatsApp|Telegram|сравнение тарифов)/g);
  if (parts.length === 1) return text;
  return parts.map((part, i) => {
    if (part === 'сравнение тарифов') {
      return (
        <Link key={i} to="/tarify" className={LINK_CLS}>
          {part}
        </Link>
      );
    }
    const url = part === 'WhatsApp' ? WA_INSTALL_URL : part === 'Telegram' ? TG_URL : null;
    if (!url) return part;
    return (
      <a key={i} href={url} target="_blank" rel="noopener noreferrer" className={LINK_CLS}>
        {part}
      </a>
    );
  });
}
