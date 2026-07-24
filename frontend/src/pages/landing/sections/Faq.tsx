import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ChevronDown } from 'lucide-react';
import { gsap, useReveal, EASE } from '../gsap';
import { linkifyContacts } from './linkify';
import { faqMain } from '../content';

/** На главной — только первые 5 вопросов; полный список живёт на /voprosy. */
const FAQ_PREVIEW_COUNT = 5;

const prefersReduce = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Один вопрос: нативный <details>/<summary> (клавиатура + семантика раскрытия
 * бесплатно), но раскрытие высоты ведёт GSAP — плавный height 0↔auto с
 * экспоненциальным ease-out. Атрибут `open` контролируемый: при закрытии контент
 * держим в DOM до конца анимации (иначе браузер спрятал бы его мгновенно), потом
 * снимаем. Шеврон крутится чистым CSS по `group-open` (тот же `open`-атрибут) —
 * никакого конфликта GSAP/CSS за один transform.
 *
 * Контракт: аккордеон закрыт по умолчанию (ожидаемый UX, а не «спрятанная
 * секция») — вопросы-summary видимы всегда. reduced-motion → мгновенное
 * раскрытие без твинов. Любой сбой GSAP ловится и всё равно переключает
 * состояние, так что ответ остаётся доступным.
 */
function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<gsap.core.Tween | null>(null);

  // Раскрытие: запускается после того, как `open=true` вернул контент в DOM.
  // useLayoutEffect ставит height:0 синхронно до paint — контент не мигает
  // на полную высоту перед стартом анимации.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel || !open || prefersReduce()) return; // reduced/закрытие обрабатываются иначе
    animRef.current?.kill();
    try {
      gsap.set(panel, { overflow: 'hidden' });
      animRef.current = gsap.fromTo(
        panel,
        { height: 0 },
        {
          height: 'auto',
          duration: 0.34,
          ease: EASE.out,
          overwrite: true,
          onComplete: () => gsap.set(panel, { clearProps: 'height,overflow' }),
        },
      );
    } catch {
      gsap.set(panel, { clearProps: 'height,overflow' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Киллим незавершённую анимацию при размонтировании (SPA-роутинг).
  // Тело в скобках — cleanup обязан возвращать void, а kill() отдаёт Tween.
  useEffect(() => () => void animRef.current?.kill(), []);

  const toggle = (e: React.MouseEvent) => {
    e.preventDefault(); // раскрытие/закрытие ведём сами
    const panel = panelRef.current;
    animRef.current?.kill();

    if (!open) {
      setOpen(true); // анимацию раскрытия подхватит useLayoutEffect выше
      return;
    }
    // Закрытие: сжать текущую высоту → 0, и только потом убрать контент.
    if (!panel || prefersReduce()) {
      setOpen(false);
      return;
    }
    try {
      gsap.set(panel, { overflow: 'hidden' });
      animRef.current = gsap.to(panel, {
        height: 0,
        duration: 0.3,
        ease: EASE.out,
        overwrite: true,
        onComplete: () => {
          setOpen(false);
          gsap.set(panel, { clearProps: 'height,overflow' });
        },
      });
    } catch {
      setOpen(false);
    }
  };

  return (
    <details
      open={open}
      data-faq-item
      className="group rounded-2xl border border-slate-200/60 bg-white shadow-sm transition-colors hover:border-slate-300"
    >
      <summary
        onClick={toggle}
        className="flex min-h-[56px] cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-left text-base font-medium text-slate-900 [&::-webkit-details-marker]:hidden"
      >
        {q}
        <ChevronDown className="h-5 w-5 shrink-0 text-slate-400 transition-transform duration-300 group-open:rotate-180 motion-reduce:transition-none" />
      </summary>
      {/* Обёртка, чью высоту анимирует GSAP; ответ всегда внутри неё */}
      <div ref={panelRef}>
        <p className="px-5 pb-5 text-sm leading-relaxed text-slate-600">{linkifyContacts(a)}</p>
      </div>
    </details>
  );
}

/**
 * Секция FAQ на главной. Моушен (свой для секции): заголовок поднимается,
 * вопросы въезжают лёгким каскадом (stagger снизу), раскрытие — GSAP-height
 * (см. FaqItem). Всё через useReveal (контракт видимости соблюдён: контент
 * виден по CSS-дефолту, from-состояние ставится только в no-preference, любой
 * сбой форсит показ; ScrollTrigger киллится при уходе со страницы).
 */
export default function Faq() {
  const headRef = useReveal<HTMLDivElement>({ type: 'rise' });
  const listRef = useReveal<HTMLDivElement>({
    type: 'stagger',
    childSelector: '[data-faq-item]',
    start: 'top 84%',
    stagger: 0.07,
    distance: 22,
  });
  const ctaRef = useReveal<HTMLDivElement>({ type: 'rise', start: 'top 90%' });

  return (
    <section id="faq" className="scroll-mt-24 border-t border-slate-200/60">
      <div className="mx-auto max-w-3xl px-4 py-20 sm:px-6 sm:py-28">
        <div ref={headRef} className="text-center">
          <h2 className="text-3xl font-extrabold tracking-tight text-slate-900 sm:text-5xl text-balance">
            Частые вопросы
          </h2>
        </div>

        <div ref={listRef} className="mt-12 space-y-3">
          {faqMain.slice(0, FAQ_PREVIEW_COUNT).map((item) => (
            <FaqItem key={item.q} q={item.q} a={item.a} />
          ))}
        </div>

        {/* Полный список вопросов (включая FAQ всех разделов) — на /voprosy */}
        <div ref={ctaRef} className="mt-8 text-center">
          <Link
            to="/voprosy"
            className="inline-flex min-h-[52px] items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-8 text-base font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:text-slate-900 motion-safe:active:scale-[0.98]"
          >
            Все вопросы и ответы
            <ArrowRight className="h-5 w-5" aria-hidden />
          </Link>
        </div>
      </div>
    </section>
  );
}
