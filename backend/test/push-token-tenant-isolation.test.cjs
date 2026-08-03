/**
 * push_tokens: смена пользователя на ОДНОМ устройстве и адресные пуши.
 *
 * Дыра, которую эти тесты держат закрытой (аудит мультитенантности):
 * upsertToken отказывался ПЕРЕЗАПИСАТЬ токен, принадлежащий живому
 * пользователю ЧУЖОГО тенанта, — и оставлял старую строку жить. Сотрудник A
 * автосервиса «Альфа» не разлогинился, на этом же телефоне вошёл B из «Беты» →
 * «Альфа» продолжала слать на трубку баннеры с номером заказа, госномером,
 * ФИО клиента и суммами, а B не получал ничего. Теперь путь fail-CLOSED:
 * строка УДАЛЯЕТСЯ (и не переназначается никому).
 *
 * Тесты гоняют настоящий PushService поверх поддельного пула, который
 * воспроизводит семантику INSERT ... ON CONFLICT ... WHERE. Поддельный пул
 * НЕ моделирует RLS (миграция 112 прячет чужого владельца от политики users),
 * то есть проверяет более РАЗРЕШИТЕЛЬНЫЙ случай admin-пула: если гарантия
 * держится здесь, под RLS она тем более держится.
 */
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

const { PushService } = require('../dist/push/push.service.js');

const backendRoot = join(__dirname, '..');
const readSource = (relativePath) => readFileSync(join(backendRoot, relativePath), 'utf8');

const squash = (sql) => sql.replace(/\s+/g, ' ').trim();

const TENANT_ALPHA = '11111111-1111-4111-8111-111111111111';
const TENANT_BETA = '22222222-2222-4222-8222-222222222222';
const USER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const USER_A2 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const TOKEN = 'ExponentPushToken[sharedDevice0001]';
const OLD_SEEN = new Date('2026-01-01T00:00:00.000Z');

/**
 * Поддельный pg.Pool: интерпретирует ровно те запросы, которые делает
 * PushService, и хранит push_tokens / users в памяти.
 */
function createPool({ tokens = [], users = [] } = {}) {
  const state = { tokens, users };
  const calls = [];

  const upsert = ([userId, token, platform, tenantId]) => {
    const existing = state.tokens.find((r) => r.token === token);
    if (!existing) {
      state.tokens.push({ user_id: userId, token, platform, created_at: new Date(), last_seen_at: new Date() });
      return { rows: [], rowCount: 1 };
    }
    const owner = state.users.find((u) => u.id === existing.user_id);
    const allowed =
      existing.user_id === userId ||
      (!!owner && (owner.tenant_id === tenantId || owner.is_active === false || owner.dismissed_at != null));
    if (!allowed) return { rows: [], rowCount: 0 };
    existing.user_id = userId;
    existing.platform = platform;
    existing.last_seen_at = new Date();
    return { rows: [], rowCount: 1 };
  };

  const deleteByToken = ([token, userId]) => {
    const before = state.tokens.length;
    state.tokens = state.tokens.filter((r) => !(r.token === token && r.user_id !== userId));
    return { rows: [], rowCount: before - state.tokens.length };
  };

  const selectTokens = (sql, params) => {
    const [userId, tenantId] = params;
    const rows = state.tokens.filter((r) => {
      if (r.user_id !== userId) return false;
      if (!sql.includes('JOIN users')) return true;
      return state.users.some((u) => u.id === r.user_id && u.tenant_id === tenantId);
    });
    return { rows: rows.map((r) => ({ ...r })), rowCount: rows.length };
  };

  return {
    state,
    calls,
    async query(text, params = []) {
      const sql = squash(text);
      calls.push({ sql, params });
      if (sql.startsWith('INSERT INTO push_tokens')) return upsert(params);
      if (sql.startsWith('DELETE FROM push_tokens WHERE token =')) return deleteByToken(params);
      if (sql.includes('FROM push_tokens')) return selectTokens(sql, params);
      // notification_settings / notification_mutes probe → строки нет = дефолты.
      return { rows: [], rowCount: 0 };
    },
  };
}

const deleteCalls = (pool) => pool.calls.filter((c) => c.sql.startsWith('DELETE FROM push_tokens WHERE token ='));
const insertCall = (pool) => pool.calls.find((c) => c.sql.startsWith('INSERT INTO push_tokens'));

// ── (а) регистрация нового токена ───────────────────────────────────────────

test('новый токен регистрируется и получает last_seen_at', async () => {
  const pool = createPool({ users: [{ id: USER_A, tenant_id: TENANT_ALPHA, is_active: true, dismissed_at: null }] });
  const service = new PushService(pool);

  const result = await service.upsertToken(USER_A, TENANT_ALPHA, TOKEN, 'ios');

  assert.deepEqual(result, { token: TOKEN, platform: 'ios', registered: true });
  assert.equal(pool.state.tokens.length, 1);
  assert.equal(pool.state.tokens[0].user_id, USER_A);
  assert.ok(pool.state.tokens[0].last_seen_at instanceof Date, 'last_seen_at обязан проставляться при вставке');
  assert.equal(deleteCalls(pool).length, 0, 'успешная регистрация ничего не удаляет');
});

// ── (б) повторная регистрация тем же пользователем ──────────────────────────

test('повторная регистрация тем же пользователем обновляет строку, а не плодит вторую', async () => {
  const pool = createPool({
    users: [{ id: USER_A, tenant_id: TENANT_ALPHA, is_active: true, dismissed_at: null }],
    tokens: [{ user_id: USER_A, token: TOKEN, platform: 'android', created_at: OLD_SEEN, last_seen_at: OLD_SEEN }],
  });
  const service = new PushService(pool);

  const result = await service.upsertToken(USER_A, TENANT_ALPHA, TOKEN, 'ios');

  assert.equal(result.registered, true);
  assert.equal(pool.state.tokens.length, 1);
  assert.equal(pool.state.tokens[0].user_id, USER_A);
  assert.equal(pool.state.tokens[0].platform, 'ios', 'платформа обновляется');
  assert.ok(
    pool.state.tokens[0].last_seen_at.getTime() > OLD_SEEN.getTime(),
    'подтверждение живого токена двигает last_seen_at',
  );
  assert.equal(deleteCalls(pool).length, 0);
});

// ── (в) конфликт с живым владельцем ДРУГОГО тенанта → строка удалена ────────

test('чужой живой владелец из ДРУГОГО тенанта: строка УДАЛЕНА, registered:false', async () => {
  const pool = createPool({
    users: [
      { id: USER_A, tenant_id: TENANT_ALPHA, is_active: true, dismissed_at: null },
      { id: USER_B, tenant_id: TENANT_BETA, is_active: true, dismissed_at: null },
    ],
    tokens: [{ user_id: USER_A, token: TOKEN, platform: 'ios', created_at: OLD_SEEN, last_seen_at: OLD_SEEN }],
  });
  const service = new PushService(pool);

  const result = await service.upsertToken(USER_B, TENANT_BETA, TOKEN, 'ios');

  assert.deepEqual(result, {
    token: TOKEN,
    platform: 'ios',
    registered: false,
    reason: 'token_owned_by_another_user',
  });
  assert.equal(
    pool.state.tokens.filter((r) => r.token === TOKEN).length,
    0,
    'строка прежнего тенанта обязана исчезнуть — иначе «Альфа» продолжит слать баннеры на телефон B',
  );
  const deletes = deleteCalls(pool);
  assert.equal(deletes.length, 1, 'ровно один DELETE по токену');
  assert.deepEqual(deletes[0].params, [TOKEN, USER_B]);
});

test('удаление не переназначает токен звонящему (иначе это и был бы угон)', async () => {
  const pool = createPool({
    users: [
      { id: USER_A, tenant_id: TENANT_ALPHA, is_active: true, dismissed_at: null },
      { id: USER_B, tenant_id: TENANT_BETA, is_active: true, dismissed_at: null },
    ],
    tokens: [{ user_id: USER_A, token: TOKEN, platform: 'ios', created_at: OLD_SEEN, last_seen_at: OLD_SEEN }],
  });
  const service = new PushService(pool);

  await service.upsertToken(USER_B, TENANT_BETA, TOKEN, 'ios');

  assert.equal(pool.state.tokens.length, 0, 'токеном не владеет НИКТО — ни прежний владелец, ни звонящий');

  // …а следующая попытка того же телефона уже проходит: строка свободна.
  const second = await service.upsertToken(USER_B, TENANT_BETA, TOKEN, 'ios');
  assert.equal(second.registered, true);
  assert.equal(pool.state.tokens[0].user_id, USER_B);
});

// ── (г) конфликт внутри ОДНОГО тенанта → перезапись (by design) ─────────────

test('общий девайс внутри одного тенанта: токен переходит новому сотруднику', async () => {
  const pool = createPool({
    users: [
      { id: USER_A, tenant_id: TENANT_ALPHA, is_active: true, dismissed_at: null },
      { id: USER_A2, tenant_id: TENANT_ALPHA, is_active: true, dismissed_at: null },
    ],
    tokens: [{ user_id: USER_A, token: TOKEN, platform: 'ios', created_at: OLD_SEEN, last_seen_at: OLD_SEEN }],
  });
  const service = new PushService(pool);

  const result = await service.upsertToken(USER_A2, TENANT_ALPHA, TOKEN, 'ios');

  assert.equal(result.registered, true);
  assert.equal(pool.state.tokens.length, 1);
  assert.equal(pool.state.tokens[0].user_id, USER_A2);
  assert.equal(deleteCalls(pool).length, 0);
});

// ── (д) владелец уволен / неактивен → перезапись ────────────────────────────

test('неактивный владелец: токен переходит новому пользователю', async () => {
  const pool = createPool({
    users: [
      { id: USER_A, tenant_id: TENANT_ALPHA, is_active: false, dismissed_at: null },
      { id: USER_B, tenant_id: TENANT_BETA, is_active: true, dismissed_at: null },
    ],
    tokens: [{ user_id: USER_A, token: TOKEN, platform: 'ios', created_at: OLD_SEEN, last_seen_at: OLD_SEEN }],
  });
  const service = new PushService(pool);

  const result = await service.upsertToken(USER_B, TENANT_BETA, TOKEN, 'ios');

  assert.equal(result.registered, true);
  assert.equal(pool.state.tokens[0].user_id, USER_B);
  assert.equal(deleteCalls(pool).length, 0);
});

test('уволенный владелец (dismissed_at): токен переходит новому пользователю', async () => {
  const pool = createPool({
    users: [
      { id: USER_A, tenant_id: TENANT_ALPHA, is_active: true, dismissed_at: new Date('2026-02-01T00:00:00.000Z') },
      { id: USER_B, tenant_id: TENANT_BETA, is_active: true, dismissed_at: null },
    ],
    tokens: [{ user_id: USER_A, token: TOKEN, platform: 'ios', created_at: OLD_SEEN, last_seen_at: OLD_SEEN }],
  });
  const service = new PushService(pool);

  const result = await service.upsertToken(USER_B, TENANT_BETA, TOKEN, 'ios');

  assert.equal(result.registered, true);
  assert.equal(pool.state.tokens[0].user_id, USER_B);
});

// ── форма самого SQL (мок проверяет семантику, это — букву) ─────────────────

test('upsert штампует last_seen_at на ОБОИХ путях и сохраняет предикат владения', async () => {
  const pool = createPool({ users: [{ id: USER_A, tenant_id: TENANT_ALPHA, is_active: true, dismissed_at: null }] });
  const service = new PushService(pool);
  await service.upsertToken(USER_A, TENANT_ALPHA, TOKEN, 'ios');

  const sql = insertCall(pool).sql;
  assert.match(sql, /INSERT INTO push_tokens \(user_id, token, platform, last_seen_at\)/);
  assert.match(sql, /VALUES \(\$1, \$2, \$3, now\(\)\)/, 'вставка проставляет last_seen_at');
  assert.match(sql, /DO UPDATE SET[\s\S]*last_seen_at = now\(\)/, 'подтверждение тоже двигает last_seen_at');
  assert.match(sql, /WHERE push_tokens\.user_id = EXCLUDED\.user_id/, 'своя строка — всегда можно');
  assert.match(sql, /owner\.tenant_id = \$4 OR owner\.is_active = false OR owner\.dismissed_at IS NOT NULL/);
});

test('отказ регистрации ОБЯЗАН сопровождаться удалением строки (fail-closed)', () => {
  const source = readSource('src/push/push.service.ts');
  const block = source.slice(
    source.indexOf('if (result.rowCount === 0)'),
    source.indexOf('return { token, platform, registered: true }'),
  );
  assert.match(block, /DELETE FROM push_tokens WHERE token = \$1 AND user_id <> \$2/, 'иначе утечка остаётся открытой');
  assert.match(block, /registered: false, reason: 'token_owned_by_another_user'/, 'контракт ответа не меняется');
});

// ── адресные пуши: тенант в самом запросе за устройствами ───────────────────

test('sendToUserInTenant ищет устройства ТОЛЬКО внутри тенанта', async () => {
  const pool = createPool({
    users: [{ id: USER_B, tenant_id: TENANT_BETA, is_active: true, dismissed_at: null }],
    tokens: [{ user_id: USER_B, token: TOKEN, platform: 'ios', created_at: OLD_SEEN, last_seen_at: OLD_SEEN }],
  });
  const service = new PushService(pool);

  // Получатель из «Беты», отправитель называет «Альфу» → ноль устройств,
  // значит postToExpo даже не вызывается (сеть в тестах не трогаем).
  await service.sendToUserInTenant(USER_B, TENANT_ALPHA, 'check_assigned', 'Новый заказ-наряд', 'тело');

  const lookup = pool.calls.find((c) => c.sql.includes('FROM push_tokens pt'));
  assert.ok(lookup, 'выборка устройств обязана идти через join к users');
  assert.match(lookup.sql, /JOIN users u ON u\.id = pt\.user_id AND u\.tenant_id = \$2/);
  assert.deepEqual(lookup.params, [USER_B, TENANT_ALPHA]);
});

test('loadUserTokens: свой тенант отдаёт устройство, чужой — пусто', async () => {
  const pool = createPool({
    users: [{ id: USER_B, tenant_id: TENANT_BETA, is_active: true, dismissed_at: null }],
    tokens: [{ user_id: USER_B, token: TOKEN, platform: 'ios', created_at: OLD_SEEN, last_seen_at: OLD_SEEN }],
  });
  const service = new PushService(pool);

  assert.deepEqual(await service.loadUserTokens(USER_B, TENANT_BETA), [TOKEN]);
  assert.deepEqual(await service.loadUserTokens(USER_B, TENANT_ALPHA), []);
  assert.deepEqual(await service.loadUserTokens(USER_B, null), [TOKEN], 'без тенанта — историческое поведение');
});

// ── ни один адресный пуш с получателем из DTO не должен остаться «голым» ────

test('получатель из DTO уходит только через tenant-safe отправку', () => {
  const cases = [
    ['src/checks/checks.service.ts', /sendToUserInTenant\(\s*dto\.masterId,\s*tenantID/],
    ['src/checks/checks.service.ts', /sendToUserInTenant\(\s*newMasterId,\s*tenantID/],
    ['src/salary/salary.service.ts', /sendToUserInTenant\(\s*payment\.user_id,\s*tenantID/],
    ['src/salary/salary.service.ts', /sendToUserInTenant\(\s*dto\.userId,\s*tenantID,\s*'salary'/],
    ['src/salary/salary.service.ts', /sendToUserInTenant\(\s*dto\.userId,\s*tenantID,\s*'penalty'/],
    ['src/salary/salary.service.ts', /sendToUserInTenant\(\s*dto\.employeeId,\s*tenantID/],
    ['src/profile/profile.service.ts', /sendToUserInTenant\(\s*requesterId,\s*tenantId/],
  ];
  for (const [file, pattern] of cases) {
    assert.match(readSource(file), pattern, `${file}: адресный пуш обязан быть tenant-safe`);
  }
});

test('в checks и profile не осталось нетенантных адресных отправок', () => {
  for (const file of ['src/checks/checks.service.ts', 'src/profile/profile.service.ts']) {
    assert.doesNotMatch(
      readSource(file),
      /\.sendToUserCategory\(/,
      `${file}: все адресные пуши переведены на sendToUserInTenant`,
    );
  }
  // В salary остаётся ровно одна намеренная — получатель может быть
  // безтенантным суперадмином-оператором (см. комментарий у decidePayout).
  const salary = readSource('src/salary/salary.service.ts');
  assert.equal((salary.match(/\.sendToUserCategory\(/g) ?? []).length, 1);
  assert.match(salary, /sendToUserCategory\(\s*ownerToNotify/);
});

// ── смежные гарантии, которые правка не должна была сломать ────────────────

test('DeviceNotRegistered по-прежнему вычищает мёртвый токен', () => {
  const source = readSource('src/push/push.service.ts');
  assert.match(source, /errorCode === 'DeviceNotRegistered' && token/, 'тикет-уровень');
  assert.match(source, /receipt\.error === 'DeviceNotRegistered'/, 'квитанция-уровень');
  assert.match(source, /DELETE FROM push_tokens WHERE token = ANY\(\$1::text\[\]\)/, 'сама чистка');
});

test('уведомление об удалении аккаунта уходит только оператору платформы', () => {
  const source = readSource('src/account/account.service.ts');
  assert.match(source, /role = 'superadmin' AND is_active = true AND tenant_id IS NULL/);
});

test('миграция 152 идемпотентна и не врёт про давность строк', () => {
  const sql = readSource('migrations/152_push_tokens_last_seen.sql');
  assert.match(sql, /ADD COLUMN IF NOT EXISTS last_seen_at/);
  assert.match(sql, /SET last_seen_at = COALESCE\(created_at, now\(\)\)\s+WHERE last_seen_at IS NULL/);
  assert.match(sql, /ALTER COLUMN last_seen_at SET DEFAULT now\(\)/);
});
