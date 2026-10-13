const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
require('reflect-metadata');
const { Controller, Get, Module, UseGuards, ForbiddenException, Logger } = require('@nestjs/common');
const { NestFactory } = require('@nestjs/core');
const { JwtService } = require('@nestjs/jwt');
const { JwtAuthGuard } = require('../dist/common/guards/jwt-auth.guard');
const { JwtStrategy } = require('../dist/auth/jwt.strategy');
const { HttpExceptionFilter } = require('../dist/common/filters/http-exception.filter');

Logger.overrideLogger(false);
process.env.JWT_SECRET = 'isolated-auth-infrastructure-test-secret';

test('real JWT guard distinguishes failed authentication from unavailable validation', async (t) => {
  let mode = 'healthy',
    hits = 0,
    queries = 0;
  const internal = Object.assign(new Error('private PostgreSQL connection timeout'), { code: '53300' });
  const pool = {
    async query(sql) {
      queries++;
      if (mode === 'unavailable') throw internal;
      if (/FROM revoked_tokens/.test(sql)) return { rows: mode === 'revoked' ? [{ exists: 1 }] : [] };
      return {
        rows: [
          {
            is_active: true,
            tenant_id: randomUUID(),
            role: 'director',
            role_matrix: {},
            session_stale: mode === 'stale',
            tenant_has_points: true,
            point_allowed: mode !== 'point-denied',
            default_point_id: randomUUID(),
          },
        ],
      };
    },
  };
  new JwtStrategy(pool);
  class ProtectedController {
    read() {
      hits++;
      return { ok: true };
    }
  }
  Controller('protected')(ProtectedController);
  UseGuards(JwtAuthGuard)(ProtectedController);
  Get()(ProtectedController.prototype, 'read', Object.getOwnPropertyDescriptor(ProtectedController.prototype, 'read'));
  class TestModule {}
  Module({ controllers: [ProtectedController] })(TestModule);
  const app = await NestFactory.create(TestModule, { logger: false });
  const filter = new HttpExceptionFilter(),
    logs = [];
  filter.logger = { error: (...args) => logs.push(args) };
  app.useGlobalFilters(filter);
  await app.listen(0, '127.0.0.1');
  const base = await app.getUrl(),
    jwt = new JwtService({ secret: process.env.JWT_SECRET });
  const token = (extra = {}, options = {}) => jwt.sign({ sub: randomUUID(), jti: randomUUID(), ...extra }, options);
  const request = (bearer) =>
    fetch(`${base}/protected`, {
      headers: bearer ? { Authorization: `Bearer ${bearer}` } : {},
    });
  try {
    await t.test(
      'missing, malformed, expired and wrong-signature tokens remain 401 without database access',
      async () => {
        for (const bearer of [
          undefined,
          'invalid.jwt',
          token({}, { expiresIn: -1 }),
          token({}, { secret: 'wrong-secret' }),
        ]) {
          assert.equal((await request(bearer)).status, 401);
        }
        assert.equal(queries, 0);
        assert.equal(hits, 0);
      },
    );
    await t.test('database timeout is observable 503, fails closed and does not poison token recovery', async () => {
      const bearer = token();
      mode = 'unavailable';
      const failed = await request(bearer);
      assert.equal(failed.status, 503);
      assert.equal(hits, 0);
      assert.equal(JSON.stringify(await failed.json()).includes('PostgreSQL'), false);
      assert.ok(logs.some((entry) => entry[0].includes('5xx 503')));
      mode = 'healthy';
      assert.equal((await request(bearer)).status, 200, 'same valid session must recover without a new login');
      assert.equal(hits, 1);
    });
    await t.test(
      'explicit revocation, password boundary and removed point keep their actual 401 explanation',
      async () => {
        for (const [nextMode, message] of [
          ['revoked', 'Токен отозван'],
          ['stale', 'Пароль изменён'],
          ['point-denied', 'Филиал больше не доступен'],
        ]) {
          mode = nextMode;
          const response = await request(token({ pointId: randomUUID() }));
          assert.equal(response.status, 401);
          assert.ok((await response.json()).message.includes(message));
        }
        assert.equal(hits, 1);
      },
    );
    await t.test('a deliberate HTTP authorization exception is preserved', () => {
      const denied = new ForbiddenException({ message: 'Нет права' });
      assert.throws(
        () => new JwtAuthGuard().handleRequest(denied, false),
        (error) => error === denied,
      );
    });
  } finally {
    await app.close();
  }
});
