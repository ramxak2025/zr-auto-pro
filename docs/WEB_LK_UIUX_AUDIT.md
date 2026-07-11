# Autexa Web Admin — Consolidated UI/UX Audit Report

Source: 9 cluster audits, ~60 findings across 42 pages. Two junk entries (`A.tsx`, `EquipmentPage.tsx` = "test"/"d") discarded. Everything below is real.

The dominant signal: **the same 6 defects repeat on almost every page.** This is not 60 problems — it's ~6 missing shared primitives. Fix the primitives once and most findings close in bulk.

---

## 1. SYSTEMIC THEMES (ranked by blast radius)

### T1 — "Error rendered as empty state, no retry" (~20 pages) — HIGHEST PRIORITY

**Where:** CashFlow, Reports, Clients, Cars, Employees, Salary (both views), Schedule (my-stats + grid), KnowledgeBase (list + article), Integrations (4 cards), NotificationSettings, Calls (has error but no retry button), CompanySettings, Tariff, AdminTenants, AdminDashboard, AdminTenantDetail, AdminPlans, AdminAuditLog.
**Root cause:** queries destructure only `{ data, isLoading }`. On failure `isLoading=false` + `data=undefined` falls through to the empty state — so a network failure reads as "you have 0 clients / empty period / tenant not found / MRR 0₽", and on settings pages the blank default form invites Save-over-real-config. WorkBoardPage and AdminBroadcastPage already do it right.
**ONE fix:** a shared `<QueryState query={q}>` wrapper (or a `useQueryState` helper) that renders loading → error(+Повторить/`refetch`) → empty → children. Adopt it in every list/detail/settings query. This single component collapses ~20 findings including the P0.

### T2 — Full-app-shell `LoadingSpinner` nested inside page content (~10 pages)

**Where:** Reports, CashFlow, Schedule (×2), Salary, NotificationSettings + all 5 admin pages.
**Root cause:** `LoadingSpinner` is a route-level fallback — `h-screen/h-[100dvh]` with its **own fake top header and fake 5-icon bottom tab bar**. Rendered inside `<main>` (which already has the real chrome) it paints a phantom mobile shell over the desktop frame and reads as a broken screen. Sometimes rendered _below_ the real header + filters (double header).
**ONE fix:** add an `<InlineLoader>` primitive (centered `Loader2` or a few `animate-pulse` skeleton cards, content-sized). Reserve `LoadingSpinner` strictly for App.tsx route fallback. Sweep all inline usages.

### T3 — Hand-rolled page headers, inconsistent title scale (~11 pages)

**Where:** Reports (text-xl), CashFlow (text-2xl non-token), Dashboard (text-xl), Employees (custom sticky), EmployeeDetail (gradient hero), Salary (bare text-2xl), Marketing (text-xl), Integrations (text-xl), Calls (text-lg — smallest H1 in app), CompanySettings (text-xl), Login (bespoke). Two pages both titled "Сотрудники" with different chrome.
**Root cause:** `.page-header`/`.page-title` exist but aren't enforced; no `<PageHeader>` component.
**ONE fix:** ship `<PageHeader title icon subtitle actions>` (h-10 w-10 rounded-xl bg-primary-50 chip, h-5 w-5 icon, text-2xl title). Replace all hand-rolled headers. Pure className/structure change, zero behavior risk.

### T4 — Icon-only buttons with no accessible name (~12 pages)

**Where:** Dashboard, WorkBoard, Clients (mobile), Users, Schedule, Calls (many), Integrations, KnowledgeBase, More, AdminPlans, Login, CashFlow select. All announce as bare "button".
**Root cause:** no shared `IconButton`, no `jsx-a11y` lint gate.
**ONE fix:** `<IconButton label icon>` that requires a `label` (→ aria-label + title). Add `eslint-plugin-jsx-a11y` `control-has-associated-label` to prevent regressions.

### T5 — Toggle switches with no accessible name (6 pages)

**Where:** NotificationSettings, Integrations (reusable Toggle → every integration switch), CompanySettings (×2), AdminTenants, AdminPlans, AdminTenantDetail (×2).
**Root cause:** `sr-only peer` checkbox inside a `<label>` that wraps only the visual pill; descriptive text sits in a sibling.
**ONE fix:** shared `<Switch>` component with a **required** `aria-label` prop. Fixes all 6+ at once.

### T6 — `text-gray-400` on real content fails WCAG AA (~15 pages)

**Where:** Dashboard, Reports, CashFlow, WorkBoard, Employees, EmployeeDetail, Salary, Calls, Integrations, CompanySettings, Tariff, AdminTenants, AdminPlans, Login (+ dark RevenueChart slate-500, 8.5px axis labels; red-500 error text ≈3.9:1 in RegisterForm/Login).
**Root cause:** gray-400 (~2.8:1) used for content-bearing microtext.
**ONE fix:** scoped find/replace on these pages — content `text-gray-400`→`text-gray-500` (keep gray-400 decorative-only), error `text-red-500`→`text-red-600`, dark-card `slate-500`→`slate-400/300`, raise 8.5px axis to ≥10px. Not an app-wide retheme.

### T7 — Clickable rows/cells not keyboard-operable (4 pages)

**Where:** Clients (`<tr>`/`<div onClick>`), Cars (same), Schedule (date cells — mouse-only status setting; scrubber), Calls (audio scrubber).
**Root cause:** `onClick` on `<tr>`/`<div>` with `cursor-pointer` but no `role`/`tabIndex`/`onKeyDown`. Whole lists unreachable by keyboard.
**ONE fix:** a `useClickableRow()` helper (or make the primary name a real `<Link>`) applying role="button"/tabIndex/Enter+Space. Schedule already does this correctly on its names column — mirror it.

### Smaller shared threads

- **T8 Destructive-confirm inconsistency:** ImportClientsCars uses native `window.confirm` for the single most consequential action; Schedule grid delete fires with no confirm while the modal path uses ConfirmDialog. → Route all destructive actions through shared `ConfirmDialog`.
- **T9 Money formatting drift:** EmployeeDetail + Employees ship local regex `formatMoney`; AdminPlans price lacks `tabular-nums`. → Single `shared/utils/formatters` import + tabular-nums everywhere money renders.
- **T10 Primitive bypass:** CompanySettings/More hand-roll `.card`/`.input`/`.label` (wrong radius/border/contrast); Schedule hand-rolls Modal backdrops. → Adopt `.card`/`.input`/`.label`/`<Modal>`.

---

## 2. TOP P0 / MUST-FIX LIST

1. **P0 — KnowledgeBase ArticleReader infinite spinner.** No `isError`; on API failure it's stuck on the spinner forever (escape only via Назад). Add error branch (`isError && !article` → error card + Повторить/refetch).
2. **Settings pages overwrite real config on load failure.** Integrations (4 cards), CompanySettings, NotificationSettings render blank _default_ forms on error → owner Saves over stored credentials/config. Gate the form + Save button behind successful load; show error+retry. (Highest data-loss risk in T1.)
3. **Financial screens fabricate zeros / false-empty.** AdminDashboard shows "MRR 0₽ / ARPU 0₽" on failure; Reports/CashFlow/Salary show "Нет данных" for a failed fetch. Add explicit error+retry before the empty branch.
4. **AdminTenantDetail: transient error masquerades as permanent 404** ("Автосервис не найден", no retry). Distinguish isError from resolved-empty.
5. **Clients KPI scope bug (data integrity, not just cosmetic).** "Всего 500 / С автомобилями 6" mixes server total with current-page counts — actively misleading. Relabel page-scoped tiles or drop them until a server aggregate exists.
6. **Schedule grid delete has no confirmation** — a mis-tap permanently deletes a schedule entry. Route through existing ConfirmDialog.
7. **Keyboard-unreachable core lists** — Clients, Cars, Schedule grid fully mouse-only (T7).
8. **Unlabeled controls on primary screens** — Login password toggle, every integration/settings Switch, icon-only edit/delete on mobile cards (T4/T5).

---

## 3. RECOMMENDED ROADMAP (waves)

### Wave 1 — Systemic foundation (build/adopt shared primitives)

_Scope: ~1 focused pass building 6 primitives + wiring the lint gate. Unlocks bulk fixes in Waves 2–3._
Deliverables:

- `<QueryState>` / `useQueryState` (loading/error+retry/empty/children) — closes T1 + P0 #1–4.
- `<InlineLoader>` + stop using shell `LoadingSpinner` inline — closes T2.
- `<PageHeader>` — closes T3.
- `<IconButton>` + `<Switch>` (both require label) + add `eslint-plugin-jsx-a11y` — closes T4/T5 and prevents regression.
- `useClickableRow()` helper — closes T7.
- Confirm single shared `formatMoney` + `ConfirmDialog` are the only sanctioned paths.

### Wave 2 — High-traffic screens (adopt the primitives + polish)

_Dashboard, Касса/CheckCreate, Products, Clients, Checks, plus CashFlow/Reports/Salary (money-critical)._
_Scope: retrofit each with PageHeader + QueryState + IconButton, fix the page-specific bugs._
Deliverables:

- Dashboard: PageHeader, period-chevron aria-labels, dark-chart contrast/axis-size, MasterDashboard error+retry.
- Clients: QueryState error, KPI-scope fix (#5), keyboard rows, mobile-button aria-labels.
- CashFlow/Reports/Salary: QueryState error+retry, InlineLoader, PageHeader, gray-400→gray-500, gate summary cards behind loaded state.
- (Касса/CheckCreate/Products/Checks weren't in this batch's findings — apply the same primitive retrofit + verify against the checklist.)

### Wave 3 — The rest

_Employees/EmployeeDetail, Schedule, Users, Cars, Marketing, Integrations, Calls, Notifications, KnowledgeBase, CompanySettings, Tariff, More, Login/Register, all 5 Admin pages._
Deliverables: adopt QueryState + InlineLoader + PageHeader + Switch everywhere; Schedule (keyboard cells, Modal port, confirm delete); Integrations/CompanySettings/Notifications load-error gating; Import → ConfirmDialog; contrast sweep; Login/Register → shared input/label/btn + error contrast + required markers; Admin pages → inline loader + error branches + tabular-nums + toggle labels.

---

## 4. QUICK WINS (one safe pass, high impact, no behavior change)

1. **Contrast sweep** — `text-gray-400`→`text-gray-500` on content, `text-red-500`→`text-red-600` on error text, dark-card `slate-500`→`slate-400` (~15 pages, className-only). Closes T6.
2. **Add aria-labels** to all icon-only buttons + `sr-only` toggle checkboxes (T4/T5) — additive attributes, no risk.
3. **CarsPage search width:** `mb-4` → `mb-4 max-w-md` (one line, matches Clients).
4. **AdminPlans price:** add `tabular-nums` (one class).
5. **CallsPage:** add `refetch()` "Повторить" to existing error block + rename "МоиЗвонки" → align with "Телефония (Mango Office)".
6. **SalaryPage:** `<Fragment key>` on the `.map` (kills React key warning).
7. **ClientDetail badge tokens:** normalize to one family (`-blue/-green/-yellow/-gray`).
8. **MorePage:** add an `<h1 className="page-title">Ещё` (heading hierarchy).
9. **CashFlow master filter select:** add `aria-label="Фильтр по мастеру"`.
10. **RegisterForm:** add `*` markers + `required` on owner input; darken error text.

---

**Bottom line for scope selection:** Wave 1 is the whole game — 6 primitives retire ~45 of ~60 findings and prevent the settings-overwrite data-loss class. If the owner wants the smallest high-value cut: **Wave 1 + Quick Wins #1–2** ships accessibility compliance and kills the error-as-empty/data-loss risk across all 42 pages in one coordinated pass.

---

## Appendix — all findings (64)

### P0

- **KnowledgeBasePage.tsx** [loading-empty-error] ArticleReader (line 701-704, 755) does `const { data: article, isLoading } = useQuery(...)` with NO isError handling, then `if (isLoading || !article) return <spinner>`. When getArticle fails, react-query exhausts its retries, isLoading becomes false and data stays undefined — so the component falls into the spinner branch permanently. Opening any article while the API hiccups shows an infinite spinner the user can only escape via the 'Назад' button (which is at least rendered inside the branch).
  - Fix: Destructure `isError` from the query and add a branch before the spinner: when isError && !article, render an inline error card (AlertCircle + 'Не удалось загрузить статью' + a 'Повторить' button calling `refetch()`), keeping the existing 'Назад' button. No API/prop change.

### P1

- **ReportsPage.tsx / CashFlowPage.tsx** [loading-empty-error] LoadingSpinner (components/LoadingSpinner.tsx) is a full-viewport route fallback: flex flex-col h-screen h-[100dvh] with its OWN fake top header bar and a fake 5-icon bottom tab bar (used as the app shell fallback in App.tsx:183). ReportsPage.tsx:95-96 and CashFlowPage.tsx:202-203 render the real page header plus DatePeriodPicker (and for CashFlow the summary cards) first, then render the LoadingSpinner inline. During every load the user sees real header, filters, then a viewport-tall skeleton that itself contains a second fake header strip and a fake tab bar. WorkBoardPage.tsx:117 does it right with an early return before its header.
  - Fix: Do not render the full-screen LoadingSpinner beneath page chrome. Either early-return it before the header (like WorkBoardPage), or use a lightweight inline skeleton/spinner (centered Loader2 animate-spin or a few animate-pulse card placeholders like DashboardPage StatCardSkeleton) inside the content area with no header/tab-bar.
- **CashFlowPage.tsx** [loading-empty-error] The query at CashFlowPage.tsx:76-80 has no error handling. On failure isLoading is false and days is empty, so line 204-205 shows EmptyState Нет данных - a request failure is presented as a legitimately empty period, with no retry. Separately the summary cards (lines 144-199) render outside the isLoading guard, so during load every card flashes 0 before real data arrives.
  - Fix: Destructure isError and refetch from useQuery and add an error branch before the empty check: a card with a message plus a Повторить button calling refetch (mirror WorkBoardPage.tsx:146-152). Optionally gate the summary-card grid behind not-isLoading so it does not show 0 during the first request.
- **ReportsPage.tsx** [loading-empty-error] ReportsPage.tsx:96-98 collapses error and empty into one bare centered gray line: when report is falsy it shows a text-center py-12 text-gray-500 div reading Не удалось загрузить данные. The query (line 40-45) never reads isError, so a failed request on this core financial screen shows plain text with no retry and no alignment with the app EmptyState/error patterns.
  - Fix: Pull isError and refetch from useQuery and render an explicit error state with a Повторить button (same pattern as WorkBoardPage.tsx:146-152).
- **ReportsPage.tsx / CashFlowPage.tsx / DashboardPage.tsx** [consistency] Header treatment diverges. WorkBoardPage.tsx:122-131 uses shared page-header plus page-title (text-2xl) with a h-10 w-10 rounded-xl bg-primary-50 icon chip. ReportsPage.tsx:75-83 hand-rolls flex items-center gap-3 with h1 text-xl and a bg-primary-100 chip. CashFlowPage.tsx:107-112 uses h1 text-2xl (not page-title) with chip p-2 bg-primary-50 with a w-6 h-6 icon. DashboardPage.tsx:1006 uses h1 text-xl. Title size, chip background, and icon size differ page to page for the same analytics section.
  - Fix: Standardize on the existing page-header/page-title classes and one icon-chip spec (flex h-10 w-10 items-center justify-center rounded-xl bg-primary-50 with h-5 w-5 text-primary-600) across Reports, CashFlow and Dashboard, matching WorkBoardPage. Pure className changes.
- **CashFlowPage.tsx** [accessibility] The master filter select at CashFlowPage.tsx:127-138 has no associated label and no aria-label, only an adjacent decorative Users icon. Screen-reader users get no name for the control.
  - Fix: Add aria-label Фильтр по мастеру to the select, or wrap with a visually-hidden label htmlFor.
- **ReportsPage.tsx / CashFlowPage.tsx / DashboardPage.tsx / WorkBoardPage.tsx** [accessibility] Informational text across the cluster uses text-gray-400 (about 2.8:1 on white) at small sizes: header subtitles (DashboardPage.tsx:1009, ReportsPage.tsx:81), the percent-of-revenue hints (ReportsPage.tsx:188-190 and 206-208), average check (ReportsPage.tsx:162), CashFlow footnotes (CashFlowPage.tsx:174, 183, 193). These carry real content yet fail WCAG AA.
  - Fix: Bump content-bearing text-gray-400 to text-gray-500 (about 4.6:1) on these labels/hints; keep gray-400 only for decorative glyphs. Scope to these pages to avoid an app-wide retheme.
- **A.tsx** [consistency] d
  - Fix: f
- **ClientsPage.tsx** [loading-empty-error] The list query destructures only { data, isLoading } (ClientsPage.tsx:67). There is no isError branch: a failed/offline fetch leaves data undefined, so the render falls through to the EmptyState "Нет клиентов / Добавьте первого клиента" (lines 300-306). A director whose request failed sees a message implying their client base is empty, with an "Добавить клиента" CTA and no way to retry. This is a core screen and the owner's explicit goal.
  - Fix: Destructure isError (and keep refetch) from useQuery, and add a branch before the empty check: if (isError) render an error state (reuse EmptyState with an icon + title "Не удалось загрузить" + action { label: 'Повторить', onClick: () => refetch() }). No API/behavior change.
- **CarsPage.tsx** [loading-empty-error] Same defect as ClientsPage: the query destructures only { data, isLoading } (CarsPage.tsx:19). A failed fetch renders the EmptyState "Нет автомобилей" (lines 60-69), misrepresenting a network error as an empty dataset with no retry affordance.
  - Fix: Add isError + refetch from useQuery and render an EmptyState error variant with a { label: 'Повторить', onClick: () => refetch() } action before the cars.length === 0 branch.
- **ClientsPage.tsx** [consistency] The KPI strip mixes scopes: "Всего клиентов" shows server total (total = data.total, line 186/284) while "С автомобилями" and "Автопарк" are computed from only the current 20-row page (clients.filter / clients.reduce, lines 187-188, 288/292). On page 1 of a 500-client base the user sees e.g. "Всего 500 / С автомобилями 6 / Автопарк 9", implying only 6 of 500 clients have cars. The numbers silently change per page.
  - Fix: Either relabel the two page-scoped tiles to make scope explicit (e.g. "С авто (на странице)") or, minimally, drop the two page-derived tiles and keep only the server-provided total until a server-side aggregate exists. Do not change the API.
- **ClientsPage.tsx** [accessibility] The mobile card edit/delete buttons (ClientsPage.tsx:321-333) are icon-only (Edit2, Trash2) with no aria-label and no title — unlike their desktop-table counterparts (lines 425/433) which at least have title. Screen-reader and voice-control users get an unlabeled button on mobile widths.
  - Fix: Add aria-label="Редактировать" and aria-label="Удалить" to the two mobile buttons at lines 321-333 (mirror the desktop title values).
- **ImportClientsCarsPage.tsx** [consistency] runConfirm() gates the irreversible DB write behind a native window.confirm('Импортировать данные в систему?...') (ImportClientsCarsPage.tsx:377). Every other confirm in this cluster (client delete, car delete) uses the styled ConfirmDialog primitive; the native browser dialog is visually inconsistent, unthemeable, and not brand-styled for the single most consequential action on the page.
  - Fix: Replace the window.confirm with the shared ConfirmDialog (variant default/primary), gated by a small confirmOpen state; call the existing confirm logic in onConfirm. Behavior/endpoint unchanged.
- **EmployeesPage.tsx** [loading-empty-error] None of the four queries (users-all, employee-schedule, employee-salary, prev-salary) handle isError. After usersLoading resolves, the only branches are LoadingSpinner and activeUsers.length===0 → EmptyState "Сотрудников пока нет" (lines 178-187). A failed /users request therefore shows the same 'invite your team' empty screen as a genuinely empty roster, with no error message and no way to retry.
  - Fix: Destructure isError (and refetch) from the users query and add a branch before the empty check: if (isError) render EmptyState with an error title + description and an action={{ label: 'Повторить', onClick: () => refetch() }}. No data-shape or API change.
- **SalaryPage.tsx** [loading-empty-error] AdminSalaryView salary-all query (lines 232-239) exposes only isLoading; on error `masters` becomes [] and the screen shows EmptyState "Нет данных / За выбранный период нет данных" (line 336) — a failed payroll fetch is indistinguishable from a legitimately empty period. MasterSalaryView (lines 120-137) has the same issue: on error `summary` is undefined → "Нет данных о зарплате". Neither offers retry.
  - Fix: Add isError to both useQuery destructures and render an error+Повторить EmptyState (action calls refetch) before the empty branch. Purely additive.
- **SchedulePage.tsx** [loading-empty-error] My-Stats tab renders `{myStatsData ? (...) : <LoadingSpinner />}` (lines 996, 1038-1040): if the my-schedule-stats query errors, myStatsData stays undefined and the tab shows a permanent full-screen skeleton forever. The schedule/today queries (274-283) also have no isError handling, so a failed fetch silently blanks the grid.
  - Fix: Track isLoading/isError for the my-stats query explicitly and branch on all three (loading → inline spinner, error → EmptyState+retry, empty → message). Add an error branch to the schedule tab alongside the existing scheduleLoading/empty checks.
- **SchedulePage.tsx** [loading-empty-error] LoadingSpinner is a whole-app skeleton (h-screen / h-[100dvh] with a fake top bar and 5-icon tab bar — see LoadingSpinner.tsx). It is rendered nested inside the month card at line 840 (`<div className="py-16"><LoadingSpinner/></div>`) and inside the My-Stats tab at line 1039. Inside a bordered card/tab this paints a second fake header and tab bar over the real Layout, reading as a broken screen. Same misuse appears in SalaryPage MasterSalaryView.
  - Fix: For in-card/in-tab loading use a small inline spinner (e.g. the existing `<Loader2 className="w-6 h-6 animate-spin text-primary-500" />` pattern already used in this file's WorkMode/history sections), reserving the full-screen LoadingSpinner for page-root loads only.
- **SchedulePage.tsx** [forms] The quick-status popup's "Удалить запись" button (line 1104) calls quickSetStatus('delete'), which immediately fires deleteMutation.mutate(entry.id) (lines 561-564) with no confirmation. The exact same deletion from the edit Modal is gated behind ConfirmDialog (lines 1259-1270). Same destructive action, inconsistent safety, and a mis-tap on the grid permanently deletes a schedule entry.
  - Fix: Route the popup delete through the existing deleteId/ConfirmDialog state (setDeleteId(entry.id) then close popup) instead of calling deleteMutation directly, matching the modal path. No API change.
- **UsersPage.tsx** [accessibility] The mobile card edit and delete buttons (lines 303-316) are icon-only (Pencil / Trash2) with neither a title nor an aria-label, so screen readers announce them as an unlabeled 'button'. The desktop equivalents (lines 367-382) at least carry title="Редактировать"/"Уволить" but still lack aria-label.
  - Fix: Add aria-label="Редактировать сотрудника" and aria-label="Уволить сотрудника" to all four buttons (and title on the two mobile ones). Text/behavior unchanged.
- **SchedulePage.tsx** [accessibility] Month-nav arrows are icon-only with no aria-label (lines 785-790, 804-809, and 106/108 in AttendanceRatingTab). More seriously, the schedule grid date cells are plain <div onClick> (lines 913-920) with no role, tabIndex, or key handler, so the entire status-setting interaction is mouse-only — keyboard users cannot open the quick-status popup, even though the sibling employee-name column was correctly made role="button" tabIndex={0} (line 859-862).
  - Fix: Add aria-label to the chevron nav buttons; give the clickable cells role="button", tabIndex={0}, an aria-label (employee + date), and an onKeyDown Enter/Space handler mirroring the onClick, matching the pattern already used on the names column.
- **EmployeesPage.tsx** [consistency] EmployeesPage hand-rolls a sticky <header> with a custom icon tile + text-2xl title + segmented period control (lines 238-269), EmployeeDetailPage builds a gradient hero h1 (lines 127-148), and SalaryPage master view uses a bare text-2xl h1 (line 143) — while UsersPage and SchedulePage use the shared .page-header/.page-title classes (UsersPage 261-262, SchedulePage 722-723). The result: two screens both titled "Сотрудники" (UsersPage line 262 and EmployeesPage line 245) with visibly different chrome, padding and title scale.
  - Fix: Where a plain header is intended, wrap the title in <div className="page-header"><h1 className="page-title">…</h1></div> and hang the period switcher off it, so the type scale/padding match the rest of the cluster. Keep the EmployeesPage segmented control; only align the title block.
- **EquipmentPage.tsx** [loading-empty-error] test
  - Fix: test
- **KnowledgeBasePage.tsx** [loading-empty-error] The main article list (line 136-140, 352-371) only tracks `articlesLoading`. If `knowledgeApi.listArticles` errors, `articles` stays [] and the UI renders the EmptyState 'Здесь пока пусто / Создайте папку или добавьте первый материал' — telling the user the section is empty and inviting them to author content, when in fact the load failed. Same silent-empty risk for the categories query (line 128).
  - Fix: Add `isError` to the articles query; when true render an error+retry block (reuse EmptyState with icon=AlertCircle, title 'Не удалось загрузить', and an action { label: 'Повторить', onClick: refetch }) instead of the 'пусто' EmptyState.
- **IntegrationsPage.tsx** [loading-empty-error] All four cards (AcquiringCard line 89, FiscalCard line 262, TelephonyCard line 537, WalletCard line 726) read only `isLoading` from useQuery. On a failed getSettings the spinner clears and the form renders its blank defaults (enabled:false, empty shopId/login, 'Ключ ещё не задан'), indistinguishable from an unconfigured integration. The owner can then hit Save and overwrite real stored config, or wrongly conclude nothing is set up. There is no error indication or retry anywhere on this core settings page.
  - Fix: Destructure `isError`/`refetch` in each card and, when isError, replace the form body with a small inline error row (Info/AlertCircle + 'Не удалось загрузить настройки' + 'Повторить' button → refetch) instead of showing the default form; keep the Save button hidden until data actually loads.
- **NotificationSettingsPage.tsx** [loading-empty-error] Two problems. (1) Line 100 `if (isLoading) return <LoadingSpinner />` renders the app-shell skeleton, which is `h-screen h-[100dvh]` with its OWN fake top header AND fake bottom tab bar (LoadingSpinner.tsx line 3-31). Rendered inside the page content area (which already sits inside Layout's real header), this paints a nested header + phantom tab bar and forces 100dvh — a broken-looking full-screen takeover for what is a short toggle list. (2) There is no error branch: if getPreferences fails, isLoading is false, prefs is undefined, muted defaults to [] (line 73) so every switch shows ON, and toggling saves against an unknown baseline.
  - Fix: Replace the full-screen LoadingSpinner with an inline skeleton or centered Loader2 sized to the content (matching how the Integrations cards spin), and add an `isError` branch rendering an error+retry message before the toggle list.
- **CallsPage.tsx** [loading-empty-error] The error state (line 509-514) shows AlertCircle + 'Не удалось загрузить звонки' + 'Проверьте настройки МоиЗвонки' but no retry control — the user must change the date back and forth to re-trigger the query. Also the hint says 'МоиЗвонки', while the telephony integration this feature depends on is labeled 'Телефония (Mango Office)' in IntegrationsPage — inconsistent product naming that sends the owner looking for a settings screen that isn't named that.
  - Fix: Add a 'Повторить' button calling the query's `refetch()` in the error block, and align the hint wording with the actual integration label ('Проверьте настройки телефонии' or 'Mango Office').
- **NotificationSettingsPage.tsx** [accessibility] The toggle switches (line 131-140) are a `<label>` wrapping an sr-only checkbox and a purely-visual `<div>`. The label contains no text and the input has no aria-label; the descriptive text (cat.label / cat.description) lives in a sibling div that is NOT associated with the control. A screen reader announces each switch as an unnamed 'checkbox'. The identical pattern is used by the reusable Toggle in IntegrationsPage.tsx (line 62-71), so every integration on/off switch is also unnamed.
  - Fix: Add `aria-label={cat.label}` to the checkbox input (and pass an `aria-label` prop through the Integrations Toggle, e.g. 'Эквайринг', 'Телефония'), or associate the text via aria-labelledby. Purely additive, no behavior change.
- **CallsPage.tsx** [accessibility] Multiple icon-only controls have no accessible name: previous-day / next-day chevrons (line 418, 422), the per-row play/pause recording button (line 302-314), and the AudioPlayer play/pause (line 171-184) and close (line 211-217) buttons. All announce as bare 'button'. Additionally the audio scrubber (line 191-197) is a click/touch-only `<div>` with no role/aria and no keyboard support.
  - Fix: Add aria-label to each ('Предыдущий день', 'Следующий день', 'Прослушать запись'/'Пауза', 'Закрыть плеер'). Optionally give the scrubber role='slider' with aria-valuenow/min/max and keyboard arrow handling, or at minimum an aria-label.
- **MarketingPage.tsx** [consistency] Three pages in this cluster hand-roll their headers at inconsistent sizes instead of the shared .page-header/.page-title (text-2xl) used by KnowledgeBasePage (line 225-231) and NotificationSettingsPage (line 104-105): MarketingPage line 49 `text-xl font-bold`, IntegrationsPage line 1051 `text-xl font-bold`, and CallsPage line 414 `text-lg font-bold` (the smallest H1 in the app). Navigating between these siblings makes the page title visibly jump size.
  - Fix: Wrap each header in `<div className="page-header">` and use `<h1 className="page-title">`, keeping the existing subtitle `<p className="text-sm text-gray-500">`. Where a leading icon/back button exists (Integrations, Knowledge), keep it as the flex-start element.
- **CompanySettingsPage.tsx** [loading-empty-error] The my-company query (lines 249-252) only destructures isLoading. On fetch failure isLoading is false and company is undefined, so the page silently renders the whole settings form with empty fields — the user sees no error, no retry, and could type and Save over real data. The app's own convention (ClientDetailPage.tsx:882) is `if (isError || !data) return <EmptyState … action retry/back>`.
  - Fix: Destructure isError (and refetch) from useQuery and, before rendering the form, add `if (isError) return <EmptyState icon={Building2} title="Не удалось загрузить настройки" description="Проверьте соединение и попробуйте снова" action={{ label: 'Повторить', onClick: () => refetch() }} />;` matching the existing EmptyState pattern.
- **TariffPage.tsx** [loading-empty-error] The subscription query (lines 15-21) handles only isLoading. On error, sub is undefined and the page renders a misleading 'Ваша организация' / 'Тариф не назначен' card with the users row and plans list hidden — it looks like an unconfigured account rather than a failed load, and there is no retry.
  - Fix: Add isError/refetch from useQuery and render an error state before the main content, e.g. `if (isError) return <EmptyState icon={CreditCard} title="Не удалось загрузить подписку" action={{ label: 'Повторить', onClick: () => refetch() }} />;`.
- **CompanySettingsPage.tsx** [accessibility] Both toggle switches — Режим кассовой смены (lines 76-85) and Программа лояльности (lines 170-179) — are `<input type=checkbox class="sr-only peer">` inside a `<label>` that wraps only the input and its visual pill. The visible heading text ('Режим кассовой смены' / 'Программа лояльности') is a sibling `<h2>`, not associated, so each switch has no accessible name for screen readers.
  - Fix: Add `aria-label="Режим кассовой смены"` / `aria-label="Программа лояльности"` to each checkbox input (no layout change), or give the h2 an id and reference it via aria-labelledby on the input.
- **MorePage.tsx** [accessibility] The avatar upload button (lines 308-315) is icon-only (Camera / Loader2 spinner) with no text and no aria-label, so it announces as an unnamed button.
  - Fix: Add `aria-label="Загрузить фото профиля"` to the button.
- **AdminDashboardPage.tsx** [consistency] The full-app shell skeleton `LoadingSpinner` (components/LoadingSpinner.tsx: `flex flex-col h-screen`, a fake mobile top header AND a fake 5-item bottom tab bar) is returned as the loading state (AdminDashboardPage.tsx:34) but renders INSIDE AdminLayout's `<main>`, which already has the real sidebar + mobile tab nav. The result is a foreign, viewport-tall mobile mock (with a phantom bottom tab bar) flashing inside the desktop admin frame. Same misuse in AdminTenantsPage.tsx:224, AdminPlansPage.tsx:195, AdminAuditLogPage.tsx:43, AdminTenantDetailPage.tsx:467.
  - Fix: In the admin pages, replace `return <LoadingSpinner />` with a lightweight inline loader that lives within the content area — mirror the pattern AdminBroadcastPage already uses for history (a centered `Loader2` spinner in a `card card-body py-10`, or a few `animate-pulse` skeleton `card`s). Do not reuse the mobile-shell LoadingSpinner outside the tenant app; no data/logic change.
- **AdminTenantsPage.tsx** [loading-empty-error] The `['tenants']` query destructures only `{ data, isLoading }` (AdminTenantsPage.tsx:87). There is no `isError` branch, so when the fetch fails, `tenants = data ?? []` is empty and the page shows the EmptyState 'Нет автосервисов / Создайте первую автосервис' (line 238) — a network/server failure is presented as 'you have no tenants', on the primary operational admin screen. AdminBroadcastPage handles this correctly (isError + 'Повторить'); this page does not.
  - Fix: Destructure `isError` (and `refetch`) from the query and add an error branch before the empty/list render: a `card card-body` with a short message ('Не удалось загрузить автосервисы') and a `btn-secondary` 'Повторить' calling `refetch()` — copy AdminBroadcastPage.tsx:640-650. Same pattern should be applied to AdminAuditLogPage.tsx and AdminPlansPage.tsx, which have the identical isLoading-only shape.
- **AdminDashboardPage.tsx** [loading-empty-error] `admin-stats` is read with `{ data, isLoading }` only (line 28); on fetch failure `stats` is undefined and every card renders `?? 0`, so the owner sees a fully-populated dashboard reading 'MRR 0 ₽', 'ARPU 0 ₽', 'Всего клиентов 0' — fabricated financial zeros indistinguishable from a real empty platform. The embedded SubscriptionRevenuePanel/MrrTrendChart carry their own state, but the top KPI grid does not.
  - Fix: Add `isError` to the query and, when true, render an inline error card with a 'Повторить' (`refetch`) button in place of the KPI grid, instead of silently substituting zeros. No change to the success rendering.
- **AdminTenantDetailPage.tsx** [loading-empty-error] The `['tenant', id]` query uses `{ data: tenant, isLoading }` only (line 164). After loading, if the request failed (500/network/timeout) `tenant` is undefined and the page renders the 'Автосервис не найден' EmptyState (line 469) with a 'Назад' action — a transient fetch error is shown to the operator as a permanent 404, with no retry.
  - Fix: Destructure `isError`/`refetch`; distinguish the two: on `isError` show an error state with a 'Повторить' button (refetch), and keep the 'не найден' EmptyState only for a genuinely resolved-but-empty response. Minimal branch addition, no logic/API change.
- **AdminPlansPage.tsx** [accessibility] The plan-card edit and delete controls are icon-only buttons with NO accessible name — neither `aria-label` nor `title` (AdminPlansPage.tsx:268-273 Pencil, 274-279 Trash2). A screen reader announces them as bare 'button'. (By contrast AdminTenantDetailPage.tsx:783/790 and AdminTenantsPage give their icon buttons a `title`, and Modal's close button has aria-label — so this page is the outlier.)
  - Fix: Add `aria-label="Редактировать тариф"` and `title="Редактировать"` to the edit button and `aria-label="Удалить тариф"` / `title="Удалить"` to the delete button. Purely additive.
- **LoginPage.tsx** [accessibility] LoginPage.tsx:126-132 — the password show/hide toggle is an icon-only <button> (Eye/EyeOff) with no aria-label and no text, so screen readers announce it as an unnamed button. The functionally identical toggle in the shared RegisterForm.tsx:181-188 already sets aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}, so this is an inconsistent regression on the primary screen.
  - Fix: Add aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'} to the button on LoginPage.tsx:127 (mirror RegisterForm). No functional change.
- **LoginPage.tsx** [consistency] LoginPage.tsx:83-94, 111-125, 138-151 hand-roll inputs, labels and the submit button with bespoke Tailwind (rounded-xl, bg-gray-50, py-3.5, uppercase tracking-wider micro-labels, border-red-400 error) instead of the shared .input / .label / .input-error / .btn-primary classes (index.css:142-168) that the rest of the app — including the RegisterForm shown in the modal launched from this same screen (RegisterModal over LoginPage) — uses. The result: rounded-xl vs rounded-lg, gray-50 fill vs white, uppercase micro-labels vs sentence-case .label, and a submit button lacking the .btn's focus:ring-2 focus:ring-offset-2. Two different input systems are visible in one login flow.
  - Fix: Where practical, replace the bespoke input/label/button classes with .input, .label, .input-error and .btn-primary (keeping the leading Phone/Lock icons via a wrapping relative div). If the premium login look is intentional, at minimum align the error border to border-red-500 and add the .btn focus ring to the submit button so keyboard focus and error styling match the app. Purely visual, no behavior change.
- **LoginPage.tsx** [accessibility] Several real text/link elements fall well below 4.5:1 on the white background: the footer legal links «Политика конфиденциальности» / «Условия использования» use text-gray-400 (#9ca3af ≈ 2.8:1) — LoginPage.tsx:177,186; the copyright «Autexa v2.1 © 2026» uses text-gray-300 (#d1d5db ≈ 1.6:1) — LoginPage.tsx:191; the subtitle (line 70) and the «Подключить автосервис?» helper (line 156) also use text-gray-400. The legal links are interactive and must be legible.
  - Fix: Bump the footer legal links to text-gray-500 (hover:text-gray-700), the copyright to text-gray-400, and the subtitle/helper text to text-gray-500. Colors only, no layout or behavior change.

### P2

- **DashboardPage.tsx / WorkBoardPage.tsx** [accessibility] Icon-only controls rely on title alone or nothing. DashboardPage.tsx:538-553 period prev/next chevrons have no aria-label. WorkBoardPage.tsx:134-142 refresh/settings buttons have title plus a hidden sm:inline label, so on mobile they are icon-only with the text removed from the a11y tree, leaving only title.
  - Fix: Add explicit aria-label (Предыдущий период, Следующий период, Обновить, Настроить колонки) to each icon-only button.
- **ReportsPage.tsx / DashboardPage.tsx** [consistency] ReportsPage.tsx:55-67 hand-rolls the Доступ ограничен state (centered, bg-gray-100 rounded-full icon, custom h2) nearly identical to the shared EmptyState (components/EmptyState.tsx). DashboardPage.tsx also defines local ErrorBanner (135-142) and StatCardSkeleton (54-64); the ErrorBanner used by MasterDashboard (line 757) has no retry action.
  - Fix: Render EmptyState with icon Lock and title Доступ ограничен in ReportsPage instead of the bespoke block. For the DashboardPage error path prefer a shared error affordance with a retry/refetch action.
- **DashboardPage.tsx** [accessibility] In the dark RevenueChart card the labels Оборот, Прибыль, Чеков and the x-axis labels use text-slate-500 on bg-slate-900 (about 3.3:1, fails AA for small text), and month-view axis labels render at text-[8.5px] (DashboardPage.tsx:634-636), below a comfortably legible size.
  - Fix: Use text-slate-400 (or slate-300) for these labels on the dark card to clear 4.5:1, and raise the smallest axis label from 8.5px to at least 10px, or thin the label set so 10px fits.
- **ClientsPage.tsx** [accessibility] Row/card navigation is implemented as onClick on a <tr> (ClientsPage.tsx:364) and a <div> (line 312), and likewise in CarsPage.tsx (<tr> line 108, <div> line 75). These have cursor-pointer but no role, tabIndex, or key handler, so the entire clients/cars list is unreachable and unactivatable by keyboard.
  - Fix: Minimal: on the clickable card <div> add role="button", tabIndex={0}, and onKeyDown to fire navigate on Enter/Space. For table rows, either the same pattern or make the client name a real <Link>. Keep the existing onClick.
- **CarsPage.tsx** [consistency] CarsPage wraps SearchInput in a full-width container (CarsPage.tsx:46, className="mb-4") while the sibling ClientsPage constrains it to max-w-md (ClientsPage.tsx:248). On desktop the cars search stretches edge-to-edge, breaking the visual rhythm shared by the two list pages.
  - Fix: Change CarsPage.tsx line 46 to className="mb-4 max-w-md" to match ClientsPage.
- **ClientDetailPage.tsx** [consistency] The same payment methods are styled with two interchangeable token families in the same file: CarChecksPanel.paymentBadge uses badge-success/badge-info/badge-warning/badge-default (ClientDetailPage.tsx:99-110) while the Recent Checks section uses badge-green/badge-blue/badge-yellow/badge-gray (lines 1080-1086). They render identically (verified in index.css) but the split invites drift on future edits.
  - Fix: Pick one family (the -blue/-green/-yellow/-gray set is used more widely in the cluster) and update the paymentBadge map to match. Purely a class-name normalization, no visual change.
- **SalaryPage.tsx** [consistency] In the desktop table each master maps to a bare fragment `return (<> <tr key=...> ... {isExpanded && <tr key=...>} </>)` (lines 467-504). The key sits on the inner <tr>s but the fragment returned by .map has no key, triggering React's 'Each child in a list should have a unique key prop' warning and defeating reconciliation on the row list.
  - Fix: Replace the anonymous fragment with `<Fragment key={master.masterId}>` (import Fragment from react) and drop the now-redundant key on the first <tr>.
- **SchedulePage.tsx** [consistency] The master-reorder dialog (lines 1046-1074) and the quick-status popup (lines 1078-1110) hand-roll fixed inset-0 backdrops + centered panels, duplicating what components/Modal provides and skipping its Escape-to-close and focus handling. The edit form on the same screen already uses <Modal> (line 1191), so the interaction model is inconsistent within one page.
  - Fix: Port at least the reorder dialog (a plain centered dialog) to <Modal isOpen ... size="sm">. If the quick popup must stay custom for layout reasons, add onKeyDown Escape handling to match Modal's behavior.
- **EmployeesPage.tsx** [typography] Small (9-11px) labels and hints are set in text-gray-400 (#9ca3af ≈ 2.5:1 on white) and text-gray-300 throughout: KPI captions (lines 196, 201), Stat label/hint (lines 539, 546), member counts (line 339). EmployeeDetailPage repeats it (Tile labels line 324, Row labels 337), as does SalaryPage (stat labels, mobile card captions lines 379/383/387). At these sizes the text is effectively unreadable for low-vision users and fails WCAG AA.
  - Fix: Bump content-bearing micro-labels from text-gray-400/300 to text-gray-500 (#6b7280 ≈ 4.6:1). Keep purely decorative chevrons as-is. No layout change.
- **EmployeeDetailPage.tsx** [consistency] EmployeeDetailPage (lines 24-25) and EmployeesPage (lines 49-52) each define a local regex-based formatMoney, while SalaryPage imports the shared formatMoney from shared/utils/formatters (line 21). Divergent implementations risk different grouping/rounding for the same figures across the staff cluster.
  - Fix: Import formatMoney from '../../../shared/utils/formatters' in both pages and delete the local copies (verify the shared one already appends ₽ / rounds identically before removing).
- **CallsPage.tsx** [accessibility] Meaningful text is rendered in text-gray-400 (#9ca3af ≈ 2.8:1 on white), below AA: the header subtitle 'История и записи' (line 415) and the 10px call durations / status secondary lines (line 297, 443). IntegrationsPage hintCls also uses text-[11px] text-gray-400 (line 37) for field guidance. Tiny + low-contrast compounds legibility.
  - Fix: Bump secondary content text from text-gray-400 to text-gray-500 (≈4.6:1) and avoid pairing 10-11px with gray-400; reserve gray-400 for decorative icons only.
- **IntegrationsPage.tsx** [accessibility] The header back button (line 1047, ArrowLeft only) has no aria-label/title, and in KnowledgeBasePage.tsx the reader's delete button (line 792-794, Trash2 only) has neither aria-label nor title (unlike the folder-manager Trash/Pencil which do carry titles). Both announce as unnamed 'button'.
  - Fix: Add aria-label='Назад' to the Integrations back button and aria-label='Удалить статью' (or a title) to the reader delete button.
- **CompanySettingsPage.tsx** [loading-empty-error] The loading branch (lines 317-323) is a bare centered Loader2 spinner, whereas the rest of the app — including TariffPage in this same cluster — returns the shared skeleton `<LoadingSpinner />`.
  - Fix: Replace the custom spinner block with `return <LoadingSpinner />;` (already imported pattern elsewhere) for consistent loading chrome.
- **CompanySettingsPage.tsx** [consistency] Every field hand-rolls the input class string `rounded-xl border border-gray-200 px-4 py-2.5 text-sm focus:border-primary-300 focus:ring-1 focus:ring-primary-200` (e.g. lines 350, 364, 390, 430) and labels as `text-xs font-medium text-gray-600` (e.g. lines 346, 357). The design system ships `.input` and `.label` (index.css:160,166); the hand-rolled labels are smaller (text-xs vs .label text-sm) and lower-contrast (gray-600 vs gray-700) than the standard.
  - Fix: Swap the repeated input class strings for `className="input"` and the label spans for `className="label"` (or at minimum bump labels to text-sm/text-gray-700 to match .label). No functional change.
- **CompanySettingsPage.tsx** [consistency] Cards use `bg-white rounded-2xl border border-gray-100 shadow-sm p-5` (lines 339, 408, 70, 164) instead of the shared `.card` (rounded-xl, border-gray-200) + `.card-body` used by TariffPage in the same cluster — divergent radius and border color. Also the header h1 is `text-xl font-bold` (line 333) while the design-system `.page-title` is `text-2xl font-bold`, so this settings page's title is a size smaller than TariffPage's.
  - Fix: Move card containers to `className="card"` with an inner `card-body`, and either use `.page-title` on the h1 or bump it to text-2xl to align the heading scale across the cluster.
- **MorePage.tsx** [navigation] The 'Ещё' page renders a user card and menu list with no `<h1>`/page-title at all; the first heading-level text is the user's name in a `<p>`. This breaks heading hierarchy (no h1 on the page) versus other pages that use .page-title.
  - Fix: Add a visually-consistent page title (e.g. an h1 'Ещё' using .page-title, or at minimum a screen-reader h1) above the user card; keep the existing layout otherwise.
- **MorePage.tsx** [consistency] User card, menu-list container, and logout button all hand-roll `bg-white rounded-2xl border border-gray-100 shadow-sm` (lines 298, 336, 376) rather than the shared `.card` (rounded-xl / border-gray-200), matching the same divergence in CompanySettingsPage and differing from TariffPage's `.card`.
  - Fix: Adopt `.card` on these containers (add divide/overflow utilities as needed) so radius and border color match the rest of the app.
- **CompanySettingsPage.tsx** [accessibility] Small helper/hint text uses text-gray-400 (#9ca3af ≈ 2.8:1 on white), below the 4.5:1 minimum — e.g. the cashier-note (lines 93-95), percent-field hints (lines 209, 226), and the receipt-footer hint (line 469). TariffPage's feature-group labels (line 154) do the same. The app's own hint color elsewhere is gray-500 (.stat-label), which passes.
  - Fix: Raise these `text-gray-400` hint spans to `text-gray-500` to meet contrast and match the app's standard hint color; no layout change.
- **AdminTenantsPage.tsx** [accessibility] The Активна/Неактивна toggle is an `sr-only peer` checkbox whose `<label>` wraps only the visual track `<div>`; the descriptive text ('Активна'/'Неактивна') sits in a sibling `<span>` outside the label (AdminTenantsPage.tsx:541-551). The checkbox therefore has no accessible name — a screen reader reads an unlabeled checkbox. Identical pattern in AdminPlansPage.tsx:439-450 and AdminTenantDetailPage.tsx:869-880 / 1008-1019.
  - Fix: Add `aria-label="Активна"` to each `sr-only peer` checkbox (or move the status `<span>` inside the same `<label>`). No visual/behavior change.
- **AdminTenantsPage.tsx** [accessibility] Meaningful body text is rendered in `text-gray-400` (#9ca3af ≈ 2.85:1 on white, below the 4.5:1 minimum): the 'Нет доступных тарифов...' notice inside the tenant modal (AdminTenantsPage.tsx:534). Same low-contrast gray-400 is used for real content in AdminPlansPage.tsx (excluded-feature labels line 309, 'Тарифы загружаются…' etc.) and AdminBroadcastPage placeholders.
  - Fix: Bump informational gray-400 text to `text-gray-500` (the app's standard secondary color, ≈ 4.6:1). Leave decorative icon strokes as-is. Cosmetic only.
- **AdminPlansPage.tsx** [typography] The plan-card price uses `plan.monthlyPrice.toLocaleString('ru-RU')` with no `tabular-nums` (AdminPlansPage.tsx:284), whereas the dashboard KPI values (AdminDashboardPage.tsx `stat-value tabular-nums`) and the tenant modal price (AdminTenantsPage.tsx:525 `tabular-nums`) do use lining/tabular figures. Prices across the plan grid don't align digit-for-digit, inconsistent with the rest of the cluster.
  - Fix: Add `tabular-nums` to the price `<span>` (line 284). One-class change, no functional impact.
- **RegisterForm.tsx** [forms] RegisterForm.tsx marks only the optional field explicitly — «Комментарий (необязательно)» (line 195) — while the four validated-required fields (company/owner/phone/password, lines 116,133,149,168) carry no visual required marker. The asymmetry implies the unmarked fields are optional even though submit blocks on them (lines 63-66). The owner input also omits the HTML required attribute that company (line 119) has.
  - Fix: Add a required marker (e.g. a red «\*» after the label text) to the four required .label elements, and add required to the owner <input> for parity with company. Cosmetic + attribute parity; validation logic already enforces these.
- **RegisterForm.tsx** [accessibility] Field-level validation errors render as text-red-500 (#ef4444 ≈ 3.9:1 on white) at text-xs — RegisterForm.tsx:128,144,163,190 and LoginPage.tsx:96,134. Small red-500 text is just under the 4.5:1 threshold. This is an app-wide pattern, so keep it consistent but ideally darken.
  - Fix: Use text-red-600 for the small error paragraphs (≈4.8:1) across both forms — a single-shade darken that stays on-brand and doesn't touch the red-500 borders/logic.
