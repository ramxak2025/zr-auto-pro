import { Apple, Monitor, Smartphone } from 'lucide-react';
import Reveal from './Reveal';

const PLATFORMS = [
  {
    icon: Apple,
    title: 'iPhone',
    text: 'Быстрое и плавное приложение — с голосовым вводом и офлайн-режимом.',
  },
  {
    icon: Smartphone,
    title: 'Android',
    text: 'Та же касса, склад и отчёты — в кармане у каждого мастера.',
  },
  {
    icon: Monitor,
    title: 'Браузер',
    text: 'Полноценная версия без установки — с любого компьютера.',
  },
];

export default function Platforms() {
  return (
    <section className="border-t border-white/[0.05]">
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
        <Reveal className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight text-white sm:text-5xl">На любом устройстве</h2>
          <p className="mt-4 text-lg text-white/55">
            Один аккаунт — три платформы. Данные синхронизируются между всеми устройствами.
          </p>
        </Reveal>

        <div className="mt-14 grid grid-cols-1 gap-4 sm:grid-cols-3">
          {PLATFORMS.map((p, i) => (
            <Reveal key={p.title} delay={Math.min(i * 0.07, 0.21)}>
              <div className="h-full rounded-3xl border border-white/[0.07] bg-[#141416] p-6 text-center transition-all duration-300 hover:-translate-y-0.5 hover:border-white/[0.16]">
                <span className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-white/[0.05] ring-1 ring-white/[0.07]">
                  <p.icon className="h-6 w-6 text-white/85" />
                </span>
                <h3 className="mt-4 text-lg font-semibold text-white">{p.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-white/55">{p.text}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
