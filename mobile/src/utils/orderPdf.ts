// ═══════════════════════════════════════════════════════════════════════════
//  Заказ-наряд / акт — генерация PDF для открытого чека.
//
//  Чистая функция `buildOrderHtml` (без нативных зависимостей — тестируется
//  отдельно) собирает A4-вёрстку заказ-наряда из данных чека + реквизитов
//  компании. `shareOrderPdf` поднимает expo-print / expo-sharing ЛЕНИВО через
//  guarded require: до батч-prebuild нативные модули ExpoPrint / ExpoSharing не
//  слинкованы, и обычный top-level `import` уронил бы экран на старте. Поэтому
//  если модуль не найден — деградируем до алерта «Доступно после обновления
//  приложения» вместо краша. Контракт совпадает с KnowledgeBlocks (lazy
//  react-native-webview): «native linked only after the batched prebuild».
//
//  ВСЕ строковые значения из данных (имена, адрес, комментарии, госномер)
//  экранируются `escapeHtml` перед вставкой в HTML — иначе символы < > & " '
//  ломают разметку PDF или открывают HTML-инъекцию. Числа/даты форматируем
//  сами — их экранировать не нужно.
// ═══════════════════════════════════════════════════════════════════════════
import type { Check, Tenant } from '../../../shared/types';

const PAYMENT_LABELS: Record<string, string> = {
  cash: 'Наличные',
  card: 'Карта',
  warranty: 'Гарантия',
  cash_card: 'Нал/Карта',
};

// Alert поднимаем лениво, чтобы модуль с чистым `buildOrderHtml` НЕ тянул
// 'react-native' статически — иначе он не импортируется в node-окружении jest
// (RN-индекс на Flow-синтаксисе не трансформируется дефолтным jest).
function showAlert(title: string, message: string): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Alert } = require('react-native') as typeof import('react-native');
    Alert.alert(title, message);
  } catch {
    /* вне RN-окружения (тесты) — no-op */
  }
}

/**
 * Экранирует любое свободное текстовое значение перед вставкой в HTML.
 * Применять ко ВСЕМ значениям из данных (имена, адрес, госномер, footer).
 */
export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatMoney(v: number): string {
  return (
    Math.round(v || 0)
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽'
  );
}

function formatDateTime(d: string): string {
  const dt = new Date(d);
  const date = dt.toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' });
  const time = dt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  return `${date}, ${time}`;
}

/**
 * Собирает HTML заказ-наряда (A4, inline CSS, без внешних ресурсов).
 * Чистая функция — никаких нативных зависимостей, удобно тестировать.
 */
export function buildOrderHtml(check: Check, company?: Tenant | null): string {
  const c = company;
  const companyName = escapeHtml(c?.legalName || c?.name || 'Автосервис');
  const innLine = c?.inn ? `ИНН ${escapeHtml(c.inn)}` : '';
  const addr = c?.address ? escapeHtml(c.address) : '';
  const phone = c?.phone ? escapeHtml(c.phone) : '';
  const reqLine = [innLine, addr, phone].filter(Boolean).join(' &nbsp;•&nbsp; ');
  const footer = c?.receiptFooter ? escapeHtml(c.receiptFooter) : '';

  const dateLabel = formatDateTime(check.date);
  const services = check.services ?? [];
  const products = check.products ?? [];

  const clientName = check.client?.fullName ? escapeHtml(check.client.fullName) : 'Розничный покупатель';
  const carLabel = check.car
    ? `${escapeHtml(check.car.makeModel)}${check.car.plateNumber ? ` &nbsp;·&nbsp; ${escapeHtml(check.car.plateNumber)}` : ''}`
    : '';
  const mileageLabel = check.mileage ? `${check.mileage.toLocaleString('ru-RU')} км` : '';
  const masterLabel = check.master?.fullName ? escapeHtml(check.master.fullName) : '';
  const paymentLabel = escapeHtml(PAYMENT_LABELS[check.paymentMethod] ?? check.paymentMethod);
  const discount = check.discount ?? 0;

  const infoRow = (label: string, value: string) =>
    value ? `<tr><td class="k">${label}</td><td class="v">${value}</td></tr>` : '';

  const servicesTable =
    services.length > 0
      ? `
      <h3>Услуги</h3>
      <table class="lines">
        <thead><tr>
          <th class="n">№</th><th>Наименование</th><th>Мастер</th>
          <th class="r">Кол-во</th><th class="r">Цена</th><th class="r">Сумма</th>
        </tr></thead>
        <tbody>
          ${services
            .map(
              (s, i) => `<tr>
              <td class="n">${i + 1}</td>
              <td>${escapeHtml(s.name)}</td>
              <td>${s.master?.fullName ? escapeHtml(s.master.fullName) : '—'}</td>
              <td class="r">${s.quantity}</td>
              <td class="r">${formatMoney(s.price)}</td>
              <td class="r">${formatMoney(s.total)}</td>
            </tr>`,
            )
            .join('')}
        </tbody>
        <tfoot><tr><td colspan="5" class="r">Итого услуги</td><td class="r b">${formatMoney(check.serviceTotal)}</td></tr></tfoot>
      </table>`
      : '';

  const productsTable =
    products.length > 0
      ? `
      <h3>Товары / запчасти</h3>
      <table class="lines">
        <thead><tr>
          <th class="n">№</th><th>Наименование</th>
          <th class="r">Кол-во</th><th class="r">Цена</th><th class="r">Сумма</th>
        </tr></thead>
        <tbody>
          ${products
            .map(
              (p, i) => `<tr>
              <td class="n">${i + 1}</td>
              <td>${escapeHtml(p.name)}</td>
              <td class="r">${p.quantity}</td>
              <td class="r">${formatMoney(p.sellPrice)}</td>
              <td class="r">${formatMoney(p.totalSell)}</td>
            </tr>`,
            )
            .join('')}
        </tbody>
        <tfoot><tr><td colspan="4" class="r">Итого товары</td><td class="r b">${formatMoney(check.productTotal)}</td></tr></tfoot>
      </table>`
      : '';

  return `<!DOCTYPE html>
<html lang="ru"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<style>
  @page { size: A4; margin: 16mm 14mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Helvetica Neue", Arial, sans-serif; color: #1c1c1e; font-size: 12px; line-height: 1.45; margin: 0; }
  .company { font-size: 19px; font-weight: 700; letter-spacing: -0.2px; }
  .req { color: #6b7280; font-size: 11px; margin-top: 3px; }
  .rule { border: none; border-top: 2px solid #111; margin: 12px 0 14px; }
  .title { font-size: 16px; font-weight: 700; }
  .title .date { font-weight: 400; color: #6b7280; font-size: 12px; }
  table.info { width: 100%; border-collapse: collapse; margin: 10px 0 4px; }
  table.info td { padding: 3px 0; vertical-align: top; }
  table.info td.k { color: #6b7280; width: 130px; }
  table.info td.v { font-weight: 600; }
  h3 { font-size: 13px; margin: 18px 0 6px; }
  table.lines { width: 100%; border-collapse: collapse; }
  table.lines th, table.lines td { padding: 6px 6px; border-bottom: 1px solid #ececec; text-align: left; font-size: 11px; }
  table.lines thead th { background: #f6f6f7; color: #444; font-weight: 600; border-bottom: 1px solid #d9d9de; }
  table.lines td.n, table.lines th.n { width: 26px; color: #9ca3af; text-align: center; }
  table.lines .r { text-align: right; white-space: nowrap; }
  table.lines tfoot td { border-bottom: none; border-top: 1px solid #d9d9de; font-weight: 600; padding-top: 8px; }
  .b { font-weight: 700; }
  .totals { margin-top: 16px; width: 100%; border-collapse: collapse; }
  .totals td { padding: 4px 0; }
  .totals td.r { text-align: right; }
  .totals tr.grand td { font-size: 16px; font-weight: 700; border-top: 2px solid #111; padding-top: 8px; }
  .pay { margin-top: 6px; color: #6b7280; text-align: right; font-size: 12px; }
  .sign { margin-top: 46px; display: flex; justify-content: space-between; gap: 32px; }
  .sign .line { flex: 1; border-top: 1px solid #9ca3af; padding-top: 4px; color: #6b7280; font-size: 11px; }
  .footer { margin-top: 26px; text-align: center; color: #9ca3af; font-size: 10px; }
</style></head>
<body>
  <div class="company">${companyName}</div>
  ${reqLine ? `<div class="req">${reqLine}</div>` : ''}
  <hr class="rule"/>
  <div class="title">Заказ-наряд №${check.number} <span class="date">от ${dateLabel}</span></div>

  <table class="info">
    ${check.point?.name ? infoRow('Точка', escapeHtml(check.point.name)) : ''}
    ${infoRow('Клиент', clientName)}
    ${infoRow('Автомобиль', carLabel)}
    ${infoRow('Пробег', mileageLabel)}
    ${infoRow('Мастер', masterLabel)}
  </table>

  ${servicesTable}
  ${productsTable}

  <table class="totals">
    ${discount > 0 ? `<tr><td>Скидка</td><td class="r">−${formatMoney(discount)}</td></tr>` : ''}
    <tr class="grand"><td>ИТОГО</td><td class="r">${formatMoney(check.totalRevenue)}</td></tr>
  </table>
  <div class="pay">Способ оплаты: ${paymentLabel}</div>

  <div class="sign">
    <div class="line">Подпись клиента ____________________</div>
    <div class="line">Подпись исполнителя ____________________</div>
  </div>

  ${footer ? `<div class="footer">${footer}</div>` : ''}
</body></html>`;
}

/**
 * Строит PDF заказ-наряда и открывает системный share-sheet (печать, сохранить
 * в Файлы, отправить в WhatsApp). expo-print / expo-sharing подключаются лениво
 * через guarded require — до батч-prebuild нативные модули не слинкованы, и тогда
 * показываем мягкий алерт вместо краша.
 */
export async function shareOrderPdf(check: Check, company?: Tenant | null): Promise<void> {
  let Print: typeof import('expo-print');
  let Sharing: typeof import('expo-sharing');
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    Print = require('expo-print');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    Sharing = require('expo-sharing');
    if (typeof Print?.printToFileAsync !== 'function') throw new Error('ExpoPrint not linked');
  } catch {
    showAlert('Печать недоступна', 'Доступно после обновления приложения.');
    return;
  }

  try {
    const html = buildOrderHtml(check, company);
    const { uri } = await Print.printToFileAsync({ html, base64: false });
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(uri, {
        mimeType: 'application/pdf',
        dialogTitle: `Заказ-наряд №${check.number}`,
        UTI: 'com.adobe.pdf',
      });
    } else {
      showAlert('PDF создан', uri);
    }
  } catch {
    showAlert('Ошибка', 'Не удалось создать PDF.');
  }
}
