const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
require('reflect-metadata');
const { Module, ValidationPipe, Logger } = require('@nestjs/common');
const { NestFactory } = require('@nestjs/core');
const { JwtService } = require('@nestjs/jwt');
const { JwtStrategy } = require('../dist/auth/jwt.strategy');
const { ReturnsController } = require('../dist/returns/returns.controller');
const { ReturnsService } = require('../dist/returns/returns.service');
Logger.overrideLogger(false);
process.env.JWT_SECRET = 'isolated-return-http-validation-secret';

test('returns HTTP route validates its body and check ID without weakening financial permissions', async (t) => {
  let role = 'director',
    calls = 0;
  new JwtStrategy({
    query: async (sql) => ({
      rows: /FROM revoked_tokens/.test(sql)
        ? []
        : [
            {
              is_active: true,
              tenant_id: randomUUID(),
              role,
              role_matrix: {},
              session_stale: false,
              tenant_has_points: false,
            },
          ],
    }),
  });
  const service = {
    createReturn: async () => {
      calls++;
      return { ok: true };
    },
  };
  class TestModule {}
  Module({ controllers: [ReturnsController], providers: [{ provide: ReturnsService, useValue: service }] })(TestModule);
  const app = await NestFactory.create(TestModule, { logger: false });
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  await app.listen(0, '127.0.0.1');
  const base = await app.getUrl(),
    jwt = new JwtService({ secret: process.env.JWT_SECRET });
  const post = (body, id = randomUUID()) =>
    fetch(`${base}/returns/${id}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${jwt.sign({ sub: randomUUID(), jti: randomUUID() })}`,
      },
      body: JSON.stringify(body),
    });
  try {
    await t.test('malformed primitives, nested lines and UUID never reach the service', async () => {
      for (const body of [
        {},
        { destination: 'unknown', scope: 'full' },
        { destination: 'defect', scope: 'full', reason: 42 },
        { destination: 'warehouse', scope: 'full', refundAmount: '12.5' },
        { destination: 'warehouse', scope: 'full', refundAmount: -1 },
        { destination: 'warehouse', scope: 'partial', lines: { length: 1 } },
        { destination: 'warehouse', scope: 'partial', lines: [null] },
        { destination: 'warehouse', scope: 'partial', lines: [{ productLineId: 'wrong' }] },
        { destination: 'warehouse', scope: 'partial', lines: [{ productLineId: randomUUID(), quantity: '1' }] },
        { destination: 'warehouse', scope: 'partial', lines: [{ productLineId: randomUUID(), quantity: 0 }] },
      ])
        assert.equal((await post(body)).status, 400, JSON.stringify(body));
      assert.equal((await post({ destination: 'warehouse', scope: 'full' }, 'wrong')).status, 400);
      assert.equal(calls, 0);
    });
    await t.test('legitimate fractional request remains accepted', async () => {
      const response = await post({
        destination: 'warehouse',
        scope: 'partial',
        refundAmount: 100.25,
        lines: [{ productLineId: randomUUID(), quantity: 0.5 }],
      });
      assert.equal(response.status, 201);
      assert.equal(calls, 1);
    });
    await t.test('master without payment_edit remains forbidden', async () => {
      role = 'master';
      assert.equal((await post({ destination: 'warehouse', scope: 'full' })).status, 403);
      assert.equal(calls, 1);
    });
  } finally {
    await app.close();
  }
});
