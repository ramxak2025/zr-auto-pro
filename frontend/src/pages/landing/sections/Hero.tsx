import { Banknote, CheckCircle2, TrendingUp } from 'lucide-react';
import Reveal from './Reveal';
import CtaButton from './CtaButton';
import { hero } from '../content';

/** CSS-мокап телефона с мини-дашбордом — без единой картинки, светлый UI. */
function PhoneMock() {
  return (
    <div className="relative mx-auto w-[280px]">
      {/* Плавающий чип поверх телефона */}
      <div className="absolute -left-6 top-24 z-10 hidden items-center gap-2 rounded-2xl border border-slate-200/70 bg-white/95 px-3.5 py-2.5 shadow-xl shadow-slate-900/10 backdrop-blur sm:flex">
        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
        <div className="text-left">
          <p className="text-xs font-semibold text-slate-900">Чек №214 оплачен</p>
          <p className="text-[11px] text-slate-400">Карта · 5 450 ₽</p>
        </div>
      </div>

      <div className="rounded-[2.75rem] border border-slate-200 bg-white p-3 shadow-2xl shadow-slate-900/10">
        <div className="overflow-hidden rounded-[2.25rem] border border-slate-100 bg-[#F6F8FB] px-4 pb-7 pt-3">
          {/* Dynamic Island */}
          <div className="mx-auto mb-5 h-6 w-24 rounded-full bg-slate-900" />

          <p className="text-xs text-slate-400">Сегодня</p>
          <p className="mt-0.5 text-3xl font-bold tracking-tight text-slate-900">48 250 ₽</p>

          {/* Карточка «Касса сегодня» */}
          <div className="mt-4 rounded-2xl border border-slate-200/70 bg-white p-3.5 shadow-sm">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-50">
                <Banknote className="h-4 w-4 text-emerald-600" />
              </span>
              <p className="text-xs font-medium text-slate-600">Касса сегодня</p>
            </div>
            <div className="mt-3 space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-400">Наличные</span>
                <span className="font-semibold text-slate-900">21 800 ₽</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Карта</span>
                <span className="font-semibold text-slate-900">26 450 ₽</span>
              </div>
            </div>
          </div>

          {/* Карточка «Оборот» с мини-графиком */}
          <div className="mt-3 rounded-2xl border border-slate-200/70 bg-white p-3.5 shadow-sm">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary-50">
                <TrendingUp className="h-4 w-4 text-primary-600" />
              </span>
              <p className="text-xs font-medium text-slate-600">Оборот за неделю</p>
            </div>
            <div className="mt-3 flex h-14 items-end gap-1.5" aria-hidden>
              {[38, 52, 30, 64, 46, 78, 58].map((h, i) => (
                <span
                  key={i}
                  className={`flex-1 rounded-t-md ${i === 5 ? 'bg-primary-500' : 'bg-primary-200'}`}
                  style={{ height: `${h}%` }}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Заголовок из content: последнее предложение — акцентным градиентом. */
function splitTitle(title: string): { head: string; tail: string } {
  const idx = title.lastIndexOf('. ');
  if (idx === -1) return { head: title, tail: '' };
  return { head: title.slice(0, idx + 1), tail: title.slice(idx + 2) };
}

export default function Hero() {
  const { head, tail } = splitTitle(hero.title);

  return (
    <section className="relative overflow-hidden">
      {/* Пастельный gradient mesh — размытые радиальные блобы на светлом */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -top-40 left-1/2 h-[480px] w-[720px] -translate-x-1/2 rounded-full bg-primary-300/30 blur-[130px]" />
        <div className="absolute -left-40 top-48 h-[360px] w-[360px] rounded-full bg-violet-300/25 blur-[110px]" />
        <div className="absolute -right-32 top-72 h-[320px] w-[320px] rounded-full bg-amber-200/40 blur-[110px]" />
      </div>

      <div className="relative mx-auto grid max-w-6xl items-center gap-14 px-4 pb-20 pt-16 sm:px-6 sm:pt-24 lg:grid-cols-[1.15fr_0.85fr] lg:pb-28">
        <Reveal>
          <div className="text-center lg:text-left">
            <span className="inline-flex items-center gap-2 rounded-full border border-slate-200/80 bg-white px-4 py-1.5 text-xs font-medium text-slate-600 shadow-sm">
              <img src="/logo-icon.png" alt="" width={16} height={16} decoding="async" className="h-4 w-4 rounded" />
              {hero.badge}
            </span>

            <h1 className="mt-6 text-[clamp(40px,7vw,72px)] font-bold leading-[1.04] tracking-tight text-slate-900">
              {head}
              {tail && (
                <>
                  {' '}
                  <span className="bg-gradient-to-r from-primary-500 to-primary-700 bg-clip-text text-transparent">
                    {tail}
                  </span>
                </>
              )}
            </h1>

            <p className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-slate-600 lg:mx-0">{hero.subtitle}</p>

            <ul className="mx-auto mt-6 max-w-xl space-y-2.5 text-left lg:mx-0">
              {hero.bullets.map((b) => (
                <li key={b} className="flex items-start gap-2.5 text-[15px] leading-relaxed text-slate-700">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" />
                  {b}
                </li>
              ))}
            </ul>

            <div className="mt-9 flex flex-col items-center gap-3 sm:flex-row sm:justify-center lg:justify-start">
              <CtaButton className="w-full sm:w-auto" />
              <a
                href="#features"
                className="inline-flex min-h-[52px] w-full items-center justify-center rounded-2xl border border-slate-200 bg-white px-8 text-base font-semibold text-slate-700 shadow-sm transition-colors hover:border-slate-300 hover:text-slate-900 sm:w-auto"
              >
                Смотреть возможности
              </a>
            </div>
          </div>
        </Reveal>

        <Reveal delay={0.15}>
          <PhoneMock />
        </Reveal>
      </div>
    </section>
  );
}
