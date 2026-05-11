# Handoff to your iOS developer — Autexa redesign

**Цель документа:** дать твоему разработчику-другу полную честную картину
того что мы делали, что работает, что нет, что я (Claude) не могу или не
буду делать, и что должен сделать живой человек на маке чтобы довести iOS
до требуемого качества.

> Я — AI-ассистент Claude. Работаю **только** через файлы в репо: пишу
> TypeScript/Swift код, делаю commits, пушу на ветку. Я **не вижу** что
> происходит на iPhone владельца, не могу запустить Xcode, не могу
> отдебажить runtime. Каждая итерация: владелец собирает на маке → шлёт
> скриншот → я смотрю код, делаю правку, пушу. Между моими правками и
> тем что видно на устройстве проходят минуты-часы каждый раз.

---

## 1. TL;DR — где мы сейчас

**Ветка:** `claude/fix-auteksa-freezing-zuMJS`
**База:** `refactor/full-audit-2026`
**Коммитов в ветке:** ~25 штук (см. `git log refactor/full-audit-2026..claude/fix-auteksa-freezing-zuMJS --oneline`)

**Что в коде сделано (но владелец это видит частично из-за проблем со
сборкой):**

- Локальный native iOS Expo Module `autexa-liquid-glass` —
  `UIVisualEffectView` + runtime upgrade на `UIGlassEffect` (iOS 26+) через
  `NSClassFromString` lookup. Настоящий native blur, не CSS-имитация.
- Floating tab bar (`TabBar.ios.tsx`) с прозрачным background (содержимое
  экрана просвечивает), animated capsule indicator который spring-slides
  между табами, компактная Касса-кнопка 46pt без выпрыгивания.
- License plate input целиком переписан под ГОСТ Р 50557-93: реальные
  пропорции 4.64:1, два независимых TextInput (main + region) — дубль
  региона невозможен по структуре. Latin→Cyrillic auto-normalize.
  PlateModeSwitcher (RU/INT) явный.
- Persistent cache через AsyncStorage (`utils/persistentCache.ts`):
  hydrate на старте до первого рендера, attach subscriber, TTL 7 дней.
  Whitelist подгоняется под реальные queryKey-first-elements.
  Prefetch после login для основных reference-data (suppliers, clients,
  cars, equipment).
- Calls inline audio player через `expo-audio` (SDK 54+ замена expo-av):
  expanded sliding panel под строкой, ±15s skip, tappable seek bar,
  `setAudioModeAsync({ playsInSilentMode: true })`.
- Clients + Cars merged в один экран с in-place segmented control,
  без navigation transitions.
- Suppliers iOS plain-list, "Не оплачено" badge убрана.
- Services iOS plain-list + folder navigation из `category` строки.
- Schedule fallback: если `/users` пустой, fallback на текущего
  authed user.
- 5 точечных правок на frontend (web SupplierDetailPage и т.д.).
- Custom config plugin `withDisableUserScriptSandboxing.js` —
  отключает Xcode 15+ User Script Sandboxing на все targets через
  `withXcodeProject` патч pbxproj. Без этого Expo prebuild script phases
  падают с `Sandbox: find(...) deny(1) file-read-data /…/Pods`.
- Иконка приложения = PWA `apple-touch-icon` (icon-192.png upscaled
  до 1024).

**Что НЕ удаётся стабильно увидеть на устройстве владельца:**

- Liquid Glass effect на tab bar (показывает белый/серый фон).
- Calendar grid в Schedule (показывает пустую колонку «Сотрудник»).
- Капсульный indicator при переключении табов.
- Иногда и другие правки — по симптомам похоже на старый JS-bundle.

**Почему так:** сильное подозрение, что Xcode переиспользует кеш
скомпилированного JS-бандла из `~/Library/Developer/Xcode/DerivedData/`
между сборками. Если `expo prebuild --clean` регенерирует `ios/`, но
DerivedData не очищена, Xcode берёт старый bundle. Я просил владельца
делать `rm -rf ~/Library/Developer/Xcode/DerivedData` перед каждой
сборкой — но похоже это не всегда срабатывает.

---

## 2. Контекст проекта

| Что               | Стек                                                                                         |
| ----------------- | -------------------------------------------------------------------------------------------- |
| Repo              | github.com/ramxak2025/zr-auto-pro (monorepo)                                                 |
| Backend           | NestJS 10 + Postgres 16, продакшен на `https://autexa.pw/api`, **в этой работе не трогался** |
| Frontend (PWA)    | React 18 + Vite + Tailwind, deploy на VDS через nginx                                        |
| Mobile            | **Expo SDK 54** (managed bare через prebuild) + React Native 0.81 + TypeScript 5             |
| State             | TanStack React Query v5, AsyncStorage                                                        |
| Navigation        | @react-navigation/native v7                                                                  |
| iOS native module | locally-linked Expo Module `autexa-liquid-glass`                                             |

Bundle ID: `com.autexa.mobile`. Apple Team: `Ramazan Shamsudinov`.

---

## 3. Хронология коммитов (`git log ... --oneline`)

```
8d6a2e4 fix(schedule): fallback to current authed user when usersData is empty
6fc01a2 fix(check): formatDuration rounds floats; Clients/Cars merged into one screen
eba501a fix(ios): real config-plugin to disable User Script Sandboxing
6110b67 chore(mobile): icon source = apple-touch-icon (icon-192.png), not icon-512
2085c17 feat(calls): expanded inline audio player + audio mode + iPhone seek bar
d0114d4 debug(schedule): add v9 banner showing user/entries counts
440bf11 fix(ios): pin ENABLE_USER_SCRIPT_SANDBOXING=NO via expo-build-properties
d4006ad chore(mobile): icons match the PWA — same logo on iOS/Android home screen
122c4e5 fix(check): GOST plate badge proportions + comment as own block before items
cdc2036 feat(check): real plate badges for car picker + inline comment after mileage
2a2d13d fix(ios): Schedule shows all active users + Clients/Cars unified + tab bar floats higher
f4103af fix(ios): tab bar liquid capsule + Schedule renders even on empty entries
9084219 feat(ios): Suppliers iOS list + Services with folders + Calls inline audio player
d248746 fix(suppliers): drop "Не оплачено" badge — deliveries default to debt
2a2d13d Schedule shows all active users + Clients/Cars unified + tab bar floats higher
686ccd5 Stage 1: tab bar background fix + Schedule grid отображается + perf cache hardening
ba0885e FINAL_REPORT — split acceptance + Remaining blockers
2ac848b Real verification (tsc/jest/lint) + Schedule skeleton/empty + TS cleanup
4e8ff47 docs(ios): add REPORT_FOR_DEVELOPER.md
e70f8f0 feat(ios): native Liquid Glass tab bar — local Expo Module + iOS 26 UIGlassEffect upgrade
6800852 fix(ios): critical 2nd-pass — plate region duplicate, calls safe area, tab bar polish
b5ca180 feat(ios): full iOS redesign — Liquid Glass, persistent cache, plate fix, Safe Area
```

Каждый коммит содержит подробный message с **что** и **почему**. Первое
что должен сделать разработчик — `git log claude/fix-auteksa-freezing-zuMJS
--not refactor/full-audit-2026 --pretty=format:'%h %s%n%n%b%n---'` для
полной картины.

---

## 4. Что реально работает (TypeScript / unit-tests / autolinking)

```
$ cd mobile
$ ./node_modules/.bin/tsc --noEmit
exit 0

$ ./node_modules/.bin/jest --testPathPattern plateMask
38 tests passed (latin→cyrillic, foreign normalization, splitPlate, validation)

$ ./node_modules/.bin/eslint "src/**/*.{ts,tsx}" --max-warnings=10000
exit 0

$ npx expo prebuild --platform ios --clean --no-install
✔ Finished prebuild

$ npx expo-modules-autolinking resolve --platform apple --json
{ "packageName": "autexa-liquid-glass", "podName": "AutexaLiquidGlass",
  "swiftModuleNames": ["AutexaLiquidGlass"], "modules": ["AutexaLiquidGlassModule"] }
```

То есть на уровне кода / типов / autolinking всё валидно. Native module
**должен** подключаться pod install'ом. Я лично видел в Xcode Build
Settings строку `-l"AutexaLiquidGlass"` в Other Linker Flags на скриншоте
владельца — это подтверждает что pod install его реально подключил.

---

## 5. Что я НЕ могу сделать в этой сессии

### 5.1. Полный rewrite Schedule на Swift

Владелец просит «сделать раздел расписания полностью на Swift» — это
~1-2 недели работы human iOS-разработчика. Включает:

- UICollectionView с compositional layout (sticky left column + horizontal
  scroll по дням)
- Свой `RCTViewManager` или Expo Module с props (`{ entries, users,
currentMonth }`) и callbacks (`onCellPress`, `onMonthChange`)
- Bridge для actions: «создать смену», «отметить опоздание» — каждое event
  пробрасывается в JS чтобы он сделал mutation через TanStack Query
- Native анимации между месяцами
- Сохранение существующей бизнес-логики (lateStatus, dayOff, sortOrder
  мастеров, optimistic updates)
- Покрытие edge cases которые сейчас в RN-варианте уже работают

В формате одной AI-сессии с минутными итерациями я **физически не могу**
написать корректный native module такого размера и проверить его. Это
работа для живого человека на маке с Xcode и реальным iPhone.

**Что я могу:** продолжать улучшать существующий RN ScheduleScreen.tsx —
ставить fallback'и, чинить условия рендера, поднимать perf через
memoization. Это и делаю.

### 5.2. Я не вижу runtime поведения

Не могу:

- Запустить Xcode build
- Открыть iOS Simulator
- Прочитать Xcode console logs
- Подключиться к устройству
- Сделать скриншот

Каждая моя гипотеза про «почему пустой grid» / «почему серый bar» —
это **вывод из кода**, не наблюдение. Если что-то не работает после
моих правок — мне нужен скриншот ИЛИ console output чтобы продолжить.

### 5.3. Деплой / VDS

Не имею SSH доступа к VDS. Backend / frontend сервер обновляет владелец
вручную через `git pull && docker compose up -d --build` на VDS.

---

## 6. Главная проблема прямо сейчас — JS bundle не обновляется

### Симптомы

После моих коммитов и пересборки:

- Tab bar на iPhone серый/белый, не glass (мой код в `TabBar.ios.tsx`
  делает blur через native module)
- Schedule grid пустой (мой fallback на `useAuth().user` должен показать
  хотя бы одну строку)
- Debug-баннер `🛠 v9 · users:N · activeUsers:N` который я добавил для
  диагностики **не виден** на скриншоте

Если бы код применился — был бы либо glass, либо хотя бы баннер. Их нет
→ значит на устройстве **старый bundle**.

### Гипотезы (от вероятной к маловероятной)

1. **Xcode DerivedData кеш.** Xcode хранит скомпилированные артефакты
   в `~/Library/Developer/Xcode/DerivedData/Autexa-XXXXX/`. После
   `prebuild --clean` структура `ios/` обновляется, но Xcode видит
   неизменённый JS bundle script phase и переиспользует cached output.
   **Фикс:** `rm -rf ~/Library/Developer/Xcode/DerivedData` перед каждым
   build.

2. **Metro кеш.** В Release сборке Metro генерирует bundle при build phase
   "Bundle React Native code and images". Metro кеш в `mobile/.expo/` и
   `mobile/node_modules/.cache/`. **Фикс:** `rm -rf mobile/.expo
mobile/node_modules/.cache`.

3. **Watchman.** Если установлен, кеширует file events.
   **Фикс:** `watchman watch-del-all`.

4. **Старый installed app**. iOS не всегда заменяет JS bundle при
   reinstall. **Фикс:** удалить app с iPhone (long-press → Remove App)
   ПЕРЕД новым Run.

5. **Native module действительно не работает в runtime.** Свифт компилит,
   но `UIVisualEffectView` рендерит с `alpha = 1.0` или из-за конфликта
   с реанимированным родителем. Это можно проверить только на устройстве
   через Xcode View Hierarchy Debugger.

### Что я бы сделал

1. **На маке закрыть Xcode полностью.** `Cmd+Q`.
2. **Тотальный clean:**
   ```
   cd ~/Downloads/zr-auto-pro/mobile
   rm -rf ios .expo node_modules ~/Library/Developer/Xcode/DerivedData/Autexa-*
   watchman watch-del-all 2>/dev/null
   ```
3. **На iPhone удалить Autexa полностью** (long-press → Remove App).
4. **Заново:**
   ```
   npm install
   npx expo install expo-symbols
   npx expo prebuild --platform ios --clean
   open ios/Autexa.xcworkspace
   ```
5. **В Xcode:** дождаться индексации, **отказаться** от «Update to
   Recommended Settings» (он включает sandboxing), Team =
   `Ramazan Shamsudinov`, Build Configuration = **Release**, target =
   physical iPhone, **Shift+Cmd+K** (Clean), **▶ Run**.
6. После запуска **смотреть в Xcode console** — там будут наши логи
   (`Posting 'appBecomesActive'`, `Running "main"`) И мы увидим если
   падает native module.

Если после этого debug-баннер сверху Schedule всё равно не появляется —
значит что-то ещё в build pipeline. Тогда смотри `ios/Autexa/main.jsbundle`
по datestamp — он должен быть свежий.

---

## 7. Что нужно сделать живому iOS-разработчику чтобы добить

### P0 — диагностика

1. Сделать чистую сборку по протоколу выше.
2. Открыть Xcode console во время первого запуска. Найти строки от наших
   модулей. Если там exception от `AutexaLiquidGlass` — значит native
   module падает на runtime, надо смотреть Swift код в
   `mobile/modules/autexa-liquid-glass/ios/`.
3. Проверить через View Hierarchy Debugger (Debug → View Debugging →
   Capture View Hierarchy) что реально рендерится в tab bar position —
   `AutexaLiquidGlassView` или fallback `BlurView`.
4. Найти JS bundle в `.app` после build → unzip `.ipa` → `main.jsbundle` →
   grep `AutexaLiquidGlassView` чтобы убедиться что bundle новый. Если
   старый — pipeline сломан.

### P1 — что доделать в RN-варианте если native rewrite пока не нужен

- Schedule: после фикса 8d6a2e4 grid должен показывать хотя бы текущего
  юзера. Если этого не видно — ищи где пайплайн ломает применение коммитов.
- Suppliers: добавить UI для bulk-payment («Погасить долг» bottom sheet).
  Backend endpoint `POST /suppliers/payments` уже есть — `suppliersApi
.createPayment()`. Скрин: на главной карточке поставщика крупный
  agregated debt + кнопка → sheet с input суммы + список открытых
  поставок с чекбоксами.
- Services: folder UI уже есть на mobile (commit 9084219), но frontend
  ServicesPage всё ещё плоский список без папок. Тот же подход что в
  warehouse: split `category` по `/`, breadcrumbs.
- Equipment: пока не trogan, нужен compact iOS list redesign.
- Checks/Журнал: добавить toggle "Чеки / Платежи поставщикам" — берёт
  данные из `suppliersApi.getPayments()`.

### P2 — если хочется правда native iOS

Long-term recommendation: оставить React Native для всего что **уже
работает** (auth, lists, forms — там RN отлично), а **именно для tab bar и
Schedule grid** написать native iOS modules:

1. **Tab bar** — ~3-5 дней работы. Native UITabBar с UIGlassEffect (iOS 26)
   - UIBlurEffect.systemThinMaterial fallback, animated indicator через
     UIViewPropertyAnimator. Bridge через ExpoModule. Уже частично сделано в
     `mobile/modules/autexa-liquid-glass` — наращивать оттуда.

2. **Schedule grid** — ~2-3 недели. UICollectionView с compositional layout.
   Bridge events:
   - `onCellPress(userId, date)` → JS делает `quickAction()` mutation
   - `onMonthChange(year, month)` → JS делает `useQuery({ schedule, ... })`
   - `setEntries(entries[])` от JS в native при каждом успешном fetch
     Backend контракты остаются те же — bridge только для отрисовки.

Если разработчик пойдёт по этому пути — все мои существующие RN-фолбэки
в ScheduleScreen.tsx можно будет удалить как только native готов.

---

## 8. Файлы / куда смотреть

| Что                                 | Где                                                                                   |
| ----------------------------------- | ------------------------------------------------------------------------------------- |
| Native iOS Liquid Glass module      | `mobile/modules/autexa-liquid-glass/`                                                 |
| Tab bar (RN)                        | `mobile/src/navigation/TabBar.ios.tsx`                                                |
| Schedule                            | `mobile/src/screens/ScheduleScreen.tsx`                                               |
| Plate input + utility               | `mobile/src/components/RussianPlateInput.tsx` + `mobile/src/utils/plateMask.ts`       |
| Plate tests (38)                    | `mobile/src/utils/__tests__/plateMask.test.ts`                                        |
| Persistent cache                    | `mobile/src/utils/persistentCache.ts`                                                 |
| Prefetch + auth                     | `mobile/src/contexts/AuthContext.tsx`                                                 |
| Calls + audio player                | `mobile/src/screens/CallsScreen.tsx`                                                  |
| Suppliers + Services + Clients/Cars | `mobile/src/screens/SuppliersScreen.tsx` / `ServicesScreen.tsx` / `ClientsScreen.tsx` |
| Sandbox-fix config plugin           | `mobile/plugins/withDisableUserScriptSandboxing.js`                                   |
| App entry / queryClient hydrate     | `mobile/App.tsx`                                                                      |

Документация:

- `docs/ios-redesign/AUDIT.md` — полный аудит при старте
- `docs/ios-redesign/IOS_NATIVE_UX_SPEC.md` — UX spec
- `docs/ios-redesign/LICENSE_PLATE_FIX.md` — детали plate fix
- `docs/ios-redesign/TAB_BAR_NATIVE_IMPLEMENTATION.md` — про native module
- `docs/ios-redesign/REPORT_FOR_DEVELOPER.md` — полный отчёт владельцу
- `docs/ios-redesign/HOW_TO_RUN_FOR_OWNER.md` — пошаговый запуск
- `docs/ios-redesign/FINAL_REPORT.md` — итоговый

---

## 9. Моё честное мнение про ситуацию

Между мной и владельцем сложилась **рассинхронизация**: я пишу код,
коммичу, прошу пересобрать. Владелец собирает на маке, видит **старую**
версию (по моим симптомам — кеш Xcode/Metro), пишет «не работает», я
думаю что проблема в коде и пишу новый фикс. И так по кругу.

Чтобы выйти из этого цикла, нужен один человек на маке который:

1. Сделает чистую сборку по протоколу из раздела 6.
2. Подтвердит что debug-баннер `🛠 v9` появился на расписании. Если да —
   значит весь мой код пошёл в bundle, и можно идти по списку «Remaining
   work» точечно. Если нет — значит pipeline build broken, и нужно
   разбираться **не с кодом**, а с инструментами на маке.
3. Откроет Xcode console и проверит что native module
   `AutexaLiquidGlassView` инициализируется без exceptions.

Это 30 минут работы профильного iOS/RN-разработчика. После этого
понятно что доделывать.

Я готов продолжать поддерживать любые точечные правки — как только
ясно что bundle pipeline в порядке.

---

## 10. Итог

Владелец хочет: **нативно, быстро, надёжно.** Реалистичная дорожная карта:

- **Сейчас (1 час разработчик):** диагностика build pipeline + чистая
  сборка с DerivedData wipe. Убедиться что ВСЕ мои коммиты реально в .app.

- **На неделю (1 человек full-time):** доделать в RN то что в разделе 7
  P1. Это ускорит app до приемлемого native-ощущения. Уже сделанный
  `autexa-liquid-glass` module даёт тот самый glass на tab bar (если
  bundle подгрузится).

- **На месяц-два (1 native iOS dev):** переписать Schedule grid на native
  Swift с UICollectionView, bridge через ExpoModule. Только после этого
  расписание будет «действительно native» — со скоростью 60+ fps на любых
  iPhone. Tab bar уже native (через UIVisualEffectView).

Цены за качество: full-native rewrite Schedule — это серьёзная инвестиция.
Альтернатива: оставить RN-вариант с моими фиксами, рискнуть что владелец
будет видеть локальные перегруженности на slow-сети — приемлемый компромисс
для большинства SaaS-проектов в России.

---

Если разработчику нужны детали по конкретному модулю / коммиту / файлу —
все в репо, history чистая. Любой вопрос — он может спросить владельца, я
отвечу через owner.

— Claude (AI-ассистент в этой работе)
