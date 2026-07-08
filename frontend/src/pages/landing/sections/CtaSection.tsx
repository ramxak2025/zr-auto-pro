import { Link } from 'react-router-dom';
import { ArrowRight, MessageCircle, Send } from 'lucide-react';
import Reveal from './Reveal';
import OptionalImage from '../OptionalImage';
import { ctaSection } from '../content';
import { getTelegramUrl, getWhatsAppUrl } from '../config';

const PRIMARY_BTN =
  'inline-flex min-h-[56px] w-full items-center justify-center gap-2.5 rounded-2xl bg-primary-600 px-8 text-base font-semibold text-white shadow-lg shadow-primary-600/25 transition hover:bg-primary-500 motion-safe:active:scale-[0.98] active:bg-primary-700 sm:w-auto sm:text-lg';

// Secondary «написать нам» — тот же тинт-паттерн, что у контактов в футере.
const CONTACT_BTN =
  'inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl px-6 text-sm font-semibold transition motion-safe:active:scale-[0.98] sm:w-auto';

export default function CtaSection() {
  const whatsapp = getWhatsAppUrl();
  const telegram = getTelegramUrl();

  return (
    <section>
      <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-24">
        <Reveal>
          <div className="relative overflow-hidden rounded-3xl border border-slate-200/60 bg-white px-6 py-12 text-center shadow-sm sm:px-12 sm:py-16">
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

                {/* Primary — self-service регистрация */}
                <div className="mt-8 flex justify-center">
                  <Link to="/register" className={PRIMARY_BTN}>
                    Начать бесплатно
                    <ArrowRight className="h-5 w-5" />
                  </Link>
                </div>
                <p className="mt-3 text-sm text-slate-500">{ctaSection.riskReversal}</p>

                {/* Secondary — живой контакт (перенос базы, вопросы) */}
                {(whatsapp || telegram) && (
                  <div className="mt-8 border-t border-slate-100 pt-6">
                    <p className="text-sm text-slate-500">Есть вопросы? Напишите — поможем перенести базу:</p>
                    <div className="mt-3 flex flex-col items-center justify-center gap-3 sm:flex-row">
                      {whatsapp && (
                        <a
                          href={whatsapp}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`${CONTACT_BTN} border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100`}
                        >
                          <MessageCircle className="h-4 w-4" />
                          {ctaSection.whatsappLabel}
                        </a>
                      )}
                      {telegram && (
                        <a
                          href={telegram}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`${CONTACT_BTN} border border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100`}
                        >
                          <Send className="h-4 w-4" />
                          {ctaSection.telegramLabel}
                        </a>
                      )}
                    </div>
                    <p className="mt-3 text-sm text-slate-500">{ctaSection.note}</p>
                  </div>
                )}
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
