# Autexa Android (Kotlin)

Нативное Android-приложение для AUTEXA CRM, работает с тем же NestJS
бэкендом что и PWA/React Native.

## Стек

| Слой | Технология |
|---|---|
| Язык | Kotlin 2.0 |
| UI | Jetpack Compose + Material 3 |
| Навигация | Compose Navigation |
| DI | Hilt (Dagger) |
| Сеть | Retrofit + OkHttp + kotlinx.serialization |
| Async | Coroutines + Flow |
| Хранилище | DataStore (токен) |
| Картинки | Coil |
| Минимум API | 24 (Android 7.0+) |
| Target API | 35 (Android 15) |

## Архитектура

MVVM + Clean Architecture lite:

```
ui/
  screens/
    login/        LoginScreen.kt + LoginViewModel.kt
    home/         HomeScreen.kt + HomeViewModel.kt
  theme/          Material3 palette + typography
  AutexaApp.kt    root composable (login vs home gate)

data/
  local/          TokenStore (DataStore)
  network/        Retrofit APIs, interceptors, DTOs
  repo/           Repositories (AuthRepository)

di/
  NetworkModule.kt  — Hilt providers

MainActivity.kt     — ComponentActivity entry
AutexaApplication.kt — @HiltAndroidApp
```

## Сборка

### Prerequisites

- JDK 17+ (`java -version`)
- Android Studio Koala or later — или Android SDK CLI с `build-tools 35.0.0`, `platform-tools`
- ANDROID_HOME переменная окружения, указывающая на SDK

### Первый запуск

```bash
cd android
# Для первого запуска нужен gradle-wrapper jar, скачать можно через Android Studio,
# либо выполнить: gradle wrapper --gradle-version 8.11.1 (если gradle установлен)

# После gradle-wrapper готов:
./gradlew :app:assembleDebug     # debug APK
./gradlew :app:assembleRelease   # release APK

# APK окажется в app/build/outputs/apk/
```

### В Android Studio

1. Открой Android Studio
2. **File → Open** → выбери `android/` (не сам zr-auto-pro)
3. Gradle sync запустится автоматически
4. Жми Run ▶

## Конфигурация

API endpoint задан в `app/build.gradle.kts`:

```kotlin
buildConfigField("String", "API_BASE_URL", "\"https://autexa.pw/api/\"")
```

Для локальной разработки (если backend запущен локально):
1. В эмуляторе `10.0.2.2` = `localhost` хоста. Можно задать отдельный build variant.
2. Или поменяй `API_BASE_URL` в debug блоке.

## Что уже работает

- ✅ Login flow (телефон + пароль → JWT → DataStore)
- ✅ Auto-login (при наличии токена — сразу Home)
- ✅ `/auth/me` подтягивает пользователя
- ✅ Logout — чистит токен, срабатывает revoke на сервере
- ✅ Material 3 + dynamic color (Android 12+)
- ✅ JWT interceptor на всех запросах кроме публичных

## Что добавить дальше (roadmap)

Паттерн для нового экрана (пример: Checks):

1. **Модели** — `data/network/models/ChecksModels.kt`
2. **API** — `data/network/ChecksApi.kt`
3. **Hilt provider** — добавить в `NetworkModule.kt`
4. **Repository** — `data/repo/ChecksRepository.kt`
5. **ViewModel** — `ui/screens/checks/ChecksViewModel.kt`
6. **UI** — `ui/screens/checks/ChecksScreen.kt`
7. **Навигация** — добавить NavHost когда экранов будет 3+

### Список эндпоинтов для интеграции

См. `ZR_AUTO_PRO_DOCUMENTATION.txt` в корне репо. Основные:

- `GET /api/checks` — список заказ-нарядов
- `POST /api/checks` — создать
- `GET /api/clients?search=...` — поиск клиентов
- `GET /api/products?limit=100` — товары
- `GET /api/schedule?dateFrom=...&dateTo=...` — расписание
- `GET /api/salary/my` — моя зарплата
- `GET /api/reports/financial` — отчёты
- etc.

Все требуют `Authorization: Bearer <token>` — интерсептор добавляет автоматически.

## Тесты

```bash
./gradlew :app:testDebugUnitTest            # юнит
./gradlew :app:connectedDebugAndroidTest    # на устройстве/эмуляторе
```

## Релиз

Для подписанной сборки:

1. Сгенерировать keystore:
   ```bash
   keytool -genkey -v -keystore autexa.keystore -alias autexa \
     -keyalg RSA -keysize 2048 -validity 10000
   ```

2. В `~/.gradle/gradle.properties`:
   ```
   AUTEXA_STORE_FILE=/путь/autexa.keystore
   AUTEXA_STORE_PASSWORD=...
   AUTEXA_KEY_ALIAS=autexa
   AUTEXA_KEY_PASSWORD=...
   ```

3. В `app/build.gradle.kts` добавить `signingConfigs { release { ... } }`.

4. Собрать: `./gradlew :app:assembleRelease`

## FAQ

**Q: Нужно ли поддерживать iOS?**
A: Нет — для iOS остаётся PWA (автэкса.pw через Safari → "Добавить на главный экран").

**Q: Как синхронизируются данные с PWA?**
A: Никак напрямую — оба клиента стучатся в тот же NestJS API. Источник истины — PostgreSQL на VDS. Изменение с PWA сразу видно в Android (после pull-to-refresh) и наоборот.

**Q: Где токен хранится?**
A: В Jetpack DataStore (encrypted preferences). Очищается при logout.
