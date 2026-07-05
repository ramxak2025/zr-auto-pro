import { MessageCircle, Send } from 'lucide-react';
import Reveal from './Reveal';
import CtaButton from './CtaButton';
import { getTelegramUrl, getWhatsAppUrl } from '../config';

const BIG_BTN =
  'inline-flex min-h-[56px] w-full items-center justify-center gap-2.5 rounded-2xl px-8 text-base font-semibold text-white transition-colors sm:w-auto sm:text-lg';

export default function CtaSection() {
  const whatsapp = getWhatsAppUrl();
  const telegram = getTelegramUrl();

  return (
    <section>
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-24">
        <Reveal>
          <div className="relative overflow-hidden rounded-3xl border border-white/[0.08] bg-[#141416] px-6 py-16 text-center sm:px-12">
            {/* Подсветка внутри карточки */}
            <div aria-hidden className="pointer-events-none absolute inset-0">
              <div className="absolute -top-24 left-1/2 h-64 w-[560px] -translate-x-1/2 rounded-full bg-primary-600/25 blur-[100px]" />
            </div>

            <div className="relative">
              <h2 className="text-3xl font-bold tracking-tight text-white sm:text-5xl">Начните сегодня</h2>
              <p className="mx-auto mt-4 max-w-md text-lg text-white/60">
                Первые возможности — бесплатно: касса, склад и журнал доступны сразу.
              </p>
              {whatsapp || telegram ? (
                <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
                  {whatsapp && (
                    <a
                      href={whatsapp}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`${BIG_BTN} bg-green-500 shadow-lg shadow-green-500/25 hover:bg-green-400 active:bg-green-600`}
                    >
                      <MessageCircle className="h-5 w-5" />
                      Написать в WhatsApp
                    </a>
                  )}
                  {telegram && (
                    <a
                      href={telegram}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`${BIG_BTN} bg-sky-500 shadow-lg shadow-sky-500/25 hover:bg-sky-400 active:bg-sky-600`}
                    >
                      <Send className="h-5 w-5" />
                      Написать в Telegram
                    </a>
                  )}
                </div>
              ) : (
                <div className="mt-8">
                  <CtaButton />
                </div>
              )}
              <p className="mt-4 text-sm text-white/40">Отвечаем быстро — поможем подключиться за несколько минут.</p>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
