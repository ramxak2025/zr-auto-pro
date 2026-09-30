/**
 * adminMoney — чистые (без React Native) правила денег в кабинетах суперадмина и менеджера:
 * рубли до копейки, доля владельца, подписи баланса и разбор введённой суммы. Отдельный
 * модуль, чтобы их проверял jest без нативных модулей; экраны берут их через adminShared.
 */

/**
 * Рубли до копейки, когда они есть: 740.74 → «740,74 ₽», 3000 → «3 000 ₽». Доля
 * владельца и долг менеджера считаются до копейки, а `formatMoney` округляет до рубля.
 */
export function formatMoneyExact(value: number): string {
  const cents = Math.round((value || 0) * 100);
  const abs = Math.abs(cents);
  const rub = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const kop = abs % 100;
  return `${cents < 0 ? '−' : ''}${rub}${kop ? `,${String(kop).padStart(2, '0')}` : ''} ₽`;
}

/**
 * Доля владельца в подсказке формы: round(amount × pct / 100, 2), как на сервере.
 * Только подсказка — истина в ответе сервера (снимок в `ownerShareAmount`).
 */
export function computeOwnerShare(amount: number, percent: number): number {
  // toFixed(6) гасит хвост двоичной дроби (301.49999999999994 → 301.5), как numeric в PG.
  return Math.round(Number((amount * percent).toFixed(6))) / 100;
}

/** 60 → «60 %», 33.5 → «33,5 %». */
export function formatPercent(value: number): string {
  return `${String(Number(value.toFixed(2))).replace('.', ',')} %`;
}

/** Подпись баланса менеджера: долг владельцу, переплата (расчётов внесено больше долей) или «Долга нет». */
export function balanceCaption(balance: number): string {
  if (balance >= 0.005) return `Долг ${formatMoneyExact(balance)}`;
  if (balance <= -0.005) return `Переплата ${formatMoneyExact(-balance)}`;
  return 'Долга нет';
}

/** «3000», «3 000,50», «3000.5» → рубли с копейками; пусто/ноль/мусор → null. */
export function parseAmount(raw: string): number | null {
  const text = raw.replace(/\s/g, '').replace(',', '.');
  if (!text) return null;
  const v = Number(text);
  if (!Number.isFinite(v) || v <= 0) return null;
  return Math.round(v * 100) / 100;
}
