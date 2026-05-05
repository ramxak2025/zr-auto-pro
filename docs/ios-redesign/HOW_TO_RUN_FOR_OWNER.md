# Как запустить Autexa на iPhone — пошаговая инструкция для владельца

Эта инструкция написана для человека, который **не разбирается в разработке**. Все команды копируются и вставляются как есть.

---

## ЧТО НУЖНО ИМЕТЬ НА МАКЕ

Установи (один раз, потом не трогаешь):

| Программа | Где взять |
|-----------|-----------|
| **Xcode** | App Store на маке |
| **Node.js (версия 20+)** | [nodejs.org](https://nodejs.org) — скачай LTS-версию |
| **Command Line Tools** | в терминале: `xcode-select --install` |
| **CocoaPods** | в терминале: `sudo gem install cocoapods` |
| **Apple Developer Account** | у тебя уже есть (Ramazan Shamsudinov) |

Также понадобится:
- **iPhone** + кабель USB
- На iPhone должен быть включён режим разработчика: Настройки → Конфиденциальность и безопасность → Режим разработчика → Включить (потребуется перезагрузка)

---

## ЕСЛИ КОМПЬЮТЕР ЧИСТЫЙ — ПЕРВЫЙ РАЗ

```bash
# 1) Скачать проект (проект может лежать где угодно — например, ~/Downloads/zr-auto-pro)
cd ~
git clone https://github.com/ramxak2025/zr-auto-pro.git

# 2) Перейти в проект
cd zr-auto-pro

# 3) Перейти на нашу ветку
git checkout claude/fix-auteksa-freezing-zuMJS

# 4) Перейти в папку мобилки
cd mobile

# 5) Установить пакеты (одна минута)
npm install

# 6) Поставить отдельно один пакет
npx expo install expo-symbols

# 7) Сгенерировать iOS-проект (создаст папку ios/)
npx expo prebuild --platform ios --clean
```

Когда увидишь надписи `✔ Finished prebuild` и `✔ Installed CocoaPods` — переходим к Xcode.

> **Важно:** если у тебя проект уже скачан, и есть незакоммиченные изменения (например, обновлённый `package-lock.json` после прошлого `npm install`), и `git pull` ругается «Your local changes would be overwritten» — сначала сохрани изменения в стэш:
> ```bash
> git stash
> git checkout claude/fix-auteksa-freezing-zuMJS
> git pull origin claude/fix-auteksa-freezing-zuMJS
> ```

---

## ЗАПУСК В XCODE

### 1. Открыть проект

```bash
open ios/Autexa.xcworkspace
```

⚠️ Открывай **именно `.xcworkspace`** (а не `.xcodeproj`).

### 2. Подписать проект

В Xcode слева в дереве файлов:
1. Кликни на синюю иконку **Autexa** в самом верху
2. По центру выбери **Signing & Capabilities**
3. **Team** → выбери **Ramazan Shamsudinov**
4. Bundle Identifier оставь `com.autexa.mobile`
5. Дождись пока внизу появится: `Provisioning Profile: Xcode Managed Profile` без красных ошибок

### 3. Подключить iPhone

1. Кабель в iPhone и в мак
2. На iPhone: **Trust This Computer** → ввести код
3. На iPhone должен быть включён **Режим разработчика** (Settings → Privacy & Security → Developer Mode → ON)

### 4. Выбрать устройство в Xcode

Сверху по центру Xcode рядом с **Autexa** — кликни на дропдаун с именем устройства.

В списке найди свой настоящий iPhone (раздел сверху, БЕЗ скобок `(iOS X.X.X)` после имени — те с скобками это симуляторы) → выбери.

### 5. Переключи на Release-сборку (быстрее, без Metro)

Меню: **Product → Scheme → Edit Scheme...** (или `Cmd+<`)
- Слева **Run**
- Вкладка **Info**
- **Build Configuration** → поменяй с `Debug` на **`Release`**
- Закрой окно

### 6. Жми ▶ Run (или `Cmd+R`)

Первая сборка — 5-15 минут. Потом приложение само установится на iPhone и откроется.

### 7. На iPhone разреши разработчика

Если появится ошибка про «Untrusted Developer»:
1. На iPhone: **Настройки → Основные → VPN и управление устройством**
2. Найди раздел **Apple Development: Ramazan Shamsudinov**
3. Тапни → **Доверять / Trust**
4. Возвращайся на главный экран → открой Autexa

---

## ВТОРОЙ И ВСЕ СЛЕДУЮЩИЕ РАЗЫ

Если ты уже один раз проделал всё выше, дальше намного проще.

### Просто обновить приложение на iPhone (если поменялся код):

```bash
cd ~/zr-auto-pro
git pull
cd mobile
npm install              # только если изменился package.json
npx expo prebuild --platform ios --clean
open ios/Autexa.xcworkspace
```

Потом в Xcode → ▶ Run.

### Если на iPhone приложение перестало открываться (через ~год)

Это нормально — закончился срок Apple Developer сертификата. Просто пересобери:

```bash
cd ~/zr-auto-pro/mobile
open ios/Autexa.xcworkspace
```

В Xcode → ▶ Run → новая сборка установится поверх старой.

---

## ЕСЛИ ЧТО-ТО ПОШЛО НЕ ТАК

### «Could not find module 'expo-symbols'» при сборке
Запусти:
```bash
cd mobile
npm install
npx expo install expo-symbols
npx expo prebuild --platform ios --clean
```

### «Your local changes would be overwritten by merge»
```bash
git stash
git checkout claude/fix-auteksa-freezing-zuMJS
git pull origin claude/fix-auteksa-freezing-zuMJS
```

### «No bundle URL present» (красный экран на iPhone)
Это в Debug-сборке. Переключись на **Release** через Edit Scheme (см. шаг 5 выше).

### «Signing certificate not found»
В Xcode: **Settings → Accounts** → проверь что Apple ID добавлен. Если нет — добавь через **+** → Apple ID → войди.

### «Failed to register bundle identifier»
Это значит `com.autexa.mobile` уже занят. В Xcode → Signing & Capabilities → Bundle Identifier поменяй на свой уникальный, например `com.autexa.mobile.ramazan`. После этого открой `mobile/app.json` и в строке `"bundleIdentifier": "com.autexa.mobile"` тоже впиши тот же новый.

### «Не удается проверить приложение» на iPhone (требуется сетевое подключение)
- Выключи VPN на iPhone
- Перейди в **Настройки → Основные → VPN и управление устройством → Apple Development → Trust**

### Хочется быстро увидеть как меняется код в реальном времени
В Xcode переключи Build Configuration обратно на **Debug**, и в отдельном терминале запусти:
```bash
cd ~/zr-auto-pro/mobile
npm run start:dev
```

Тогда iPhone и мак должны быть в одной WiFi-сети, на iPhone откроется dev-launcher с QR.

### Билд не прошёл с ошибкой про CocoaPods
```bash
cd ~/zr-auto-pro/mobile/ios
sudo gem install cocoapods   # если первый раз
pod install
```

Потом снова в Xcode → ▶ Run.

---

## ЧТО МЫ ИСПРАВИЛИ В ЭТОЙ ВЕРСИИ

Кратко (полный список — в `docs/ios-redesign/FINAL_REPORT.md`):

- 🎨 **Премиальный нижний бар** — настоящий iOS material через `expo-blur` (UIVisualEffectView под капотом). Без точек-индикаторов под вкладками. Центральная кнопка Касса — компактная и flush с баром, не выпрыгивает
- 🔢 **Госномер БЕЗ дублирования региона** — main и region разделены на два независимых поля; `О777ОО88` показывается только как `О 777 ОО | 88`
- 📞 **Звонки больше не залезают на Dynamic Island** — добавлен SafeAreaView и нативный header с back-button
- 📦 **Склад как iOS plain list** — компактные ряды с hairline-разделителями вместо толстых Material-карточек. На iPhone 17 Pro помещается ~10 товаров на экран вместо 6
- ⚡ **Холодный старт без пустых экранов** — данные мгновенно из кеша
- 🚀 **Быстрая загрузка разделов** — после логина данные подкачиваются в фоне
- ❌ **Убран ложный «0 товаров»** — больше не показывается во время загрузки
- 🔄 **Латиница в кириллицу** — `P332PA05` → `Р 332 РА | 05`
- 🌐 **Switcher RU/INT** для иностранных номеров
- 🔍 **Умный поиск клиента** — находит по любому формату ввода
- 📅 **Расписание** — последняя строка больше не уходит под нижний бар
- ✅ **Все экраны** — корректные отступы, Safe Area везде

---

## КУДА ОБРАЩАТЬСЯ

Если что-то непонятно или сломалось — открой issue на GitHub, или попроси нового Claude помочь с конкретной ошибкой (приложи скрин экрана или текст).
