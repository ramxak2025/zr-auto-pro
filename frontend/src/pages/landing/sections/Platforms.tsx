import { Apple, MessageCircle, Monitor, Play, Smartphone } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import Reveal from './Reveal';
import { storeSection } from '../content';
import { getWhatsAppUrl, WHATSAPP_INSTALL_MESSAGE } from '../config';

/** Иконки lucide по имени из content.ts (официальные ассеты сторов не используем). */
const ICONS: Record<string, LucideIcon> = { Apple, Play, Smartphone, Monitor };

export default function Platforms() {
  const installUrl = getWhatsAppUrl(WHATSAPP_INSTALL_MESSAGE);
  return (
    <section className="border-t border-slate-200/60">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-28">
        <Reveal className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-extrabold tracking-tight text-slate-900 sm:text-5xl">{storeSection.title}</h2>
          <p className="mt-4 text-lg text-slate-600">{storeSection.subtitle}</p>
        </Reveal>

        {/* < md: одна компактная карточка вместо вертикальной стопки —
            «iPhone · Android · Браузер» в строку + бейджи сторов + CTA установки */}
        <Reveal className="mt-8 md:hidden">
          <div className="rounded-3xl border border-slate-200/60 bg-white p-5 shadow-sm">
            <p className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
              {storeSection.platforms.map((p) => {
                const Icon = ICONS[p.icon] ?? Smartphone;
                return (
                  <span key={p.title} className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
                    <Icon className="h-5 w-5 text-slate-600" aria-hidden />
                    {p.title}
                  </span>
                );
              })}
            </p>
            <div className="mt-4 grid grid-cols-2 gap-2.5">
              {storeSection.badges.map((b) => {
                const Icon = ICONS[b.icon] ?? Smartphone;
                return (
                  <div
                    key={b.store}
                    aria-disabled="true"
                    className="flex min-h-[48px] select-none items-center justify-center gap-1.5 rounded-xl border border-slate-200/60 bg-white px-2"
                  >
                    <Icon className="h-5 w-5 shrink-0 text-slate-700" />
                    <span className="text-[13px] font-semibold text-slate-900">{b.store}</span>
                    <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                      Скоро
                    </span>
                  </div>
                );
              })}
            </div>
            {installUrl && (
              <a
                href={installUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-5 text-sm font-semibold text-white shadow-lg shadow-emerald-500/25 transition motion-safe:active:scale-[0.98] active:bg-emerald-600"
              >
                <MessageCircle className="h-5 w-5" />
                {storeSection.supportInstallLabel}
              </a>
            )}
          </div>
        </Reveal>

        <div className="mt-14 hidden grid-cols-1 gap-4 sm:grid-cols-3 md:grid">
          {storeSection.platforms.map((p, i) => {
            const Icon = ICONS[p.icon] ?? Smartphone;
            return (
              <Reveal key={p.title} delay={Math.min(i * 0.07, 0.21)}>
                <div className="h-full rounded-3xl border border-slate-200/60 bg-white p-6 text-center shadow-sm transition-all duration-300 motion-safe:hover:-translate-y-0.5 hover:shadow-md">
                  <span className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100">
                    <Icon className="h-6 w-6 text-slate-700" />
                  </span>
                  <h3 className="mt-4 text-lg font-semibold text-slate-900">{p.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-slate-500">{p.text}</p>
                </div>
              </Reveal>
            );
          })}
        </div>

        {/* Бейджи сторов («Скоро») + живая установка через поддержку (md+;
            на мобиле всё это уже внутри компактной карточки выше) */}
        <Reveal delay={0.1}>
          <div className="mt-12 hidden flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center md:flex">
            {storeSection.badges.map((b) => {
              const Icon = ICONS[b.icon] ?? Smartphone;
              return (
                <div
                  key={b.store}
                  aria-disabled="true"
                  className="flex min-h-[64px] cursor-default select-none items-center gap-3.5 rounded-2xl border border-slate-200/60 bg-white px-5 py-3 shadow-sm"
                >
                  <Icon className="h-7 w-7 shrink-0 text-slate-700" />
                  <div className="min-w-0 text-left">
                    <div className="flex items-center gap-2">
                      <span className="text-base font-semibold leading-tight text-slate-900">{b.store}</span>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                        Скоро
                      </span>
                    </div>
                    <p className="mt-0.5 text-[11px] leading-tight text-slate-500">{b.note}</p>
                  </div>
                </div>
              );
            })}

            {installUrl && (
              <a
                href={installUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-[64px] items-center justify-center gap-2.5 rounded-2xl bg-emerald-500 px-6 text-base font-semibold text-white shadow-lg shadow-emerald-500/25 transition hover:bg-emerald-400 motion-safe:active:scale-[0.98] active:bg-emerald-600"
              >
                <MessageCircle className="h-5 w-5" />
                {storeSection.supportInstallLabel}
              </a>
            )}
          </div>
        </Reveal>

        <Reveal delay={0.15}>
          <p className="mt-6 text-center text-sm text-slate-500">{storeSection.syncNote}</p>
        </Reveal>
      </div>
    </section>
  );
}
