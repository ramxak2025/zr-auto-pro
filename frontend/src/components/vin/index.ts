/**
 * VIN-код автомобиля — единый модуль веба (171, 2026-09-25): поле ввода с
 * расшифровкой, вывод номера с копированием и чистые помощники UI. Раньше
 * жил двумя копиями в `components/checks/` и `components/clients/`.
 */
export { default as VinInput } from './VinInput';
export type { VinInputProps } from './VinInput';
export { VinText, VinLine, CopyVinButton } from './VinText';
export * from './vinUi';
