import { ReactNode } from 'react';
import {
  CalendarClock,
  CalendarDays,
  Car,
  Mic,
  Package,
  Percent,
  Receipt,
  ShieldCheck,
  Star,
  TrendingUp,
  WifiOff,
} from 'lucide-react';
import Reveal from './Reveal';

/** Российский госномер — CSS-мокап настоящей плашки: А 123 ВС | 05 RUS + флаг. */
function PlateMock() {
  return (
    <div className="inline-flex shrink-0 items-stretch overflow-hidden rounded-md border-2 border-neutral-900 bg-white shadow-md">
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
    { label: 'Наличные', cls: 'bg-emerald-500/15 text-emerald-300' },
    { label: 'Карта', cls: 'bg-primary-500/15 text-primary-300' },
    { label: 'Смешанная', cls: 'bg-white/[0.06] text-white/60' },
    { label: 'Гарантия', cls: 'bg-white/[0.06] text-white/60' },
    { label: 'Рассрочка', cls: 'bg-amber-500/15 text-amber-300' },
  ];
  return (
    <div className="mt-6 rounded-2xl border border-white/[0.07] bg-[#0D0D0F] p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-white">Магомед</p>
          <p className="truncate text-xs text-white/45">Lada Priora · 2012</p>
        </div>
        <PlateMock />
      </div>
      <div className="mt-4 space-y-2 border-t border-white/[0.06] pt-3">
        {lines.map((l) => (
          <div key={l.name} className="flex items-center justify-between gap-3 text-sm">
            <span className="truncate text-white/70">{l.name}</span>
            <span className="shrink-0 font-medium text-white">{l.price}</span>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-between border-t border-white/[0.06] pt-3">
        <span className="text-xs text-white/45">Итого</span>
        <span className="text-lg font-bold text-white">5 450 ₽</span>
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
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary-600/20 ring-1 ring-primary-500/40">
        <Mic className="h-6 w-6 text-primary-400" />
      </div>
      <div className="flex items-end gap-1" aria-hidden>
        {[8, 18, 12, 26, 16, 30, 20, 12, 22, 10].map((h, i) => (
          <span key={i} className="w-1 rounded-full bg-primary-500/70" style={{ height: h }} />
        ))}
      </div>
      <div className="w-full rounded-xl border border-white/[0.06] bg-[#0D0D0F] p-3 text-xs text-white/60">
        «заменили передние колодки рекомендую поменять диски»
        <div className="mt-2 rounded-lg bg-primary-600/15 px-2.5 py-1.5 font-medium text-primary-300">
          Комментарий: Заменили передние колодки, рекомендована замена дисков
        </div>
      </div>
    </div>
  );
}

/** Мокап движения денег: стек-бар с разбивкой по способам оплаты. */
function CashFlowMock() {
  const legend = [
    { label: 'Наличные', dot: 'bg-emerald-400' },
    { label: 'Карта', dot: 'bg-primary-400' },
    { label: 'Рассрочка', dot: 'bg-amber-400' },
    { label: 'Гарантия', dot: 'bg-violet-400' },
  ];
  return (
    <div className="mt-4">
      <div className="flex h-3 overflow-hidden rounded-full" aria-hidden>
        <div className="bg-emerald-500/80" style={{ width: '38%' }} />
        <div className="bg-primary-500/80" style={{ width: '34%' }} />
        <div className="bg-amber-500/80" style={{ width: '18%' }} />
        <div className="bg-violet-500/80" style={{ width: '10%' }} />
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
        {legend.map((l) => (
          <span key={l.label} className="flex items-center gap-1.5 text-xs text-white/50">
            <span className={`h-2 w-2 rounded-full ${l.dot}`} />
            {l.label}
          </span>
        ))}
      </div>
    </div>
  );
}

interface Cell {
  className: string;
  icon: ReactNode;
  iconBg: string;
  title: string;
  text: string;
  mock?: ReactNode;
}

const CELLS: Cell[] = [
  {
    className: 'md:col-span-2 lg:col-span-6 lg:row-span-2',
    icon: <Receipt className="h-5 w-5 text-primary-400" />,
    iconBg: 'bg-primary-500/15',
    title: 'Касса и заказ-наряд',
    text: 'Чек за минуту: услуги, товары, клиент и его авто. Российский госномер — как настоящая плашка. Оплата наличными, картой, смешанной оплатой, по гарантии или в рассрочку.',
    mock: <CheckMock />,
  },
  {
    className: 'lg:col-span-3 lg:row-span-2',
    icon: <Mic className="h-5 w-5 text-primary-400" />,
    iconBg: 'bg-primary-500/15',
    title: 'Голосовой ввод',
    text: 'Надиктуйте комментарий к заказ-наряду — текст распознается и появится в чеке. Его можно поправить.',
    mock: <VoiceMock />,
  },
  {
    className: 'lg:col-span-3',
    icon: <WifiOff className="h-5 w-5 text-amber-400" />,
    iconBg: 'bg-amber-500/15',
    title: 'Работает без интернета',
    text: 'Чеки сохраняются офлайн и отправляются сами, когда связь вернётся.',
  },
  {
    className: 'md:col-span-2 lg:col-span-3',
    icon: <Package className="h-5 w-5 text-primary-400" />,
    iconBg: 'bg-primary-500/15',
    title: 'Склад',
    text: 'Остатки и категории с фото, дробные единицы — продавайте 0,5 м шланга. Импорт из Excel, инвентаризация.',
  },
  {
    className: 'md:col-span-2 lg:col-span-6',
    icon: <TrendingUp className="h-5 w-5 text-emerald-400" />,
    iconBg: 'bg-emerald-500/15',
    title: 'Движение денег',
    text: 'Оборот и разбивка — наличные, карта, гарантия, рассрочка — сходятся копейка в копейку. Видно, сколько наличных на руках у каждого мастера в конце дня.',
    mock: <CashFlowMock />,
  },
  {
    className: 'lg:col-span-3',
    icon: <CalendarClock className="h-5 w-5 text-amber-400" />,
    iconBg: 'bg-amber-500/15',
    title: 'Рассрочка',
    text: 'График платежей, напоминания клиентам, погашения наличными или картой.',
  },
  {
    className: 'lg:col-span-3',
    icon: <CalendarDays className="h-5 w-5 text-primary-400" />,
    iconBg: 'bg-primary-500/15',
    title: 'Расписание',
    text: 'Смены мастеров на месяц вперёд.',
  },
  {
    className: 'lg:col-span-3',
    icon: <Percent className="h-5 w-5 text-emerald-400" />,
    iconBg: 'bg-emerald-500/15',
    title: 'Зарплата',
    text: 'Проценты от выполненных работ считаются сами.',
  },
  {
    className: 'lg:col-span-3',
    icon: <Car className="h-5 w-5 text-primary-400" />,
    iconBg: 'bg-primary-500/15',
    title: 'Клиенты и авто',
    text: 'Вся история по машине, поиск по госномеру и телефону.',
  },
  {
    className: 'lg:col-span-3',
    icon: <ShieldCheck className="h-5 w-5 text-primary-400" />,
    iconBg: 'bg-primary-500/15',
    title: 'Роли и права',
    text: 'Владелец видит всё, мастер — только своё.',
  },
  {
    className: 'lg:col-span-3',
    icon: <Star className="h-5 w-5 text-amber-400" />,
    iconBg: 'bg-amber-500/15',
    title: 'Отзывы и записи',
    text: 'Онлайн-запись открывает кассу с уже подставленным клиентом. Сбор отзывов на карты.',
  },
];

export default function Features() {
  return (
    <section id="features" className="scroll-mt-24">
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
        <Reveal className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight text-white sm:text-5xl">Всё, что нужно сервису</h2>
          <p className="mt-4 text-lg text-white/55">
            От первого звонка клиента до зарплаты мастера — один инструмент вместо тетради, Excel и калькулятора.
          </p>
        </Reveal>

        <div className="mt-14 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-12 lg:auto-rows-[minmax(11rem,auto)]">
          {CELLS.map((cell, i) => (
            <Reveal key={cell.title} className={cell.className} delay={Math.min(i * 0.05, 0.3)}>
              <div className="group h-full rounded-3xl border border-white/[0.07] bg-[#141416] p-6 transition-all duration-300 hover:-translate-y-0.5 hover:border-white/[0.16] hover:bg-[#17171A]">
                <span className={`inline-flex h-10 w-10 items-center justify-center rounded-xl ${cell.iconBg}`}>
                  {cell.icon}
                </span>
                <h3 className="mt-4 text-lg font-semibold text-white">{cell.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-white/55">{cell.text}</p>
                {cell.mock}
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
