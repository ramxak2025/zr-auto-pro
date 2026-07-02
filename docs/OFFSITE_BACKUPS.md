# Offsite-бэкапы в S3 (защита от «сгорел VDS — потеряно всё»)

## Зачем

Сейчас `backup.sh` (вызывается автоматически на каждом деплое, STEP 0 в `deploy.sh`)
складывает дамп базы (`zr_auto_pro_*.sql.gz`) и архив фото/документов
(`uploads_*.tar.gz`) в `/opt/zr-auto-pro/backups/` — **на тот же диск, где живёт
прод**. Если VDS сгорит, диск умрёт или сервер удалят — пропадут и база, и все
бэкапы одновременно.

Offsite-шаг закрывает этот риск: сразу после каждого успешного локального бэкапа
свежие файлы дополнительно выгружаются в **S3-бакет** — независимое хранилище,
которое живёт отдельно от диска VDS.

Механизм **спящий по умолчанию**: пока в серверном `.env` нет ключей — ничего не
меняется, в логе одна строка `[offsite] offsite не настроен — пропускаю.`
(тот же паттерн, что у GHCR pull-режима деплоя).

## Как это работает

- После успешного `pg_dump` + `tar` скрипт проверяет четыре переменные
  `S3_BACKUP_*` (в окружении или в `/opt/zr-auto-pro/.env`). Заданы все четыре →
  выгрузка включается.
- Выгружаются **только файлы, созданные в этом запуске**: свежий SQL-дамп и (если
  создался) свежий uploads-архив. Кладутся в бакет в папку `<бакет>/autexa/`.
- Инструмент — докеризованный `rclone` (`rclone/rclone:latest`), без
  конфиг-файла: remote описывается переменными окружения. На сервер ничего
  ставить не нужно — docker уже есть.
- **Ретенция в бакете**: после выгрузки удаляются offsite-файлы старше
  `S3_BACKUP_RETENTION_DAYS` дней (по умолчанию 30). Локальная ротация
  (последние N файлов на диске) работает как раньше, независимо.
- **Безопасность деплоя**: любая ошибка offsite (нет сети, неверный ключ, бакет
  недоступен) — только громкий `[offsite] WARNING:` в логе. Локальный бэкап уже
  создан и проверен, деплой продолжается. Offsite не может уронить ни бэкап, ни
  деплой.
- **Секреты не логируются**: значения ключей не печатаются и не попадают в
  командную строку docker (передаются через окружение процесса).

То же зеркально работает в ручном `scripts/backup.sh` (запуск из корня репо).

## Завести бакет за 5 минут (Beget — вы уже там)

1. Панель Beget → **Облачные хранилища** (Cloud → S3-хранилище) →
   **Создать хранилище/бакет**. Имя, например, `autexa-backups`. Доступ —
   **приватный** (публичный доступ выключен — в бакете будет дамп базы!).
2. Там же Beget покажет/позволит создать **ключи доступа**: Access Key и
   Secret Key. Скопируйте оба.
3. Endpoint у Beget: `https://s3.ru1.storage.beget.cloud`.

Альтернативы (любой S3-совместимый провайдер, шаги те же: бакет → ключи → endpoint):

| Провайдер               | Endpoint                             |
| ----------------------- | ------------------------------------ |
| Beget Cloud S3          | `https://s3.ru1.storage.beget.cloud` |
| Selectel Object Storage | `https://s3.storage.selcloud.ru`     |
| Yandex Object Storage   | `https://storage.yandexcloud.net`    |

Честная заметка: объектное хранилище Beget — отдельная инфраструктура, не диск
вашего VDS, так что риск «сгорел сервер» оно закрывает. Параноидальный максимум —
бакет у **другого** провайдера (Selectel/Yandex), тогда не страшна даже авария
всего аккаунта Beget.

## Что добавить на сервер

Пять строк в `/opt/zr-auto-pro/.env` (файл уже существует — дописать в конец):

```bash
S3_BACKUP_ENDPOINT=https://s3.ru1.storage.beget.cloud
S3_BACKUP_BUCKET=autexa-backups
S3_BACKUP_ACCESS_KEY=ВАШ_ACCESS_KEY
S3_BACKUP_SECRET_KEY=ВАШ_SECRET_KEY
S3_BACKUP_RETENTION_DAYS=30
```

Перезапускать ничего не нужно: переменные читает только `backup.sh` при каждом
запуске; в контейнеры docker-compose они не пробрасываются (в
`docker-compose.yml` только явные списки `environment:`, без `env_file`).

## Как проверить, что работает

1. Дождитесь следующего деплоя (любой пуш в деплой-ветку) — или запустите бэкап
   вручную на сервере:

   ```bash
   cd /opt/zr-auto-pro && bash backup.sh
   ```

2. Посмотрите лог (при деплое через cron):

   ```bash
   grep offsite /var/log/zr-autodeploy.log | tail -20
   ```

   Ожидаемые строки:

   ```
   [offsite] Загружаю zr_auto_pro_2026-07-02_....sql.gz → autexa-backups/autexa/ ...
   [offsite] OK: zr_auto_pro_2026-07-02_....sql.gz загружен.
   [offsite] OK: uploads_2026-07-02_....tar.gz загружен.
   [offsite] Ретенция: offsite-файлы старше 30 дн. удалены.
   [offsite] Offsite-копия готова: autexa-backups/autexa/ (ретенция 30 дн.).
   ```

   Если видите `[offsite] WARNING:` — читайте текст рядом: чаще всего опечатка в
   endpoint/ключах или бакет не создан (скрипт бакет **не создаёт**).

3. Убедитесь, что файлы реально в бакете: проще всего — в веб-панели провайдера
   (Beget → Облачные хранилища → ваш бакет → папка `autexa/`). Либо с сервера:

   ```bash
   cd /opt/zr-auto-pro
   set -a; . ./.env; set +a
   docker run --rm \
     -e RCLONE_CONFIG_OFFSITE_TYPE=s3 \
     -e RCLONE_CONFIG_OFFSITE_PROVIDER=Other \
     -e RCLONE_CONFIG_OFFSITE_ENDPOINT="$S3_BACKUP_ENDPOINT" \
     -e RCLONE_CONFIG_OFFSITE_ACCESS_KEY_ID="$S3_BACKUP_ACCESS_KEY" \
     -e RCLONE_CONFIG_OFFSITE_SECRET_ACCESS_KEY="$S3_BACKUP_SECRET_KEY" \
     rclone/rclone:latest lsl "offsite:$S3_BACKUP_BUCKET/autexa/"
   ```

## Как восстановиться из offsite-копии

Сценарий: VDS погиб, поднят новый сервер. Порядок:

1. **Поднять проект** на новом сервере как обычно: `git clone` в
   `/opt/zr-auto-pro`, создать `.env` (включая те же `S3_BACKUP_*`),
   `docker compose up -d` — контейнер postgres должен работать (пустая база —
   нормально, сейчас зальём).

2. **Скачать свежие копии из бакета** обратно в `backups/`:

   ```bash
   cd /opt/zr-auto-pro
   mkdir -p backups
   set -a; . ./.env; set +a
   docker run --rm \
     -v /opt/zr-auto-pro/backups:/backups \
     -e RCLONE_CONFIG_OFFSITE_TYPE=s3 \
     -e RCLONE_CONFIG_OFFSITE_PROVIDER=Other \
     -e RCLONE_CONFIG_OFFSITE_ENDPOINT="$S3_BACKUP_ENDPOINT" \
     -e RCLONE_CONFIG_OFFSITE_ACCESS_KEY_ID="$S3_BACKUP_ACCESS_KEY" \
     -e RCLONE_CONFIG_OFFSITE_SECRET_ACCESS_KEY="$S3_BACKUP_SECRET_KEY" \
     rclone/rclone:latest copy "offsite:$S3_BACKUP_BUCKET/autexa/" /backups
   ```

   (Скачает всё содержимое `autexa/`; если нужно только самое свежее — добавьте
   имя конкретного файла: `... copy "offsite:$S3_BACKUP_BUCKET/autexa/zr_auto_pro_<дата>.sql.gz" /backups`.)

3. **Восстановить базу** — `restore.sh` существует в корне репо и восстанавливает
   **только базу данных** (gunzip → psql внутрь контейнера postgres). Без
   аргумента берёт самый свежий `backups/zr_auto_pro_*.sql.gz`; спросит
   интерактивное подтверждение `yes`:

   ```bash
   ./restore.sh                                      # последний дамп
   ./restore.sh backups/zr_auto_pro_<дата>.sql.gz    # конкретный дамп
   docker compose restart backend
   ```

4. **Восстановить фото/документы (uploads)** — `restore.sh` их **НЕ трогает**,
   это делается одной ручной командой (распаковка архива в docker-volume):

   ```bash
   docker run --rm \
     -v zr-auto-pro_uploads:/data \
     -v /opt/zr-auto-pro/backups:/backup:ro \
     alpine sh -c "tar xzf /backup/uploads_<дата>.tar.gz -C /data"
   ```

   Имя volume на новом сервере то же — `zr-auto-pro_uploads` (создаётся
   `docker compose up`). Проверить: `docker volume ls | grep uploads`.

## Ограничения и честные заметки

- **Бакет должен существовать заранее** — выгрузка идёт с
  `--s3-no-check-bucket` (не требует прав на создание бакетов и лишних запросов),
  скрипт его не создаёт.
- Образ `rclone/rclone:latest` (~25 МБ) докачивается при первом запуске; из-за
  `docker image prune -af` в начале каждого деплоя он, как и `alpine` для
  uploads-архива, может докачиваться на каждом деплое — это секунды и уже
  существующее поведение для alpine.
- Offsite-шаг стоит **после** локального бэкапа: если сам pg_dump упал, offsite
  не запускается (нечего выгружать) — деплой при этом, как и раньше, продолжается
  с WARNING.
- В бакете будет **полный дамп базы** (клиенты, телефоны, деньги). Бакет —
  только приватный, ключи — только в серверном `.env` (в git не коммитим,
  `.env.example` — шаблон).
- Ретенция offsite (по возрасту, дни) и локальная ротация (по количеству файлов)
  — независимые механизмы; менять одну не значит менять другую.
