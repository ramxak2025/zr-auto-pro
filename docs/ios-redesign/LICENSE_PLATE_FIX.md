# License Plate — fix details (2nd pass)

## TL;DR

Регион больше не дублируется. Реализовано через **два независимых `TextInput`** (main + region) вместо одного с склеенным `displayValue`.

## Архитектура компонента

```
┌────────────────────────────┬────────────┐
│  ┌──────────────────────┐  │ [region    │
│  │ <TextInput main />   │  │  <TextInput│
│  │  "А 123 АА"           │  │   region/> │
│  └──────────────────────┘  │  flag, RUS │
└────────────────────────────┴────────────┘
                             ↑
                       2px black divider
```

- Родитель хранит ОДНУ строку `value` ('А123АА77').
- Компонент при render через `splitPlate(value)` режет на `main` (0..6) и `region` (6..9).
- Главный TextInput показывает `formatMain(main)` ('А 123 АА' — с пробелами).
- Region TextInput показывает `region` ('77' или '177').
- На любое изменение — child компонент собирает clean: `combinePlate(newMain, region)` или `combinePlate(main, newRegion)` и вызывает `onChangeText(clean)`.

## Auto-focus

Когда пользователь набирает 6-й символ main части (clean main `length === 6`), фокус автоматически переходит на region. Через `setTimeout(() => regionRef.current?.focus(), 0)` — даём React Native обновить state перед перемещением фокуса.

## Backspace cross-boundary

Когда пользователь стоит в **пустом** region и нажимает backspace, фокус возвращается на main. Реализовано через `onKeyPress`:

```tsx
onKeyPress={(e) => {
  if (e.nativeEvent.key === 'Backspace' && region.length === 0) {
    mainRef.current?.focus();
  }
}}
```

## Нормализация ввода

### Main блок (`processPlateMainInput`)

```ts
function processPlateMainInput(raw: string): string {
  const chars: string[] = [];
  let pos = 0;
  for (const ch of raw) {
    if (pos >= 6) break;
    const normalized = normalizeChar(ch, pos); // pos 0=letter, 1-3=digit, 4-5=letter
    if (normalized) {
      chars.push(normalized);
      pos++;
    }
  }
  return chars.join('');
}
```

`normalizeChar` применяет: `toUpperCase` → `LAT_TO_CYR` map → проверка по позиции:

- pos 0, 4, 5: только из {А, В, Е, К, М, Н, О, Р, С, Т, У, Х}
- pos 1, 2, 3: только цифры 0-9

Невалидные символы отбрасываются (не вставляются в clean).

### Region блок (`processPlateRegionInput`)

```ts
function processPlateRegionInput(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, 3);
}
```

Только цифры, максимум 3 (для 3-значных регионов типа 777, 199).

### Foreign блок (`normalizeForeignPlate`)

```ts
function normalizeForeignPlate(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9 \-/]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 20);
}
```

Сохраняет разделители (`-`, `/`, пробел) — иностранные номера часто пишут с ними.

## Поиск в backend

В `CheckCreateScreen` используется:

```ts
const normalizedSearch = normalizePlateForSearch(plateSearch, plateMode);
useQuery({
  queryKey: ['clients-plate', normalizedSearch, plateMode],
  queryFn: () => clientsApi.getAll({ search: normalizedSearch, limit: 20 }),
  enabled: normalizedSearch.length >= 2,
  placeholderData: (prev) => prev, // keepPreviousData
});
```

`normalizePlateForSearch`:

- mode='ru': `processPlateInput(raw.replace(/\s/g, ''))` — латиница→кириллица, удаление пробелов
- mode='foreign': uppercase + удаление separators (`-`, `/`, пробел) для substring match

## Acceptance criteria — все ✅

- [x] `О777ОО88` → `О 777 ОО | 88` (без дубля)
- [x] `O777OO88` (latin) → `О 777 ОО | 88`
- [x] `Р332РА05` → `Р 332 РА | 05`
- [x] `P332PA05` → `Р 332 РА | 05`
- [x] `А123АА777` (3-digit region) → `А 123 АА | 777`
- [x] `р332ра05` (lowercase) → `Р 332 РА | 05`
- [x] Backspace в empty region → focus возвращается на main
- [x] Auto-focus на region когда main complete
- [x] Foreign mode: `BG-3845-PA` → отображается как есть с INT-маркером
- [x] Поиск backend получает нормализованный clean
- [x] Тесты в `mobile/src/utils/__tests__/plateMask.test.ts` — все проходят

## Тестируемые функции (unit-tested)

В `mobile/src/utils/plateMask.ts`:

- `processPlateInput(raw)` — общий, для legacy back-compat
- `processPlateMainInput(raw)` — main block
- `processPlateRegionInput(raw)` — region block
- `combinePlate(main, region)` — helper
- `formatPlateDisplay(clean)` — для строковой репрезентации
- `formatMain(main)` — main с пробелами
- `splitPlate(clean)` — split into main + region
- `isValidPlate(clean)` — regexp
- `isRussianInput(text)` — auto-detect
- `normalizeForeignPlate(raw)` — INT нормализация
- `normalizePlateForSearch(raw, mode)` — для backend
- `detectPlateMode(value)` — initial mode для UI

---

## Addendum 2026-07-27 — перестановка цифр при быстром наборе (root cause: контролируемый `selection` на Fabric)

**Симптом.** При быстром наборе «х807кс» на кассе получалось «Х 870 …» — цифры менялись местами. Воспроизводилось ПОСЛЕ всех предыдущих фиксов (локальный буфер `mainClean`, echo-ring `emittedRef`, анти-IME пропы) — они корректны и остаются, но корень был не в них.

**Root cause.** `RussianPlateInput` после каждого кейстрока пинил caret через state-проп: `handleMainChange` → `setMainSel({start: end, end})`, эхо-хендлер `onSelectionChange` → `setMainSel(e.nativeEvent.selection)`, и `TextInput` получал `selection={mainSel}`. React-коммит пропа на Fabric **асинхронный**: selection `{3,3}` от кейстрока «8» долетал до native ПОСЛЕ того, как пользователь уже набрал «0» (native «Х 80», caret 4). Устаревший проп откатывал caret на 3, и следующий «7» вставлялся по устаревшей позиции: «Х 870». Маска (`plateMask.ts`) порядко-сохранна и невиновна — она лишь узаконивала уже испорченную строку.

**Fix.** Контролируемый caret удалён полностью: state `mainSel`, проп `selection`, `onSelectionChange` и его хендлер, все `setMainSel`. Native сам держит caret: при append/backspace он и так корректен; при перезаписи `value` (вставка пробела «Х8»→«Х 8», latin→cyrillic замена) iOS и Android ставят caret в конец переписанного текста — что и есть правильная позиция для этих кейсов. Императивная коррекция не потребовалась. У регион-поля контролируемого selection не было — лечение не нужно.

**Правило.** Caret руками — **только императивно** (`ref.setSelection` / `dispatchCommand` в том же тике), **никогда через state-проп `selection`**: на Fabric его коммит асинхронный и во время быстрого набора всегда проигрывает гонку следующему кейстроку.
