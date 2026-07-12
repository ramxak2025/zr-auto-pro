# Autexa iOS build 61 (3.0.0) — App Store rejection diagnosis

**Verdict:** This is the SAME 3.1.3(c)/3.1.1 rejection as the prior 5 rounds. The "Route A enterprise-only" pivot was decided but is only PARTIALLY shipped: the review NOTES and the app BINARY are clean, but the **public website still renders a full consumer subscription store**, and the **App Store Connect metadata still reads as a personal/consumer app**. Apple sees the site + the store listing, not your private notes — so nothing that actually triggers the rejection has changed since build 61 was submitted.

---

## 1. Most likely rejection reasons (ranked)

### #1 — Public website is still a subscription checkout (Guideline 3.1.3(c) / 3.1.1) — PRIMARY

The reviewer opens `autexa.pw` (your marketingUrl AND supportUrl) and, executing JS in a real browser, sees:

- `/tarify`: three priced tiers — **Старт 1 000 ₽/мес, Бизнес 7 000 ₽/мес, Легенда 10 000 ₽/мес** — with a **monthly/yearly billing toggle («Помесячно | На год −20%»)** and a CTA sitting directly under each price. That is the exact visual grammar of "pick a plan and subscribe outside IAP."
  Evidence: `TarifyPage.tsx:19-58,120,202-210`; `pricingShared.tsx:55-100,180-186,281-284`; `content.ts:1601-1646`.
- Homepage itself repeats the prices: FAQ «Сколько это стоит?» → 1000/7000/10000 ₽ + «за год дешевле на 20%», plus the Pricing teaser renders ₽/мес per plan.
  Evidence: `content.ts:1497-1502`; `Pricing.tsx:42-64`.
- `pricingFaq` describes recurring billing in words: yearly-discounted 800/5600/8000 ₽, «сменить тариф», «скрытые платежи… цена фиксированная».
  Evidence: `content.ts:1717-1751`.

This is unchanged from every prior rejection. It is almost certainly the single line Apple quoted.

### #2 — ASC store listing still frames the app as personal/consumer (Guideline 3.1.3(c)) — PRIMARY

The LIVE description (pulled from ASC 2026-07-12) opens «AUTEXA — система управления автосервисом **В ВАШЕМ iPhone** … весь автосервис **В ОДНОМ ПРИЛОЖЕНИИ**», has a «**ВОЗМОЖНОСТИ iPhone**» lifestyle section (виджеты / Live Activity / Dynamic Island / Siri), and closes «**Один аккаунт — весь бизнес в порядке.**» This is precisely the "available to single users / consumers / family use" framing Apple cited. And **no public metadata field contains any org-only statement** — the B2B claim lives ONLY in the private review notes, which is not enough for the enterprise-services exception. Apple requires the store presentation itself to read as enterprise.
Evidence: ASC appStoreVersionLocalizations (ru), version cf397098…, build 61 REJECTED.

### #3 — Public self-serve signup with a password field (Guideline 3.1.1 / 2.1) — CONTRIBUTING, HIGH

`/register` is a public unauthenticated route reachable from every «Оставить заявку» / «Смотреть тарифы» CTA. `RegisterForm` collects company + **phone-as-login + a password (min 8, show/hide)**. A password field on a public page reads as "create an account / sign up," even though the backend now moderates it. This was explicitly cited before.
Evidence: `App.tsx:249-255`; `RegisterForm.tsx:50-90,155-200`; `pricingShared.tsx:20-31`.

### #4 — supportUrl == marketingUrl == autexa.pw (Guideline 1.5 / 3.1.3(c)) — CONTRIBUTING

Both metadata URLs point at the sales funnel, so even tapping "App Support" lands the reviewer on the priced/signup page. Guarantees maximum exposure of the purchase signals and contradicts the "B2B, no consumer purchase" note.

### #5 — "Install via WhatsApp / Скоро в App Store" on the reviewed domain (Guideline 2.3.1) — MINOR

`storeSection` advertises obtaining the iOS app outside the App Store («устанавливается через поддержку», «Скачать через поддержку» → WhatsApp, «Скоро» badges). For a binary in review this is a distribution-outside-the-store claim on the very domain Apple is reviewing.
Evidence: `content.ts:1533-1588`; `Platforms.tsx:36-63`.

### #6 — In-app "manage subscription on the website" copy (Guideline 3.1.3) — MINOR

`SubscriptionScreen.tsx:186` «Управление подпиской доступно в веб-версии Autexa.» — borderline anti-steering. Safest is total silence.

---

## 2. Exact fixes

**Website (kills #1, #4, #5 — do these first, they are the actual trigger):**

- Delete the `BillingToggle` (monthly/yearly −20% switcher) everywhere.
- Remove ALL ruble amounts: PlanCard price, both comparison tables, homepage Pricing teaser, faqMain «Сколько это стоит?», and pricingFaq (drop 800/5600/8000, «платить за год / помесячная оплата», «сменить тариф» numbers). Replace with «Цена и тариф подбираются менеджером при подключении под размер команды».
- Plan cards become feature-only tiers with a single CTA «Оставить заявку» / «Обсудить подключение».
- On the public `/register` form, **drop the password field** — collect only org name + contact name + phone + comment. Manager issues credentials after approval. Reframe strictly as «Заявка на подключение / демонстрацию»; remove «Уже есть аккаунт / Регистрация» self-serve framing from public surfaces.
- Point **supportUrl at a dedicated price-free support/contacts page** (e.g. `autexa.pw/support`). Ideally make the whole public site price-free so both URLs are safe.
- Remove the «Скоро» store badges + «Скачать через поддержку / установка через WhatsApp» path.
- **Verify the deployed build actually renders these changes** (SPA cache — confirm the live JS bundle, not a stale one). Note from the investigation: WebFetch only saw the static shell, so you must confirm the deployed bundle in a real browser.

**ASC metadata (kills #2 — no rebuild needed, edit in App Store Connect):**

- Rewrite the description opener to org-only per `docs/ios-redesign/APP_STORE_3_1_3C_ENTERPRISE_ONLY.md`: «Autexa — система управления для автосервисов. Приложение предназначено для организаций (юридических лиц и ИП) и их сотрудников; не предназначено для личного использования.» Remove «в вашем iPhone» and «Один аккаунт — весь бизнес в порядке». Rename/reframe «ВОЗМОЖНОСТИ iPhone» as a business-tool section.
- Add that explicit org-only line into the PUBLIC description (mirror the site b2bNotice) so the enterprise read is confirmed by store copy, not just the notes.
- Reframe promotionalText to team/org language (drop «в одном приложении»).
- Subtitle → «Система для автосервисов» (plural implies organizations, ≤30 chars).
- Soften «Онлайн-касса 54-ФЗ и фискализация» → «интеграция с онлайн-кассой» unless a working fiscal register is demonstrable under demo account +79000000000 (avoids an independent 2.3.1 flag).

**App binary (minor, iOS):**

- `SubscriptionScreen.tsx:186` — render nothing (remove the "manage on website" sentence) or a neutral non-directive status.

**Metadata note:** ASC description/promo/subtitle changes can be submitted WITHOUT a new build (metadata-only). The site changes need no build at all. Only the SubscriptionScreen copy needs a build — do it if you're rebuilding anyway, but it is not blocking.

---

## 3. What the owner should paste to CONFIRM

Apple's exact wording is NOT in the ASC API — the diagnosis above is inferred from the deployed source + the 5-rejection history. To confirm which of #1–#4 Apple actually cited, paste from **App Store Connect → your app → the rejected 3.0.0 (61) submission → Resolution Center**, the reviewer's message. Specifically look for and send back:

- The **guideline number(s)** Apple listed (expect 3.1.3(c) and/or 3.1.1).
- Any **screenshot or URL** the reviewer attached (they often paste the exact `autexa.pw/tarify` or `/register` screen).
- Whether they mention **"purchase mechanisms outside the App Store"**, **"account creation"**, or **"available to single users / consumers"** — that phrasing tells us whether the primary hit is the priced site (#1), the signup form (#3), or the consumer-framed listing (#2).

Send me that verbatim text and I'll confirm we've closed the exact item rather than guessing.

---

## 4. Uncertainty flag

`autexa.pw` returned HTTPS 200 (the `.pw` TLD was NOT blocked this run), but it is a client-rendered Vite/React SPA, so an automated fetch saw only the static `index.html` shell (title «Autexa — программа для автосервиса…») — no pricing/register DOM. **A real Apple reviewer's browser executes the JS and sees the full pricing store and prices that the fetch could not.** This diagnosis is therefore based on the **deployed landing SOURCE** (`frontend/src/pages/landing/*`, `content.ts`, `RegisterPage`/`RegisterForm`, `App.tsx` routes) plus the live ASC metadata pull and the rejection history — which is exactly what renders live. Residual uncertainty: I cannot see Apple's literal rejection sentence, so the ranking of #1 vs #2 as the primary cited item is an inference (both are almost certainly present); the Resolution Center text in section 3 resolves it.
