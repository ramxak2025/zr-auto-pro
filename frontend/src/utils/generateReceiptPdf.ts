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
 * Generates a receipt-style PDF and downloads it directly.
 * Uses html2pdf.js: HTML → Canvas → PDF blob → auto-download.
 */
export async function generateReceiptPdf(check: Check, tenant?: Partial<Tenant> | null): Promise<void> {
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

  const servicesHtml = (check.services ?? []).map(svc => `
    <tr>
      <td style="max-width:120px;word-wrap:break-word;font-size:10px;padding:3px 1px;vertical-align:top">${esc(svc.name)}${svc.master?.fullName ? `<br><span style="font-size:8px;color:#666">${esc(svc.master.fullName)}</span>` : ''}</td>
      <td style="text-align:center;width:24px;font-size:10px;padding:3px 1px">${svc.quantity}</td>
      <td style="text-align:right;width:50px;white-space:nowrap;font-size:10px;padding:3px 1px">${fmt(svc.price)}</td>
      <td style="text-align:right;width:55px;font-weight:bold;white-space:nowrap;font-size:10px;padding:3px 1px">${fmt(svc.total)}</td>
    </tr>
  `).join('');

  const productsHtml = (check.products ?? []).map(prod => `
    <tr>
      <td style="max-width:120px;word-wrap:break-word;font-size:10px;padding:3px 1px;vertical-align:top">${esc(prod.name)}</td>
      <td style="text-align:center;width:24px;font-size:10px;padding:3px 1px">${prod.quantity}</td>
      <td style="text-align:right;width:50px;white-space:nowrap;font-size:10px;padding:3px 1px">${fmt(prod.sellPrice)}</td>
      <td style="text-align:right;width:55px;font-weight:bold;white-space:nowrap;font-size:10px;padding:3px 1px">${fmt(prod.totalSell)}</td>
    </tr>
  `).join('');

  const requisites: string[] = [];
  if (inn) requisites.push(`ИНН ${inn}`);
  if (kpp) requisites.push(`КПП ${kpp}`);
  if (ogrn) requisites.push(`ОГРН ${ogrn}`);
  const requisitesLine = requisites.join(' | ');

  const thStyle = 'font-size:8px;text-transform:uppercase;color:#555;border-bottom:1px solid #ccc;padding:2px 1px';

  // Hidden container for rendering
  const container = document.createElement('div');
  container.style.position = 'fixed';
  container.style.left = '-9999px';
  container.style.top = '0';
  container.innerHTML = `
<div id="receipt-content" style="font-family:'Courier New',Courier,monospace;font-size:11px;line-height:1.4;color:#000;width:302px;padding:12px 8px;background:#fff">

<div style="font-size:16px;font-weight:bold;text-align:center;letter-spacing:1px;margin-bottom:2px">${esc(companyName)}</div>
${legalName ? `<div style="font-size:9px;text-align:center;color:#444;margin-bottom:2px">${esc(legalName)}</div>` : ''}
${requisitesLine ? `<div style="font-size:8px;text-align:center;color:#666;margin-bottom:2px">${esc(requisitesLine)}</div>` : ''}
${companyAddress ? `<div style="font-size:9px;text-align:center;color:#444;margin-bottom:2px">${esc(companyAddress)}</div>` : ''}
${companyPhone ? `<div style="font-size:9px;text-align:center;color:#444;margin-bottom:4px">тел. ${esc(companyPhone)}</div>` : ''}

<hr style="border:none;border-top:2px solid #000;margin:6px 0">
<div style="font-size:14px;font-weight:bold;text-align:center;margin:4px 0 2px">ЧЕК #${check.number}</div>
<div style="font-size:10px;text-align:center;color:#333;margin-bottom:4px">${esc(dateStr)}</div>
<hr style="border:none;border-top:1px dashed #000;margin:6px 0">

${check.client?.fullName ? `<div style="display:flex;justify-content:space-between;font-size:10px;margin-bottom:2px"><span style="color:#555">Клиент:</span><span style="font-weight:bold">${esc(check.client.fullName)}</span></div>` : ''}
${check.car?.makeModel ? `<div style="display:flex;justify-content:space-between;font-size:10px;margin-bottom:2px"><span style="color:#555">Авто:</span><span style="font-weight:bold">${esc(check.car.makeModel)}${check.car.plateNumber ? ` [${esc(check.car.plateNumber)}]` : ''}</span></div>` : ''}
${check.master?.fullName ? `<div style="display:flex;justify-content:space-between;font-size:10px;margin-bottom:2px"><span style="color:#555">Мастер:</span><span style="font-weight:bold">${esc(check.master.fullName)}</span></div>` : ''}
${check.mileage ? `<div style="display:flex;justify-content:space-between;font-size:10px;margin-bottom:2px"><span style="color:#555">Пробег:</span><span style="font-weight:bold">${check.mileage.toLocaleString('ru-RU')} км</span></div>` : ''}

${(check.services?.length ?? 0) > 0 ? `
<hr style="border:none;border-top:1px dashed #000;margin:6px 0">
<div style="font-size:11px;font-weight:bold;text-align:center;letter-spacing:1px;margin:4px 0;text-transform:uppercase">Услуги</div>
<table style="width:100%;border-collapse:collapse;margin-bottom:2px">
<thead><tr><th style="${thStyle};text-align:left">Наименование</th><th style="${thStyle};text-align:center">Кол</th><th style="${thStyle};text-align:right">Цена</th><th style="${thStyle};text-align:right">Сумма</th></tr></thead>
<tbody>${servicesHtml}</tbody>
</table>` : ''}

${(check.products?.length ?? 0) > 0 ? `
<hr style="border:none;border-top:1px dashed #000;margin:6px 0">
<div style="font-size:11px;font-weight:bold;text-align:center;letter-spacing:1px;margin:4px 0;text-transform:uppercase">Товары</div>
<table style="width:100%;border-collapse:collapse;margin-bottom:2px">
<thead><tr><th style="${thStyle};text-align:left">Наименование</th><th style="${thStyle};text-align:center">Кол</th><th style="${thStyle};text-align:right">Цена</th><th style="${thStyle};text-align:right">Сумма</th></tr></thead>
<tbody>${productsHtml}</tbody>
</table>` : ''}

<hr style="border:none;border-top:1px dashed #000;margin:6px 0">
${check.serviceTotal > 0 ? `<div style="display:flex;justify-content:space-between;font-size:10px;padding:2px 0"><span>Услуги:</span><span>${fmt(check.serviceTotal)} ₽</span></div>` : ''}
${check.productTotal > 0 ? `<div style="display:flex;justify-content:space-between;font-size:10px;padding:2px 0"><span>Товары:</span><span>${fmt(check.productTotal)} ₽</span></div>` : ''}
${(check.discount ?? 0) > 0 ? `<div style="display:flex;justify-content:space-between;font-size:10px;padding:2px 0"><span>Скидка:</span><span>-${fmt(check.discount!)} ₽</span></div>` : ''}

<hr style="border:none;border-top:2px solid #000;margin:6px 0">
<div style="display:flex;justify-content:space-between;align-items:center;font-size:16px;font-weight:bold;padding:4px 0"><span>ИТОГО:</span><span>${fmt(check.totalRevenue)} ₽</span></div>
<hr style="border:none;border-top:2px solid #000;margin:6px 0">

<div style="font-size:11px;font-weight:bold;text-align:center;padding:4px;margin:4px 0;border:1px solid #000">${esc(paymentMethodLabels[check.paymentMethod] ?? check.paymentMethod)}</div>

${check.paymentMethod === 'cash_card' ? `
<div style="display:flex;justify-content:space-between;font-size:10px;padding:2px 0"><span>Наличные:</span><span>${fmt(check.cashAmount)} ₽</span></div>
<div style="display:flex;justify-content:space-between;font-size:10px;padding:2px 0"><span>Карта:</span><span>${fmt(check.cardAmount)} ₽</span></div>` : ''}

${check.comment ? `
<hr style="border:none;border-top:1px dashed #000;margin:6px 0">
<div style="font-size:9px;color:#555;margin-bottom:2px">Комментарий:</div>
<div style="font-size:9px;color:#444;background:#f5f5f5;padding:4px 6px;border-radius:2px;margin:4px 0;white-space:pre-wrap">${esc(check.comment)}</div>` : ''}

<hr style="border:none;border-top:1px dashed #000;margin:6px 0">
<div style="font-size:10px;text-align:center;margin-top:6px;white-space:pre-wrap">${esc(footer)}</div>
<div style="font-size:8px;text-align:center;color:#888;margin-top:4px">${esc(companyName)}</div>

</div>`;

  document.body.appendChild(container);

  try {
    const html2pdf = (await import('html2pdf.js')).default;
    const element = container.querySelector('#receipt-content') as HTMLElement;

    await html2pdf()
      .set({
        margin: 0,
        filename: `check-${check.number}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true },
        jsPDF: { unit: 'mm', format: [80, 297], orientation: 'portrait' },
      })
      .from(element)
      .save();
  } finally {
    document.body.removeChild(container);
  }
}

function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
