const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');
const { DashboardService } = require('../dist/dashboard/dashboard.service');
const { PublicBookingsService } = require('../dist/bookings/public-bookings.service');
const live = process.env.OCT26_BOOKING_PAGES_TEST_DB;
test(
  'pending attention count and every bounded inbox page match actual service tenant/point/resource/status scopes',
  { skip: !live },
  async () => {
    const url = new URL(live);
    assert.equal(url.hostname, '127.0.0.1');
    assert.equal(url.port, '55446');
    assert.equal(url.pathname, '/autexa_oct26_dashboard_repair');
    const pool = new Pool({ connectionString: live });
    const c = await pool.connect();
    const schema = 'pages_' + randomUUID().replaceAll('-', '');
    try {
      await c.query(`CREATE SCHEMA ${schema}`);
      await c.query(`SET search_path TO ${schema},pg_catalog`);
      await c.query(`CREATE TABLE tenants(id uuid,timezone text,is_active boolean);CREATE TABLE roles(id uuid,tenant_id uuid,matrix jsonb);
 CREATE TABLE users(id uuid,tenant_id uuid,role text,role_id uuid,is_active boolean,dismissed_at timestamptz,purged_at timestamptz);
 CREATE TABLE tenant_points(tenant_id uuid,is_active boolean);CREATE FUNCTION autexa_point_is_allowed(uuid,uuid,uuid) RETURNS boolean LANGUAGE sql AS $$SELECT true$$;
 CREATE TABLE public_booking_requests(id uuid,tenant_id uuid,point_id uuid,resource_id uuid,status text,request_id uuid,contact_name text,contact_phone text,comment text,selected_services jsonb,starts_at timestamptz,duration_minutes int,created_at timestamptz);
 CREATE TABLE bookings(id uuid,tenant_id uuid,public_request_id uuid,status text,client_id uuid,scheduled_at timestamptz,duration_minutes int);`);
      const tenant = randomUUID(),
        foreignTenant = randomUUID(),
        point = randomUUID(),
        otherPoint = randomUUID(),
        self = randomUUID(),
        peer = randomUUID(),
        role = randomUUID();
      await c.query("INSERT INTO tenants VALUES($1,'Europe/Moscow',true)", [tenant]);
      await c.query('INSERT INTO roles VALUES($1,$2,$3)', [role, tenant, { bookings: { view: true } }]);
      await c.query("INSERT INTO users VALUES($1,$2,'master',$3,true,NULL,NULL)", [self, tenant, role]);
      const seed = async (count, tid = tenant, pid = point, uid = self, status = 'pending') => {
        const { rows } = await c.query(
          `INSERT INTO public_booking_requests SELECT gen_random_uuid(),$1,$2,$3,$5,gen_random_uuid(),'Synthetic inbox customer','+70000000001',NULL,'[]',now(),30,now()-n*interval '1 second' FROM generate_series(1,$4) n RETURNING id`,
          [tid, pid, uid, count, status],
        );
        return rows.map((r) => r.id);
      };
      const expected = await seed(205);
      await seed(7, tenant, point, peer);
      await seed(9, tenant, otherPoint);
      await seed(11, foreignTenant);
      await seed(4, tenant, null);
      await seed(1, tenant, point, self, 'confirmed');
      const [cancelled] = await seed(1);
      await c.query("INSERT INTO bookings VALUES($1,$2,$3,'cancelled',NULL,now(),30)", [
        randomUUID(),
        tenant,
        cancelled,
      ]);
      const actor = {
        tenantID: tenant,
        currentPointId: point,
        userID: self,
        role: 'master',
        permissions: {
          bookings_access: true,
          checks_view: false,
          suppliers_access: false,
          warehouse_access: false,
          debts_manage: false,
        },
      };
      const inbox = new PublicBookingsService(c),
        dashboard = new DashboardService(c);
      const collect = async () => {
        const all = [];
        for (let page = 1; page <= 10; page++) {
          const rows = await inbox.requests(actor, { status: 'pending', page });
          assert.ok(rows.length <= 200);
          all.push(...rows);
          if (rows.length < 200) break;
        }
        return all;
      };
      assert.equal((await dashboard.attention(actor)).buckets[0].count, 205);
      const defaultPage = await inbox.requests(actor, { status: 'pending' });
      assert.equal(defaultPage.length, 200);
      assert.deepEqual(
        (await inbox.requests(actor, { status: 'pending', page: 1 })).map((r) => r.id),
        defaultPage.map((r) => r.id),
      );
      const own = await collect();
      assert.equal(own.length, 205);
      assert.equal(new Set(own.map((r) => r.id)).size, 205);
      assert.deepEqual(new Set(own.map((r) => r.id)), new Set(expected));
      assert.equal((await inbox.requests(actor, { status: 'pending', page: 2 })).length, 5);
      assert.equal((await inbox.requests(actor, { status: 'pending', page: 3 })).length, 0);
      for (const page of [0, -1, 1.5, 'not-a-page', 1000001])
        await assert.rejects(
          () => inbox.requests(actor, { status: 'pending', page }),
          (error) => error.getStatus() === 400,
        );
      await c.query("UPDATE users SET role='admin' WHERE id=$1", [self]);
      actor.role = 'admin';
      const all = await collect();
      assert.equal(all.length, 212);
      assert.equal((await dashboard.attention(actor)).buckets[0].count, 212);
      assert.ok(all.every((r) => r.pointId === point));
      actor.currentPointId = null;
      assert.equal((await collect()).length, 4);
      assert.equal((await dashboard.attention(actor)).buckets[0].count, 4);
    } finally {
      await c.query(`DROP SCHEMA ${schema} CASCADE`);
      c.release();
      await pool.end();
    }
  },
);
