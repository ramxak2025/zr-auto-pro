import { useRef } from 'react';
import { CheckCircle2, Crown, Minus, PhoneCall, Wrench } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import CarouselDots from './CarouselDots';
import Reveal from './Reveal';
import { roles } from '../content';
import type { RoleKey } from '../content';

/** Иконка и акцент для каждой персоны — презентация, тексты из content.ts. */
const ROLE_STYLE: Record<RoleKey, { icon: LucideIcon; iconCls: string; iconBg: string }> = {
  owner: { icon: Crown, iconCls: 'text-primary-600', iconBg: 'bg-primary-50' },
  // rose вместо violet: палитра лендинга сознательно без violet (анти-паттерн «AI purple»)
  admin: { icon: PhoneCall, iconCls: 'text-rose-600', iconBg: 'bg-rose-50' },
  master: { icon: Wrench, iconCls: 'text-amber-600', iconBg: 'bg-amber-50' },
};

/**
 * «Кому» — три персоны (владелец / администратор / мастер):
 * узнаваемые боли без продукта → что человек получает с Autexa.
 */
export default function Roles() {
  const scrollerRef = useRef<HTMLDivElement>(null);

  return (
    <section id="roles" className="scroll-mt-24 border-t border-slate-200/60">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-28">
        <Reveal className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-extrabold tracking-tight text-slate-900 sm:text-5xl text-balance">
            Кому подходит Autexa
          </h2>
          <p className="mt-4 text-lg text-slate-600">
            Каждый в сервисе видит своё — и у каждого своя причина открыть приложение.
          </p>
        </Reveal>

        {/* < md: горизонтальная snap-карусель (чистый CSS, без JS-слушателей) —
            карточка ~82vw + peek следующей как аффорданс свайпа; md+ — прежняя сетка.
            Reveal ОДИН на весь контейнер (как в Features): per-card Reveal рисовал
            peek-карточку с opacity:0 и fade+rise посреди горизонтального свайпа. */}
        <Reveal delay={0.05}>
          <div
            ref={scrollerRef}
            className="no-scrollbar -mx-4 mt-8 flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-px-4 px-4 pb-2 [overscroll-behavior-x:contain] md:mx-0 md:mt-14 md:grid md:grid-cols-3 md:overflow-visible md:px-0 md:pb-0"
          >
            {roles.map((role) => {
              const style = ROLE_STYLE[role.key];
              return (
                <div key={role.key} className="w-[82vw] max-w-md shrink-0 snap-start md:w-auto md:max-w-none">
                  <div className="flex h-full flex-col rounded-3xl border border-slate-200/60 bg-white p-6 shadow-sm transition-all duration-300 motion-safe:hover:-translate-y-0.5 hover:shadow-md motion-safe:active:scale-[0.98]">
                    <div className="flex items-center gap-3">
                      <span className={`inline-flex h-11 w-11 items-center justify-center rounded-2xl ${style.iconBg}`}>
                        <style.icon className={`h-5 w-5 ${style.iconCls}`} />
                      </span>
                      <h3 className="text-xl font-semibold text-slate-900">{role.title}</h3>
                    </div>

                    <p className="mt-5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Знакомо?</p>
                    <ul className="mt-2 space-y-2">
                      {role.pains.map((p) => (
                        <li key={p} className="flex items-start gap-2 text-sm leading-relaxed text-slate-500">
                          <Minus className="mt-0.5 h-4 w-4 shrink-0 text-slate-300" />
                          {/* мобиле — до 2 строк: карусель ниже, текст короче */}
                          <span className="line-clamp-2 md:line-clamp-none">{p}</span>
                        </li>
                      ))}
                    </ul>

                    <p className="mt-5 border-t border-slate-100 pt-4 text-[11px] font-semibold uppercase tracking-wider text-emerald-600">
                      С Autexa
                    </p>
                    <ul className="mt-2 space-y-2">
                      {role.gains.map((g, gi) => (
                        <li
                          key={g}
                          // на мобиле — только 3 главные выгоды; полный список с md+
                          className={`items-start gap-2 text-sm leading-relaxed text-slate-700 ${
                            gi >= 3 ? 'hidden md:flex' : 'flex'
                          }`}
                        >
                          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                          {g}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              );
            })}
          </div>
          {/* Точки-индикаторы карусели — только мобилка (md+ это сетка) */}
          <CarouselDots scrollerRef={scrollerRef} count={roles.length} itemLabel="Роль" className="mt-1 md:hidden" />
        </Reveal>
      </div>
    </section>
  );
}
