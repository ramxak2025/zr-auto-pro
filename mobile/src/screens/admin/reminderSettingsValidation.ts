export function parseReminderDays(text: string): number[] | null {
  if (!text.trim()) return [];
  const pieces = text.trim().split(/[,;\s]+/);
  if (pieces.some((part) => !/^\d+$/.test(part))) return null;
  const days = [...new Set(pieces.map(Number))];
  return days.length <= 8 && days.every((day) => day >= 0 && day <= 30) ? days.sort((a, b) => b - a) : null;
}
