import { Wrench } from 'lucide-react';
import { Link } from 'react-router-dom';
import { pricing } from '../content';
import { PricingCalculator } from './PricingCalculator';

export default function Pricing() {
  return (
    <section id="pricing" className="scroll-mt-24 border-t border-slate-200/60">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-20">
        <h2 className="text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">{pricing.title}</h2>
        <p className="mb-6 mt-3 max-w-2xl text-base text-slate-600">{pricing.subtitle}</p>
        <PricingCalculator />
        <p className="mt-5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-600">
          <Wrench className="h-4 w-4 text-slate-500" aria-hidden />
          {pricing.implementation.title} — {pricing.implementation.duration.toLowerCase()}.
          <Link
            to="/tarify"
            className="inline-flex min-h-[44px] items-center font-semibold text-primary-700 underline underline-offset-4 hover:text-primary-800"
          >
            Подробнее о внедрении
          </Link>
        </p>
      </div>
    </section>
  );
}
