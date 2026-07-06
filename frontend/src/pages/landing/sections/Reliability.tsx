import { ArrowRight, Database, History, Lock, Server, Signal, WifiOff } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import Reveal from './Reveal';
import { features } from '../content';

/**
 * Иконки по порядку capabilities раздела nadezhnost в content.ts:
 * офлайн → резервные каналы → серверы в РФ → копии → изоляция → корзина.
 */
const ICONS: LucideIcon[] = [WifiOff, Signal, Server, Database, Lock, History];

export default function Reliability() {
  const section = features.find((f) => f.slug === 'nadezhnost');
  if (!section) return null;

  return (
    // На мобиле секция скрыта целиком: её роль выполняют TrustStrip под hero
    // и чип «Надёжность» в сетке «Все возможности» (жалоба владельца на длинный скролл)
    <section id="reliability" className="hidden scroll-mt-24 border-t border-slate-200/60 md:block">
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
        <Reveal className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-extrabold tracking-tight text-slate-900 sm:text-5xl">
            {section.title} — не опция
          </h2>
          <p className="mt-4 text-lg text-slate-600">{section.tagline}</p>
        </Reveal>

        <div className="mt-14 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {section.detail.capabilities.map((item, i) => {
            const Icon = ICONS[i] ?? Server;
            return (
              <Reveal key={item.title} delay={Math.min(i * 0.06, 0.24)}>
                <div className="h-full rounded-3xl border border-slate-200/60 bg-white p-6 shadow-sm transition-all duration-300 motion-safe:hover:-translate-y-0.5 hover:shadow-md">
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-primary-50">
                    <Icon className="h-5 w-5 text-primary-600" />
                  </span>
                  <h3 className="mt-4 text-lg font-semibold text-slate-900">{item.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-slate-500">{item.text}</p>
                </div>
              </Reveal>
            );
          })}
        </div>

        <Reveal delay={0.1} className="mt-10 text-center">
          <Link
            to="/f/nadezhnost"
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl px-4 text-sm font-semibold text-primary-600 transition-colors hover:text-primary-700"
          >
            Подробнее о надёжности
            <ArrowRight className="h-4 w-4" />
          </Link>
        </Reveal>
      </div>
    </section>
  );
}
