# Home-Screen Widget: повторное включение + role-aware redesign (2026-06-12)

## Проблема

Виджет AuTexaWidget был отключён коммитом `6c2b25c`: EAS-сборка падала на подписи
второго таргета («No profiles for com.autexa.mobile.widget»). Плагин убрали из
`app.json`, а запись в App Group загейтили `WIDGET_ENABLED = false`.

Владелец попросил вернуть виджет и сделать его роль-зависимым: мастер видит свой
заработок, владелец — оборот и чистую прибыль.

## Решение

### Подпись второго таргета на EAS

`app.json` → `extra.eas.build.experimental.ios.appExtensions`:

```json
[
  {
    "targetName": "AuTexaWidget",
    "bundleIdentifier": "com.autexa.mobile.widget",
    "entitlements": { "com.apple.security.application-groups": ["group.com.autexa.mobile"] }
  }
]
```

EAS теперь сам регистрирует bundle id расширения и выпускает для него профиль.
App Group у основного приложения задан и в `app.json` → `ios.entitlements`, и
дублируется плагином (идемпотентно) — обе записи указывают на
`group.com.autexa.mobile`.

В `plugins/withWidgetExtension.js` DEVELOPMENT_TEAM сменён с бесплатной Personal
Team `XHTQCBD2K4` на платную `98SHYK65HQ` (OU установленного сертификата) — иначе
7-дневный «Unable to Verify App» и невозможность провижна widget-bundle-id.

### Payload (роль-зависимый)

JS пишет JSON в App Group (`widget_dashboard_data`) через
`AutexaLiquidGlassModule.setWidgetData` (гейт `WIDGET_ENABLED` снова `true`):

- master → `{ role: 'master', earningsToday, earningsMonth, shiftOpen?, updatedAt }`
- owner → `{ role: 'owner', revenue, profitToday, checksCount, updatedAt }`

Источники данных (новых запросов нет):

- owner: `dashboardV2({period:'today'})` из `OwnerHero` (`revenueToday`, `netProfitToday`, `checksToday`);
- master: `salaryApi.getMy()` из `MasterDashboard` (`today`, `month`) + зеркальный
  observer `['shifts','my']` (дедуплицируется с запросом `ShiftControl`).

Старый payload без `role` декодируется (все поля optional) и падает в owner-layout.

### Дизайн (iOS 17+, deployment target расширения = 17.0)

- `containerBackground(for: .widget) { Color(.systemBackground) }` — авто-тёмная тема, никаких хардкод-белых;
- суммы — SF Rounded bold + `minimumScaleFactor` + `privacySensitive()`;
- ₽-форматирование `ru_RU` с разрядами («48 500 ₽»), склонение «чек/чека/чеков»;
- брендовый синий `#2563eb` для иконок-акцентов;
- small + medium семейства, у мастера индикатор смены (точка/капсула);
- «обновлено HH:mm» мелким, состояние «Откройте Autexa» при отсутствии данных;
- placeholder в галерее — sample-данные (system redaction для placeholder-entry).

## Fallback-стратегия

- Android / unit-tests: `updateWidgetData` → no-op (`Platform.OS !== 'ios'` + try/catch вокруг `requireNativeModule`).
- iOS без виджета на экране: запись в UserDefaults безвредна, `reloadAllTimelines` — no-op.
- iOS 17 — минимум расширения; основное приложение не меняет deployment target.

## Acceptance criteria (владелец, физический iPhone)

1. Долгий тап по экрану «Домой» → «+» → найти «Autexa» → доступны small и medium.
2. Под владельцем: открыть приложение (дашборд) → виджет показывает «Оборот сегодня»,
   «Чистая прибыль», число чеков, «обновлено HH:mm».
3. Под мастером: открыть приложение → виджет показывает «Мой заработок сегодня»,
   «За месяц», зелёная точка при открытой смене.
4. Тёмная тема системы → фон виджета тёмный, текст читаемый.
5. До первого входа в приложение виджет показывает «Откройте Autexa».
