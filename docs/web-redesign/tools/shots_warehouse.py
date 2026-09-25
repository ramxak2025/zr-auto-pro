"""
Скриншоты группы G3 «Склад и поставщики» — дополнение к shots.py.

Зачем отдельный файл: детальные страницы (поставщик, заказ поставщику) не имеют
статического пути — id берём кликом по первой строке списка; плюс 375 px для
всех страниц группы. Логин и сбор ошибок консоли — как в shots.py.

  .venv/bin/python docs/web-redesign/tools/shots_warehouse.py before
  .venv/bin/python docs/web-redesign/tools/shots_warehouse.py after products,suppliers
  SHOT_OUT=/tmp/wip .venv/bin/python docs/web-redesign/tools/shots_warehouse.py wip
"""
import os
import re
import sys

from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout

BASE = 'http://localhost:5173'
OUT = os.environ.get('SHOT_OUT', '/Users/ramazan/Proects/zr-auto-pro/docs/web-redesign/screenshots')
PHONE, PASSWORD = '+79000000000', 'AutexaDemo2026'

# (имя файла, путь, «кликнуть первую строку списка и снять открывшуюся страницу»)
PAGES = [
    ('products', '/products', None),
    ('services', '/services', None),
    ('suppliers', '/suppliers', None),
    ('supplier-detail', '/suppliers', 'row'),
    ('purchase-orders', '/purchase-orders', None),
    ('purchase-order-detail', '/purchase-orders', 'row'),
    ('purchase-order-new', '/purchase-orders/new', None),
    ('equipment', '/equipment', None),
]
MOBILE = ['products', 'services', 'suppliers', 'purchase-orders', 'equipment']

prefix = sys.argv[1] if len(sys.argv) > 1 else 'before'
only = sys.argv[2].split(',') if len(sys.argv) > 2 else None


def settle(page, ms=900):
    try:
        page.wait_for_load_state('networkidle', timeout=12000)
    except PWTimeout:
        pass
    page.wait_for_timeout(ms)


def login(ctx):
    page = ctx.new_page()
    page.goto(BASE + '/login')
    settle(page, 300)
    page.fill('#phone', PHONE)
    page.fill('#password', PASSWORD)
    page.click('button[type=submit]')
    try:
        page.locator('text=Профи — Центр').first.wait_for(timeout=6000)
        page.locator('text=Профи — Центр').first.click()
    except PWTimeout:
        pass
    page.wait_for_url(re.compile(r'.*/dashboard.*'), timeout=20000)
    settle(page, 500)
    return page


def open_first_row(page):
    """Открыть первую строку списка: ссылка в главной колонке (DataTable) или tr[role=button] (до миграции)."""
    # На 1440 мобильные карточки (md:hidden) стоят в DOM раньше таблицы — берём видимую строку.
    link = page.locator('main table tbody tr a:visible').first
    if link.count() > 0:
        link.click()
    else:
        page.locator('main table tbody tr:visible, main [role=button]:visible').first.click()
    page.wait_for_timeout(300)


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    logs = {}

    def attach(page, key):
        logs.setdefault(key, [])
        page.on('console', lambda m: logs[key].append(f'[{m.type}] {m.text[:220]}') if m.type in ('error', 'warning') else None)
        page.on('pageerror', lambda e: logs[key].append(f'[pageerror] {str(e)[:220]}'))
        page.on('requestfailed', lambda r: logs[key].append(f'[requestfailed] {r.url[:120]} {r.failure}'))

    ctx = browser.new_context(viewport={'width': 1440, 'height': 900}, device_scale_factor=1,
                              locale='ru-RU', timezone_id='Europe/Moscow', service_workers='block')
    page = login(ctx)
    state = ctx.storage_state()
    for name, path, action in PAGES:
        if only and name not in only:
            continue
        attach(page, name)
        page.goto(BASE + path)
        settle(page)
        if action == 'row':
            try:
                open_first_row(page)
                settle(page)
            except Exception as e:  # noqa: BLE001 — список пуст: снимаем то, что есть
                print('row click failed for', name, e)
        page.screenshot(path=f'{OUT}/{prefix}-{name}-1440.png')
        print('shot', name, page.url.replace(BASE, ''), '→ errors:', len(logs[name]))

    mctx = browser.new_context(viewport={'width': 375, 'height': 812}, device_scale_factor=2, is_mobile=True,
                               has_touch=True, locale='ru-RU', timezone_id='Europe/Moscow',
                               service_workers='block', storage_state=state)
    mpage = mctx.new_page()
    for name, path, _ in PAGES:
        if name not in MOBILE or (only and name not in only):
            continue
        attach(mpage, 'm-' + name)
        mpage.goto(BASE + path)
        settle(mpage)
        mpage.screenshot(path=f'{OUT}/{prefix}-{name}-375.png')
        # Горизонтальный скролл на телефоне — ошибка вёрстки.
        sw = mpage.evaluate('document.documentElement.scrollWidth')
        print('shot mobile', name, '→ errors:', len(logs['m-' + name]), '| scrollWidth', sw)

    print('---- console/network issues')
    seen = set()
    for k, items in logs.items():
        for it in items:
            sig = it[:160]
            if sig in seen:
                continue
            seen.add(sig)
            print(k, it)
    browser.close()
