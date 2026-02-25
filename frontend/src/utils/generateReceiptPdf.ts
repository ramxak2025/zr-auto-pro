import jsPDF from 'jspdf';
import type { Check } from '../types';

const paymentMethodLabels: Record<string, string> = {
  cash: 'НАЛИЧНЫЕ',
  card: 'КАРТА',
  warranty: 'ГАРАНТИЯ',
  cash_card: 'НАЛ/КАРТА',
};

/**
 * Generates a receipt-style PDF for a check (like a real cash register receipt).
 * Width: 80mm thermal printer style, monospaced font.
 */
export function generateReceiptPdf(check: Check, tenantName: string): void {
  // Receipt width = 80mm, variable height
  const w = 80;
  const marginX = 4;
  const contentW = w - marginX * 2;

  // Pre-calculate height
  let estimatedH = 160; // base
  estimatedH += (check.services?.length ?? 0) * 14;
  estimatedH += (check.products?.length ?? 0) * 14;
  if (check.comment) estimatedH += 20;

  const doc = new jsPDF({ unit: 'mm', format: [w, Math.max(estimatedH, 160)] });

  let y = 6;
  const fontSize = {
    header: 11,
    subheader: 8,
    normal: 7,
    small: 6,
  };

  // Helpers
  const setFont = (size: number, style: 'normal' | 'bold' = 'normal') => {
    doc.setFontSize(size);
    doc.setFont('helvetica', style);
  };

  const centerText = (text: string, yPos: number) => {
    const textWidth = doc.getTextWidth(text);
    doc.text(text, (w - textWidth) / 2, yPos);
  };

  const leftText = (text: string, yPos: number) => {
    doc.text(text, marginX, yPos);
  };

  const rightText = (text: string, yPos: number) => {
    const textWidth = doc.getTextWidth(text);
    doc.text(text, w - marginX - textWidth, yPos);
  };

  const dashedLine = (yPos: number) => {
    setFont(fontSize.small);
    const dashes = '- '.repeat(40);
    centerText(dashes, yPos);
  };

  const formatMoney = (value: number): string => {
    return value.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const wrapText = (text: string, maxWidth: number): string[] => {
    const words = text.split(' ');
    const lines: string[] = [];
    let current = '';
    for (const word of words) {
      const test = current ? `${current} ${word}` : word;
      if (doc.getTextWidth(test) > maxWidth) {
        if (current) lines.push(current);
        current = word;
      } else {
        current = test;
      }
    }
    if (current) lines.push(current);
    return lines;
  };

  // ═══ HEADER ═══
  setFont(fontSize.header, 'bold');
  centerText(tenantName.toUpperCase(), y);
  y += 5;

  // Date and check number
  setFont(fontSize.subheader, 'bold');
  centerText(`ЧЕК #${check.number}`, y);
  y += 4;

  setFont(fontSize.normal);
  const dateStr = new Date(check.date).toLocaleDateString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
  centerText(dateStr, y);
  y += 3;

  dashedLine(y);
  y += 3;

  // ═══ CLIENT / CAR INFO ═══
  if (check.client?.fullName) {
    setFont(fontSize.normal);
    leftText(`Клиент: ${check.client.fullName}`, y);
    y += 3.5;
  }
  if (check.car?.makeModel) {
    setFont(fontSize.normal);
    leftText(`Авто: ${check.car.makeModel}`, y);
    if (check.car.plateNumber) {
      rightText(check.car.plateNumber, y);
    }
    y += 3.5;
  }
  if (check.master?.fullName) {
    setFont(fontSize.normal);
    leftText(`Мастер: ${check.master.fullName}`, y);
    y += 3.5;
  }
  if (check.mileage) {
    setFont(fontSize.normal);
    leftText(`Пробег: ${check.mileage.toLocaleString('ru-RU')} км`, y);
    y += 3.5;
  }

  dashedLine(y);
  y += 3;

  // ═══ SERVICES ═══
  if (check.services && check.services.length > 0) {
    setFont(fontSize.subheader, 'bold');
    centerText('УСЛУГИ', y);
    y += 4;

    setFont(fontSize.normal);
    for (const svc of check.services) {
      const nameLines = wrapText(svc.name, contentW);
      for (const line of nameLines) {
        leftText(line, y);
        y += 3;
      }
      // Quantity x Price = Total
      const detail = svc.quantity > 1
        ? `  ${svc.quantity} x ${formatMoney(svc.price)}`
        : '';
      const totalStr = formatMoney(svc.total);
      if (detail) {
        leftText(detail, y);
      }
      rightText(totalStr, y);
      y += 4;
    }

    dashedLine(y);
    y += 3;
  }

  // ═══ PRODUCTS ═══
  if (check.products && check.products.length > 0) {
    setFont(fontSize.subheader, 'bold');
    centerText('ТОВАРЫ', y);
    y += 4;

    setFont(fontSize.normal);
    for (const prod of check.products) {
      const nameLines = wrapText(prod.name, contentW);
      for (const line of nameLines) {
        leftText(line, y);
        y += 3;
      }
      const detail = prod.quantity > 1
        ? `  ${prod.quantity} x ${formatMoney(prod.sellPrice)}`
        : '';
      const totalStr = formatMoney(prod.totalSell);
      if (detail) {
        leftText(detail, y);
      }
      rightText(totalStr, y);
      y += 4;
    }

    dashedLine(y);
    y += 3;
  }

  // ═══ TOTALS ═══
  setFont(fontSize.normal);
  if (check.serviceTotal > 0) {
    leftText('Услуги:', y);
    rightText(formatMoney(check.serviceTotal), y);
    y += 3.5;
  }
  if (check.productTotal > 0) {
    leftText('Товары:', y);
    rightText(formatMoney(check.productTotal), y);
    y += 3.5;
  }
  if ((check.discount ?? 0) > 0) {
    leftText('Скидка:', y);
    rightText(`-${formatMoney(check.discount!)}`, y);
    y += 3.5;
  }

  y += 1;
  dashedLine(y);
  y += 3;

  // Total
  setFont(fontSize.header, 'bold');
  leftText('ИТОГО:', y);
  rightText(`${formatMoney(check.totalRevenue)} P`, y);
  y += 5;

  dashedLine(y);
  y += 3;

  // Payment method
  setFont(fontSize.subheader, 'bold');
  centerText(`Оплата: ${paymentMethodLabels[check.paymentMethod] ?? check.paymentMethod}`, y);
  y += 4;

  if (check.paymentMethod === 'cash_card') {
    setFont(fontSize.normal);
    leftText('Наличные:', y);
    rightText(formatMoney(check.cashAmount), y);
    y += 3.5;
    leftText('Карта:', y);
    rightText(formatMoney(check.cardAmount), y);
    y += 3.5;
  }

  // Comment
  if (check.comment) {
    y += 1;
    dashedLine(y);
    y += 3;
    setFont(fontSize.normal);
    leftText('Комментарий:', y);
    y += 3;
    const commentLines = wrapText(check.comment, contentW);
    for (const line of commentLines) {
      leftText(line, y);
      y += 3;
    }
  }

  y += 2;
  dashedLine(y);
  y += 4;

  // Footer
  setFont(fontSize.small);
  centerText('Спасибо за визит!', y);
  y += 3;
  centerText(`${tenantName}`, y);

  // Save
  doc.save(`check-${check.number}.pdf`);
}
