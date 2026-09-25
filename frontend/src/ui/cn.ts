import clsx, { type ClassValue } from 'clsx';

/**
 * Склейка классов. Обёртка над clsx без tailwind-merge (новых зависимостей в
 * проекте не заводим): порядок классов — ответственность вызывающего, поэтому
 * примитивы всегда ставят `className` потребителя ПОСЛЕДНИМ.
 */
export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}
