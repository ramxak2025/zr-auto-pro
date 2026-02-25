import type { Check, Tenant } from '../types';

const paymentMethodLabels: Record<string, string> = {
  cash: 'Наличные',
  card: 'Карта',
  warranty: 'Гарантия',
  cash_card: 'Нал / Карта',
};

const fmt = (value: number): string =>
  value.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Opens a new window with a styled receipt HTML and triggers the browser's
 * print dialog. The user can then "Save as PDF" or print directly.
 * Full Cyrillic support, beautiful thermal-receipt design.
 */
export function generateReceiptPdf(check: Check, tenant?: Partial<Tenant> | null): void {
  const companyName = tenant?.name || 'Автосервис';
  const legalName = tenant?.legalName || '';
  const inn = tenant?.inn || '';
  const kpp = tenant?.kpp || '';
  const ogrn = tenant?.ogrn || '';
  const companyPhone = tenant?.phone || '';
  const companyAddress = tenant?.address || '';
  const footer = tenant?.receiptFooter || 'Спасибо за визит!';

  const dateStr = new Date(check.date).toLocaleDateString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });

  // Build services rows
  const servicesHtml = (check.services ?? []).map(svc => `
    <tr>
      <td class="item-name">${esc(svc.name)}${svc.master?.fullName ? `<br><span class="item-sub">${esc(svc.master.fullName)}</span>` : ''}</td>
      <td class="item-qty">${svc.quantity}</td>
      <td class="item-price">${fmt(svc.price)}</td>
      <td class="item-total">${fmt(svc.total)}</td>
    </tr>
  `).join('');

  // Build products rows
  const productsHtml = (check.products ?? []).map(prod => `
    <tr>
      <td class="item-name">${esc(prod.name)}</td>
      <td class="item-qty">${prod.quantity}</td>
      <td class="item-price">${fmt(prod.sellPrice)}</td>
      <td class="item-total">${fmt(prod.totalSell)}</td>
    </tr>
  `).join('');

  // Requisites line
  const requisites: string[] = [];
  if (inn) requisites.push(`ИНН ${inn}`);
  if (kpp) requisites.push(`КПП ${kpp}`);
  if (ogrn) requisites.push(`ОГРН ${ogrn}`);
  const requisitesLine = requisites.join(' | ');

  const html = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>Чек #${check.number}</title>
<style>
  @page {
    size: 80mm auto;
    margin: 0;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Courier New', Courier, monospace;
    font-size: 11px;
    line-height: 1.4;
    color: #000;
    width: 80mm;
    max-width: 80mm;
    margin: 0 auto;
    padding: 8px 6px;
    background: #fff;
  }
  .center { text-align: center; }
  .right { text-align: right; }
  .bold { font-weight: bold; }
  .company-name {
    font-size: 16px;
    font-weight: bold;
    text-align: center;
    letter-spacing: 1px;
    margin-bottom: 2px;
  }
  .legal-name {
    font-size: 9px;
    text-align: center;
    color: #444;
    margin-bottom: 2px;
  }
  .requisites {
    font-size: 8px;
    text-align: center;
    color: #666;
    margin-bottom: 2px;
  }
  .contact-line {
    font-size: 9px;
    text-align: center;
    color: #444;
    margin-bottom: 4px;
  }
  .separator {
    border: none;
    border-top: 1px dashed #000;
    margin: 6px 0;
  }
  .separator-double {
    border: none;
    border-top: 2px solid #000;
    margin: 6px 0;
  }
  .check-number {
    font-size: 14px;
    font-weight: bold;
    text-align: center;
    margin: 4px 0 2px;
  }
  .date-line {
    font-size: 10px;
    text-align: center;
    color: #333;
    margin-bottom: 4px;
  }
  .info-row {
    display: flex;
    justify-content: space-between;
    font-size: 10px;
    margin-bottom: 2px;
  }
  .info-label { color: #555; }
  .info-value { font-weight: bold; }
  .section-title {
    font-size: 11px;
    font-weight: bold;
    text-align: center;
    letter-spacing: 1px;
    margin: 4px 0;
    text-transform: uppercase;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 2px;
  }
  th {
    font-size: 8px;
    text-transform: uppercase;
    color: #555;
    border-bottom: 1px solid #ccc;
    padding: 2px 1px;
    text-align: left;
  }
  th.r { text-align: right; }
  th.c { text-align: center; }
  td { font-size: 10px; padding: 3px 1px; vertical-align: top; }
  .item-name { max-width: 120px; word-wrap: break-word; }
  .item-sub { font-size: 8px; color: #666; }
  .item-qty { text-align: center; width: 24px; }
  .item-price { text-align: right; width: 50px; white-space: nowrap; }
  .item-total { text-align: right; width: 55px; font-weight: bold; white-space: nowrap; }
  .totals-row {
    display: flex;
    justify-content: space-between;
    font-size: 10px;
    padding: 2px 0;
  }
  .grand-total {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 16px;
    font-weight: bold;
    padding: 4px 0;
  }
  .payment-badge {
    font-size: 11px;
    font-weight: bold;
    text-align: center;
    padding: 4px;
    margin: 4px 0;
    border: 1px solid #000;
  }
  .footer-text {
    font-size: 10px;
    text-align: center;
    margin-top: 6px;
    white-space: pre-wrap;
  }
  .footer-company {
    font-size: 8px;
    text-align: center;
    color: #888;
    margin-top: 4px;
  }
  .comment-box {
    font-size: 9px;
    color: #444;
    background: #f5f5f5;
    padding: 4px 6px;
    border-radius: 2px;
    margin: 4px 0;
    white-space: pre-wrap;
  }
  @media print {
    body { padding: 4px 4px; }
  }
  @media screen {
    body {
      margin: 20px auto;
      box-shadow: 0 2px 20px rgba(0,0,0,0.15);
      border-radius: 4px;
      padding: 12px 8px;
    }
  }
</style>
</head>
<body>

<!-- Company header -->
<div class="company-name">${esc(companyName)}</div>
${legalName ? `<div class="legal-name">${esc(legalName)}</div>` : ''}
${requisitesLine ? `<div class="requisites">${esc(requisitesLine)}</div>` : ''}
${companyAddress ? `<div class="contact-line">${esc(companyAddress)}</div>` : ''}
${companyPhone ? `<div class="contact-line">тел. ${esc(companyPhone)}</div>` : ''}

<hr class="separator-double">

<!-- Check info -->
<div class="check-number">ЧЕК #${check.number}</div>
<div class="date-line">${esc(dateStr)}</div>

<hr class="separator">

<!-- Client / Car / Master -->
${check.client?.fullName ? `<div class="info-row"><span class="info-label">Клиент:</span><span class="info-value">${esc(check.client.fullName)}</span></div>` : ''}
${check.car?.makeModel ? `<div class="info-row"><span class="info-label">Авто:</span><span class="info-value">${esc(check.car.makeModel)}${check.car.plateNumber ? ` [${esc(check.car.plateNumber)}]` : ''}</span></div>` : ''}
${check.master?.fullName ? `<div class="info-row"><span class="info-label">Мастер:</span><span class="info-value">${esc(check.master.fullName)}</span></div>` : ''}
${check.mileage ? `<div class="info-row"><span class="info-label">Пробег:</span><span class="info-value">${check.mileage.toLocaleString('ru-RU')} км</span></div>` : ''}

${(check.services?.length ?? 0) > 0 ? `
<hr class="separator">
<div class="section-title">Услуги</div>
<table>
  <thead><tr><th>Наименование</th><th class="c">Кол</th><th class="r">Цена</th><th class="r">Сумма</th></tr></thead>
  <tbody>${servicesHtml}</tbody>
</table>
` : ''}

${(check.products?.length ?? 0) > 0 ? `
<hr class="separator">
<div class="section-title">Товары</div>
<table>
  <thead><tr><th>Наименование</th><th class="c">Кол</th><th class="r">Цена</th><th class="r">Сумма</th></tr></thead>
  <tbody>${productsHtml}</tbody>
</table>
` : ''}

<hr class="separator">

<!-- Subtotals -->
${check.serviceTotal > 0 ? `<div class="totals-row"><span>Услуги:</span><span>${fmt(check.serviceTotal)} ₽</span></div>` : ''}
${check.productTotal > 0 ? `<div class="totals-row"><span>Товары:</span><span>${fmt(check.productTotal)} ₽</span></div>` : ''}
${(check.discount ?? 0) > 0 ? `<div class="totals-row"><span>Скидка:</span><span>-${fmt(check.discount!)} ₽</span></div>` : ''}

<hr class="separator-double">

<!-- Grand total -->
<div class="grand-total">
  <span>ИТОГО:</span>
  <span>${fmt(check.totalRevenue)} ₽</span>
</div>

<hr class="separator-double">

<!-- Payment method -->
<div class="payment-badge">${esc(paymentMethodLabels[check.paymentMethod] ?? check.paymentMethod)}</div>

${check.paymentMethod === 'cash_card' ? `
<div class="totals-row"><span>Наличные:</span><span>${fmt(check.cashAmount)} ₽</span></div>
<div class="totals-row"><span>Карта:</span><span>${fmt(check.cardAmount)} ₽</span></div>
` : ''}

${check.comment ? `
<hr class="separator">
<div style="font-size:9px;color:#555;margin-bottom:2px;">Комментарий:</div>
<div class="comment-box">${esc(check.comment)}</div>
` : ''}

<hr class="separator">

<!-- Footer -->
<div class="footer-text">${esc(footer)}</div>
<div class="footer-company">${esc(companyName)}</div>

</body>
</html>`;

  // Open in new window and trigger print
  const win = window.open('', '_blank', 'width=400,height=700');
  if (!win) {
    alert('Пожалуйста, разрешите всплывающие окна для печати чека');
    return;
  }
  win.document.write(html);
  win.document.close();

  // Wait for content to render, then trigger print
  win.onload = () => {
    win.focus();
    win.print();
  };
}

/** Escape HTML special characters */
function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
