"""
Золотой путь группы G3 «Склад и поставщики» (Playwright, headless Chromium).

Сценарий приёмки из задания фазы B: создать папку и товар с фото, списать 1 шт,
открыть поставщика, создать поставку и оплату, создать заказ поставщику. По
дороге собираем ошибки консоли и pageerror — в частности, проверяем, что
исчез «Failed to execute 'put' on 'IDBObjectStore' … could not be cloned».

  .venv/bin/python docs/web-redesign/tools/scenario_warehouse.py [--photo /path/to.png]

Запускается на локальном стеке (vite :5173 + backend), демо-директор.
"""
import os
import re
import sys
import time

from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout

BASE = 'http://localhost:5173'
PHONE, PASSWORD = '+79000000000', 'AutexaDemo2026'
PHOTO = None
if '--photo' in sys.argv:
    PHOTO = sys.argv[sys.argv.index('--photo') + 1]
STAMP = time.strftime('%H%M%S')
FOLDER = f'Тест-папка {STAMP}'
PRODUCT = f'Тест-товар {STAMP}'
OUT = os.environ.get('SHOT_OUT', '/Users/ramazan/Proects/zr-auto-pro/docs/web-redesign/screenshots')

issues = []
steps = []


def step(name, ok=True, note=''):
    steps.append((name, ok, note))
    print(('OK  ' if ok else 'FAIL'), name, ('— ' + note) if note else '')


def settle(page, ms=600):
    try:
        page.wait_for_load_state('networkidle', timeout=12000)
    except PWTimeout:
        pass
    page.wait_for_timeout(ms)


def toast(page, text, timeout=15000):
    page.get_by_text(text, exact=False).first.wait_for(timeout=timeout)


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
    settle(page, 400)
    return page


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(viewport={'width': 1440, 'height': 900}, locale='ru-RU',
                              timezone_id='Europe/Moscow', service_workers='block')
    page = login(ctx)
    page.on('console', lambda m: issues.append(f'[{m.type}] {m.text[:220]}') if m.type == 'error' else None)
    page.on('pageerror', lambda e: issues.append(f'[pageerror] {str(e)[:220]}'))
    page.on('requestfailed', lambda r: issues.append(f'[requestfailed] {r.url[:120]} {r.failure}'))

    # ── 1. Склад: папка ─────────────────────────────────────────────────────
    page.goto(BASE + '/products')
    settle(page)
    page.get_by_role('button', name='Новая папка').first.click()
    page.fill('#new-folder-name', FOLDER)
    page.get_by_role('button', name='Создать', exact=True).click()
    try:
        page.wait_for_url(re.compile(r'.*path=.*'), timeout=8000)
        step('Папка создана, путь в URL', True, page.url.replace(BASE, ''))
    except PWTimeout:
        step('Папка создана, путь в URL', False, page.url)

    # ── 2. Товар с фото ─────────────────────────────────────────────────────
    page.get_by_role('button', name='Добавить товар').first.click()
    page.fill('#product-name', PRODUCT)
    page.fill('#product-sell', '1250')
    page.fill('#product-cost', '800')
    page.fill('#product-stock', '5')
    photo_note = 'без фото'
    if PHOTO and os.path.exists(PHOTO):
        page.locator('[role=dialog] input[type=file]').first.set_input_files(PHOTO)
        try:
            page.locator('[role=dialog] img').first.wait_for(timeout=15000)
            photo_note = 'фото загружено'
        except PWTimeout:
            photo_note = 'фото НЕ загрузилось (проверьте uploads/S3 на локальном стеке)'
    page.get_by_role('button', name='Создать', exact=True).click()
    try:
        toast(page, 'Товар создан')
        step('Товар создан', True, photo_note)
    except PWTimeout:
        step('Товар создан', False, photo_note)
    settle(page)
    row = page.get_by_role('button', name=PRODUCT, exact=True).first
    row.wait_for(timeout=10000)
    step('Товар виден в таблице папки', True)

    # ── 3. Списание 1 шт ────────────────────────────────────────────────────
    row.click()
    page.get_by_role('button', name='Списание', exact=True).click()
    page.fill('#writeoff-qty', '1')
    page.fill('#writeoff-reason', 'Сценарий приёмки: списание 1 шт')
    page.get_by_role('button', name='Списать', exact=True).click()
    try:
        toast(page, 'Товар списан')
        step('Списание 1 шт', True)
    except PWTimeout:
        step('Списание 1 шт', False)
    settle(page)
    page.screenshot(path=f'{OUT}/after-products-folder-1440.png')

    # Поиск + мобильная ширина проверяются в shots_warehouse.py; здесь — Back в корень.
    page.go_back()
    settle(page, 400)
    step('Назад браузера вернул в корень склада', 'path=' not in page.url, page.url.replace(BASE, ''))

    # ── 4. Поставщик: поставка ──────────────────────────────────────────────
    page.goto(BASE + '/suppliers')
    settle(page)
    page.locator('main table tbody tr a:visible').first.click()
    page.wait_for_url(re.compile(r'.*/suppliers/[0-9a-f-]+.*'), timeout=10000)
    settle(page)
    supplier_url = page.url
    step('Открыт поставщик', True, supplier_url.replace(BASE, ''))
    page.get_by_role('button', name='Новая поставка').click()
    page.get_by_role('button', name='Добавить товар').click()
    drawer_search = page.locator('[role=dialog] input[aria-label="Поиск товара"]')
    drawer_search.fill(PRODUCT)
    page.get_by_role('button', name=re.compile(rf'^Выбрать {re.escape(PRODUCT)}$')).first.click()
    # Панель поставки закрывается сама после выбора (closeOnSelect по умолчанию).
    page.locator('[role=dialog]').last.get_by_text('Товар в поставку').wait_for(state='hidden', timeout=5000)
    step('Товар выбран в панели', True)
    page.get_by_role('button', name='Создать поставку').click()
    try:
        toast(page, 'Поставка создана')
        step('Поставка создана', True)
    except PWTimeout:
        step('Поставка создана', False)
    settle(page)
    page.screenshot(path=f'{OUT}/after-supplier-detail-1440.png')

    # ── 5. Оплата ───────────────────────────────────────────────────────────
    page.get_by_role('tab', name=re.compile(r'^Оплаты')).click()
    page.wait_for_url(re.compile(r'.*tab=payments.*'), timeout=5000)
    page.get_by_role('button', name='Новая оплата').click()
    page.fill('#payment-amount', '100')
    page.get_by_role('button', name='Записать оплату').click()
    try:
        toast(page, 'Оплата записана')
        step('Оплата записана', True)
    except PWTimeout:
        step('Оплата записана', False)
    settle(page)
    page.screenshot(path=f'{OUT}/after-supplier-payments-1440.png')

    # ── 6. Заказ поставщику ─────────────────────────────────────────────────
    page.goto(BASE + '/purchase-orders/new')
    settle(page)
    page.locator('#po-supplier').select_option(index=1)
    page.get_by_role('button', name='Добавить товар').click()
    page.locator('[role=dialog] input[aria-label="Поиск товара"]').fill(PRODUCT)
    page.get_by_role('button', name=re.compile(rf'^Выбрать {re.escape(PRODUCT)}$')).first.click()
    page.locator('[role=dialog] [aria-label="Закрыть"]').last.click()
    page.wait_for_timeout(300)
    page.screenshot(path=f'{OUT}/after-purchase-order-new-1440.png')
    page.get_by_role('button', name='Оформить заказ').click()
    try:
        page.wait_for_url(re.compile(r'.*/purchase-orders/[0-9a-f-]+$'), timeout=15000)
        settle(page)
        status = page.locator('main h1').first.inner_text()
        step('Заказ оформлен, открыта карточка', True, status)
    except PWTimeout:
        step('Заказ оформлен, открыта карточка', False, page.url)
    page.screenshot(path=f'{OUT}/after-purchase-order-detail-1440.png')

    page.goto(BASE + '/purchase-orders')
    settle(page)
    page.screenshot(path=f'{OUT}/after-purchase-orders-1440.png')

    print('---- console/network issues')
    seen = set()
    idb = False
    for it in issues:
        if it in seen:
            continue
        seen.add(it)
        if 'IDBObjectStore' in it:
            idb = True
        print(it)
    print('IDB clone pageerror:', 'PRESENT' if idb else 'absent')
    failed = [s for s in steps if not s[1]]
    print('---- steps failed:', len(failed))
    browser.close()
    sys.exit(1 if failed else 0)
