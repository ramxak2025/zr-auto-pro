import { MessageCircle, Send, ShieldCheck } from 'lucide-react';
import Reveal from './Reveal';
import CtaButton from './CtaButton';
import OptionalImage from '../OptionalImage';
import { ctaSection } from '../content';
import { getTelegramUrl, getWhatsAppUrl } from '../config';

const BIG_BTN =
  'inline-flex min-h-[56px] w-full items-center justify-center gap-2.5 rounded-2xl px-8 text-base font-semibold text-white transition motion-safe:active:scale-[0.98] sm:w-auto sm:text-lg';

export default function CtaSection() {
  const whatsapp = getWhatsAppUrl();
  const telegram = getTelegramUrl();

  return (
    <section>
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-24">
        <Reveal>
          <div className="relative overflow-hidden rounded-3xl border border-slate-200/60 bg-white px-6 py-16 text-center shadow-sm sm:px-12">
            {/* Пастельная подсветка внутри карточки */}
            <div aria-hidden className="pointer-events-none absolute inset-0">
              <div className="absolute -top-24 left-1/2 h-64 w-[560px] -translate-x-1/2 rounded-full bg-primary-200/50 blur-[100px]" />
              <div className="absolute -bottom-24 right-0 h-48 w-[360px] rounded-full bg-emerald-200/40 blur-[100px]" />
            </div>

            <div className="relative flex flex-col items-center gap-10 lg:flex-row lg:gap-12">
              <div className="min-w-0 flex-1">
                <h2 className="text-3xl font-extrabold tracking-tight text-slate-900 sm:text-5xl text-balance">
                  {ctaSection.title}
                </h2>
                <p className="mx-auto mt-4 max-w-md text-lg text-slate-600">{ctaSection.subtitle}</p>

                {/* Риск-реверс — снимаем страх решения */}
                <p className="mx-auto mt-4 flex max-w-lg items-start justify-center gap-2 text-sm leading-relaxed text-slate-600">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                  {ctaSection.riskReversal}
                </p>

                {whatsapp || telegram ? (
                  <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
                    {whatsapp && (
                      <a
                        href={whatsapp}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`${BIG_BTN} bg-emerald-500 shadow-lg shadow-emerald-500/25 hover:bg-emerald-400 active:bg-emerald-600`}
                      >
                        <MessageCircle className="h-5 w-5" />
                        {ctaSection.whatsappLabel}
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
                        {ctaSection.telegramLabel}
                      </a>
                    )}
                  </div>
                ) : (
                  <div className="mt-8">
                    <CtaButton />
                  </div>
                )}
                <p className="mt-4 text-sm text-slate-500">{ctaSection.note}</p>
              </div>
              {/* Слот под фото сервиса: появится вместе с файлом
                  /img/landing/workshop.webp — до этого блок остаётся
                  одноколоночным и центрированным, как раньше */}
              <OptionalImage
                src="/img/landing/workshop.webp"
                alt="Автосервис за работой с Autexa"
                width={800}
                height={600}
                className="w-full max-w-md shrink-0 rounded-2xl border border-slate-200/60 object-cover shadow-md lg:w-96"
              />
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
