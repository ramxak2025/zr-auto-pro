import { Database, Lock, Server, Signal } from 'lucide-react';
import Reveal from './Reveal';

const ITEMS = [
  {
    icon: Server,
    title: 'Серверы в России',
    text: 'Данные хранятся и обрабатываются на площадках в РФ.',
  },
  {
    icon: Signal,
    title: 'Резервные каналы связи',
    text: 'Приложение работает, даже когда мобильный оператор капризничает.',
  },
  {
    icon: Database,
    title: 'Ежедневные резервные копии',
    text: 'Копии базы создаются каждый день и хранятся отдельно от сервера.',
  },
  {
    icon: Lock,
    title: 'Изоляция данных',
    text: 'Данные каждого сервиса изолированы — никто чужой их не увидит.',
  },
];

export default function Reliability() {
  return (
    <section id="reliability" className="scroll-mt-24 border-t border-white/[0.05]">
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
        <Reveal className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight text-white sm:text-5xl">Надёжность — не опция</h2>
          <p className="mt-4 text-lg text-white/55">
            Касса, склад и зарплата не прощают потери данных. Поэтому база защищена на каждом уровне.
          </p>
        </Reveal>

        <div className="mt-14 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {ITEMS.map((item, i) => (
            <Reveal key={item.title} delay={Math.min(i * 0.06, 0.24)}>
              <div className="h-full rounded-3xl border border-white/[0.07] bg-[#141416] p-6 transition-all duration-300 hover:-translate-y-0.5 hover:border-white/[0.16]">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-primary-500/15">
                  <item.icon className="h-5 w-5 text-primary-400" />
                </span>
                <h3 className="mt-4 text-lg font-semibold text-white">{item.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-white/55">{item.text}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
