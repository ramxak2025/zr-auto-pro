import { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import Reveal from './Reveal';
import { faqMain } from '../content';
import { getTelegramUrl, getWhatsAppUrl, WHATSAPP_INSTALL_MESSAGE } from '../config';

const LINK_CLS = 'font-medium text-primary-600 transition-colors hover:text-primary-700';

const WA_INSTALL_URL = getWhatsAppUrl(WHATSAPP_INSTALL_MESSAGE);
const TG_URL = getTelegramUrl();

/**
 * Упоминания WhatsApp/Telegram в ответах превращаем в живые ссылки —
 * текст остаётся ровно тем, что в content.ts, меняется только разметка.
 */
function linkifyContacts(text: string): ReactNode {
  const parts = text.split(/(WhatsApp|Telegram)/g);
  if (parts.length === 1) return text;
  return parts.map((part, i) => {
    const url = part === 'WhatsApp' ? WA_INSTALL_URL : part === 'Telegram' ? TG_URL : null;
    if (!url) return part;
    return (
      <a key={i} href={url} target="_blank" rel="noopener noreferrer" className={LINK_CLS}>
        {part}
      </a>
    );
  });
}

export default function Faq() {
  return (
    <section id="faq" className="scroll-mt-24 border-t border-slate-200/60">
      <div className="mx-auto max-w-3xl px-4 py-20 sm:px-6 sm:py-28">
        <Reveal className="text-center">
          <h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-5xl">Частые вопросы</h2>
        </Reveal>

        <div className="mt-12 space-y-3">
          {faqMain.map((item, i) => (
            <Reveal key={item.q} delay={Math.min(i * 0.05, 0.2)}>
              <details className="group rounded-2xl border border-slate-200/60 bg-white shadow-sm transition-colors hover:border-slate-300">
                <summary className="flex min-h-[56px] cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-left text-base font-medium text-slate-900 [&::-webkit-details-marker]:hidden">
                  {item.q}
                  <ChevronDown className="h-5 w-5 shrink-0 text-slate-400 transition-transform duration-300 group-open:rotate-180" />
                </summary>
                <p className="px-5 pb-5 text-sm leading-relaxed text-slate-600">{linkifyContacts(item.a)}</p>
              </details>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
