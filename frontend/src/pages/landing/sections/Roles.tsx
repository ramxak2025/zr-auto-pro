import { CheckCircle2, Crown, Minus, PhoneCall, Wrench } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import Reveal from './Reveal';
import { roles } from '../content';
import type { RoleKey } from '../content';

/** Иконка и акцент для каждой персоны — презентация, тексты из content.ts. */
const ROLE_STYLE: Record<RoleKey, { icon: LucideIcon; iconCls: string; iconBg: string }> = {
  owner: { icon: Crown, iconCls: 'text-primary-600', iconBg: 'bg-primary-50' },
  admin: { icon: PhoneCall, iconCls: 'text-violet-600', iconBg: 'bg-violet-50' },
  master: { icon: Wrench, iconCls: 'text-amber-600', iconBg: 'bg-amber-50' },
};

/**
 * «Кому» — три персоны (владелец / администратор / мастер):
 * узнаваемые боли без продукта → что человек получает с Autexa.
 */
export default function Roles() {
  return (
    <section id="roles" className="scroll-mt-24 border-t border-slate-200/60">
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
        <Reveal className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-5xl">Кому подходит Autexa</h2>
          <p className="mt-4 text-lg text-slate-600">
            Каждый в сервисе видит своё — и у каждого своя причина открыть приложение.
          </p>
        </Reveal>

        <div className="mt-14 grid grid-cols-1 gap-4 md:grid-cols-3">
          {roles.map((role, i) => {
            const style = ROLE_STYLE[role.key];
            return (
              <Reveal key={role.key} delay={Math.min(i * 0.07, 0.21)}>
                <div className="flex h-full flex-col rounded-3xl border border-slate-200/60 bg-white p-6 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md">
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
                        {p}
                      </li>
                    ))}
                  </ul>

                  <p className="mt-5 border-t border-slate-100 pt-4 text-[11px] font-semibold uppercase tracking-wider text-emerald-600">
                    С Autexa
                  </p>
                  <ul className="mt-2 space-y-2">
                    {role.gains.map((g) => (
                      <li key={g} className="flex items-start gap-2 text-sm leading-relaxed text-slate-700">
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                        {g}
                      </li>
                    ))}
                  </ul>
                </div>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}
