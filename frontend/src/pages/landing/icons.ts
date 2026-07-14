import {
  BarChart3,
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  ClipboardList,
  LayoutGrid,
  Megaphone,
  Mic,
  Package,
  Percent,
  Receipt,
  ShieldCheck,
  TrendingUp,
  Truck,
  UserCog,
  Users,
  Wallet,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/**
 * Единый словарь иконок разделов лендинга по имени из content.ts.
 * Используется и в bento-сетке (Features), и на странице раздела
 * (FeatureDetailPage) — новый раздел достаточно добавить здесь один раз.
 * Промах по имени закрывается fallback'ом `?? LayoutGrid` на месте вызова.
 */
export const SECTION_ICONS: Record<string, LucideIcon> = {
  Receipt,
  ClipboardList,
  Package,
  Users,
  CalendarCheck,
  CalendarDays,
  Percent,
  CalendarClock,
  Wallet,
  TrendingUp,
  BarChart3,
  Truck,
  UserCog,
  Megaphone,
  Mic,
  ShieldCheck,
  LayoutGrid,
};

export interface SectionTint {
  /** пастельный фон чипа иконки */
  chip: string;
  /** насыщенный цвет иконки (он же — тон декоративной иконки-подложки) */
  icon: string;
}

/**
 * Свой оттенок на раздел: пастельный чип + насыщенная иконка.
 * Раскидано с оглядкой на соседство в bento-сетке (Features.LAYOUT), чтобы
 * одинаковые оттенки не стояли рядом. Violet/purple не используем сознательно
 * (анти-паттерн «AI purple»). Cyan схлопнут в sky (на чипе 20px неразличимы,
 * итого 8 семейств); teal оставлен — teal→emerald поставил бы klienty впритык
 * под dengi тем же цветом в lg-bento. Промах по slug → DEFAULT_TINT на месте вызова.
 */
export const SECTION_TINTS: Record<string, SectionTint> = {
  kassa: { chip: 'bg-sky-100', icon: 'text-sky-600' },
  golos: { chip: 'bg-rose-100', icon: 'text-rose-600' },
  zhurnal: { chip: 'bg-indigo-100', icon: 'text-indigo-600' },
  // amber-700: amber-600 на amber-100 давал 2.86:1 — ниже порога 3:1 для графики (WCAG)
  sklad: { chip: 'bg-amber-100', icon: 'text-amber-700' },
  dengi: { chip: 'bg-emerald-100', icon: 'text-emerald-600' },
  // pribyl соседствует с dengi (emerald) в bento и в группе «Деньги» —
  // берём indigo, чтобы флагман прибыли не сливался с движением денег.
  pribyl: { chip: 'bg-indigo-100', icon: 'text-indigo-600' },
  otchety: { chip: 'bg-sky-100', icon: 'text-sky-600' },
  rassrochka: { chip: 'bg-orange-100', icon: 'text-orange-600' },
  klienty: { chip: 'bg-teal-100', icon: 'text-teal-600' },
  zapisi: { chip: 'bg-sky-100', icon: 'text-sky-600' },
  raspisanie: { chip: 'bg-indigo-100', icon: 'text-indigo-600' },
  zarplata: { chip: 'bg-emerald-100', icon: 'text-emerald-600' },
  postavshchiki: { chip: 'bg-amber-100', icon: 'text-amber-700' },
  sotrudniki: { chip: 'bg-rose-100', icon: 'text-rose-600' },
  marketing: { chip: 'bg-sky-100', icon: 'text-sky-600' },
  nadezhnost: { chip: 'bg-teal-100', icon: 'text-teal-600' },
  prochee: { chip: 'bg-slate-100', icon: 'text-slate-600' },
};

export const DEFAULT_TINT: SectionTint = { chip: 'bg-primary-50', icon: 'text-primary-600' };

export interface SectionGroup {
  /** Заголовок направления в каталогах разделов. */
  title: string;
  /** Слаги разделов из content.features в порядке показа внутри группы. */
  slugs: string[];
}

/**
 * Единственный источник группировки 17 разделов по направлениям бизнеса.
 * Используется в шторке «Разделы» (SectionsSheet), сетке «Все возможности»
 * (Features, mobile) и сетке категорий на /voprosy — правится в одном месте.
 */
export const SECTION_GROUPS: SectionGroup[] = [
  { title: 'Работа сервиса', slugs: ['kassa', 'zhurnal', 'sklad', 'postavshchiki'] },
  { title: 'Деньги', slugs: ['pribyl', 'dengi', 'zarplata', 'rassrochka', 'otchety'] },
  { title: 'Клиенты', slugs: ['klienty', 'zapisi', 'marketing'] },
  { title: 'Команда', slugs: ['sotrudniki', 'raspisanie', 'golos'] },
  { title: 'Система', slugs: ['nadezhnost', 'prochee'] },
];

/**
 * Раскладывает элементы с `slug` по SECTION_GROUPS. Разделы, не попавшие
 * ни в одну группу (новый slug в content.ts без обновления SECTION_GROUPS),
 * не теряются — уходят в хвостовую группу «Другое», чтобы каталог никогда
 * не «съедал» раздел молча.
 */
export function groupBySections<T extends { slug: string }>(items: T[]): { title: string; items: T[] }[] {
  const bySlug = new Map(items.map((it) => [it.slug, it]));
  const used = new Set<string>();
  const groups = SECTION_GROUPS.map((g) => ({
    title: g.title,
    items: g.slugs.flatMap((slug) => {
      const it = bySlug.get(slug);
      // used.has: страж от слага, случайно попавшего в две группы, —
      // карточка рендерится один раз, в первой встретившейся группе.
      if (!it || used.has(slug)) return [];
      used.add(slug);
      return [it];
    }),
  })).filter((g) => g.items.length > 0);
  const leftovers = items.filter((it) => !used.has(it.slug));
  if (leftovers.length > 0) groups.push({ title: 'Другое', items: leftovers });
  return groups;
}
