import { Banknote, CheckCircle2, TrendingUp } from 'lucide-react';
import Reveal from './Reveal';
import CtaButton from './CtaButton';

/** CSS-мокап телефона с мини-дашбордом — без единой картинки. */
function PhoneMock() {
  return (
    <div className="relative mx-auto w-[280px]">
      {/* Плавающий чип поверх телефона */}
      <div className="absolute -left-6 top-24 z-10 hidden items-center gap-2 rounded-2xl border border-white/10 bg-[#17171A]/95 px-3.5 py-2.5 shadow-xl shadow-black/40 backdrop-blur sm:flex">
        <CheckCircle2 className="h-4 w-4 text-emerald-400" />
        <div className="text-left">
          <p className="text-xs font-semibold text-white">Чек №214 оплачен</p>
          <p className="text-[11px] text-white/45">Карта · 5 450 ₽</p>
        </div>
      </div>

      <div className="rounded-[2.75rem] border border-white/10 bg-[#141416] p-3 shadow-2xl shadow-primary-900/30">
        <div className="overflow-hidden rounded-[2.25rem] border border-white/[0.06] bg-[#0D0D0F] px-4 pb-7 pt-3">
          {/* Dynamic Island */}
          <div className="mx-auto mb-5 h-6 w-24 rounded-full bg-black ring-1 ring-white/10" />

          <p className="text-xs text-white/45">Сегодня</p>
          <p className="mt-0.5 text-3xl font-bold tracking-tight text-white">48 250 ₽</p>

          {/* Карточка «Касса сегодня» */}
          <div className="mt-4 rounded-2xl border border-white/[0.06] bg-[#141416] p-3.5">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/15">
                <Banknote className="h-4 w-4 text-emerald-400" />
              </span>
              <p className="text-xs font-medium text-white/70">Касса сегодня</p>
            </div>
            <div className="mt-3 space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-white/45">Наличные</span>
                <span className="font-semibold text-white">21 800 ₽</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/45">Карта</span>
                <span className="font-semibold text-white">26 450 ₽</span>
              </div>
            </div>
          </div>

          {/* Карточка «Оборот» с мини-графиком */}
          <div className="mt-3 rounded-2xl border border-white/[0.06] bg-[#141416] p-3.5">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary-500/15">
                <TrendingUp className="h-4 w-4 text-primary-400" />
              </span>
              <p className="text-xs font-medium text-white/70">Оборот за неделю</p>
            </div>
            <div className="mt-3 flex h-14 items-end gap-1.5" aria-hidden>
              {[38, 52, 30, 64, 46, 78, 58].map((h, i) => (
                <span
                  key={i}
                  className={`flex-1 rounded-t-md ${i === 5 ? 'bg-primary-500' : 'bg-primary-500/30'}`}
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

export default function Hero() {
  return (
    <section className="relative overflow-hidden">
      {/* Gradient mesh — размытые радиальные блобы */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -top-40 left-1/2 h-[480px] w-[720px] -translate-x-1/2 rounded-full bg-primary-600/20 blur-[130px]" />
        <div className="absolute -left-40 top-48 h-[360px] w-[360px] rounded-full bg-primary-400/10 blur-[110px]" />
        <div className="absolute -right-32 top-72 h-[320px] w-[320px] rounded-full bg-amber-500/[0.07] blur-[110px]" />
      </div>

      <div className="relative mx-auto grid max-w-6xl items-center gap-14 px-4 pb-20 pt-16 sm:px-6 sm:pt-24 lg:grid-cols-[1.15fr_0.85fr] lg:pb-28">
        <Reveal>
          <div className="text-center lg:text-left">
            <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-1.5 text-xs font-medium text-white/60">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              Для автосервисов России
            </span>

            <h1 className="mt-6 text-[clamp(40px,7vw,72px)] font-bold leading-[1.04] tracking-tight text-white">
              Автосервис под контролем.{' '}
              <span className="bg-gradient-to-r from-primary-400 to-primary-600 bg-clip-text text-transparent">
                С телефона.
              </span>
            </h1>

            <p className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-white/60 lg:mx-0">
              Autexa — касса, склад, зарплата и клиенты в одном приложении. Работает на iPhone, Android и в браузере —
              даже когда интернет подводит.
            </p>

            <div className="mt-9 flex flex-col items-center gap-3 sm:flex-row sm:justify-center lg:justify-start">
              <CtaButton className="w-full sm:w-auto" />
              <a
                href="#features"
                className="inline-flex min-h-[52px] w-full items-center justify-center rounded-2xl border border-white/10 px-8 text-base font-semibold text-white/80 transition-colors hover:border-white/25 hover:text-white sm:w-auto"
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
