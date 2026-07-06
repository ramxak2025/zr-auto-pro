import { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, LayoutGrid, Mic } from 'lucide-react';
import Reveal from './Reveal';
import { features } from '../content';
import { DEFAULT_TINT, SECTION_ICONS, SECTION_TINTS } from '../icons';

/** Российский госномер — CSS-мокап настоящей плашки: А 123 ВС | 05 RUS + флаг. */
function PlateMock() {
  return (
    <div className="inline-flex shrink-0 items-stretch overflow-hidden rounded-md border-2 border-neutral-900 bg-white shadow-sm">
      <div className="px-2.5 py-1 text-base font-bold tracking-[0.12em] text-neutral-900">А 123 ВС</div>
      <div className="flex flex-col items-center justify-center border-l-2 border-neutral-900 px-1.5 py-0.5 leading-none">
        <span className="text-sm font-bold text-neutral-900">05</span>
        <span className="mt-0.5 flex items-center gap-0.5">
          <span className="text-[6px] font-bold text-neutral-900">RUS</span>
          <span className="flex h-[7px] w-3 flex-col overflow-hidden rounded-[1px] border border-neutral-300">
            <span className="flex-1 bg-white" />
            <span className="flex-1 bg-blue-600" />
            <span className="flex-1 bg-red-500" />
          </span>
        </span>
      </div>
    </div>
  );
}

/** Мокап чека внутри главной bento-ячейки «Касса». */
function CheckMock() {
  const lines = [
    { name: 'Замена масла ДВС', price: '1 200 ₽' },
    { name: 'Масло 5W-40 · 4 л', price: '3 400 ₽' },
    { name: 'Фильтр масляный', price: '850 ₽' },
  ];
  const payments = [
    { label: 'Наличные', cls: 'bg-emerald-50 text-emerald-700' },
    { label: 'Карта', cls: 'bg-primary-50 text-primary-700' },
    { label: 'Смешанная', cls: 'bg-slate-100 text-slate-600' },
    { label: 'Гарантия', cls: 'bg-slate-100 text-slate-600' },
    { label: 'Рассрочка', cls: 'bg-amber-50 text-amber-700' },
  ];
  return (
    <div className="mt-6 rounded-2xl border border-slate-200/70 bg-slate-50/70 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-900">Магомед</p>
          <p className="truncate text-xs text-slate-400">Lada Priora · 2012</p>
        </div>
        <PlateMock />
      </div>
      <div className="mt-4 space-y-2 border-t border-slate-200/70 pt-3">
        {lines.map((l) => (
          <div key={l.name} className="flex items-center justify-between gap-3 text-sm">
            <span className="truncate text-slate-600">{l.name}</span>
            <span className="shrink-0 font-medium text-slate-900">{l.price}</span>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-between border-t border-slate-200/70 pt-3">
        <span className="text-xs text-slate-400">Итого</span>
        <span className="text-lg font-bold text-slate-900">5 450 ₽</span>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {payments.map((p) => (
          <span key={p.label} className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${p.cls}`}>
            {p.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Мокап голосового ввода: волна + распознанный комментарий к заказ-наряду. */
function VoiceMock() {
  return (
    <div className="mt-6 flex flex-col items-center gap-4">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary-50 ring-1 ring-primary-200">
        <Mic className="h-6 w-6 text-primary-600" />
      </div>
      <div className="flex items-end gap-1" aria-hidden>
        {[8, 18, 12, 26, 16, 30, 20, 12, 22, 10].map((h, i) => (
          <span key={i} className="w-1 rounded-full bg-primary-400" style={{ height: h }} />
        ))}
      </div>
      <div className="w-full rounded-xl border border-slate-200/70 bg-slate-50/70 p-3 text-xs text-slate-500">
        «заменили передние колодки рекомендую поменять диски»
        <div className="mt-2 rounded-lg bg-primary-50 px-2.5 py-1.5 font-medium text-primary-700">
          Комментарий: Заменили передние колодки, рекомендована замена дисков
        </div>
      </div>
    </div>
  );
}

/** Мокап движения денег: стек-бар с разбивкой по способам оплаты. */
function CashFlowMock() {
  const legend = [
    { label: 'Наличные', dot: 'bg-emerald-500' },
    { label: 'Карта', dot: 'bg-primary-500' },
    { label: 'Рассрочка', dot: 'bg-amber-400' },
    { label: 'Гарантия', dot: 'bg-slate-400' },
  ];
  return (
    <div className="mt-4">
      <div className="flex h-3 overflow-hidden rounded-full" aria-hidden>
        <div className="bg-emerald-500" style={{ width: '38%' }} />
        <div className="bg-primary-500" style={{ width: '34%' }} />
        <div className="bg-amber-400" style={{ width: '18%' }} />
        {/* Гарантия — «неденежный» статус: нейтральный slate (палитра лендинга без violet) */}
        <div className="bg-slate-400" style={{ width: '10%' }} />
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
        {legend.map((l) => (
          <span key={l.label} className="flex items-center gap-1.5 text-xs text-slate-500">
            <span className={`h-2 w-2 rounded-full ${l.dot}`} />
            {l.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * Порядок и раскладка bento-сетки (lg — 12 колонок). Порядок отличается от
 * content.features только ради упаковки сетки без дыр; тексты — из content.
 */
const LAYOUT: { slug: string; className: string }[] = [
  { slug: 'kassa', className: 'md:col-span-2 lg:col-span-6 lg:row-span-2' },
  { slug: 'golos', className: 'md:col-span-2 lg:col-span-3 lg:row-span-2' },
  { slug: 'zhurnal', className: 'lg:col-span-3' },
  { slug: 'sklad', className: 'lg:col-span-3' },
  { slug: 'dengi', className: 'md:col-span-2 lg:col-span-6' },
  { slug: 'otchety', className: 'lg:col-span-3' },
  { slug: 'rassrochka', className: 'lg:col-span-3' },
  { slug: 'klienty', className: 'lg:col-span-3' },
  { slug: 'zapisi', className: 'lg:col-span-3' },
  { slug: 'raspisanie', className: 'lg:col-span-3' },
  { slug: 'zarplata', className: 'lg:col-span-3' },
  { slug: 'postavshchiki', className: 'lg:col-span-4' },
  { slug: 'sotrudniki', className: 'lg:col-span-4' },
  { slug: 'marketing', className: 'lg:col-span-4' },
  { slug: 'nadezhnost', className: 'lg:col-span-6' },
  { slug: 'prochee', className: 'md:col-span-2 lg:col-span-6' },
];

/** CSS-мокапы для «больших» ячеек. */
const MOCKS: Record<string, ReactNode> = {
  kassa: <CheckMock />,
  golos: <VoiceMock />,
  dengi: <CashFlowMock />,
};

/**
 * Мобильная карусель «Главное»: 6 продающих разделов с реальными фото
 * из public/img/landing/f-<slug>.webp (1200×900). Порядок — воронка ценности:
 * касса → деньги → склад → голос → зарплата → рассрочка.
 */
const MOBILE_HIGHLIGHTS = ['kassa', 'dengi', 'sklad', 'golos', 'zarplata', 'rassrochka'];

export default function Features() {
  const bySlug = new Map(features.map((f) => [f.slug, f]));

  return (
    <section id="features" className="scroll-mt-24 border-t border-slate-200/60">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-28">
        <Reveal className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-extrabold tracking-tight text-slate-900 sm:text-5xl text-balance">
            Всё, что нужно сервису
          </h2>
          <p className="mt-4 text-lg text-slate-600">
            От первого звонка клиента до зарплаты мастера — один инструмент вместо тетради, Excel и калькулятора.
          </p>
        </Reveal>

        {/* < md: вместо 16 стековых карточек — фото-карусель «Главное» (6 rich-карточек)
            + компактная сетка чипов «Все возможности». Скролл страницы короче в разы,
            фото продают вместо простыней текста. md+ — прежний bento без изменений. */}
        <div className="md:hidden">
          <Reveal delay={0.05}>
            <p className="mt-8 text-xs font-semibold uppercase tracking-wider text-slate-500">Главное</p>
            {/* Чистый CSS scroll-snap: карточка ~78vw + peek следующей, без JS-слушателей */}
            <div className="no-scrollbar -mx-4 mt-3 flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-px-4 px-4 pb-2 [overscroll-behavior-x:contain]">
              {MOBILE_HIGHLIGHTS.map((slug) => {
                const section = bySlug.get(slug);
                if (!section) return null;
                const Icon = SECTION_ICONS[section.icon] ?? LayoutGrid;
                const tint = SECTION_TINTS[slug] ?? DEFAULT_TINT;
                return (
                  <Link
                    key={slug}
                    to={`/f/${slug}`}
                    className="flex w-[78vw] max-w-xs shrink-0 snap-start flex-col overflow-hidden rounded-3xl border border-slate-200/60 bg-white shadow-sm transition motion-safe:active:scale-[0.98]"
                  >
                    {/* alt="" — заголовок карточки уже называет раздел; width/height
                        резервируют место (нет CLS). Все фото lazy: (а) eager-<img>
                        внутри display:none (md+) всё равно скачивается — lazy без
                        layout-бокса нет; (б) секция ~2 экрана ниже фолда, eager лишь
                        конкурировал бы с критическим путём на LTE; префетч-дистанция
                        браузера догружает фото задолго до доскролла. */}
                    <img
                      src={`/img/landing/f-${slug}.webp`}
                      alt=""
                      width={1200}
                      height={900}
                      loading="lazy"
                      decoding="async"
                      className="aspect-[4/3] w-full rounded-t-3xl object-cover"
                    />
                    <span className="flex flex-1 flex-col p-4">
                      <span className="flex items-center gap-2.5">
                        <span
                          className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${tint.chip}`}
                        >
                          <Icon className={`h-4 w-4 ${tint.icon}`} />
                        </span>
                        <span className="text-base font-semibold text-slate-900">{section.title}</span>
                      </span>
                      <span className="mt-2 line-clamp-2 text-sm leading-relaxed text-slate-600">
                        {section.tagline}
                      </span>
                      <span className="mt-auto inline-flex items-center gap-1 pt-3 text-sm font-semibold text-primary-600">
                        Подробнее
                        <ArrowRight className="h-4 w-4" />
                      </span>
                    </span>
                  </Link>
                );
              })}
            </div>
          </Reveal>

          <Reveal delay={0.05}>
            <p className="mt-8 text-xs font-semibold uppercase tracking-wider text-slate-500">Все возможности</p>
            <div className="mt-3 grid grid-cols-2 gap-2.5">
              {features.map((f) => {
                const Icon = SECTION_ICONS[f.icon] ?? LayoutGrid;
                const tint = SECTION_TINTS[f.slug] ?? DEFAULT_TINT;
                return (
                  <Link
                    key={f.slug}
                    to={`/f/${f.slug}`}
                    className="flex min-h-[56px] items-center gap-2.5 rounded-2xl border border-slate-200/60 bg-white px-3 py-2 shadow-sm transition motion-safe:active:scale-[0.98]"
                  >
                    <span
                      className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${tint.chip}`}
                    >
                      <Icon className={`h-[18px] w-[18px] ${tint.icon}`} />
                    </span>
                    <span className="line-clamp-2 min-w-0 text-[13px] font-medium leading-snug text-slate-800">
                      {f.title}
                    </span>
                  </Link>
                );
              })}
            </div>
          </Reveal>
        </div>

        <div className="mt-14 hidden gap-4 md:grid md:grid-cols-2 lg:auto-rows-[minmax(11rem,auto)] lg:grid-cols-12">
          {LAYOUT.map(({ slug, className }, i) => {
            const section = bySlug.get(slug);
            if (!section) return null;
            const Icon = SECTION_ICONS[section.icon] ?? LayoutGrid;
            const tint = SECTION_TINTS[slug] ?? DEFAULT_TINT;
            return (
              <Reveal key={slug} className={className} delay={Math.min(i * 0.04, 0.28)}>
                <Link
                  to={`/f/${slug}`}
                  className="group relative flex h-full flex-col overflow-hidden rounded-3xl border border-slate-200/60 bg-white p-6 shadow-sm transition-all duration-300 motion-safe:hover:-translate-y-0.5 hover:shadow-md motion-safe:active:scale-[0.98]"
                >
                  {/* Карточкам без мокапа — большая полупрозрачная иконка раздела
                      в правом верхнем углу: глубина без шума */}
                  {!MOCKS[slug] && (
                    <Icon
                      aria-hidden
                      strokeWidth={1.5}
                      className={`pointer-events-none absolute -right-4 -top-4 h-24 w-24 rotate-6 ${tint.icon} opacity-[0.12]`}
                    />
                  )}
                  <span
                    className={`relative inline-flex h-10 w-10 items-center justify-center rounded-xl ${tint.chip}`}
                  >
                    <Icon className={`h-5 w-5 ${tint.icon}`} />
                  </span>
                  <h3 className="mt-4 text-lg font-semibold text-slate-900">{section.title}</h3>
                  <p className="mt-1 text-sm font-medium leading-relaxed text-slate-700">{section.tagline}</p>
                  <p className="mt-1.5 text-sm leading-relaxed text-slate-500">{section.summary}</p>
                  {MOCKS[slug]}
                  <span className="mt-auto inline-flex items-center gap-1 pt-4 text-sm font-semibold text-primary-600 transition-colors group-hover:text-primary-700">
                    Подробнее
                    <ArrowRight className="h-4 w-4 transition-transform duration-200 motion-safe:group-hover:translate-x-0.5" />
                  </span>
                </Link>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}
