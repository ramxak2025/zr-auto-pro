import { ChevronDown } from 'lucide-react';
import Reveal from './Reveal';

const QA = [
  {
    q: 'Сколько это стоит?',
    a: 'Тарифы подбираются под размер сервиса — от одиночного бокса до сети. Старт бесплатный: первые возможности доступны без оплаты.',
  },
  {
    q: 'Нужен ли мощный интернет?',
    a: 'Нет. Чеки сохраняются офлайн и отправляются сами, когда связь вернётся, а резервные каналы связи держат приложение в строю, даже когда оператор капризничает.',
  },
  {
    q: 'Мои данные в безопасности?',
    a: 'Да. Серверы находятся в России, данные каждого сервиса изолированы друг от друга, а резервные копии создаются каждый день.',
  },
  {
    q: 'Сложно ли обучить мастеров?',
    a: 'Нет. Интерфейс как у обычного мобильного приложения, а комментарий к заказ-наряду можно просто надиктовать голосом.',
  },
  {
    q: 'Есть ли веб-версия?',
    a: 'Да. Полноценная версия работает в браузере с любого компьютера — без установки.',
  },
];

export default function Faq() {
  return (
    <section id="faq" className="scroll-mt-24 border-t border-white/[0.05]">
      <div className="mx-auto max-w-3xl px-4 py-20 sm:px-6 sm:py-28">
        <Reveal className="text-center">
          <h2 className="text-3xl font-bold tracking-tight text-white sm:text-5xl">Частые вопросы</h2>
        </Reveal>

        <div className="mt-12 space-y-3">
          {QA.map((item, i) => (
            <Reveal key={item.q} delay={Math.min(i * 0.05, 0.2)}>
              <details className="group rounded-2xl border border-white/[0.07] bg-[#141416] transition-colors hover:border-white/[0.14]">
                <summary className="flex min-h-[56px] cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-left text-base font-medium text-white [&::-webkit-details-marker]:hidden">
                  {item.q}
                  <ChevronDown className="h-5 w-5 shrink-0 text-white/40 transition-transform duration-300 group-open:rotate-180" />
                </summary>
                <p className="px-5 pb-5 text-sm leading-relaxed text-white/60">{item.a}</p>
              </details>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
