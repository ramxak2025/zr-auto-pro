import { Link } from 'react-router-dom';
import { ArrowRight, ChevronDown } from 'lucide-react';
import Reveal from './Reveal';
import { linkifyContacts } from './linkify';
import { faqMain } from '../content';

/** На главной — только первые 5 вопросов; полный список живёт на /voprosy. */
const FAQ_PREVIEW_COUNT = 5;

export default function Faq() {
  return (
    <section id="faq" className="scroll-mt-24 border-t border-slate-200/60">
      <div className="mx-auto max-w-3xl px-4 py-20 sm:px-6 sm:py-28">
        <Reveal className="text-center">
          <h2 className="text-3xl font-extrabold tracking-tight text-slate-900 sm:text-5xl text-balance">
            Частые вопросы
          </h2>
        </Reveal>

        <div className="mt-12 space-y-3">
          {faqMain.slice(0, FAQ_PREVIEW_COUNT).map((item, i) => (
            <Reveal key={item.q} delay={Math.min(i * 0.05, 0.2)}>
              {/* acc-details — плавное раскрытие (interpolate-size, см. index.css) */}
              <details className="acc-details group rounded-2xl border border-slate-200/60 bg-white shadow-sm transition-colors hover:border-slate-300">
                <summary className="flex min-h-[56px] cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-left text-base font-medium text-slate-900 [&::-webkit-details-marker]:hidden">
                  {item.q}
                  <ChevronDown className="h-5 w-5 shrink-0 text-slate-400 transition-transform duration-300 group-open:rotate-180 motion-reduce:transition-none" />
                </summary>
                <p className="px-5 pb-5 text-sm leading-relaxed text-slate-600">{linkifyContacts(item.a)}</p>
              </details>
            </Reveal>
          ))}
        </div>

        {/* Полный список вопросов (включая FAQ всех разделов) — на /voprosy */}
        <Reveal delay={0.1} className="mt-8 text-center">
          <Link
            to="/voprosy"
            className="inline-flex min-h-[52px] items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-8 text-base font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:text-slate-900 motion-safe:active:scale-[0.98]"
          >
            Все вопросы и ответы
            <ArrowRight className="h-5 w-5" aria-hidden />
          </Link>
        </Reveal>
      </div>
    </section>
  );
}
