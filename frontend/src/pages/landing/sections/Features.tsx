import { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, LayoutGrid, Mic } from 'lucide-react';
import Reveal from './Reveal';
import { features } from '../content';
import { SECTION_ICONS } from '../icons';

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
    { label: 'Гарантия', dot: 'bg-violet-400' },
  ];
  return (
    <div className="mt-4">
      <div className="flex h-3 overflow-hidden rounded-full" aria-hidden>
        <div className="bg-emerald-500" style={{ width: '38%' }} />
        <div className="bg-primary-500" style={{ width: '34%' }} />
        <div className="bg-amber-400" style={{ width: '18%' }} />
        <div className="bg-violet-400" style={{ width: '10%' }} />
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

/** Акцент иконки: emerald — деньги, amber — рассрочка, остальное — primary. */
const ACCENTS: Record<string, { icon: string; bg: string }> = {
  dengi: { icon: 'text-emerald-600', bg: 'bg-emerald-50' },
  zarplata: { icon: 'text-emerald-600', bg: 'bg-emerald-50' },
  otchety: { icon: 'text-emerald-600', bg: 'bg-emerald-50' },
  rassrochka: { icon: 'text-amber-600', bg: 'bg-amber-50' },
};
const DEFAULT_ACCENT = { icon: 'text-primary-600', bg: 'bg-primary-50' };

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

export default function Features() {
  const bySlug = new Map(features.map((f) => [f.slug, f]));

  return (
    <section id="features" className="scroll-mt-24 border-t border-slate-200/60">
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
        <Reveal className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-5xl">Всё, что нужно сервису</h2>
          <p className="mt-4 text-lg text-slate-600">
            От первого звонка клиента до зарплаты мастера — один инструмент вместо тетради, Excel и калькулятора.
          </p>
        </Reveal>

        <div className="mt-14 grid grid-cols-1 gap-4 md:grid-cols-2 lg:auto-rows-[minmax(11rem,auto)] lg:grid-cols-12">
          {LAYOUT.map(({ slug, className }, i) => {
            const section = bySlug.get(slug);
            if (!section) return null;
            const Icon = SECTION_ICONS[section.icon] ?? LayoutGrid;
            const accent = ACCENTS[slug] ?? DEFAULT_ACCENT;
            return (
              <Reveal key={slug} className={className} delay={Math.min(i * 0.05, 0.3)}>
                <Link
                  to={`/f/${slug}`}
                  className="group flex h-full flex-col rounded-3xl border border-slate-200/60 bg-white p-6 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md"
                >
                  <span className={`inline-flex h-10 w-10 items-center justify-center rounded-xl ${accent.bg}`}>
                    <Icon className={`h-5 w-5 ${accent.icon}`} />
                  </span>
                  <h3 className="mt-4 text-lg font-semibold text-slate-900">{section.title}</h3>
                  <p className="mt-1 text-sm font-medium leading-relaxed text-slate-700">{section.tagline}</p>
                  <p className="mt-1.5 text-sm leading-relaxed text-slate-500">{section.summary}</p>
                  {MOCKS[slug]}
                  <span className="mt-auto inline-flex items-center gap-1 pt-4 text-sm font-semibold text-primary-600 transition-colors group-hover:text-primary-700">
                    Подробнее
                    <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
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
