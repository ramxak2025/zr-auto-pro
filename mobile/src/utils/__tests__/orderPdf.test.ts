/**
 * orderPdf tests — заказ-наряд / акт HTML builder.
 *
 * buildOrderHtml — чистая функция (без нативных зависимостей), поэтому
 * тестируем вёрстку напрямую: заголовок документа, строки услуг/товаров,
 * итоги, способ оплаты, строку подписи и — критично — экранирование
 * пользовательского текста (защита от HTML-инъекции из имён/комментариев).
 *
 * Услуги без количества (2026-09-30): в таблице услуг нет колонки «Кол-во»
 * (у товаров есть), а legacy-строка старого чека с quantity > 1 показывается
 * как «Мойка ×3» в наименовании.
 */
import { buildOrderHtml, escapeHtml } from '../orderPdf';
import type { Check, Tenant } from '../../../../shared/types';

type ServiceLine = Check['services'][number];

/** Таблица услуг из готового HTML (между заголовками «Услуги» и «Товары / запчасти»). */
function servicesSection(html: string): string {
  const start = html.indexOf('<h3>Услуги</h3>');
  const end = html.indexOf('<h3>Товары / запчасти</h3>');
  return html.slice(start, end);
}

/** Таблица товаров из готового HTML (от «Товары / запчасти» до блока итогов). */
function productsSection(html: string): string {
  const start = html.indexOf('<h3>Товары / запчасти</h3>');
  const end = html.indexOf('<table class="totals">');
  return html.slice(start, end);
}

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
    // Одна и та же услуга дважды = две строки по 1 500 ₽ (quantity всегда 1).
    services: [
      {
        id: 's1',
        name: 'Замена масла',
        price: 1500,
        quantity: 1,
        total: 1500,
        master: { id: 'm-1', fullName: 'Пётр Мастеров' },
      },
      {
        id: 's2',
        name: 'Замена масла',
        price: 1500,
        quantity: 1,
        total: 1500,
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

describe('buildOrderHtml — услуги без количества', () => {
  const legacyWash = (overrides: Partial<ServiceLine> = {}): ServiceLine =>
    ({
      id: 'sl-legacy',
      name: 'Мойка',
      price: 500,
      quantity: 3,
      total: 1500,
      master: { id: 'm-1', fullName: 'Пётр Мастеров' },
      ...overrides,
    }) as ServiceLine;

  test('в таблице услуг нет колонки «Кол-во», в таблице товаров она остаётся', () => {
    const html = buildOrderHtml(makeCheck(), company);
    const services = servicesSection(html);
    const products = productsSection(html);
    expect(services).toContain('Наименование');
    expect(services).toContain('Мастер');
    expect(services).toContain('Цена');
    expect(services).toContain('Сумма');
    expect(services).not.toContain('Кол-во');
    expect(products).toContain('Кол-во');
    // №, Наименование, Мастер, Цена, Сумма — пять колонок; у товаров — №, Наименование, Кол-во, Цена, Сумма.
    expect(services.match(/<th\b/g)).toHaveLength(5);
    expect(products.match(/<th\b/g)).toHaveLength(5);
  });

  test('итоговая строка таблицы услуг занимает четыре колонки под пять', () => {
    const html = buildOrderHtml(makeCheck(), company);
    expect(servicesSection(html)).toContain('<td colspan="4" class="r">Итого услуги</td>');
    expect(productsSection(html)).toContain('<td colspan="4" class="r">Итого товары</td>');
  });

  test('строка обычной услуги — без «×N»; одна услуга дважды — две строки', () => {
    const services = servicesSection(buildOrderHtml(makeCheck(), company));
    expect(services).not.toMatch(/×\s*\d/);
    expect(services.match(/Замена масла/g)).toHaveLength(2);
    expect(services.match(/1 500 ₽/g)).toHaveLength(4); // цена и сумма в каждой из двух строк
    // Номера строк идут подряд: 1 и 2.
    expect(services).toContain('<td class="n">1</td>');
    expect(services).toContain('<td class="n">2</td>');
  });

  test('legacy-строка старого чека: «Мойка ×3» в наименовании, сумма как в чеке', () => {
    const html = buildOrderHtml(makeCheck({ services: [legacyWash()], serviceTotal: 1500 }), company);
    const services = servicesSection(html);
    expect(services).toContain('<td>Мойка ×3</td>');
    expect(services).toContain('<td class="r">500 ₽</td>'); // цена за единицу
    expect(services).toContain('<td class="r">1 500 ₽</td>'); // сумма строки — как в чеке
    expect(services).not.toContain('Кол-во');
  });

  test('«×N» дописывается после экранированного имени — инъекция через имя не проходит', () => {
    const html = buildOrderHtml(
      makeCheck({ services: [legacyWash({ name: 'Мойка <b onclick=x>', quantity: 2, total: 1000 })] }),
      company,
    );
    expect(html).toContain('Мойка &lt;b onclick=x&gt; ×2');
    expect(html).not.toContain('<b onclick=x>');
  });

  test('дробное legacy-количество печатается без хвоста float, пустое / единица — без «×»', () => {
    const fractional = servicesSection(
      buildOrderHtml(makeCheck({ services: [legacyWash({ quantity: 2.5, total: 1250 })] }), company),
    );
    expect(fractional).toContain('<td>Мойка ×2.5</td>');

    for (const quantity of [1, 0, null as unknown as number]) {
      const section = servicesSection(
        buildOrderHtml(makeCheck({ services: [legacyWash({ quantity, total: 500 })] }), company),
      );
      expect(section).toContain('<td>Мойка</td>');
      expect(section).not.toContain('×');
    }
  });

  test('товары по-прежнему показывают количество в своей колонке', () => {
    const products = productsSection(buildOrderHtml(makeCheck(), company));
    expect(products).toContain('<td class="r">2</td>');
    expect(products).toContain('Масло 5W30');
  });
});
