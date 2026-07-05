import { Apple, MessageCircle, Monitor, Play, Smartphone } from 'lucide-react';
import Reveal from './Reveal';
import { getWhatsAppUrl, WHATSAPP_INSTALL_MESSAGE } from '../config';

/** Заглушки сторов — рисуем сами (иконки lucide), официальные ассеты Apple/Google не используем. */
const STORE_BADGES = [
  { icon: Apple, store: 'App Store' },
  { icon: Play, store: 'Google Play' },
];

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
  const installUrl = getWhatsAppUrl(WHATSAPP_INSTALL_MESSAGE);
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

        {/* Бейджи сторов (в процессе публикации) + живая установка через поддержку */}
        <Reveal delay={0.1}>
          <div className="mt-12 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
            {STORE_BADGES.map((b) => (
              <div
                key={b.store}
                aria-disabled="true"
                className="flex min-h-[64px] cursor-default select-none items-center gap-3.5 rounded-2xl border border-white/[0.07] bg-[#141416] px-5 py-3 opacity-60"
              >
                <b.icon className="h-7 w-7 shrink-0 text-white/80" />
                <div className="min-w-0 text-left">
                  <div className="flex items-center gap-2">
                    <span className="text-base font-semibold leading-tight text-white">{b.store}</span>
                    <span className="rounded-full bg-white/[0.08] px-2 py-0.5 text-[10px] font-medium text-white/70">
                      Скоро
                    </span>
                  </div>
                  <p className="mt-0.5 text-[11px] leading-tight text-white/45">Приложение в процессе публикации</p>
                </div>
              </div>
            ))}

            {installUrl && (
              <a
                href={installUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-[64px] items-center justify-center gap-2.5 rounded-2xl bg-green-500 px-6 text-base font-semibold text-white shadow-lg shadow-green-500/25 transition-colors hover:bg-green-400 active:bg-green-600"
              >
                <MessageCircle className="h-5 w-5" />
                Скачать через поддержку
              </a>
            )}
          </div>
        </Reveal>
      </div>
    </section>
  );
}
