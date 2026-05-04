# iOS Deployment Guide — Autexa

Полный путь от чистого мака до приложения на твоём iPhone.

Backend общий с сайтом — `https://autexa.pw/api`. Менять ничего не нужно,
RN-приложение уже настроено на этот URL.

---

## 0. Что нужно перед началом

На маке должно быть:

- **Xcode** (последняя версия, из App Store) — обязательно
- **Command Line Tools** для Xcode: `xcode-select --install`
- **Node.js 20+** — `node -v` должен показать v20+ (если нет → https://nodejs.org)
- **CocoaPods** — `sudo gem install cocoapods` (Expo сам поставит при необходимости)
- **Apple Developer Account** ($99/год) — у тебя есть
- **iPhone**, кабель USB-C / Lightning

---

## 1. Подготовка проекта (один раз)

```bash
# 1.1 Клонируй проект (если не клонирован)
git clone <твой-git-url> ~/zr-auto-pro
cd ~/zr-auto-pro

# 1.2 Подтяни последнюю ветку
git checkout refactor/full-audit-2026
git pull

# 1.3 Установи зависимости мобилы
cd mobile
npm install

# 1.4 Сгенерируй iOS-проект
npx expo prebuild --platform ios --clean
```

`prebuild` создаст папку `mobile/ios/` со всеми файлами Xcode-проекта,
поставит CocoaPods, сгенерирует Info.plist из app.json. Это можно делать
повторно — ключ `--clean` пересоздаёт всё с нуля.

После этого появится файл:
```
mobile/ios/Autexa.xcworkspace
```

> ⚠️ **Всегда открывай `.xcworkspace`, НЕ `.xcodeproj`.** Pods требуют workspace.

---

## 2. Способ A — Запуск на симуляторе (без Apple Developer, бесплатно)

Самый быстрый способ проверить что всё работает.

```bash
cd mobile
npm run ios
```

Эта команда:
1. Запустит Metro bundler
2. Откроет iOS Simulator (Apple Watch Studio выберет первый доступный iPhone)
3. Скомпилирует и установит .app
4. Покажет приложение

Первая сборка 5-10 минут, потом — 30 сек.

**Если хочешь конкретное устройство:**
```bash
npm run ios -- --device "iPhone 15 Pro"
```

Список доступных:
```bash
xcrun simctl list devices available
```

---

## 3. Способ B — Запуск на физическом iPhone через Xcode (быстрее всего)

Это **рекомендованный путь** для разработки на реальном устройстве.

### 3.1 Подготовка iPhone

1. Подключи iPhone к маку кабелем USB
2. На iPhone разблокируй экран → доверь маку («Trust this Computer»)
3. **Settings → Privacy & Security → Developer Mode → On** (потребует перезагрузку)

### 3.2 Подготовка Xcode

1. Открой `mobile/ios/Autexa.xcworkspace` в Xcode
2. В левом дереве выбери проект **Autexa** (синяя иконка)
3. На вкладке **Signing & Capabilities**:
   - **Team**: выбери свой Apple Developer Team из списка
   - **Bundle Identifier**: должен быть `com.autexa.mobile` (если кто-то в твоей команде уже занял — измени, например `com.tvoeimya.autexa`, и не забудь обновить в `mobile/app.json`)
   - Галочка **Automatically manage signing** должна быть включена
4. Xcode сам создаст / скачает provisioning profile

### 3.3 Сборка и установка

1. Сверху Xcode рядом со схемой выбери своё устройство (iPhone Иван)
2. Нажми ▶ Run (Cmd+R)
3. Первая сборка 5-15 минут
4. На iPhone впервые после установки:
   - **Settings → General → VPN & Device Management → Developer App** → твой Apple ID → Trust

После этого приложение запускается с домашнего экрана.

### 3.4 Что делать когда меняешь код

- Изменения в JS / TSX — **просто Cmd+R в симуляторе** или Reload в dev menu (Shake / Cmd+D), Metro подхватит горячо.
- Изменения в нативных модулях (новый npm-пакет с native code) — **повторный Build в Xcode**.
- Если совсем сломалось — `npx expo prebuild --platform ios --clean` и пересобрать.

---

## 4. Способ C — TestFlight (для тестов с другими)

Это нужно когда хочешь дать ссылку нескольким людям без настройки Xcode у каждого.

### 4.1 Установи EAS CLI на маке

```bash
npm install -g eas-cli
eas login              # вход с Expo-аккаунта (твой Expo ID — ramxak, см. app.json)
```

### 4.2 Привяжи Apple Developer

```bash
cd mobile
eas credentials --platform ios
```

EAS попросит:
- **Apple ID** (твой email Apple Developer)
- **App-specific password** (создаётся в [appleid.apple.com](https://appleid.apple.com) → Sign-In and Security → App-Specific Passwords)
- **Team ID** (показан в [Apple Developer Portal](https://developer.apple.com/account))

EAS сам создаст:
- Distribution Certificate
- App Store Provisioning Profile

### 4.3 Зарегистрируй App ID в App Store Connect

Перед первой сборкой → [App Store Connect](https://appstoreconnect.apple.com) → My Apps → **+** New App:
- Platform: iOS
- Name: Autexa
- Primary Language: Russian
- Bundle ID: `com.autexa.mobile` (выбери из списка после создания в Apple Developer Portal)
- SKU: `autexa-mobile` (любой уникальный)

Запиши **App Store Connect ID** (число типа `1234567890`) — пригодится для `eas submit`.

### 4.4 Обнови `mobile/eas.json` под свой аккаунт

```jsonc
"submit": {
  "production": {
    "ios": {
      "appleId": "твой@email.com",
      "ascAppId": "1234567890",         // тот самый ASC ID
      "appleTeamId": "ABCDE12345"       // Team ID
    }
  }
}
```

### 4.5 Сборка для TestFlight

```bash
eas build --profile production --platform ios
```

EAS соберёт `.ipa` на своих серверах (~15-25 минут). Результат — ссылка
в терминале и в [expo.dev/builds](https://expo.dev/accounts/ramxak/projects/autexa-mobile/builds).

### 4.6 Загрузка в TestFlight

```bash
eas submit --profile production --platform ios --latest
```

Через 5-30 минут (Apple обработает) билд появится в App Store Connect →
TestFlight. Можешь добавить тестировщиков по email — они получат
приглашение в TestFlight-приложении на iPhone и поставят билд оттуда.

---

## 5. Способ D — Production в App Store

Когда захочешь выложить публично:

1. В App Store Connect для своего приложения заполни:
   - Описание (на русском)
   - Скриншоты (минимум 6.5", 5.5" iPhone — берём из симулятора)
   - Иконку 1024×1024 (уже есть в `assets/icon.png`)
   - Privacy Policy URL — обязательно (сделай простую страничку на autexa.pw/privacy)
   - Категория, age rating, ключевые слова
2. В TestFlight выбери последний билд → **Submit for Review**
3. Apple проверит за 1-3 дня
4. Approved → **Release this version** → приложение появится в App Store

`eas submit` после первой настройки — повторный пуш в Store одной командой.

---

## 6. Backend и сеть

- Приложение ходит на `https://autexa.pw/api` — задано в `app.json` → `extra.apiUrl`
- HTTPS на iOS работает из коробки (App Transport Security)
- Если поменяешь URL — поменяй и `app.json`, после `prebuild --clean` это попадёт в Info.plist
- Если когда-нибудь захочешь dev-API на http://localhost для отладки — нужно будет добавить ATS exception в `infoPlist.NSAppTransportSecurity`

---

## 7. Частые проблемы

**❌ "Could not find module 'expo-blur'"** при сборке
→ `cd mobile && npm install`, потом `npx expo prebuild --clean`

**❌ "Untrusted Developer" на iPhone**
→ Settings → General → VPN & Device Management → Developer App → Trust

**❌ "No bundle URL present"** (красный экран)
→ Metro не запущен. Запусти `npm start` в одном терминале + `npm run ios` в другом

**❌ "Signing certificate not found"** в Xcode
→ Signing & Capabilities → выбери Team заново. Если списка пусто — Xcode → Settings → Accounts → добавь Apple ID

**❌ Билд падает в EAS на этапе "Prebuild"**
→ Проверь что `app.json` валидный JSON, потом `eas build --platform ios --clear-cache`

**❌ TestFlight "Invalid bundle structure"**
→ Bump `buildNumber` в `app.json` (3 → 4 → 5), пересобрать

---

## 8. Что обновлять при каждом деплое

При каждой новой публичной сборке (TestFlight / App Store):
- `app.json` → `expo.version` — semver, видна юзерам ("3.0.0" → "3.0.1")
- `app.json` → `expo.ios.buildNumber` — целое число, должно расти ("3" → "4"). EAS делает это автоматом если `autoIncrement: true` в профиле.

Внутренние JS-обновления через `expo-updates` (уже подключено) — релизятся
без пересборки бинаря: `eas update --branch production`. Но это для
JS-only изменений, не работает для нативных пакетов.

---

## 9. Шпаргалка команд

```bash
# Ежедневная разработка (на симуляторе)
cd mobile
npm run ios

# На своём iPhone через Xcode
open mobile/ios/Autexa.xcworkspace
# затем выбери iPhone и нажми Run

# Сборка для TestFlight
cd mobile
eas build --profile production --platform ios

# Загрузка в App Store Connect
eas submit --profile production --platform ios --latest

# JS-only обновление существующего билда (без пересборки)
eas update --branch production --message "fix: что-то починил"
```
