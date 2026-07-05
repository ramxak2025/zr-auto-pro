import Reveal from './Reveal';
import CtaButton from './CtaButton';

export default function CtaSection() {
  return (
    <section>
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-24">
        <Reveal>
          <div className="relative overflow-hidden rounded-3xl border border-white/[0.08] bg-[#141416] px-6 py-16 text-center sm:px-12">
            {/* Подсветка внутри карточки */}
            <div aria-hidden className="pointer-events-none absolute inset-0">
              <div className="absolute -top-24 left-1/2 h-64 w-[560px] -translate-x-1/2 rounded-full bg-primary-600/25 blur-[100px]" />
            </div>

            <div className="relative">
              <h2 className="text-3xl font-bold tracking-tight text-white sm:text-5xl">Начните сегодня</h2>
              <p className="mx-auto mt-4 max-w-md text-lg text-white/60">
                Первые возможности — бесплатно: касса, склад и журнал доступны сразу.
              </p>
              <div className="mt-8">
                <CtaButton />
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
