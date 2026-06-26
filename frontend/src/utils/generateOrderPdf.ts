import type { Check, Tenant } from '../types';
import { paymentMethodLabels } from '../../../shared/utils/formatters';

const fmt = (value: number): string =>
  (value ?? 0).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Generates an A4 «Заказ-наряд / акт» PDF for an opened check and downloads it.
 *
 * Mirrors the proven pipeline from generateReceiptPdf.ts (the thermal-receipt
 * util): build an offscreen HTML node → dynamic `import('html2pdf.js')` →
 * HTML → Canvas → PDF blob → auto-download. The only differences are the A4
 * page geometry (jsPDF format 'a4') and a formal work-order template instead of
 * the 80mm receipt layout.
 *
 * All user-supplied text is run through esc() before it touches innerHTML.
 */
export async function generateOrderPdf(check: Check, tenant?: Partial<Tenant> | null): Promise<void> {
  const companyName = tenant?.name || 'Автосервис';
  const legalName = tenant?.legalName || '';
  const inn = tenant?.inn || '';
  const kpp = tenant?.kpp || '';
  const ogrn = tenant?.ogrn || '';
  const companyPhone = tenant?.phone || '';
  const companyAddress = tenant?.address || '';

  const dateStr = new Date(check.date).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const requisites: string[] = [];
  if (inn) requisites.push(`ИНН ${inn}`);
  if (kpp) requisites.push(`КПП ${kpp}`);
  if (ogrn) requisites.push(`ОГРН ${ogrn}`);
  const requisitesLine = requisites.join('   ');

  const tdBase = 'font-size:12px;padding:6px 8px;border:1px solid #d4d4d4;vertical-align:top';
  const thBase =
    'font-size:11px;text-transform:uppercase;letter-spacing:.4px;color:#444;background:#f3f3f3;padding:6px 8px;border:1px solid #d4d4d4;font-weight:600';

  // ── Services table ──────────────────────────────────────────────────────
  const services = check.services ?? [];
  const servicesHtml = services
    .map(
      (svc, i) => `
    <tr>
      <td style="${tdBase};text-align:center;width:32px;color:#777">${i + 1}</td>
      <td style="${tdBase}">${esc(svc.name)}</td>
      <td style="${tdBase};color:#555">${esc(svc.master?.fullName ?? '—')}</td>
      <td style="${tdBase};text-align:center;width:56px">${svc.quantity}</td>
      <td style="${tdBase};text-align:right;width:90px;white-space:nowrap">${fmt(svc.price)}</td>
      <td style="${tdBase};text-align:right;width:100px;white-space:nowrap;font-weight:600">${fmt(svc.total)}</td>
    </tr>`,
    )
    .join('');

  const servicesBlock =
    services.length > 0
      ? `
    <div style="font-size:13px;font-weight:700;margin:14px 0 6px">Услуги</div>
    <table style="width:100%;border-collapse:collapse">
      <thead><tr>
        <th style="${thBase};text-align:center">№</th>
        <th style="${thBase};text-align:left">Наименование</th>
        <th style="${thBase};text-align:left">Мастер</th>
        <th style="${thBase};text-align:center">Кол-во</th>
        <th style="${thBase};text-align:right">Цена</th>
        <th style="${thBase};text-align:right">Сумма</th>
      </tr></thead>
      <tbody>${servicesHtml}</tbody>
    </table>`
      : '';

  // ── Products table ──────────────────────────────────────────────────────
  const products = check.products ?? [];
  const productsHtml = products
    .map(
      (prod, i) => `
    <tr>
      <td style="${tdBase};text-align:center;width:32px;color:#777">${i + 1}</td>
      <td style="${tdBase}">${esc(prod.name)}</td>
      <td style="${tdBase};text-align:center;width:56px">${prod.quantity}</td>
      <td style="${tdBase};text-align:right;width:90px;white-space:nowrap">${fmt(prod.sellPrice)}</td>
      <td style="${tdBase};text-align:right;width:100px;white-space:nowrap;font-weight:600">${fmt(prod.totalSell)}</td>
    </tr>`,
    )
    .join('');

  const productsBlock =
    products.length > 0
      ? `
    <div style="font-size:13px;font-weight:700;margin:14px 0 6px">Товары / запчасти</div>
    <table style="width:100%;border-collapse:collapse">
      <thead><tr>
        <th style="${thBase};text-align:center">№</th>
        <th style="${thBase};text-align:left">Наименование</th>
        <th style="${thBase};text-align:center">Кол-во</th>
        <th style="${thBase};text-align:right">Цена</th>
        <th style="${thBase};text-align:right">Сумма</th>
      </tr></thead>
      <tbody>${productsHtml}</tbody>
    </table>`
      : '';

  const infoRow = (label: string, value: string): string =>
    `<tr><td style="${tdBase};width:150px;color:#666;background:#fafafa">${esc(label)}</td><td style="${tdBase};font-weight:600">${value}</td></tr>`;

  const carValue = check.car?.makeModel
    ? `${esc(check.car.makeModel)}${check.car.plateNumber ? `&nbsp;&nbsp;<span style="font-weight:700">${esc(check.car.plateNumber)}</span>` : ''}`
    : '—';

  // Hidden container for rendering (offscreen, like generateReceiptPdf.ts)
  const container = document.createElement('div');
  container.style.position = 'fixed';
  container.style.left = '-9999px';
  container.style.top = '0';
  container.innerHTML = `
<div id="order-content" style="font-family:Arial,'Helvetica Neue',Helvetica,sans-serif;font-size:12px;line-height:1.45;color:#111;width:760px;padding:28px 32px;background:#fff;box-sizing:border-box">

  <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #111;padding-bottom:12px;margin-bottom:14px">
    <div style="max-width:62%">
      <div style="font-size:20px;font-weight:800;letter-spacing:.3px">${esc(companyName)}</div>
      ${legalName ? `<div style="font-size:11px;color:#444;margin-top:3px">${esc(legalName)}</div>` : ''}
      ${requisitesLine ? `<div style="font-size:10px;color:#666;margin-top:3px">${esc(requisitesLine)}</div>` : ''}
    </div>
    <div style="text-align:right;font-size:11px;color:#444;max-width:36%">
      ${companyAddress ? `<div>${esc(companyAddress)}</div>` : ''}
      ${companyPhone ? `<div style="margin-top:2px">тел. ${esc(companyPhone)}</div>` : ''}
    </div>
  </div>

  <div style="text-align:center;margin:6px 0 16px">
    <div style="font-size:18px;font-weight:800;text-transform:uppercase;letter-spacing:.5px">Заказ-наряд № ${check.number}</div>
    <div style="font-size:12px;color:#444;margin-top:3px">от ${esc(dateStr)}</div>
  </div>

  <table style="width:100%;border-collapse:collapse;margin-bottom:6px">
    <tbody>
      ${infoRow('Клиент', check.client?.fullName ? esc(check.client.fullName) : 'Розничный покупатель')}
      ${check.client?.phone ? infoRow('Телефон', esc(check.client.phone)) : ''}
      ${infoRow('Автомобиль', carValue)}
      ${check.mileage ? infoRow('Пробег', `${check.mileage.toLocaleString('ru-RU')} км`) : ''}
      ${check.master?.fullName ? infoRow('Ответственный мастер', esc(check.master.fullName)) : ''}
    </tbody>
  </table>

  ${servicesBlock}
  ${productsBlock}

  <div style="display:flex;justify-content:flex-end;margin-top:16px">
    <table style="border-collapse:collapse;min-width:300px">
      <tbody>
        ${check.serviceTotal > 0 ? `<tr><td style="${tdBase};color:#666;border:none;padding:3px 8px">Услуги</td><td style="${tdBase};text-align:right;border:none;padding:3px 8px">${fmt(check.serviceTotal)} ₽</td></tr>` : ''}
        ${check.productTotal > 0 ? `<tr><td style="${tdBase};color:#666;border:none;padding:3px 8px">Товары</td><td style="${tdBase};text-align:right;border:none;padding:3px 8px">${fmt(check.productTotal)} ₽</td></tr>` : ''}
        ${(check.discount ?? 0) > 0 ? `<tr><td style="${tdBase};color:#c2410c;border:none;padding:3px 8px">Скидка</td><td style="${tdBase};text-align:right;border:none;padding:3px 8px;color:#c2410c">-${fmt(check.discount ?? 0)} ₽</td></tr>` : ''}
        <tr>
          <td style="font-size:15px;font-weight:800;padding:8px 8px 4px;border-top:2px solid #111">ИТОГО</td>
          <td style="font-size:15px;font-weight:800;text-align:right;padding:8px 8px 4px;border-top:2px solid #111;white-space:nowrap">${fmt(check.totalRevenue)} ₽</td>
        </tr>
      </tbody>
    </table>
  </div>

  <div style="margin-top:14px;font-size:12px">
    <span style="color:#666">Способ оплаты:</span>
    <span style="font-weight:700">${esc(paymentMethodLabels[check.paymentMethod] ?? check.paymentMethod)}</span>
    ${
      check.paymentMethod === 'cash_card' && (check.cashAmount > 0 || check.cardAmount > 0)
        ? `<span style="color:#666"> (наличные ${fmt(check.cashAmount)} ₽ / карта ${fmt(check.cardAmount)} ₽)</span>`
        : ''
    }
  </div>

  ${
    check.comment
      ? `<div style="margin-top:12px;font-size:11px;color:#444;background:#f7f7f7;border:1px solid #e5e5e5;border-radius:4px;padding:8px 10px;white-space:pre-wrap"><span style="color:#888">Комментарий: </span>${esc(check.comment)}</div>`
      : ''
  }

  <div style="display:flex;justify-content:space-between;margin-top:48px;font-size:12px;color:#333">
    <div style="width:46%">
      <div style="border-top:1px solid #111;padding-top:4px">Подпись клиента</div>
    </div>
    <div style="width:46%;text-align:right">
      <div style="border-top:1px solid #111;padding-top:4px">Подпись исполнителя</div>
    </div>
  </div>

</div>`;

  document.body.appendChild(container);

  try {
    const html2pdf = (await import('html2pdf.js')).default;
    const element = container.querySelector('#order-content') as HTMLElement;

    await html2pdf()
      .set({
        margin: [10, 8, 10, 8],
        filename: `zakaz-naryad-${check.number}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      })
      .from(element)
      .save();
  } finally {
    document.body.removeChild(container);
  }
}

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
