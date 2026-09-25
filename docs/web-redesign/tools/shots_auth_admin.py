"""
Скриншоты группы «вход · база знаний · superadmin» (фаза B).

Отдельный сценарий от shots.py, потому что у этой группы три разных состояния
авторизации: страница входа снимается анонимно, база знаний — демо-директором,
панель платформы — суперадмином (локальный пользователь +79990000001 /
Superadmin2026, создаётся только в локальной базе, см. отчёт фазы B).

    .venv/bin/python docs/web-redesign/tools/shots_auth_admin.py before
    .venv/bin/python docs/web-redesign/tools/shots_auth_admin.py after login,knowledge
    SHOT_OUT=/tmp/wip .venv/bin/python docs/web-redesign/tools/shots_auth_admin.py wip

Имена файлов: <prefix>-<page>-1440.png / <prefix>-<page>-375.png.
"""
import os
import re
import sys

from playwright.sync_api import TimeoutError as PWTimeout
from playwright.sync_api import sync_playwright

BASE = 'http://localhost:5173'
OUT = os.environ.get('SHOT_OUT', '/Users/ramazan/Proects/zr-auto-pro/docs/web-redesign/screenshots')
DIRECTOR = ('+79000000000', 'AutexaDemo2026')
SUPERADMIN = ('+79990000001', 'Superadmin2026')
DEMO_TENANT_ID = 'de100000-0000-4000-a000-000000000002'
ARTICLE_TITLE = 'Как принимать автомобиль у клиента'

prefix = sys.argv[1] if len(sys.argv) > 1 else 'before'
only = set(sys.argv[2].split(',')) if len(sys.argv) > 2 else None

logs: dict[str, list[str]] = {}


def want(name: str) -> bool:
    return only is None or name in only or name.split('-')[0] in only


def settle(page, ms=900):
    try:
        page.wait_for_load_state('networkidle', timeout=12000)
    except PWTimeout:
        pass
    page.wait_for_timeout(ms)


def attach(page, key):
    logs.setdefault(key, [])
    page.on(
        'console',
        lambda m: logs[key].append(f'[{m.type}] {m.text[:200]}') if m.type in ('error', 'warning') else None,
    )
    page.on('pageerror', lambda e: logs[key].append(f'[pageerror] {str(e)[:200]}'))
    page.on('requestfailed', lambda r: logs[key].append(f'[requestfailed] {r.url[:120]} {r.failure}'))
    # Какой именно запрос ответил 4xx/5xx — иначе в консоли только «Failed to load resource».
    page.on(
        'response',
        lambda r: logs[key].append(f'[http {r.status}] {r.request.method} {r.url[:140]}') if r.status >= 400 else None,
    )


def shot(page, name, width):
    if not want(name):
        return
    page.screenshot(path=f'{OUT}/{prefix}-{name}-{width}.png')
    print('shot', name, width, '→ issues:', len(logs.get(page._shot_key, [])))


def login(page, creds, expect, pick_point=None):
    page.goto(BASE + '/login')
    settle(page, 300)
    page.fill('#phone', creds[0])
    page.fill('#password', creds[1])
    page.click('button[type=submit]')
    if pick_point:
        try:
            page.locator(f'text={pick_point}').first.wait_for(timeout=6000)
            page.locator(f'text={pick_point}').first.click()
        except PWTimeout:
            pass
    page.wait_for_url(re.compile(expect), timeout=20000)
    settle(page, 500)


def open_article(page):
    """Открыть статью из витрины базы знаний (клик по карточке — работает и до, и после правок)."""
    page.goto(BASE + '/knowledge')
    settle(page)
    # Статья лежит в папке «Приёмка и выдача авто» — сначала заходим в неё.
    folder = page.locator('text=Приёмка и выдача авто').first
    folder.wait_for(timeout=8000)
    folder.click()
    settle(page, 500)
    page.locator(f'text={ARTICLE_TITLE}').first.click()
    settle(page)


def desktop_flow(browser):
    ctx = browser.new_context(
        viewport={'width': 1440, 'height': 900},
        device_scale_factor=1,
        locale='ru-RU',
        timezone_id='Europe/Moscow',
        service_workers='block',
    )
    page = ctx.new_page()
    page._shot_key = 'd'
    attach(page, 'd')

    # 1. Вход (аноним)
    page.goto(BASE + '/login')
    settle(page)
    shot(page, 'login', 1440)

    # 2. База знаний (демо-директор)
    login(page, DIRECTOR, r'.*/dashboard.*', pick_point='Профи — Центр')
    page.goto(BASE + '/knowledge')
    settle(page)
    shot(page, 'knowledge', 1440)
    # Вкладки — по роли tab: `text=…` попадал бы в подзаголовок шапки («Регламенты, учебный центр…»).
    page.get_by_role('tab', name='Регламенты').click()
    settle(page, 500)
    shot(page, 'knowledge-regulations', 1440)
    page.get_by_role('tab', name='Учебный центр').click()
    settle(page, 500)
    shot(page, 'knowledge-learning', 1440)
    open_article(page)
    shot(page, 'knowledge-article', 1440)
    director_state = ctx.storage_state()

    # 3. Панель платформы (суперадмин) — новая сессия
    ctx.clear_cookies()
    page.evaluate('() => { localStorage.clear(); sessionStorage.clear(); }')
    login(page, SUPERADMIN, r'.*/admin/.*')
    for name, path in [
        ('admin-dashboard', '/admin/dashboard'),
        ('admin-tenants', '/admin/tenants'),
        ('admin-tenant-detail', f'/admin/tenants/{DEMO_TENANT_ID}'),
        ('admin-registration', '/admin/registration'),
        ('admin-plans', '/admin/plans'),
        ('admin-broadcast', '/admin/broadcast'),
        ('admin-audit-log', '/admin/audit-log'),
    ]:
        page.goto(BASE + path)
        settle(page)
        shot(page, name, 1440)
    admin_state = ctx.storage_state()
    ctx.close()
    return director_state, admin_state


def mobile_ctx(browser, state=None):
    return browser.new_context(
        viewport={'width': 375, 'height': 812},
        device_scale_factor=2,
        is_mobile=True,
        has_touch=True,
        locale='ru-RU',
        timezone_id='Europe/Moscow',
        service_workers='block',
        storage_state=state,
    )


def mobile_flow(browser, director_state, admin_state):
    # Аноним: страница входа
    ctx = mobile_ctx(browser)
    page = ctx.new_page()
    page._shot_key = 'm'
    attach(page, 'm')
    page.goto(BASE + '/login')
    settle(page)
    shot(page, 'login', 375)
    ctx.close()

    # Директор: база знаний + статья
    ctx = mobile_ctx(browser, director_state)
    page = ctx.new_page()
    page._shot_key = 'm'
    attach(page, 'm')
    page.goto(BASE + '/knowledge')
    settle(page)
    shot(page, 'knowledge', 375)
    open_article(page)
    shot(page, 'knowledge-article', 375)
    ctx.close()

    # Суперадмин: панель + список
    ctx = mobile_ctx(browser, admin_state)
    page = ctx.new_page()
    page._shot_key = 'm'
    attach(page, 'm')
    for name, path in [('admin-dashboard', '/admin/dashboard'), ('admin-tenants', '/admin/tenants')]:
        page.goto(BASE + path)
        settle(page)
        shot(page, name, 375)
    ctx.close()


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    director_state, admin_state = desktop_flow(browser)
    mobile_flow(browser, director_state, admin_state)
    browser.close()

print('---- console/network issues')
seen = set()
for k, items in logs.items():
    for it in items:
        sig = it[:140]
        if sig in seen:
            continue
        seen.add(sig)
        print(k, it)
