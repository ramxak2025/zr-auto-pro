const assert = require('node:assert/strict');
const test = require('node:test');

// Компилируется nest build перед `node --test` (см. package.json "test").
const { assertPrivilegeCeiling } = require('../dist/roles/privilege-ceiling.js');
const { flattenRoleMatrix } = require('../dist/common/role-matrix.js');

// Актор с ограниченными правами: держит user_management (может редактировать
// роли), но НЕ имеет доступа к прибыли, к cashflow «по всем», к складской
// себестоимости, к зарплате «по всем». Разворачиваем его матрицу в тот же
// плоский вид, что jwt.strategy кладёт в payload.permissions, чтобы
// userHasPermission внутри потолка видел ровно эти права.
const managerMatrix = {
  checks: { view: 'own', create: true },
  clients: { view: true, edit: true },
  employees: { manage: true },
  warehouse: { view: true },
  reports: { cashflow: 'own' },
  salary: { view: 'own' },
};
const manager = { role: 'admin', permissions: flattenRoleMatrix(managerMatrix) };

const is403 = (label) => (err) =>
  err && typeof err.getStatus === 'function' && err.getStatus() === 403 && err.getResponse().message.includes(label);

test('раскрытие прибыли выше своих прав (create, before={}) → 403', () => {
  assert.throws(() => assertPrivilegeCeiling({}, { reports: { profit: true } }, manager), is403('Просмотр прибыли'));
});

test('копия сильной роли поверх своих прав (склад-себестоимость) → 403', () => {
  assert.throws(
    () => assertPrivilegeCeiling({}, { warehouse: { view: true, manage: true } }, manager),
    is403('Склад: управление и себестоимость'),
  );
});

test('расширение охвата cashflow own→all выше своего охвата → 403', () => {
  assert.throws(
    () => assertPrivilegeCeiling({ reports: { cashflow: 'own' } }, { reports: { cashflow: 'all' } }, manager),
    is403('Движение денег: просмотр по всем'),
  );
});

test('расширение охвата зарплаты own→all выше своего охвата → 403', () => {
  assert.throws(
    () => assertPrivilegeCeiling({ salary: { view: 'own' } }, { salary: { view: 'all' } }, manager),
    is403('Зарплата: просмотр по всем сотрудникам'),
  );
});

test('роль в пределах своих прав (свой охват cashflow own, клиенты) — не бросает', () => {
  assert.doesNotThrow(() =>
    assertPrivilegeCeiling({}, { reports: { cashflow: 'own' }, clients: { view: true, edit: true } }, manager),
  );
});

test('сохранение уже выданного ранее сильного права (before уже true) — не бросает', () => {
  // Директор ранее выдал роли cashflow=all; менеджер правит имя/иное, all остаётся.
  assert.doesNotThrow(() =>
    assertPrivilegeCeiling({ reports: { cashflow: 'all' } }, { reports: { cashflow: 'all' } }, manager),
  );
});

test('понижение сильного права (all→own) не-owner-класс — не бросает', () => {
  assert.doesNotThrow(() =>
    assertPrivilegeCeiling({ reports: { cashflow: 'all' } }, { reports: { cashflow: 'own' } }, manager),
  );
});

test('owner-only: не-директор не выдаёт «Выплаты…» даже если сам владеет им', () => {
  const payoutHolder = { role: 'admin', permissions: flattenRoleMatrix({ salary: { payouts: true }, employees: { manage: true } }) };
  assert.throws(
    () => assertPrivilegeCeiling({}, { salary: { payouts: true } }, payoutHolder),
    is403('Выплаты, авансы и штрафы'),
  );
});

test('owner-only: настройки компании — только директор', () => {
  assert.throws(
    () => assertPrivilegeCeiling({}, { settings: { company: true } }, manager),
    is403('Настройки компании'),
  );
});

test('директор (owner-class) — потолка нет: любые права проходят', () => {
  const director = { role: 'director', permissions: {} };
  assert.doesNotThrow(() =>
    assertPrivilegeCeiling(
      {},
      { reports: { profit: true, cashflow: 'all' }, salary: { payouts: true }, settings: { company: true } },
      director,
    ),
  );
});

test('суперадмин (owner-class) — потолка нет', () => {
  const superadmin = { role: 'superadmin', permissions: {} };
  assert.doesNotThrow(() =>
    assertPrivilegeCeiling({}, { salary: { payouts: true }, equipment: { permanentDelete: true } }, superadmin),
  );
});

test('внутренний вызов без актора — проверка пропускается (fail-open)', () => {
  assert.doesNotThrow(() => assertPrivilegeCeiling({}, { reports: { profit: true }, salary: { payouts: true } }, undefined));
});
