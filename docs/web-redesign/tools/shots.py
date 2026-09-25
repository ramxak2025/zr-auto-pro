import sys, re
from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout

BASE = 'http://localhost:5173'
import os
OUT = os.environ.get('SHOT_OUT', '/Users/ramazan/Proects/zr-auto-pro/docs/web-redesign/screenshots')
PHONE, PASSWORD = '+79000000000', 'AutexaDemo2026'
PAGES = [('dashboard', '/dashboard'), ('checks', '/checks'), ('check-create', '/checks/new'),
         ('products', '/products'), ('clients', '/clients'), ('salary', '/salary'),
         ('reports', '/reports'), ('company-settings', '/company-settings'),
         # G5 «Компания»
         ('schedule', '/schedule'), ('employees', '/employees'), ('users', '/users'),
         ('points', '/points'), ('integrations', '/integrations'), ('notifications', '/notifications'),
         ('tariff', '/tariff'), ('more', '/more'),
         # G2 «Клиенты и автомобили» — id клиента из демо-сида (Иван Петров).
         ('client-detail', '/clients/de100000-0000-4000-a000-0000000000c1'), ('cars', '/cars'),
         ('clients-import', '/clients/import'), ('calls', '/calls'), ('marketing', '/marketing'),
         ('installments', '/installments'),
         # G3 «Склад и поставщики» (детальные страницы и 375 px — tools/shots_warehouse.py)
         ('services', '/services'), ('suppliers', '/suppliers'),
         ('purchase-orders', '/purchase-orders'), ('equipment', '/equipment'),
         # G6 «Вход · База знаний · superadmin» — вход (аноним), статья, учебный центр и
         # панель платформы требуют других сессий: tools/shots_auth_admin.py.
         ('knowledge', '/knowledge'),
         # G4 «Деньги и отчёты» — период фиксируем в URL (демо-данные за сентябрь 2026);
         # хаб отчётов, финансовый отчёт и экраны конструктора (11 отчётов — tools/shots_g4.py).
         ('expenses', '/expenses?from=2026-09-01&to=2026-09-30'),
         ('cashflow', '/cashflow?from=2026-09-01&to=2026-09-30'), ('planning', '/planning'),
         ('reports-financial', '/reports/financial?from=2026-09-01&to=2026-09-30'),
         ('report-summary', '/reports/summary?from=2026-09-01&to=2026-09-30'),
         ('report-masters', '/reports/masters?from=2026-09-01&to=2026-09-30'),
         ('report-salary', '/reports/salary?from=2026-09-01&to=2026-09-30'),
         ('report-products', '/reports/products?from=2026-09-01&to=2026-09-30&groupBy=category'),
         ('report-suppliers', '/reports/suppliers?from=2026-09-01&to=2026-09-30')]
# Мобильные (375×812) снимки: базовые три + страницы групп фазы B.
MOBILE_PAGES = [('dashboard', '/dashboard'), ('more', '/more'), ('checks', '/checks'),
                ('clients', '/clients'), ('client-detail', '/clients/de100000-0000-4000-a000-0000000000c1'),
                ('cars', '/cars'), ('calls', '/calls'), ('marketing', '/marketing'),
                ('installments', '/installments'),
                # G5 «Компания»
                ('schedule', '/schedule'), ('users', '/users'), ('employees', '/employees'),
                ('points', '/points'), ('integrations', '/integrations'),
                ('company-settings', '/company-settings'),
                # G4 «Деньги и отчёты»
                ('salary', '/salary?from=2026-09-01&to=2026-09-30'),
                ('expenses', '/expenses?from=2026-09-01&to=2026-09-30'),
                ('cashflow', '/cashflow?from=2026-09-01&to=2026-09-30'), ('reports', '/reports'),
                ('report-masters', '/reports/masters?from=2026-09-01&to=2026-09-30')]
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
    # Мультифилиальный логин (163): после пароля — экран «Выберите филиал».
    try:
        page.locator('text=Профи — Центр').first.wait_for(timeout=6000)
        page.locator('text=Профи — Центр').first.click()
    except PWTimeout:
        pass
    try:
        page.wait_for_url(re.compile(r'.*/dashboard.*'), timeout=20000)
    except PWTimeout:
        print('LOGIN FAILED; phone value =', page.input_value('#phone'))
        print(page.inner_text('body')[:600])
        raise
    settle(page, 500)
    return page

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    logs = {}
    def attach(page, key):
        logs.setdefault(key, [])
        page.on('console', lambda m: logs[key].append(f'[{m.type}] {m.text[:200]}') if m.type in ('error', 'warning') else None)
        page.on('pageerror', lambda e: logs[key].append(f'[pageerror] {str(e)[:200]}'))
        page.on('requestfailed', lambda r: logs[key].append(f'[requestfailed] {r.url[:120]} {r.failure}'))

    ctx = browser.new_context(viewport={'width': 1440, 'height': 900}, device_scale_factor=1,
                              locale='ru-RU', timezone_id='Europe/Moscow', service_workers='block')
    page = login(ctx)
    state = ctx.storage_state()
    for name, path in PAGES:
        if only and name not in only:
            continue
        attach(page, name)
        page.goto(BASE + path)
        settle(page)
        page.screenshot(path=f'{OUT}/{prefix}-{name}-1440.png')
        print('shot', name, '→ errors:', len(logs[name]))
    # Mobile
    mctx = browser.new_context(viewport={'width': 375, 'height': 812}, device_scale_factor=2, is_mobile=True,
                               has_touch=True, locale='ru-RU', timezone_id='Europe/Moscow',
                               service_workers='block', storage_state=state)
    mpage = mctx.new_page()
    for name, path in MOBILE_PAGES:
        if only and name not in only:
            continue
        attach(mpage, 'm-' + name)
        mpage.goto(BASE + path)
        settle(mpage)
        mpage.screenshot(path=f'{OUT}/{prefix}-{name}-375.png')
        print('shot mobile', name, '→ errors:', len(logs['m-' + name]))
    print('---- console/network issues')
    seen = set()
    for k, items in logs.items():
        for it in items:
            sig = it[:140]
            if sig in seen:
                continue
            seen.add(sig)
            print(k, it)
    browser.close()
