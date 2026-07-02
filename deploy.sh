#!/bin/bash
# ============================================================
# ZR Auto Pro — Safe Deploy Script
# АВТОМАТИЧЕСКИ делает бэкап базы перед каждым обновлением.
# Данные клиентов НИКОГДА не удаляются.
#
# Использование: ./deploy.sh
# ============================================================

set -e

# When run from webhook container, repo is at /deploy/repo
# When run from host, it should be at /opt/zr-auto-pro
if [ -d "/deploy/repo" ]; then
    REPO_DIR="/deploy/repo"
else
    REPO_DIR="/opt/zr-auto-pro"
fi

BRANCH="${DEPLOY_BRANCH:-refactor/full-audit-2026}"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

# ── Deploy lock (защита от ПАРАЛЛЕЛЬНЫХ деплоев) ─────────────────────────────
# cron (scripts/auto-pull.sh на хосте) и webhook-контейнер могут вызвать этот
# скрипт ОДНОВРЕМЕННО — два параллельных `docker compose build/up` портят
# образы и гоняют recreate друг против друга. Лок-файл лежит в корне репо:
# репо bind-mounted в webhook-контейнер как /deploy/repo, поэтому хост и
# контейнер контендятся на ОДНОМ и том же inode. flock -n: второй деплой не
# ждёт, а тихо выходит (exit 0) — cron всё равно повторит через минуту, когда
# текущий деплой завершится. Fd 200 держит лок до конца процесса.
exec 200>"$REPO_DIR/.deploy.lock"
if command -v flock >/dev/null 2>&1; then
    flock -n 200 || {
        log "Another deploy is already in progress (lock: $REPO_DIR/.deploy.lock) — skipping."
        exit 0
    }
else
    # flock отсутствует (нестандартное окружение) — НЕ блокируем деплой,
    # иначе деплои перестали бы выполняться вовсе. Просто предупреждаем.
    log "WARNING: flock not available — proceeding WITHOUT deploy lock."
fi

# ── recreate_and_wait <service> [timeout_s] ──────────────────────────────────
# Force-recreate ONE service and block until its container is healthy (or
# timeout). Used for the rolling, one-replica-at-a-time backend recreate so the
# OTHER replica keeps serving /api the whole time. Returns non-zero on timeout
# (caller aborts the deploy).
recreate_and_wait() {
    local svc="$1"
    local timeout="${2:-90}"
    log "Rolling recreate: $svc ..."
    docker compose up -d --no-deps --force-recreate "$svc" 2>&1
    local deadline=$(( $(date +%s) + timeout ))
    local attempt=0
    while [ "$(date +%s)" -lt "$deadline" ]; do
        attempt=$((attempt + 1))
        local cid
        cid=$(docker compose ps -q "$svc" 2>/dev/null | head -1)
        local inside=0
        local dhealth="unknown"
        if [ -n "$cid" ]; then
            if docker exec "$cid" node -e "require('http').get('http://localhost:3000/api/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))" 2>/dev/null; then
                inside=1
            fi
            dhealth=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}nohealth{{end}}' "$cid" 2>/dev/null || echo "unknown")
        fi
        if [ "$dhealth" = "healthy" ] || [ "$inside" = "1" ]; then
            log "$svc healthy (attempt $attempt): docker=$dhealth inside=$inside"
            return 0
        fi
        log "$svc not ready yet (attempt $attempt): docker=$dhealth inside=$inside — retrying..."
        sleep 3
    done
    log "ERROR: $svc did NOT become healthy within ${timeout}s."
    docker compose logs --tail=50 "$svc" 2>&1 || true
    return 1
}

# ═════════════════════════════════════════════════════════════════════════════
# GHCR pull-режим — деплой БЕЗ тяжёлой сборки на проде (опционально).
# ═════════════════════════════════════════════════════════════════════════════
# Если на сервере в .env (или в окружении) задан GHCR_READ_TOKEN — PAT с
# ЕДИНСТВЕННЫМ scope read:packages — деплой НЕ собирает образы на VDS (раньше
# каждая сборка давала ~300% CPU), а скачивает готовые из GitHub Container
# Registry. Образы публикует .github/workflows/build-images.yml на каждый пуш
# в деплой-ветку и помечает label'ом org.opencontainers.image.revision=<sha>.
#
# Гарантия свежести: ждём (до GHCR_PULL_WAIT_S секунд, по умолчанию 480), пока
# label ОБОИХ образов совпадёт с git HEAD только что спуленного кода — иначе
# cron-деплой, стартующий через минуту после пуша, утащил бы предыдущий
# :latest и никогда бы не повторил попытку (нового коммита нет). CI не успел /
# токен не работает / GHCR лежит → return 1, и деплой автоматически падает
# обратно на ЛОКАЛЬНУЮ сборку с кэшем слоёв. Роллинг-рекреейт и все
# health-гейты дальше ИДЕНТИЧНЫ в обоих режимах.
GHCR_USER="ramxak2025"
GHCR_BACKEND_IMAGE="ghcr.io/ramxak2025/autexa-backend:latest"
GHCR_FRONTEND_IMAGE="ghcr.io/ramxak2025/autexa-frontend:latest"

ghcr_pull_images() {
    local token="${GHCR_READ_TOKEN:-}"
    # Токен можно держать в $REPO_DIR/.env — compose в контейнеры его НЕ
    # пробрасывает (используется только здесь). Значение НИКОГДА не логируем.
    if [ -z "$token" ] && [ -f "$REPO_DIR/.env" ]; then
        token="$(grep -E '^GHCR_READ_TOKEN=' "$REPO_DIR/.env" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '"' | tr -d "'" | tr -d '[:space:]')" || token=""
    fi
    if [ -z "$token" ]; then
        return 1  # pull-режим выключен → обычная локальная сборка
    fi

    log "[ghcr-pull] GHCR_READ_TOKEN задан — пробую готовые образы из GHCR (без сборки на проде)."
    if ! printf '%s' "$token" | docker login ghcr.io -u "$GHCR_USER" --password-stdin >/dev/null 2>&1; then
        log "[ghcr-pull] WARNING: docker login ghcr.io не удался (токен истёк / нет read:packages?) — локальная сборка."
        return 1
    fi

    local want_sha=""
    want_sha="$(git -C "$REPO_DIR" rev-parse HEAD 2>/dev/null)" || want_sha=""
    if [ -z "$want_sha" ]; then
        log "[ghcr-pull] WARNING: не смог определить git HEAD — локальная сборка."
        return 1
    fi

    local wait_s="${GHCR_PULL_WAIT_S:-480}"
    local deadline=$(( $(date +%s) + wait_s ))
    local brev="" frev=""
    while :; do
        docker compose pull -q backend frontend 2>&1 || log "[ghcr-pull] pull не удался (образов может ещё не быть) — жду CI..."
        brev="$(docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$GHCR_BACKEND_IMAGE" 2>/dev/null)" || brev=""
        frev="$(docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$GHCR_FRONTEND_IMAGE" 2>/dev/null)" || frev=""
        if [ "$brev" = "$want_sha" ] && [ "$frev" = "$want_sha" ]; then
            log "[ghcr-pull] Образы коммита $want_sha получены из GHCR — сборка на проде не нужна."
            return 0
        fi
        if [ "$(date +%s)" -ge "$deadline" ]; then
            log "[ghcr-pull] WARNING: за ${wait_s}с CI не опубликовал образы коммита $want_sha (backend=${brev:-нет} frontend=${frev:-нет}) — локальная сборка."
            return 1
        fi
        log "[ghcr-pull] CI ещё собирает образы коммита $want_sha (backend=${brev:-нет} frontend=${frev:-нет}) — повтор через 20с..."
        sleep 20
    done
}

# ═════════════════════════════════════════════════════════════════════════════
# domain-bootstrap — авто-подключение резервного домена autexa-cloud.ru.
# ═════════════════════════════════════════════════════════════════════════════
# TLS терминирует ХОСТОВОЙ nginx (пакет Ubuntu), он проксирует в докерный
# frontend-nginx (host-порт 8080 → 80 внутри контейнера, см. docker-compose.yml
# frontend.ports). Докерный nginx отдаёт ЛЮБОЙ Host (server_name _), поэтому
# для нового домена нужны только: site-конфиг на хосте + сертификат certbot.
#
# Шаг вызывается в САМОМ КОНЦЕ успешного деплоя и НИКОГДА его не роняет:
# любой сбой → WARNING в лог + return 0. Идемпотентен: маркер
# /etc/nginx/.autexa-cloud-ru.done = «уже подключено, мгновенный выход».
# Пока DNS владельца не доехал до сервера — шаг тихо пропускается на каждом
# деплое и сам сработает, когда A-записи станут видны с VDS.
#
# Безопасность боевого autexa.pw:
#   • существующие конфиги НЕ редактируются — только НОВЫЙ файл + симлинк;
#   • nginx -t перед reload; не прошёл → новый файл и симлинк удаляются;
#   • reload не удался → новый конфиг откатывается, nginx перечитывается;
#   • certbot вызывается только с -d autexa-cloud.ru (+www), после него
#     конфиг подтверждаем повторным nginx -t.

dblog() { log "[domain-bootstrap] $1"; }

# Пропускаем только цели вида http(s)://host[:port] БЕЗ URI-пути — у таких
# семантика «передать путь как есть», она безопасна под любым location.
# Хвостовой "/" срезаем: proxy_pass с URI ("/") подменяет путь, без URI — нет.
db_sanitize_target() {
    local t="${1%/}"
    case "$t" in
        http://* | https://*) ;;
        *)
            echo ""
            return 0
            ;;
    esac
    local rest="${t#*://}"
    case "$rest" in
        */*)
            echo ""
            return 0
            ;;
    esac
    echo "$t"
}

# Печатает location-блок с проксированием ($host и т.п. — литералы nginx).
db_proxy_location() {
    printf '    location %s {\n' "$1"
    printf '        proxy_pass %s;\n' "$2"
    printf '        proxy_http_version 1.1;\n'
    printf '        proxy_set_header Host $host;\n'
    printf '        proxy_set_header X-Real-IP $remote_addr;\n'
    printf '        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n'
    printf '        proxy_set_header X-Forwarded-Proto $scheme;\n'
    printf '        proxy_read_timeout 90s;\n'
    printf '        proxy_send_timeout 90s;\n'
    printf '    }\n'
}

domain_bootstrap_autexa_cloud_ru() {
    local marker="/etc/nginx/.autexa-cloud-ru.done"
    local site_av="/etc/nginx/sites-available/autexa-cloud.ru"
    local site_en="/etc/nginx/sites-enabled/autexa-cloud.ru"
    local tout=""

    # 1. Уже подключён? — мгновенный выход без логов.
    if [ -f "$marker" ]; then
        return 0
    fi

    # 2. Работаем только на хосте с nginx. Из webhook-контейнера (alpine, без
    #    nginx и без /etc/nginx хоста) шаг тихо пропускается — его выполнит
    #    cron-деплой, который идёт на самом хосте.
    if ! command -v nginx >/dev/null 2>&1 || [ ! -d /etc/nginx/sites-available ] || [ ! -d /etc/nginx/sites-enabled ]; then
        dblog "хостовой nginx недоступен из этого окружения (webhook-контейнер?) — пропускаю."
        return 0
    fi

    # 2.5. Незавершённый прошлый прогон: certbot уже вписал TLS в наш конфиг,
    #      но маркер не записался (например, упал reload). Доводим до конца и
    #      НЕ перегенерируем файл — иначе стёрли бы TLS-блоки certbot'а.
    if [ -f "$site_av" ] && grep -qs 'ssl_certificate' "$site_av"; then
        ln -sfn "$site_av" "$site_en" 2>/dev/null || true
        if tout="$(nginx -t 2>&1)"; then
            nginx -s reload >/dev/null 2>&1 || systemctl reload nginx >/dev/null 2>&1 || true
            touch "$marker" 2>/dev/null || dblog "WARNING: не смог записать маркер $marker."
            dblog "autexa-cloud.ru подключён (TLS был выпущен ранее)."
        else
            dblog "WARNING: nginx -t не прошёл с ранее созданным TLS-конфигом — нужен взгляд вручную: $(echo "$tout" | tail -3 | tr '\n' ' ')"
        fi
        return 0
    fi

    # 3. DNS-guard: ОБА имени должны указывать на ЭТОТ сервер, иначе выходим.
    if ! command -v getent >/dev/null 2>&1; then
        dblog "WARNING: getent недоступен — не могу проверить DNS, пропускаю."
        return 0
    fi
    local self_ips="" public_ip="" acceptable=""
    self_ips="$(hostname -I 2>/dev/null | tr -s ' \t\n' '   ')" || self_ips=""
    public_ip="$(curl -s --max-time 5 ifconfig.me 2>/dev/null)" || public_ip=""
    # ifconfig.me мог вернуть мусор/HTML — принимаем только чистый IPv4.
    echo "$public_ip" | grep -Eq '^([0-9]{1,3}\.){3}[0-9]{1,3}$' || public_ip=""
    acceptable="212.8.229.254 $self_ips $public_ip"

    local name="" resolved="" ip="" matched=""
    for name in autexa-cloud.ru www.autexa-cloud.ru; do
        resolved="$(getent hosts "$name" 2>/dev/null | awk '{print $1}' | sort -u | tr '\n' ' ')" || resolved=""
        if [ -z "$(echo "$resolved" | tr -d ' ')" ]; then
            dblog "$name не резолвится — домен ещё не указывает на сервер, пропускаю."
            return 0
        fi
        matched=0
        for ip in $resolved; do
            case " $acceptable " in
                *" $ip "*)
                    matched=1
                    break
                    ;;
            esac
        done
        if [ "$matched" != "1" ]; then
            dblog "$name резолвится в [${resolved% }], IP сервера — [$acceptable] — домен ещё не указывает на сервер, пропускаю."
            return 0
        fi
    done
    dblog "DNS OK: autexa-cloud.ru и www.autexa-cloud.ru указывают на этот сервер."

    # 4. Источник правды для proxy_pass — действующий конфиг autexa.pw
    #    (предпочитаем файл, в котором есть и autexa.pw, и proxy_pass).
    local src="" f=""
    for f in $(grep -ls 'autexa\.pw' /etc/nginx/sites-enabled/* 2>/dev/null); do
        case "$f" in *autexa-cloud.ru*) continue ;; esac # свой конфиг не парсим
        if grep -qs 'proxy_pass' "$f"; then
            src="$f"
            break
        fi
    done
    if [ -z "$src" ]; then
        src="$(grep -ls 'autexa\.pw' /etc/nginx/sites-enabled/* 2>/dev/null | grep -v 'autexa-cloud\.ru' | head -1)" || src=""
    fi

    # Парсим proxy_pass ТОЛЬКО для location / и /api (модификаторы =, ~, ~*,
    # ^~ учитываются). Остальные location сознательно НЕ копируем — задача
    # резервного домена: PWA + /api, минимальный заведомо-рабочий конфиг.
    local root_target="" api_target=""
    if [ -n "$src" ]; then
        root_target="$(awk '
            /^[[:space:]]*location[[:space:]]/ {
                cur = $2
                if (cur == "=" || cur == "~" || cur == "~*" || cur == "^~") cur = $3
            }
            /^[[:space:]]*proxy_pass[[:space:]]/ {
                t = $2; sub(/;.*/, "", t)
                if (cur == "/" && root == "") root = t
            }
            END { print root }
        ' "$src" 2>/dev/null)" || root_target=""
        api_target="$(awk '
            /^[[:space:]]*location[[:space:]]/ {
                cur = $2
                if (cur == "=" || cur == "~" || cur == "~*" || cur == "^~") cur = $3
            }
            /^[[:space:]]*proxy_pass[[:space:]]/ {
                t = $2; sub(/;.*/, "", t)
                if ((cur == "/api" || cur == "/api/") && api == "") api = t
            }
            END { print api }
        ' "$src" 2>/dev/null)" || api_target=""
    fi
    root_target="$(db_sanitize_target "$root_target")"
    api_target="$(db_sanitize_target "$api_target")"
    if [ -z "$root_target" ]; then
        # Fallback, известный из НАШЕГО docker-compose.yml: frontend публикует
        # host-порт 8080 (ports: "8080:80") — докерный nginx примет любой Host.
        root_target="http://127.0.0.1:8080"
        dblog "proxy_pass из ${src:-<конфиг autexa.pw не найден>} не распарсился — беру заведомо-рабочий $root_target (host-порт докерного frontend)."
    else
        dblog "proxy_pass взят из $src: / → $root_target${api_target:+, /api → $api_target}."
    fi

    # 5. Генерируем НОВЫЙ минимальный port-80 конфиг (существующие не трогаем).
    local tmp_cfg="${site_av}.tmp.$$"
    {
        echo "# Autexa: резервный домен autexa-cloud.ru — проксирует в тот же докерный frontend, что и основной домен."
        echo "# Сгенерировано автоматически deploy.sh [domain-bootstrap]. HTTP-этап; TLS добавляет certbot --nginx."
        echo "server {"
        echo "    listen 80;"
        echo "    server_name autexa-cloud.ru www.autexa-cloud.ru;"
        echo ""
        echo "    # Загрузка фото идёт через /api — лимит с запасом к backend'овским 50mb."
        echo "    client_max_body_size 64m;"
        echo ""
        if [ -n "$api_target" ] && [ "$api_target" != "$root_target" ]; then
            db_proxy_location "/api" "$api_target"
            echo ""
        fi
        db_proxy_location "/" "$root_target"
        echo "}"
    } > "$tmp_cfg" 2>/dev/null || {
        dblog "WARNING: не смог записать $tmp_cfg (права?) — пропускаю."
        rm -f "$tmp_cfg" 2>/dev/null
        return 0
    }
    if ! mv -f "$tmp_cfg" "$site_av" 2>/dev/null; then
        dblog "WARNING: не смог записать $site_av (права?) — пропускаю."
        rm -f "$tmp_cfg" 2>/dev/null
        return 0
    fi
    if ! ln -sfn "$site_av" "$site_en" 2>/dev/null; then
        dblog "WARNING: не смог создать симлинк $site_en — откатываю."
        rm -f "$site_av" 2>/dev/null
        return 0
    fi

    # 6. Гейт nginx -t: битый конфиг → полный откат, боевой autexa.pw не тронут.
    if ! tout="$(nginx -t 2>&1)"; then
        dblog "WARNING: nginx -t не прошёл с новым конфигом — откатываю (autexa.pw не тронут): $(echo "$tout" | tail -3 | tr '\n' ' ')"
        rm -f "$site_en" "$site_av" 2>/dev/null
        return 0
    fi
    if ! nginx -s reload >/dev/null 2>&1 && ! systemctl reload nginx >/dev/null 2>&1; then
        dblog "WARNING: nginx reload не удался — откатываю новый конфиг."
        rm -f "$site_en" "$site_av" 2>/dev/null
        nginx -s reload >/dev/null 2>&1 || systemctl reload nginx >/dev/null 2>&1 || true
        return 0
    fi
    dblog "HTTP-конфиг autexa-cloud.ru включён (порт 80). Выпускаю сертификат..."

    # 7. certbot: обычный бинарь или snap. Нет ни того, ни другого → HTTP-конфиг
    #    остаётся жить, TLS доделается на следующем деплое после установки certbot.
    local certbot_bin=""
    if command -v certbot >/dev/null 2>&1; then
        certbot_bin="certbot"
    elif [ -x /snap/bin/certbot ]; then
        certbot_bin="/snap/bin/certbot"
    else
        dblog "WARNING: certbot не найден (ни в PATH, ни /snap/bin/certbot) — домен пока работает по HTTP, TLS добавим на следующем деплое."
        return 0
    fi
    local cb_out=""
    if ! cb_out="$("$certbot_bin" --nginx -d autexa-cloud.ru -d www.autexa-cloud.ru --non-interactive --agree-tos -m ramxak4@gmail.com --redirect 2>&1)"; then
        dblog "WARNING: certbot не выпустил сертификат (DNS ещё не виден Let's Encrypt?) — HTTP-конфиг оставлен, повторим на следующем деплое: $(echo "$cb_out" | tail -4 | tr '\n' ' ')"
        return 0
    fi
    if ! tout="$(nginx -t 2>&1)"; then
        dblog "WARNING: nginx -t после certbot не прошёл — маркер не пишу, нужен взгляд вручную: $(echo "$tout" | tail -3 | tr '\n' ' ')"
        return 0
    fi
    nginx -s reload >/dev/null 2>&1 || systemctl reload nginx >/dev/null 2>&1 || true
    touch "$marker" 2>/dev/null || dblog "WARNING: не смог записать маркер $marker (шаг идемпотентен — просто повторится)."
    dblog "autexa-cloud.ru подключён: сертификат выпущен, HTTPS и redirect активны."
    return 0
}

log "=== Starting deploy ==="
log "Repo: $REPO_DIR"
log "Branch: $BRANCH"

cd "$REPO_DIR"

# ═══════════════════════════════════════════════════════
# STEP -1: Освобождаем диск ПЕРЕД бэкапом и сборкой.
# Причина: за день из нескольких деплоев диск забивается старыми
# образами и дампами → `docker build` падает на «no space», и старый
# контейнер продолжает отдавать устаревший код. Эта очистка делает
# деплой самовосстанавливающимся и идемпотентна.
#
# ВАЖНО про порядок (кэш сборки НЕ трогаем перед сборкой):
#   • `docker image prune -af` (здесь, ДО сборки) удаляет только неиспользуемые
#     ОБРАЗЫ (dangling + без контейнеров); BuildKit-кэш СЛОЁВ живёт отдельно
#     и этот prune переживает — сборка ниже переиспользует его;
#   • `docker builder prune` переехал В КОНЕЦ успешного деплоя и работает с
#     --keep-storage=4GB (LRU): свежие слои, которые сборка только что
#     использовала, сохраняются, кэш жёстко ограничен 4GB — диск в
#     безопасности, как и раньше.
# Эффект: деплой с JS-only изменениями пересобирается за секунды по кэшу
# (раньше `--no-cache` + полный сброс кэша давали полную пересборку с
# ~300% CPU на каждый пуш).
# pgdata НЕ трогаем: prune без --volumes, ротация только в backups/.
# ═══════════════════════════════════════════════════════
log "=== Freeing disk before deploy (prune unused images, rotate backups) ==="
df -h / 2>&1 | tail -1 || true
docker image prune -af 2>&1 || true
# Держим только 10 самых свежих файлов КАЖДОГО типа в backups/ (по mtime).
# Раздельные паттерны: большие uploads-архивы не должны вытеснять SQL-дампы
# из окна хранения (и наоборот).
if [ -d "$REPO_DIR/backups" ]; then
    ls -t "$REPO_DIR"/backups/*.sql.gz 2>/dev/null | tail -n +11 | xargs -r rm -f 2>&1 || true
    ls -t "$REPO_DIR"/backups/*.sql 2>/dev/null | tail -n +11 | xargs -r rm -f 2>&1 || true
    ls -t "$REPO_DIR"/backups/uploads_*.tar.gz 2>/dev/null | tail -n +11 | xargs -r rm -f 2>&1 || true
fi
df -h / 2>&1 | tail -1 || true

# ═══════════════════════════════════════════════════════
# STEP 0: AUTOMATIC BACKUP before any changes
# ═══════════════════════════════════════════════════════
log "=== Creating backup before deploy ==="
if bash "$REPO_DIR/backup.sh" 2>&1; then
    log "Backup completed successfully"
else
    log "WARNING: Backup failed, but continuing deploy..."
    log "Check backup.sh manually if needed"
fi

# ═══════════════════════════════════════════════════════
# STEP 1: Pull latest code (safely)
# ═══════════════════════════════════════════════════════
log "Fetching branch: $BRANCH"
git fetch origin "$BRANCH" 2>&1
git checkout "$BRANCH" 2>&1 || true

# Stash any local changes instead of destroying them
if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
    log "Stashing local changes..."
    git stash push -m "auto-stash before deploy $(date '+%Y%m%d-%H%M%S')" 2>&1 || true
fi

git merge --ff-only "origin/$BRANCH" 2>&1 || {
    log "ERROR: Cannot fast-forward merge. Manual intervention required."
    log "Local branch has diverged from origin/$BRANCH"
    exit 1
}

log "Git pull complete. Latest commit:"
git log --oneline -1 2>&1

# ═══════════════════════════════════════════════════════
# STEP 1.5: Копируем последний APK в папку для скачивания
# ═══════════════════════════════════════════════════════
mkdir -p "$REPO_DIR/downloads"
LATEST_APK=$(ls -t "$REPO_DIR"/Autexa-v*.apk 2>/dev/null | head -1)
if [ -n "$LATEST_APK" ]; then
    cp "$LATEST_APK" "$REPO_DIR/downloads/Autexa.apk"
    log "APK для скачивания обновлён: $LATEST_APK → downloads/Autexa.apk"
else
    log "APK файл не найден — пропускаем"
fi

# ═══════════════════════════════════════════════════════
# STEP 2: ROLLING zero-downtime rebuild + recreate.
# Volume pgdata is NEVER touched — data is safe.
#
# Два backend-реплики (backend + backend2) за nginx-апстримом + idempotent
# proxy_next_upstream фейловер. Порядок критичен:
#   образы (GHCR pull или локальная сборка) → backend2 (recreate + ЖДЁМ healthy)
#   → nginx -t гейт → frontend → лидер backend (recreate + ЖДЁМ healthy).
# Лидера трогаем ТОЛЬКО после того, как backend2 реально прошёл health-гейт.
# Раньше здесь был голый `up -d backend2` без ожидания — лидер убивался, пока
# backend2 ещё бутился/мигрировал → окно «обе реплики мертвы» (502/504).
# ═══════════════════════════════════════════════════════
# Получаем свежие образы: pull из GHCR (если задан GHCR_READ_TOKEN — см.
# ghcr_pull_images выше) или локальная сборка С КЭШЕМ слоёв.
# `--no-cache` убран сознательно: BuildKit сам инвалидирует слои по чек-суммам
# COPY/ARG, а слой `npm install` переиспользуется, пока не менялись
# package*.json → JS-only деплой собирается за секунды вместо полной
# пересборки с ~300% CPU. Зависимости поменялись → слой пересоберётся сам.
# (Свежесть базового node:20-alpine и раньше не обновлялась: --no-cache
# не делает --pull — здесь ничего не деградировало.)
if ghcr_pull_images; then
    log "Images ready from GHCR — skipping on-prod build."
else
    log "Rebuilding backend + frontend images locally (layer cache ON)..."
    docker compose build backend frontend 2>&1
fi

# Пересоздать ВТОРУЮ реплику (HTTP-only) на новом образе и ДОЖДАТЬСЯ health.
# Пока backend2 бутится/мигрирует — лидер продолжает отдавать /api на старом
# коде. Если backend2 не поднялся — ABORT: лидер и старый frontend не тронуты,
# прод продолжает работать на старом коде.
if ! recreate_and_wait backend2; then
    log "=== Deploy FAILED (backend2 unhealthy after recreate — leader untouched, old code still serving) ==="
    docker compose ps 2>&1 || true
    exit 1
fi

# ── ГЛАВНЫЙ предохранитель против аварии «битый nginx уронил /api» ──────────
# Проверяем НОВЫЙ frontend-образ `nginx -t` во ВРЕМЕННОМ контейнере, прицепленном
# к compose-сети, чтобы `backend`/`backend2` в статическом upstream резолвились.
# Если конфиг битый — ABORT СЕЙЧАС: старый frontend продолжает отдавать сайт.
log "Validating new nginx config (nginx -t) in-network..."
if ! docker compose run --rm --no-deps frontend nginx -t 2>&1; then
    log "ERROR: new nginx config failed nginx -t — ABORTING deploy. Old frontend still serving."
    exit 1
fi
log "nginx config OK."

# Пересоздать frontend (новый nginx: 2-реплики upstream + фейловер). Короткий
# blip статики (~1-2с) — как и при обычном веб-деплое; /api переживает за счёт
# двух живых backend-реплик.
log "Recreating frontend (new nginx with failover)..."
docker compose up -d --no-deps --force-recreate frontend 2>&1

# Пересоздать ЛИДЕРА. backend2 уже здоров на новом коде (гейт выше) — nginx
# фейловерит на него, пока лидер пересоздаётся: пользователь не видит 502/504.
# Повторный recreate backend2 здесь НЕ нужен — он уже на новом образе.
if ! recreate_and_wait backend; then
    log "=== Deploy FAILED (backend unhealthy after recreate) ==="
    docker compose ps 2>&1 || true
    exit 1
fi

# ═══════════════════════════════════════════════════════
# STEP 2.5: Финальный public-path gate — nginx реально маршрутизирует на /api.
# Подтверждаем 200 через публичный путь (localhost:8080/api/health) — значит
# nginx переразрешил новые IP реплик и фейловер работает.
# ═══════════════════════════════════════════════════════
log "Confirming public /api/health (timeout 30s)..."
PUBLIC_DEADLINE=$(( $(date +%s) + 30 ))
PUBLIC_OK=0
while [ "$(date +%s)" -lt "$PUBLIC_DEADLINE" ]; do
    PUBLIC_CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://localhost:8080/api/health 2>/dev/null || echo "000")
    if [ "$PUBLIC_CODE" = "200" ]; then
        PUBLIC_OK=1
        log "Public /api/health: 200 OK"
        break
    fi
    log "Public /api/health not 200 yet ($PUBLIC_CODE) — retrying..."
    sleep 3
done
if [ "$PUBLIC_OK" != "1" ]; then
    log "ERROR: public /api/health never returned 200 after rolling deploy."
    docker compose logs --tail=50 frontend 2>&1 || true
    docker compose ps 2>&1 || true
    log "=== Deploy FAILED (public path unhealthy) ==="
    exit 1
fi

# Check status
log "Container status:"
docker compose ps 2>&1

# ═══════════════════════════════════════════════════════
# STEP 3: Пост-деплойные шаги. НИКОГДА не роняют уже успешный деплой.
# ═══════════════════════════════════════════════════════
# 3a. Авто-подключение резервного домена autexa-cloud.ru: идемпотентно
#     (маркер), тихо ждёт, пока DNS владельца доедет до сервера, затем само
#     включает host-nginx-конфиг + certbot TLS. Любой сбой → WARNING + продолжаем.
domain_bootstrap_autexa_cloud_ru || true

# 3b. Уборка диска ПОСЛЕ успешного деплоя.
# Dangling-образы (старые слои, с которых съехали теги) — безопасно удалить.
docker image prune -f 2>&1 || true
# BuildKit-кэш подрезаем ИМЕННО ЗДЕСЬ (после сборки, не перед ней) и НЕ
# подчистую: --keep-storage=4GB выселяет кэш по LRU, СОХРАНЯЯ свежие слои,
# которые только что использовала сборка (npm install и т.д.). Следующий
# JS-only деплой соберётся за секунды. Диск в безопасности: кэш жёстко
# ограничен 4GB. --max-used-space — новое имя того же флага в свежих docker;
# последний fallback чистит хотя бы dangling-кэш, но НИКОГДА не сносит кэш
# целиком (это вернуло бы полные пересборки с ~300% CPU).
docker builder prune -af --keep-storage=4GB 2>&1 \
    || docker builder prune -af --max-used-space=4GB 2>&1 \
    || docker builder prune -f 2>&1 \
    || true

log "=== Deploy complete ==="
log ""
log "IMPORTANT: Data is safe. Backups are in: $REPO_DIR/backups/"
log "To restore: ./restore.sh"

# deploy trigger: 2026-06-19 (rolling 2-replica zero-downtime + in-network nginx -t gate)
# deploy trigger: 2026-07-02 (cached builds + GHCR pull-mode + autexa-cloud.ru domain bootstrap)
