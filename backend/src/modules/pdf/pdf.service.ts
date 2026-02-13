import { Injectable } from '@nestjs/common';
import { Check } from '../checks/entities/check.entity';

const PAYMENT_LABELS: Record<string, string> = {
  cash: 'Наличные',
  card: 'Карта',
  warranty: 'Гарантия',
  cash_card: 'Нал + Карта',
};

@Injectable()
export class PdfService {
  generateCheckHtml(check: Check, tenantName?: string): string {
    const date = new Date(check.date).toLocaleDateString('ru-RU');
    const clientName = check.client?.fullName || '—';
    const clientPhone = check.client?.phone || '';
    const carInfo = check.car
      ? `${check.car.makeModel} (${check.car.plateNumber})`
      : '—';
    const masterName = check.master?.fullName || '—';
    const mileage = check.mileage ? `${check.mileage} км` : '—';
    const payment = PAYMENT_LABELS[check.paymentMethod] || check.paymentMethod;

    let servicesHtml = '';
    if (check.services && check.services.length > 0) {
      const rows = check.services
        .map(
          (s, i) =>
            `<tr>
              <td>${i + 1}</td>
              <td>${esc(s.name)}</td>
              <td class="r">${s.quantity}</td>
              <td class="r">${money(s.price)}</td>
              <td class="r">${money(s.total)}</td>
            </tr>`,
        )
        .join('');

      servicesHtml = `
        <h3>Работы</h3>
        <table>
          <thead>
            <tr><th>#</th><th>Наименование</th><th class="r">Кол-во</th><th class="r">Цена</th><th class="r">Сумма</th></tr>
          </thead>
          <tbody>${rows}</tbody>
          <tfoot>
            <tr><td colspan="4" class="r"><b>Итого работы:</b></td><td class="r"><b>${money(check.serviceTotal)}</b></td></tr>
          </tfoot>
        </table>`;
    }

    let productsHtml = '';
    if (check.products && check.products.length > 0) {
      const rows = check.products
        .map(
          (p, i) =>
            `<tr>
              <td>${i + 1}</td>
              <td>${esc(p.name)}</td>
              <td class="r">${p.quantity}</td>
              <td class="r">${money(p.sellPrice)}</td>
              <td class="r">${money(p.totalSell)}</td>
            </tr>`,
        )
        .join('');

      productsHtml = `
        <h3>Запчасти и материалы</h3>
        <table>
          <thead>
            <tr><th>#</th><th>Наименование</th><th class="r">Кол-во</th><th class="r">Цена</th><th class="r">Сумма</th></tr>
          </thead>
          <tbody>${rows}</tbody>
          <tfoot>
            <tr><td colspan="4" class="r"><b>Итого запчасти:</b></td><td class="r"><b>${money(check.productTotal)}</b></td></tr>
          </tfoot>
        </table>`;
    }

    return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<title>Заказ-наряд №${check.number}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: #333; padding: 20px; max-width: 800px; margin: 0 auto; }
  h1 { font-size: 18px; text-align: center; margin-bottom: 4px; }
  h2 { font-size: 14px; text-align: center; color: #666; margin-bottom: 16px; }
  h3 { font-size: 13px; margin: 16px 0 8px; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
  .info { display: flex; flex-wrap: wrap; gap: 8px 24px; margin-bottom: 12px; }
  .info-item { display: flex; gap: 4px; }
  .info-item .label { color: #888; }
  .info-item .value { font-weight: bold; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
  th, td { border: 1px solid #ddd; padding: 6px 8px; text-align: left; }
  th { background: #f5f5f5; font-size: 11px; text-transform: uppercase; color: #666; }
  .r { text-align: right; }
  tfoot td { border-top: 2px solid #999; }
  .total-section { margin-top: 20px; text-align: right; font-size: 14px; }
  .total-section .total-row { margin: 4px 0; }
  .total-section .grand-total { font-size: 18px; font-weight: bold; margin-top: 8px; }
  .comment { margin-top: 16px; padding: 8px; background: #f9f9f9; border-left: 3px solid #ddd; }
  .signatures { display: flex; justify-content: space-between; margin-top: 40px; }
  .sig-block { text-align: center; width: 200px; }
  .sig-line { border-top: 1px solid #333; margin-top: 40px; padding-top: 4px; font-size: 11px; color: #666; }
  @media print { body { padding: 0; } }
</style>
</head>
<body>
  <h1>ЗАКАЗ-НАРЯД №${check.number}</h1>
  <h2>${tenantName ? esc(tenantName) : 'Автосервис'}</h2>

  <div class="info">
    <div class="info-item"><span class="label">Дата:</span> <span class="value">${date}</span></div>
    <div class="info-item"><span class="label">Клиент:</span> <span class="value">${esc(clientName)}</span></div>
    ${clientPhone ? `<div class="info-item"><span class="label">Тел:</span> <span class="value">${esc(clientPhone)}</span></div>` : ''}
    <div class="info-item"><span class="label">Автомобиль:</span> <span class="value">${esc(carInfo)}</span></div>
    <div class="info-item"><span class="label">Пробег:</span> <span class="value">${mileage}</span></div>
    <div class="info-item"><span class="label">Мастер:</span> <span class="value">${esc(masterName)}</span></div>
    <div class="info-item"><span class="label">Оплата:</span> <span class="value">${payment}</span></div>
  </div>

  ${servicesHtml}
  ${productsHtml}

  <div class="total-section">
    ${check.services?.length ? `<div class="total-row">Работы: ${money(check.serviceTotal)}</div>` : ''}
    ${check.products?.length ? `<div class="total-row">Запчасти: ${money(check.productTotal)}</div>` : ''}
    <div class="grand-total">ИТОГО: ${money(check.totalRevenue)}</div>
  </div>

  ${check.comment ? `<div class="comment"><b>Комментарий:</b> ${esc(check.comment)}</div>` : ''}

  <div class="signatures">
    <div class="sig-block">
      <div class="sig-line">Мастер / ${esc(masterName)}</div>
    </div>
    <div class="sig-block">
      <div class="sig-line">Клиент / ${esc(clientName)}</div>
    </div>
  </div>
</body>
</html>`;
  }
}

function money(v: number | string): string {
  const num = typeof v === 'string' ? parseFloat(v) : v;
  return num.toLocaleString('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }) + ' \u20BD';
}

function esc(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
