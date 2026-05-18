# Autexa — Оркестрация агентов (Playbook)

## Как ты общаешься с системой

**Ты пишешь только тим-лиду.** Тим-лид — это главный Claude в открытом чате. Никаких прямых запросов узким агентам.

Тим-лид сам:

1. Разбирает задачу, делает разведку (Explore subagent, если скоуп неясен).
2. Решает, кому из отделов это передать.
3. Запускает агентов через `Agent` tool (каждый — в своём изолированном окне контекста).
4. Собирает результаты; при противоречиях возвращается с уточняющим вопросом.
5. Перед коммитом обязательно прогоняет `qa-build-engineer` как финальный gate.

## Слой → агент

### Широкие (роли-«отделы»)

| Слой | Агент | Что в зоне |
|---|---|---|
| Backend / API / БД | `backend-engineer` | `backend/**`, миграции, контракт `shared/` |
| Web PWA | `web-engineer` | `frontend/**` |
| iOS RN-слой (TypeScript) | `ios-engineer` | `mobile/src/**/*.tsx` (включая `.ios.tsx`), `mobile/app.json` iOS-секции |
| iOS Swift / native | `ios-native-engineer` | `mobile/modules/*/ios/*.swift`, `expo-module.config.json` |
| Android | `android-engineer` | `*.android.tsx`, `mobile/app.json` `android.*`, парити в shared-файлах |
| QA gate | `qa-build-engineer` | typecheck + lint + jest + plate-mask + prebuild + pod install + xcodebuild + autolinking |

### Узкие (по экранам — у каждого своё видение продукта)

| Экран / зона | Агент |
|---|---|
| Касса (Касса/заказ-наряд, госномер, выбор клиента+авто, RU/INT mode) | `cash-plate-engineer` |
| Расписание / shifts | `schedule-engineer` |
| Поставщики | `suppliers-engineer` |
| Warehouse product picker внутри Касса | `warehouse-product-picker-engineer` |
| Журнал документов | `journal-documents-engineer` |
| Единая визуальная система (`IosScreenHeader`, `iosCard*`, ритм) | `autexa-visual-system-designer` |
| Apple HIG / spacing / typography на уровне компонента | `ios-ux-designer` |
| Performance (jank, «пустой кадр», лишние re-renders) | `rn-performance-engineer` |

## Алгоритм тим-лида

```
1. Получил задачу от пользователя.
2. Разведка: один слой или несколько? Один экран или сквозная?
3. Если задача целиком про один экран и есть узкий агент — вызвать его.
   Иначе — разложить на широкие роли:
     - меняется контракт API → сначала backend-engineer,
       потом параллельно web-engineer + ios-engineer + android-engineer
     - локальная задача на одном клиенте → только этот клиент
4. Запустить агентов через Agent tool. Один Agent call = одно окно контекста.
   Каждому prompt'у дать:
     - цель в одном предложении
     - явные пути файлов (никаких "найди сам")
     - какие проверки запустить
     - зону "не трогать"
5. Собрать summaries.
6. Если есть противоречия / неоднозначности — AskUserQuestion владельцу.
7. qa-build-engineer как финальный gate.
8. Коммит на feature-branch. Push в `refactor/full-audit-2026` — только по явной команде владельца.
```

## Когда параллелим / когда последовательно

**Параллельно** — задачи на разные слои без зависимостей:

- backend reports-endpoint + frontend ReportsPage редизайн (web ждёт от backend только сигнал «контракт не меняется»).
- mobile RN-fix + web bugfix.
- `ios-engineer` + `android-engineer`, когда правят `*.ios.tsx` и `*.android.tsx` соответственно.

**Последовательно** — когда есть зависимость:

- меняем `shared/types/index.ts` → сначала backend (включая контракт), только потом потребители (web + mobile).
- ставим native iOS-модуль → сначала `ios-native-engineer` (Swift), потом `ios-engineer` (JS-обёртка).

## Анти-паттерны

- Запускать двух агентов параллельно на одну и ту же зону файлов — конфликт правок.
- Давать узкому агенту широкую задачу («сделай весь mobile»).
- Пропустить `qa-build-engineer` перед коммитом.
- Передавать агенту полузадачу с расчётом «он сам поймёт из истории чата» — у нового агента истории нет.
- Пушить в `refactor/full-audit-2026` без явного запроса от владельца.

## Релиз

См. `docs/LOCAL_DEV_SETUP.md`. Короткая версия:

1. Все правки — на feature-branch от `refactor/full-audit-2026`.
2. Локально на MacBook владельца — typecheck / lint / jest / Xcode build / smoke-проход в Simulator + физический iPhone.
3. PR в `refactor/full-audit-2026` — merge только после ревью diff'а.
4. Push в `refactor/full-audit-2026` триггерит webhook на VDS → `docker compose` rebuild.
