# Воронка звонков на главной (правка №4, 2026-09-25)

**Симптом владельца.** На главной в приложении «Воронка звонков» показывает нули, хотя
телефония подключена («Мои Звонки»).

**Причина (по коду).** `ReportsService.getCallFunnel` (`backend/src/reports/reports.service.ts`)
считает воронку по таблице `sms_history`: «обращения» = номера, на которые Autexa отправляла
СМС. Звонки из телефонии в расчёте не участвуют. У тенанта без СМС-рассылок воронка всегда
нулевая. Тот же метод питает блок «Звонки — воронка» в отчётах маркетинга
(`marketingCalls`). На главной сайта виджета воронки нет вовсе.

## Что делаем (backend, `backend-engineer`)

Переписать `getCallFunnel` на реальные звонки, сохранив сигнатуру и маршрут
`GET /reports/call-funnel?dateFrom&dateTo`. Контракт — `CallFunnel` в `shared/types/index.ts`
(новые поля optional).

1. Источник звонков — `CallsService.getCalls(tenantId, { dateFrom, dateTo })`: для Mango —
   таблица `calls`, для «Моих Звонков» — live-API (`calls.list`). Ответ уже приведён к общему
   виду `{ calls: [{ direction: 'incoming'|'outgoing', from, to, status: 'answered'|'missed',
clientId?, … }], summary }`. Если `getCalls` бросает «не настроен» → вернуть нули и
   `telephony: { connected:false, provider:null }`. Если провайдер ответил ошибкой →
   нули и `telephony: { connected:true, provider, error: <текст для UI> }`.
   Определение провайдера: Mango включён → `'mango'`, иначе настроен «Мои Звонки» → `'moizvonki'`.
2. Метрики (звонки — ВХОДЯЩИЕ, если не сказано иное):
   - `totalCalls` — входящие за период; `answeredCalls`, `missedCalls`, `outgoingCalls`,
     `notCalledBack` — как в `summary` `getCalls` (там уже есть логика «перезвонили ли»);
   - `uniqueCallers` — уникальные нормализованные номера входящих (последние 10 цифр);
   - `knownCallers` / `newCallers` — из них есть / нет в `clients` тенанта (сопоставление
     номера — тем же способом, что в `CallsService` (translate + right(…,10)));
   - `arrivedClients`, `createdChecks`, `totalRevenue` — клиенты, чей номер звонил в период,
     и у которых есть проведённый чек с датой ≥ даты ПЕРВОГО звонка этого номера в периоде и
     ≤ `dateTo` (в поясе тенанта). Выручка — `checkRevenueExpr` + `checkMoneyBaseWhere`
     (гарантия не приносит денег), фильтр филиала — как сейчас (`pointFilterSql('ch', …)`);
   - `avgCheckValue = totalRevenue / createdChecks`; `conversionRate = arrivedClients /
  uniqueCallers * 100` (0 при отсутствии звонков); `repeatClients` — среди доехавших те, у
     кого чеков > 1 за всё время.
     Один SQL на сопоставление: передать массив номеров (и дат первого звонка) через
     `unnest($1::text[], $2::date[])`, не делать запрос на каждый номер.
3. Кэш 60 с в памяти по `tenant + point + dateFrom + dateTo` — live-API «Моих Звонков» за
   месяц тяжёлый, а главную открывают часто.
4. `marketingCalls` в `reports.service.ts` продолжает вызывать `getCallFunnel` — он
   автоматически получает новую воронку; `summary` там уже берётся из `getCalls`.
5. СМС-воронку не сохраняем (у неё нет пользователей, а два разных смысла под одним
   названием — источник путаницы).

Проверка: подставной `CallsService.getCalls` (2 входящих с одного номера + 1 с другого,
один из номеров — клиент с чеком после звонка) → `uniqueCallers=2, knownCallers=1,
arrivedClients=1, createdChecks=1, conversionRate=50`. Плюс `typecheck` + `lint` + `build`.

## Что делаем на клиентах

- **mobile** (`DashboardScreen.tsx` → `CallFunnelWidget`, агент M2): состояния
  `telephony.connected === false` → карточка «Подключите телефонию, и здесь появится воронка
  обращений» с кнопкой в раздел интеграций (Маркетинг → Интеграции); `telephony.error` →
  «Не удалось получить звонки: …» с кнопкой «Повторить»; данные есть → плитки «Звонков»,
  «Дозвонились», «Пропущено», «Не перезвонили» (если > 0 — оранжевый акцент), «Приехало»,
  «Чеков», «Выручка», «Конверсия». Старый бэкенд (нет `telephony`) → рендер как раньше.
  Виджет не должен занимать место у мастера — только owner-class/роли с `calls_view`
  (как сейчас в стеке владельческих виджетов).
- **web** (`DashboardPage.tsx`, агент W1 в рамках редизайна главной): такой же виджет — в
  админке его не было.
