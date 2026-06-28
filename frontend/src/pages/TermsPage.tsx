import { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Mail } from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// Public, standalone Terms of Use page (no auth gate).
// Linked from the login screen, the web app and the mobile app.
// Brand-level document: сервис «Autexa», контакт info@autexa.pw.
// No legal-entity registration numbers are fabricated.
// ─────────────────────────────────────────────────────────────────────────────

const LAST_UPDATED = '28 июня 2026 г.';
const CONTACT_EMAIL = 'info@autexa.pw';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
      <div className="mt-2.5 space-y-3 text-[15px] leading-relaxed text-gray-600">{children}</div>
    </section>
  );
}

function Bullets({ items }: { items: ReactNode[] }) {
  return (
    <ul className="ml-1 list-disc space-y-1.5 pl-5 marker:text-gray-300">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-3xl px-5 py-10 sm:py-14">
        {/* Back to login */}
        <Link
          to="/login"
          className="mb-7 inline-flex items-center gap-1.5 text-sm text-gray-500 transition-colors hover:text-gray-700"
        >
          <ArrowLeft className="h-4 w-4" /> На страницу входа
        </Link>

        {/* Brand header */}
        <header>
          <div className="flex items-center gap-3">
            <img src="/logo-icon.png" alt="Autexa" className="h-11 w-11 rounded-xl object-contain" />
            <div>
              <p className="text-sm font-semibold tracking-wide text-gray-900">Autexa</p>
              <p className="text-xs text-gray-400">Сервис управления автосервисом</p>
            </div>
          </div>
          <h1 className="mt-6 text-3xl font-bold text-gray-900">Условия использования</h1>
          <p className="mt-2 text-sm text-gray-400">Дата последнего обновления: {LAST_UPDATED}</p>
        </header>

        <hr className="my-8 border-gray-200" />

        <article className="space-y-9">
          <Section title="1. Общие положения и предмет">
            <p>
              Настоящие Условия использования (далее — «Условия») регулируют доступ и использование сервиса «Autexa»
              (далее — «Сервис») — облачного программного продукта (SaaS) для управления автосервисами: учёта
              заказ-нарядов, кассы, склада, услуг, клиентов, расписания, зарплат и отчётности.
            </p>
            <p>
              Сервис предоставляется брендом «Autexa» (далее — «мы»). Начиная использовать Сервис, вы соглашаетесь с
              настоящими Условиями. Если вы не согласны с ними, использование Сервиса не допускается.
            </p>
          </Section>

          <Section title="2. Учётные записи и роли">
            <Bullets
              items={[
                'Для доступа к Сервису создаётся учётная запись. Вы обязаны указывать достоверные данные и поддерживать их в актуальном состоянии.',
                'Вы несёте ответственность за сохранность учётных данных и за все действия, совершённые под вашей учётной записью.',
                'Доступ к функциям разграничивается по ролям (например: владелец, директор, администратор, мастер). Назначение ролей и прав осуществляет администратор организации.',
                'О любом несанкционированном доступе к учётной записи необходимо незамедлительно сообщить нам.',
              ]}
            />
          </Section>

          <Section title="3. Допустимое использование">
            <p>При использовании Сервиса запрещается:</p>
            <Bullets
              items={[
                'Нарушать законодательство Российской Федерации и права третьих лиц.',
                'Пытаться получить несанкционированный доступ к Сервису, другим организациям или их данным.',
                'Нарушать работу Сервиса, создавать чрезмерную нагрузку, обходить ограничения и системы защиты.',
                'Вносить заведомо недостоверную, противоправную или вредоносную информацию.',
                'Использовать Сервис для рассылки спама или иных нежелательных сообщений.',
              ]}
            />
            <p>
              Вы самостоятельно отвечаете за данные, которые вносите в Сервис, включая данные клиентов вашего
              автосервиса, и за наличие необходимых согласий на их обработку.
            </p>
          </Section>

          <Section title="4. Подписка и тарифы">
            <Bullets
              items={[
                'Набор доступных функций зависит от выбранного тарифа (плана подписки).',
                'Оплата подписки производится вне приложения — на сайте или иными согласованными способами.',
                'Подписка предоставляет доступ на оплаченный период; по его окончании доступ к платным функциям может быть ограничен.',
                'Стоимость и состав тарифов могут изменяться; актуальные условия доводятся до сведения пользователей заранее.',
              ]}
            />
          </Section>

          <Section title="5. Интеллектуальная собственность">
            <p>
              Сервис, его программный код, дизайн, торговые обозначения и иные компоненты принадлежат «Autexa» и
              защищены законом. Использование Сервиса не передаёт вам каких-либо прав на эти объекты, кроме права
              пользоваться функциональностью Сервиса в соответствии с настоящими Условиями. Данные, которые вы вносите в
              Сервис, остаются вашими.
            </p>
          </Section>

          <Section title="6. Ограничение ответственности">
            <p>
              Сервис предоставляется на условиях «как есть» (as is). Мы стремимся обеспечить стабильную и бесперебойную
              работу, однако не гарантируем отсутствие сбоев, ошибок или временной недоступности.
            </p>
            <p>
              В максимально допустимых законом пределах мы не несём ответственности за косвенные убытки, упущенную
              выгоду, а также за утрату данных, произошедшую не по нашей вине. Вы отвечаете за корректность вносимых
              данных и за их использование в своей деятельности.
            </p>
          </Section>

          <Section title="7. Приостановка и прекращение доступа">
            <p>
              Мы вправе приостановить или прекратить доступ к Сервису при нарушении настоящих Условий, требований
              законодательства или при наличии угрозы безопасности Сервиса и его пользователей. Вы можете прекратить
              использование Сервиса и удалить аккаунт в любой момент — порядок удаления описан в Политике
              конфиденциальности.
            </p>
          </Section>

          <Section title="8. Изменение условий">
            <p>
              Мы можем периодически обновлять настоящие Условия. Актуальная редакция всегда доступна на этой странице;
              дата последнего обновления указана в начале документа. Продолжая использовать Сервис после изменений, вы
              принимаете обновлённые Условия.
            </p>
          </Section>

          <Section title="9. Применимое право">
            <p>
              К настоящим Условиям и отношениям, связанным с использованием Сервиса, применяется законодательство
              Российской Федерации.
            </p>
          </Section>

          <Section title="10. Контакты">
            <p className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-gray-400" />
              <a href={`mailto:${CONTACT_EMAIL}`} className="font-medium text-primary-600 hover:text-primary-700">
                {CONTACT_EMAIL}
              </a>
            </p>
          </Section>
        </article>

        <hr className="my-8 border-gray-200" />

        <footer className="flex flex-wrap items-center justify-between gap-3 text-xs text-gray-400">
          <span>Autexa &copy; 2026</span>
          <div className="flex items-center gap-3">
            <Link to="/privacy" className="transition-colors hover:text-gray-600">
              Политика конфиденциальности
            </Link>
            <span className="text-gray-300">·</span>
            <Link to="/login" className="transition-colors hover:text-gray-600">
              Вход
            </Link>
          </div>
        </footer>
      </div>
    </div>
  );
}
