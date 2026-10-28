function readableDay(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
    .format(date)
    .replace(/\s*г\.$/, '');
}

export function journalPeriodLabel(from: string, to: string) {
  if (!from && !to) return 'За всё время';
  if (from === to) return readableDay(from);
  if (!from) return `По ${readableDay(to)}`;
  if (!to) return `С ${readableDay(from)}`;
  const first = from.slice(0, 4) === to.slice(0, 4) ? readableDay(from).replace(/\s\d{4}$/, '') : readableDay(from);
  return `${first} — ${readableDay(to)}`;
}
