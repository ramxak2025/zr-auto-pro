const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPublicBookingLegalDocuments } = require('../dist/bookings/public-booking-legal');

const context = {
  tenant: {
    name: 'Автосервис',
    legal_name: 'ООО «Ремонт»',
    inn: '7701000000',
    address: 'Адрес из профиля',
    phone: '+79991112233',
    email: 'owner@example.test',
  },
  pageAddress: 'Адрес филиала',
  pageContacts: 'Справочный телефон страницы',
  links: { whatsapp: 'https://wa.me/79991112233' },
};

test('legal documents are server-generated, separate, versioned from real company data and change with contacts', () => {
  const first = buildPublicBookingLegalDocuments(context);
  const same = buildPublicBookingLegalDocuments(structuredClone(context));
  assert.deepEqual(same, first);
  assert.equal(first.operator.name, 'ООО «Ремонт»');
  assert.equal(first.operator.requisites, 'ИНН 7701000000');
  assert.match(first.policyText, /Адрес оператора: Адрес из профиля/);
  assert.match(first.policyText, /Адрес автосервиса: Адрес филиала/);
  assert.match(first.policyText, /owner@example\.test/);
  assert.match(first.consentText, /Отдельное согласие/);
  assert.notEqual(first.policyText, first.consentText);
  assert.match(first.consentVersion, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

  const changed = buildPublicBookingLegalDocuments({
    ...context,
    tenant: { ...context.tenant, email: 'updated@example.test' },
  });
  assert.notEqual(changed.consentVersion, first.consentVersion);
  assert.match(changed.policyText, /updated@example\.test/);
});
