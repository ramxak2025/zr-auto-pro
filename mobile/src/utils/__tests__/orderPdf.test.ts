/**
 * orderPdf tests — заказ-наряд / акт HTML builder.
 *
 * buildOrderHtml — чистая функция (без нативных зависимостей), поэтому
 * тестируем вёрстку напрямую: заголовок документа, строки услуг/товаров,
 * итоги, способ оплаты, строку подписи и — критично — экранирование
 * пользовательского текста (защита от HTML-инъекции из имён/комментариев).
 */
import { buildOrderHtml, escapeHtml } from '../orderPdf';
import type { Check, Tenant } from '../../../../shared/types';

function makeCheck(overrides: Partial<Check> = {}): Check {
  return {
    id: 'chk-1',
    number: 42,
    date: '2026-06-16T09:30:00.000Z',
    masterId: 'm-1',
    clientId: 'c-1',
    carId: 'car-1',
    client: { fullName: 'Иван Иванов' },
    car: { makeModel: 'Lada Priora', plateNumber: 'Х807КС198' },
    master: { fullName: 'Пётр Мастеров' },
    mileage: 123456,
    services: [
      {
        id: 's1',
        name: 'Замена масла',
        price: 1500,
        quantity: 2,
        total: 3000,
        master: { id: 'm-1', fullName: 'Пётр Мастеров' },
      },
    ],
    products: [
      { id: 'p1', name: 'Масло 5W30', sellPrice: 1000, costPrice: 600, quantity: 2, totalSell: 2000, totalCost: 1200 },
    ],
    comment: 'без замечаний',
    discount: 500,
    paymentMethod: 'card',
    cashAmount: 0,
    cardAmount: 4500,
    serviceTotal: 3000,
    productTotal: 2000,
    totalRevenue: 4500,
    productCostTotal: 1200,
    serviceSalaryTotal: 0,
    totalCost: 1200,
    profit: 3300,
    createdAt: '2026-06-16T09:30:00.000Z',
    ...overrides,
  } as unknown as Check;
}

const company: Tenant = {
  id: 't-1',
  name: 'Автосервис «Гараж»',
  legalName: 'ООО Гараж',
  inn: '7701234567',
  address: 'Москва, ул. Ленина, 1',
  phone: '+7 999 123-45-67',
  receiptFooter: 'Спасибо за визит!',
  isActive: true,
  maxUsers: 10,
  monthlyPrice: 0,
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
};

describe('escapeHtml', () => {
  test('escapes the five HTML-significant characters', () => {
    expect(escapeHtml(`<b>&"'`)).toBe('&lt;b&gt;&amp;&quot;&#39;');
  });
  test('null / undefined → empty string', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });
});

describe('buildOrderHtml', () => {
  test('renders the заказ-наряд title with number and a date', () => {
    const html = buildOrderHtml(makeCheck(), company);
    expect(html).toContain('Заказ-наряд №42');
    expect(html).toContain('2026');
  });

  test('includes company header, client, car + plate, mileage, master', () => {
    const html = buildOrderHtml(makeCheck(), company);
    expect(html).toContain('ООО Гараж');
    expect(html).toContain('ИНН 7701234567');
    expect(html).toContain('Иван Иванов');
    expect(html).toContain('Lada Priora');
    expect(html).toContain('Х807КС198');
    expect(html).toContain('123');
    expect(html).toContain('Пётр Мастеров');
  });

  test('renders service and product lines with totals and the grand total', () => {
    const html = buildOrderHtml(makeCheck(), company);
    expect(html).toContain('Замена масла');
    expect(html).toContain('Масло 5W30');
    expect(html).toContain('Скидка');
    expect(html).toContain('ИТОГО');
    expect(html).toContain('4 500 ₽');
  });

  test('shows the payment method label and a client signature line', () => {
    const html = buildOrderHtml(makeCheck(), company);
    expect(html).toContain('Карта');
    expect(html).toContain('Подпись клиента');
  });

  test('escapes HTML-injection from user-supplied names (no raw tags)', () => {
    const html = buildOrderHtml(
      makeCheck({
        client: { fullName: '<script>alert(1)</script>' } as Check['client'],
        services: [
          {
            id: 's1',
            name: 'Ремонт <img src=x onerror=alert(1)>',
            price: 100,
            quantity: 1,
            total: 100,
          } as Check['services'][number],
        ],
      }),
      company,
    );
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;img src=x');
  });

  test('falls back to «Автосервис» and «Розничный покупатель» without company / client', () => {
    const html = buildOrderHtml(makeCheck({ client: undefined, clientId: '' }), null);
    expect(html).toContain('Автосервис');
    expect(html).toContain('Розничный покупатель');
  });

  test('omits empty services / products tables', () => {
    const html = buildOrderHtml(makeCheck({ services: [], products: [] }), company);
    expect(html).not.toContain('Итого услуги');
    expect(html).not.toContain('Итого товары');
  });
});
