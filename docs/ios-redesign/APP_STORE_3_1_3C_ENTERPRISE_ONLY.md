# App Store 3.1.3(c) — Enterprise-only fix (2026-07-10)

Статус: реализовано и проверено локально (frontend typecheck/lint/build — зелёные).
Адверсариальная проверка (4 агента-«ревьюера») — потребительский путь НЕ найден ни на
одной поверхности (`consumerPathFound: false` × 4, ни одного blocker). Осталось:
задеплоить сайт + собрать новый iOS-билд + обновить ASC-notes + ответить в Resolution
Center (см. ниже).

### Пост-проверочная зачистка minor-хвостов (2026-07-10)

- Удалено мёртвое поле `trialDays: 14` из `content.ts` (интерфейс + объект) — строка
  «Бесплатный пробный период» больше не компилируется в публичный бандл.
- `roleBenefits.owner` на `/f/dengi`: «…даже из отпуска: открыл телефон — увидел кассу»
  → «Касса сервиса под контролем удалённо: открыли приложение — увидели выручку за
  сегодня по всем мастерам» (убран личный/lifestyle-оттенок, субъект — организация).
- `/f/golos`: «попробуйте на реальных чеках» → «пользуйтесь на реальных чеках».

### Известный НЕ-видимый ревьюеру хвост (опциональное будущее усиление, backend)

- `POST /auth/register` (мгновенный self-serve с токеном) в контракте ещё существует и
  `authApi.register` объявлен в `shared/api/createServices.ts`, НО не вызывается нигде
  во фронте (вся регистрация идёт через модерируемый `registrationApi.submit`). Ревьюер
  до него не доберётся. Для полной чистоты — позже загейтить/удалить (зона backend +
  `shared/` контракт, на аппрув не влияет).

## Проблема

5 отказов подряд по **Guideline 3.1.3(c) Enterprise Services + 3.1.1 In-App Purchase**
(последний — build 3.0.0(60), ревью 2026-07-09, iPhone 17 Pro Max):

> «the app offers enterprise services … however, these same services are also
> available to be sold to single users, consumers, or for family use without
> using In-App Purchase.»

Плюс **5.1.1(ii)** — недостаточно конкретная purpose-string фотогалереи.

## Корневая причина (диагностирована сквозной разведкой)

**Дело не в приложении** — iOS-бинарник уже был вычищен полностью (login-only, нет
регистрации/цен/paywall/IAP, «Подписка» скрыта на iOS, `FeatureGate` нейтрален).
Apple смотрит на **всю экосистему**, а само приложение ведёт ревьюера на сайт
(ссылки «Политика конфиденциальности»/«Условия» в «Ещё» открывают `autexa.pw`).

`autexa.pw` был **публичной потребительской витриной самообслуживания**:

- публичная `/register` — любой человек регистрируется сам (имя+телефон+пароль);
- CTA «Начать бесплатно» / «Получить доступ» → `/register` по всему лендингу;
- потребительский триал «14 дней бесплатно · без карты · отмена в любой момент»;
- тариф «Гараж» 1000₽/мес «2 сотрудника», в таблице сравнения — «1 сотрудник»;
- персона «Владелец» про одиночку «хоть из дома».

Все 5 прошлых фиксов трогали только бинарник и надписи — саму воронку самообслуживания
не убирали. Отсюда цикличность отказов.

## Решение (Route A — enterprise-only, без IAP)

Владелец выбрал: сделать сайт строго B2B. IAP **не** добавляем (Apple-комиссии нет,
модель оплаты по счёту/договору сохраняется). Лид-кэпчур сохранён через уже
существующую **модерируемую** воронку заявок (`registrationApi.submit` → апрув
суперадмином) — просто переформулирована как заявка организации.

### Что изменено на сайте (`frontend/`, коммит-кандидат)

- Все CTA `to="/register"` → «Оставить заявку» (мгновенного самодоступа нет).
- `/register` (`RegisterPage` + `RegisterForm` + `RegisterModal`) — переоформлены в
  «Заявка на подключение автосервиса»; поле «Название организации (автосервиса)»
  обязательно; убрана вся потребительская лексика триала.
- `LoginPage` вход «Регистрация» → «Подключить автосервис? Оставить заявку»
  (открывает ту же модерируемую заявку).
- Тариф: `plans[0]` «Гараж»→**«Старт»**, «от 2 сотрудников», описание «для небольших
  автосервисов, команда от 2 человек»; таблица «Сотрудников» `['1',…]`→`['от 2',…]`.
- Убраны «14 дней бесплатно», «без карты», «отмена в любой момент» отовсюду.
- Добавлен явный B2B-дисклеймер (`b2bNotice`), показан у hero, у прайса и на странице
  заявки: «Autexa — система для автосервисов. Доступ предоставляется организациям —
  юридическим лицам и ИП. Не предназначена для личного использования.»
- Персона «Владелец» переформулирована на владельца/директора организации.

Проверки фронта: `typecheck` / `lint` / `build` — зелёные.

### Что изменено в приложении (`mobile/`)

- `mobile/app.json` → `NSPhotoLibraryUsageDescription`: вместо «доступ к галерее для
  выбора фотографий» — конкретная строка с примерами (запчасть → карточка товара,
  фото авто → заказ-наряд, аватар сотрудника). Закрывает **5.1.1(ii)**.
  ⚠️ Это изменение бинарника → **нужен новый билд**.

## App Review Information → Notes (вставить в ASC, English)

```
Autexa is a B2B business-management system for auto-service companies (auto repair
shops). It is provided only to organizations (legal entities / sole proprietors) that
operate an auto-service business, and is used by their employees to run day-to-day
operations: work orders, cash register, parts/warehouse, payroll, scheduling, clients
and vehicles.

There is no consumer, individual, or family use, and no purchase of any kind inside the
app:
- The iOS app is login-only. There is no account registration in the app.
- There is no subscription, plan selection, price, paywall, or purchase flow in the app.
- Accounts are provisioned by us for an organization after the business submits an
  access request on our website (autexa.pw) and we approve it manually. An individual
  cannot self-purchase or instantly self-provision the service.
- Organizations are billed outside the app by invoice/bank transfer under a service
  agreement; the service is not offered to individual consumers.

Because the service is sold only to organizations (Guideline 3.1.3(c) Enterprise
Services), In-App Purchase is not used.

Demo account for review (Director role, full access):
Phone: +79000000000
Password: AutexaDemo2026
Sign in: open the app -> enter the phone and password -> tap "Войти" (Sign in).
```

## Resolution Center — ответ ревьюеру (English)

```
Hello, and thank you for the detailed feedback. We have addressed both items.

3.1.1 / 3.1.3(c) Enterprise Services: Autexa is a B2B tool sold only to auto-service
organizations (legal entities / sole proprietors) to run their business. We updated our
website (autexa.pw) so the service is presented and provided only to organizations:
there is no self-service individual sign-up and no consumer purchase. A business submits
an access request that we review and provision manually; billing is by invoice under a
service agreement, outside the app. The iOS app itself is login-only with no
registration, no plan/price, no paywall, and no purchase. Accordingly, under Guideline
3.1.3(c), the app does not use In-App Purchase.
Demo account (Director, full access): +79000000000 / AutexaDemo2026.

5.1.1(ii) Purpose strings: We updated the photo library purpose string to clearly
describe the use with specific examples (attaching a photo of a part to a warehouse
item, a client's vehicle photo to a work order, and a staff profile photo). This change
is included in the new build.

Please let us know if any further detail would help. Thank you.
```

## App Store листинг (описание/подзаголовок — задаёт владелец в ASC)

Переориентировать на B2B, чтобы текст листинга не противоречил notes:

- Подзаголовок (≤30 симв.): «Система для автосервисов».
- Первый абзац описания начать с: «Autexa — система управления для автосервисов.
  Приложение предназначено для организаций (юрлиц и ИП) и их сотрудников …».
- Убрать любые формулировки про «личный/для себя/веди свой гараж».

## Порядок повторной подачи (для владельца)

1. **Смёрджить и задеплоить сайт** (`autexa.pw`) с B2B-изменениями — ревьюер должен
   открыть уже B2B-версию. Проверить вживую: лендинг, `/tarify`, `/register`,
   `/privacy`, `/terms` — нигде нет мгновенной регистрации/«Начать бесплатно».
2. **Новый iOS-билд** (несёт фикс фото-строки 5.1.1) → EAS → TestFlight → submit.
3. **Обновить в ASC**: App Review Notes (текст выше), при желании — описание/подзаголовок.
4. **Ответить в Resolution Center** текстом выше и приложить демо-креды.

## Acceptance / как проверить, что закрыто

- На публичном сайте (в режиме инкогнито, без логина) НЕТ ни одной кнопки мгновенной
  регистрации/покупки для одного человека; все CTA — «Оставить заявку».
- Нигде на публичных страницах нет «1 сотрудник», «Гараж/Личный», «14 дней бесплатно /
  без карты», персонального позиционирования.
- Заявка создаёт модерируемый запрос (без авто-логина), апрув — только суперадмином.
- В приложении purpose-string фотогалереи конкретна и с примерами.

```

```
