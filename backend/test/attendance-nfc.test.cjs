const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, randomBytes } = require('node:crypto');
const { AsyncLocalStorage } = require('node:async_hooks');
const { setTimeout: delay } = require('node:timers/promises');
const { Pool } = require('pg');
const { Logger, ValidationPipe } = require('@nestjs/common');
require('reflect-metadata');
const { ShiftsNfcService } = require('../dist/shifts/shifts-nfc.service');
const { ShiftsNfcController } = require('../dist/shifts/shifts-nfc.controller');
const { ShiftsService } = require('../dist/shifts/shifts.service');
const { ShiftAutoCloseService } = require('../dist/shifts/shift-auto-close.service');
const { ScheduleService } = require('../dist/schedule/schedule.service');
const { TenantsService } = require('../dist/tenants/tenants.service');
const { PointsService } = require('../dist/points/points.service');
const { TenantAwarePool } = require('../dist/common/tenant-pool');
const { runWithTenant } = require('../dist/common/tenant-context');
const { JwtAuthGuard } = require('../dist/common/guards/jwt-auth.guard');
const { PermissionsGuard, PERMISSION_KEY } = require('../dist/common/guards/permissions.guard');
const { NfcScanDto, NfcTagNameDto } = require('../dist/shifts/dto/nfc.dto');
const { ttlCache } = require('../dist/common/ttl-cache');
const { redactNfcTelemetry } = require('../dist/common/sentry');
const { nfcDecision, nfcUri, nfcTokenHash } = require('../dist/shifts/nfc-attendance');
Logger.overrideLogger(false);
const status = code => error => error.getStatus?.() === code;
const wire = value => JSON.parse(JSON.stringify(value));
const token = () => randomBytes(32).toString('base64url');
const instant = value => new Date(value).toISOString();
const at = time => `2026-10-08T${time}+03:00`;

// Public contract checks never need the fixture.
test('NFC routes require JWT, management uses company_manage, and scan DTO cannot override actor/point/clock', async () => {
  assert.deepEqual(Reflect.getMetadata('__guards__', ShiftsNfcController), [JwtAuthGuard, PermissionsGuard]);
  for (const method of ['tags','create','activate','rename','revoke','archive']) assert.equal(Reflect.getMetadata(PERMISSION_KEY, ShiftsNfcController.prototype[method]), 'company_manage');
  const pipe = new ValidationPipe({ transform:true, whitelist:true });
  const parsed = await pipe.transform({token:token(),requestId:randomUUID(),userId:randomUUID(),pointId:randomUUID(),now:'2000-01-01'}, {type:'body',metatype:NfcScanDto});
  assert.deepEqual(Object.keys(parsed).sort(), ['requestId','token']);
  for (const body of [{token:token()},{token:'bad',requestId:randomUUID()},{token:token(),requestId:'bad'}]) await assert.rejects(pipe.transform(body,{type:'body',metatype:NfcScanDto}),status(400));
  await assert.rejects(pipe.transform({name:' '},{type:'body',metatype:NfcTagNameDto}),status(400));
});

test('NFC URI uses a trusted HTTPS origin and fragment token; exact ten-minute/ten-second decisions do not extend windows', () => {
  const previous=process.env.APP_URL, raw=token();
  const event={request:{url:'https://autexa-cloud.ru/api/shifts/nfc/scan?token='+raw,data:{token:raw},query_string:'token='+raw}};
  assert.equal(JSON.stringify(redactNfcTelemetry(event)).includes(raw),false);
  assert.deepEqual(redactNfcTelemetry({request:{url:'/api/checks',data:{example:1}}}),{request:{url:'/api/checks',data:{example:1}}});
  try {
    delete process.env.APP_URL;
    const uri=new URL(nfcUri(raw));
    assert.equal(uri.origin,'https://autexa-cloud.ru'); assert.equal(uri.pathname,'/nfc/attendance'); assert.equal(uri.search,'');
    assert.equal(new URLSearchParams(uri.hash.slice(1)).get('token'),raw);
    process.env.APP_URL='https://autexa.pw/some/path'; assert.ok(nfcUri(raw).startsWith('https://autexa.pw/nfc/attendance#'));
    for (const origin of ['http://autexa.pw','https://autexa.pw.evil.example','https://evil.example','https://a:b@autexa.pw','https://autexa.pw:444','https://www.autexa.pw']) {
      process.env.APP_URL=origin; assert.throws(()=>nfcUri(raw));
    }
  } finally { if(previous===undefined) delete process.env.APP_URL; else process.env.APP_URL=previous; }
  const base={now:new Date(at('09:10:00.000')),requestStartedAt:new Date(at('09:10:00.000')),hasOpenShift:true,firstNfcAt:new Date(at('09:00:00')),lastNfcClose:null};
  assert.equal(nfcDecision(base).action,'unchanged');
  assert.equal(nfcDecision({...base,now:new Date(at('09:10:00.001'))}).action,'closed');
  const closed={...base,hasOpenShift:false,firstNfcAt:null,lastNfcClose:new Date(at('09:10:00')),requestStartedAt:new Date(at('09:10:10')),now:new Date(at('09:10:10'))};
  assert.equal(nfcDecision(closed).reason,'closing_duplicate');
  assert.equal(nfcDecision({...closed,now:new Date(at('09:10:10.001')),requestStartedAt:new Date(at('09:10:10.001'))}).action,'opened');
  assert.equal(nfcDecision({...closed,now:new Date(at('09:11:00')),requestStartedAt:new Date(at('09:09:59'))}).action,'unchanged');
  assert.equal(nfcDecision({...closed,hasOpenShift:true}).action,'confirmed');
  assert.equal(nfcDecision({...closed,hasOpenShift:true,firstNfcAt:new Date(at('09:10:11')),now:new Date(at('09:30:00')),requestStartedAt:new Date(at('09:09:59'))}).reason,'closing_duplicate');
  const nextEvent={hasOpenShift:true,firstNfcAt:new Date(at('09:11:10.001')),lastNfcClose:new Date(at('09:11:00')),now:new Date(at('09:30:00'))};
  for(const started of ['09:11:01','09:11:10.001']) assert.deepEqual(nfcDecision({...nextEvent,requestStartedAt:new Date(at(started))}),{action:'unchanged',reason:'closing_duplicate'});
  assert.equal(nfcDecision({...nextEvent,requestStartedAt:new Date(at('09:11:10.002'))}).action,'closed');
  assert.equal(nfcDecision({...nextEvent,firstNfcAt:null,requestStartedAt:new Date(at('09:11:01'))}).action,'confirmed');
});

const live=process.env.NFC_LIVE_DB;
test('PostgreSQL16 / real RLS and locks: NFC attendance lifecycle', {skip:!live}, async t => {
  const url=new URL(live);
  assert.ok(['127.0.0.1','localhost'].includes(url.hostname) && url.port==='55438' && url.pathname==='/autexa_oct8_test','Only the explicit disposable October-8 database may be mutated');
  const admin=new Pool({connectionString:live,max:16,statement_timeout:8000});
  const appUrl=new URL(live); appUrl.username='autexa_app'; appUrl.password=process.env.NFC_LIVE_APP_PASSWORD||'oct8_app_fixture_only';
  const app=new Pool({connectionString:appUrl.toString(),max:16,statement_timeout:8000});
  const native=new TenantAwarePool(admin,app), time=new AsyncLocalStorage();
  // Only SQL clock functions are controlled for deterministic boundaries. All
  // rows, transactions, membership/RLS functions and blocking locks are real PG.
  const execute=async(client,sql,params=[])=>{
    const context=time.getStore();
    if(context?.before) await context.before(sql,params);
    if(context && /\b(?:now|clock_timestamp)\(\)/i.test(sql)) {
      const tick=context.ticks.length>1?context.ticks.shift():context.ticks[0];
      return client.query(sql.replace(/\b(?:now|clock_timestamp)\(\)/gi,`$${params.length+1}::timestamptz`),[...params,tick]);
    }
    return client.query(sql,params);
  };
  const pool={query:(sql,params)=>execute(native,sql,params),connect:async()=>{
    const client=await native.connect(); return {query:(sql,params)=>execute(client,sql,params),release:()=>client.release()};
  }};
  const q=async(sql,params=[]) => (await admin.query(sql,params)).rows;
  const one=async(sql,params=[]) => (await q(sql,params))[0];
  const pushes=[];
  const shifts=new ShiftsService(pool,{sendToUserInTenant:async(user,tenant,kind,title)=>{
    // A separate connection must already see the committed attendance ledger.
    const ledger=await one('SELECT COUNT(*)::int n FROM attendance_nfc_requests WHERE tenant_id=$1',[tenant]);
    pushes.push({user,tenant,kind,title,committed:ledger.n});
  }});
  // Track completion without replacing the real recipient query/push path.
  const notifications=[],notify=shifts.notifyNfcAttendance.bind(shifts);
  shifts.notifyNfcAttendance=(...args)=>{
    const pending=notify(...args);notifications.push({tenant:args[0],pending});return pending;
  };
  const service=new ShiftsNfcService(pool,shifts), schedule=new ScheduleService(pool);
  const tenants=[];
  const run=(f,when,fn,before)=>time.run({ticks:Array.isArray(when)?[...when]:[when],before},()=>runWithTenant(f.tenant,fn));
  const seed=async({point=true,timezone='Europe/Moscow'}={})=>{
    const f=Object.fromEntries(['tenant','point','otherPoint','owner','worker','otherWorker'].map(k=>[k,randomUUID()])); tenants.push(f.tenant);
    await q("INSERT INTO tenants(id,name,timezone,shifts_enabled,attendance_mode) VALUES($1,$2,$3,true,'nfc')",[f.tenant,'NFC fixture '+f.tenant,timezone]);
    if(point) await q("INSERT INTO tenant_points(id,tenant_id,name,is_main) VALUES($1,$3,'Main',true),($2,$3,'Other',false)",[f.point,f.otherPoint,f.tenant]);
    else { f.point=null; f.otherPoint=null; }
    for(const [id,role] of [[f.owner,'director'],[f.worker,'master'],[f.otherWorker,'master']]) await q("INSERT INTO users(id,tenant_id,phone,password,full_name,role) VALUES($1,$2,$4,'fixture-only','NFC worker',$3)",[id,f.tenant,role,id]);
    if(point) await q('INSERT INTO user_points(user_id,tenant_id,point_id) VALUES($1,$3,$4),($2,$3,$4)',[f.worker,f.otherWorker,f.tenant,f.point]);
    f.actor={userID:f.worker,tenantID:f.tenant,currentPointId:f.point,role:'master',permissions:{}};
    f.boss={...f.actor,userID:f.owner,role:'director'};
    f.makeTag=async(active=true,actor=f.boss)=>{
      const tag=await run(f,at('08:00:00'),()=>service.createTag(actor,{name:'Вход'}));
      if(active) await run(f,at('08:00:01'),()=>service.activateTag(actor,tag.id,{token:tag.token}));
      return tag;
    };
    f.scan=(tag,when=at('09:00:00'),requestId=randomUUID(),actor=f.actor,before)=>run(f,when,()=>service.scan(actor,{token:tag.token,requestId}),before);
    f.entry=()=>one('SELECT *,date::text AS date FROM schedule_entries WHERE tenant_id=$1 AND user_id=$2 ORDER BY schedule_entries.date DESC LIMIT 1',[f.tenant,f.worker]);
    f.events=()=>q('SELECT *,date::text AS date FROM shifts WHERE tenant_id=$1 AND user_id=$2 ORDER BY opened_at,id',[f.tenant,f.worker]);
    return f;
  };
  const waitUntil=async(predicate)=>{for(let i=0;i<200;i++){if(await predicate())return;await delay(5);}throw Error('Controlled concurrency barrier timed out');};
  const waiting=async(count)=>waitUntil(async()=>(await one("SELECT COUNT(*)::int n FROM pg_stat_activity WHERE datname='autexa_oct8_test' AND wait_event_type='Lock' AND query LIKE 'SELECT id FROM users%'")).n>=count);
  try {
    await t.test('real FORCE RLS is active; no token stored/listed; pending activation is readback-bound; owner permission is fresh',async()=>{
      const f=await seed(), other=await seed(), tag=await f.makeTag(false);
      await q("UPDATE tenants SET shifts_enabled=false,attendance_mode='admin' WHERE id=$1",[f.tenant]);
      const ownerStatus=await run(f,at('08:00:00'),()=>service.status(f.boss));assert.equal(ownerStatus.canManageTags,true);assert.equal(ownerStatus.attendanceMode,'admin');
      const adminPrepared=await f.makeTag();
      await assert.rejects(f.scan(adminPrepared),status(403));
      const adminList=await run(f,at('08:00:00'),()=>service.listTags(f.boss));assert.ok(adminList.some((item)=>item.id===adminPrepared.id));
      assert.equal(tag.status,'pending'); assert.equal(tag.token.length,43);
      const row=await one('SELECT * FROM attendance_nfc_tags WHERE id=$1',[tag.id]);
      assert.equal(row.token_hash,nfcTokenHash(tag.token)); assert.ok(!JSON.stringify(row).includes(tag.token));
      const list=await run(f,at('08:00:00'),()=>service.listTags(f.boss)); assert.ok(!JSON.stringify(list).includes(tag.token)); assert.ok(!JSON.stringify(list).includes(row.token_hash));
      await assert.rejects(f.scan(tag),status(403));
      await assert.rejects(run(f,at('08:00:00'),()=>service.activateTag(f.boss,tag.id,{token:token()})),status(400));
      const active=await run(f,at('08:00:00'),()=>service.activateTag(f.boss,tag.id,{token:tag.token})); assert.equal(active.status,'active');
      await assert.rejects(f.scan(tag),status(403),'tag activation does not enable attendance scans in admin mode');
      const renamed=await run(f,at('08:00:00'),()=>service.renameTag(f.boss,tag.id,{name:'Бокс 1'})); assert.equal(renamed.name,'Бокс 1');
      await q("UPDATE tenants SET shifts_enabled=true,attendance_mode='nfc' WHERE id=$1",[f.tenant]);
      const archivedTag=await f.makeTag(); await f.scan(archivedTag,at('09:00:00'));
      await assert.rejects(run(f,at('09:01:00'),()=>service.archiveTag(f.boss,archivedTag.id)),status(409));
      await run(f,at('09:01:00'),()=>service.revokeTag(f.boss,archivedTag.id));
      const archived=await run(f,at('09:02:00'),()=>service.archiveTag(f.boss,archivedTag.id));
      assert.equal(archived.status,'revoked');
      const archivedRow=await one('SELECT archived_at FROM attendance_nfc_tags WHERE id=$1',[archivedTag.id]);
      assert.ok(archivedRow.archived_at,'archive preserves the tag row');
      assert.equal((await one('SELECT tag_id FROM attendance_nfc_requests WHERE tag_id=$1 LIMIT 1',[archivedTag.id])).tag_id,archivedTag.id);
      assert.ok(!(await run(f,at('09:02:00'),()=>service.listTags(f.boss))).some((item)=>item.id===archivedTag.id));
      await assert.rejects(run(f,at('08:00:00'),()=>service.createTag({...f.actor,role:'director',permissions:{company_manage:true}},{name:'Spoof'})),status(403));
      await q("UPDATE users SET role='admin' WHERE id=$1",[f.worker]);
      await assert.rejects(run(f,at('08:00:00'),()=>service.createTag({...f.actor,role:'admin',permissions:{company_manage:true}},{name:'Admin without company gate'})),status(403));
      assert.equal((await runWithTenant(other.tenant,()=>native.query('SELECT * FROM attendance_nfc_tags WHERE id=$1',[tag.id]))).rows.length,0);
      await assert.rejects(runWithTenant(other.tenant,()=>native.query("INSERT INTO attendance_nfc_tags(tenant_id,name,token_hash) VALUES($1,'bad',$2)",[f.tenant,nfcTokenHash(token())])),e=>e.code==='42501');
      assert.deepEqual(await one("SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname='autexa_app'"),{rolsuper:false,rolbypassrls:false});
      assert.equal((await app.query('SELECT * FROM attendance_nfc_tags')).rows.length,0);
    });
    await t.test('simultaneous first scans (same and distinct UUIDs) open once, preserve exact snapshots and push only after commit',async()=>{
      const f=await seed(),tag=await f.makeTag(),requestId=randomUUID();
      const [a,b,c]=await Promise.all([f.scan(tag,at('09:23:45.678'),requestId),f.scan(tag,at('09:23:45.678'),requestId),f.scan(tag,at('09:23:45.678'))]);
      assert.deepEqual(wire(a),wire(b)); assert.deepEqual([a.action,c.action].sort(),['opened','unchanged']);
      assert.equal((await f.events()).length,1); const entry=await f.entry();
      assert.equal(instant(entry.actual_arrival),instant(at('09:23:45.678'))); assert.equal(entry.late_minutes,23); assert.equal(entry.late_status,'late_minor');
      const another=await f.makeTag(); await assert.rejects(f.scan(another,at('10:00:00'),requestId),e=>e.getStatus?.()===409&&e.getResponse().code==='IDEMPOTENCY_CONFLICT');
      await assert.rejects(f.scan(tag,at('10:00:00'),requestId,{...f.actor,userID:f.otherWorker}),status(409));
      await waitUntil(()=>pushes.filter(p=>p.tenant===f.tenant).length===1);
      assert.ok(pushes.find(p=>p.tenant===f.tenant).committed>=1);
    });
    await t.test('ten-minute boundary, immutable first anchor/arrival, ten-second closing duplicate, then deliberate fresh scan',async()=>{
      const f=await seed(),tag=await f.makeTag();
      await run(f,at('08:00:00'),()=>schedule.create(f.tenant,{userId:f.worker,date:'2026-10-08',shiftStart:'14:00',shiftEnd:'20:00'},f.boss));
      const first=await f.scan(tag,at('14:00:00')); const original=await f.entry();
      for(const when of ['14:01:00','14:10:00']) {const r=await f.scan(tag,at(when));assert.equal(r.action,'unchanged');assert.equal(r.firstNfcAt,first.firstNfcAt);}
      const closingKey=randomUUID(),closed=await f.scan(tag,at('14:10:00.001'),closingKey); assert.equal(closed.action,'closed');
      const duplicate=await f.scan(tag,at('14:10:10.001')); assert.equal(duplicate.reason,'closing_duplicate');
      const reopened=await f.scan(tag,at('14:10:10.002')); assert.equal(reopened.action,'opened');
      assert.deepEqual(await f.scan(tag,at('18:00:00'),closingKey),closed,'retry replays original close; never toggles the new event');
      assert.equal((await f.events()).length,2); assert.deepEqual(await f.entry(),original);
    });
    await t.test('manually opened shift first scan only confirms; manual new open takes precedence over prior NFC-close cooldown',async()=>{
      const f=await seed(),tag=await f.makeTag();
      await q("UPDATE tenants SET attendance_mode='manual' WHERE id=$1",[f.tenant]);
      const manual=await run(f,at('09:15:00'),()=>shifts.open(f.worker,f.tenant,f.actor)), entry=await f.entry();
      await q("UPDATE tenants SET attendance_mode='nfc' WHERE id=$1",[f.tenant]);
      const reportKey='reports-builder:'+f.tenant+':nfc';ttlCache.set(reportKey,{version:'before-confirmation'},60000);
      const confirmed=await f.scan(tag,at('12:00:00')); assert.equal(confirmed.action,'confirmed'); assert.equal(confirmed.shift.id,manual.id); assert.equal(confirmed.firstNfcAt,instant(at('12:00:00')));
      assert.deepEqual(await f.entry(),entry);assert.equal(ttlCache.get(reportKey),undefined);
      const warm={version:'after-confirmation'};ttlCache.set(reportKey,warm,60000);
      assert.equal((await f.scan(tag,at('12:10:00'))).action,'unchanged');assert.equal(ttlCache.get(reportKey),warm);
      await f.scan(tag,at('12:10:01'));
      await q("UPDATE tenants SET attendance_mode='manual' WHERE id=$1",[f.tenant]);
      const next=await run(f,at('12:10:02'),()=>shifts.open(f.worker,f.tenant,f.actor));
      await q("UPDATE tenants SET attendance_mode='nfc' WHERE id=$1",[f.tenant]);
      const duringCooldown=await f.scan(tag,at('12:10:03')); assert.equal(duringCooldown.action,'confirmed'); assert.equal(duringCooldown.shift.id,next.id);
      assert.deepEqual(await f.entry(),entry);
    });
    await t.test('distinct requests queued before a close remain duplicate even after over-ten-second employee-lock waits',async()=>{
      const f=await seed(),tag=await f.makeTag(); await f.scan(tag,at('09:00:00'));
      const blocker=await admin.connect(); await blocker.query('BEGIN'); await blocker.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[f.worker]);
      let first,second;
      try {
        first=f.scan(tag,[at('09:11:00'),at('09:11:00'),at('09:11:00')]); await waiting(1);
        second=f.scan(tag,[at('09:11:00'),at('09:11:20'),at('09:11:20')]); await waiting(2);
      } finally {await blocker.query('COMMIT');blocker.release();}
      const [closed,duplicate]=await Promise.all([first,second]);
      assert.equal(closed.action,'closed'); assert.equal(duplicate.reason,'closing_duplicate'); assert.equal(duplicate.serverAt,instant(at('09:11:20')));
      assert.equal((await f.events()).length,1); assert.equal(instant((await f.events())[0].closed_at),instant(at('09:11:00')));
    });
    await t.test('a delayed pre-close request cannot close the next NFC-opened event even after its ten-minute window',async()=>{
      const f=await seed(),tag=await f.makeTag();await f.scan(tag,at('09:00:00'));
      let release,entered;const gate=new Promise(r=>release=r),reached=new Promise(r=>entered=r);
      const old=f.scan(tag,[at('09:10:59'),at('09:30:00'),at('09:30:00')],randomUUID(),f.actor,async sql=>{if(sql.startsWith('SELECT id FROM users')){entered();await gate;}});
      await reached;
      assert.equal((await f.scan(tag,at('09:11:00'))).action,'closed');
      const fresh=await f.scan(tag,at('09:11:10.001'));assert.equal(fresh.action,'opened');
      release();const duplicate=await old;
      assert.equal(duplicate.action,'unchanged');assert.equal(duplicate.reason,'closing_duplicate');assert.equal(duplicate.shift.id,fresh.shift.id);
      const events=await f.events();assert.equal(events.length,2);assert.equal(events[1].closed_at,null);assert.equal(instant(events[1].first_nfc_at),fresh.firstNfcAt);
    });
    await t.test('a request entering the closing cooldown and delayed on a real PG lock cannot close the next NFC event or push; UUID replay is unchanged',async()=>{
      const f=await seed(),tag=await f.makeTag();await f.scan(tag,at('09:00:00'));
      assert.equal((await f.scan(tag,at('09:11:00'))).action,'closed');
      const originalEntry=await f.entry(),requestId=randomUUID(),blocker=await admin.connect();
      let delayed,fresh;
      await blocker.query('BEGIN');
      try {
        // The real request advisory lock is before the employee lock. C uses
        // another UUID and can open while B retains its ingress instant.
        await blocker.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`attendance-nfc:${f.tenant}:${requestId}`]);
        delayed=f.scan(tag,[at('09:11:01'),at('09:30:00'),at('09:30:00')],requestId);
        await waitUntil(async()=>(await one("SELECT COUNT(*)::int n FROM pg_stat_activity WHERE datname='autexa_oct8_test' AND wait_event_type='Lock' AND query LIKE 'SELECT pg_advisory_xact_lock%'")).n===1);
        fresh=await f.scan(tag,at('09:11:10.001'));assert.equal(fresh.action,'opened');
        await Promise.all(notifications.filter(p=>p.tenant===f.tenant).map(p=>p.pending));
        assert.equal(pushes.filter(p=>p.tenant===f.tenant).length,3);
      } finally {await blocker.query('COMMIT');blocker.release();}
      const duplicate=await delayed;
      assert.equal(duplicate.action,'unchanged');assert.equal(duplicate.reason,'closing_duplicate');
      assert.equal(duplicate.shift.id,fresh.shift.id);assert.equal(duplicate.firstNfcAt,fresh.firstNfcAt);
      assert.equal(duplicate.serverAt,instant(at('09:30:00')));
      assert.deepEqual(await f.scan(tag,at('09:45:00'),requestId),duplicate,'B replays the original no-op snapshot without closing the new shift');
      const events=await f.events();assert.equal(events.length,2);assert.equal(events[1].id,fresh.shift.id);
      assert.equal(events[1].closed_at,null);assert.equal(events[1].nfc_closed_at,null);assert.equal(instant(events[1].first_nfc_at),fresh.firstNfcAt);
      assert.deepEqual(await f.entry(),originalEntry);
      assert.equal((await one('SELECT COUNT(*)::int n FROM attendance_nfc_requests WHERE tenant_id=$1 AND request_id=$2',[f.tenant,requestId])).n,1);
      await Promise.all(notifications.filter(p=>p.tenant===f.tenant).map(p=>p.pending));
      assert.equal(notifications.filter(p=>p.tenant===f.tenant).length,3);assert.equal(pushes.filter(p=>p.tenant===f.tenant).length,3);
    });
    await t.test('calendar nonworking/manual marks survive NFC opening and closing without overwritten first arrival',async()=>{
      for(const mark of [{note:'Прогул'},{note:'Больничный'},{isDayOff:true},{lateStatus:'on_time'}]) {
        const f=await seed(),tag=await f.makeTag();
        await run(f,at('09:01:00'),()=>schedule.create(f.tenant,{userId:f.worker,date:'2026-10-08',...mark},f.boss));
        const original=await f.entry(); await f.scan(tag,at('12:00:00')); await f.scan(tag,at('12:11:00'));
        assert.deepEqual(await f.entry(),original);
      }
    });
    await t.test('self-service open and close require manual mode; NFC confirms the open shift in NFC mode',async()=>{
      const f=await seed(),tag=await f.makeTag();
      await assert.rejects(run(f,at('09:14:00'),()=>shifts.open(f.worker,f.tenant,f.actor)),status(403));
      await q("UPDATE tenants SET attendance_mode='manual' WHERE id=$1",[f.tenant]);
      await run(f,at('09:15:00'),()=>schedule.create(f.tenant,{userId:f.worker,date:'2026-10-08',lateStatus:'on_time'},f.boss));
      const opened=await run(f,at('09:15:00'),()=>shifts.open(f.worker,f.tenant,f.actor));
      await q("UPDATE tenants SET attendance_mode='nfc' WHERE id=$1",[f.tenant]);
      const confirmed=await f.scan(tag,at('09:16:00'));assert.equal(confirmed.action,'confirmed');assert.equal(confirmed.shift.id,opened.id);
      const events=await f.events(); assert.equal(events.length,1); assert.equal((await f.entry()).late_status,'on_time'); assert.equal((await f.entry()).is_manual_override,true);
      await assert.rejects(run(f,at('09:30:00'),()=>shifts.close(events[0].id,f.tenant,f.actor)),status(403));
      await q("UPDATE tenants SET attendance_mode='manual' WHERE id=$1",[f.tenant]);
      await run(f,at('09:30:00'),()=>shifts.close(events[0].id,f.tenant,f.actor));
      assert.ok((await f.events())[0].closed_at); assert.ok((await f.events()).filter(e=>!e.closed_at).length<=1);
    });
    await t.test('tenant-local midnight closes old event at exact next midnight and starts a fresh day; concurrent sweep is compatible',async()=>{
      const f=await seed({timezone:'Asia/Kolkata'}),tag=await f.makeTag(),oldKey=randomUUID();
      const old=await f.scan(tag,'2026-10-08T23:59:00+05:30',oldKey);
      await Promise.all([
        f.scan(tag,'2026-10-09T00:00:01+05:30'),
        run(f,'2026-10-09T00:00:01+05:30',()=>new ShiftAutoCloseService(pool).closeStaleShifts('manual')),
      ]);
      const events=await f.events(); assert.equal(events.length,2); assert.equal(instant(events[0].closed_at),'2026-10-08T18:30:00.000Z'); assert.equal(events[0].is_auto_closed,true); assert.equal(events[1].date,'2026-10-09'); assert.equal(events[1].closed_at,null);
      assert.deepEqual(await f.scan(tag,'2026-10-09T10:00:00+05:30',oldKey),old);
      const current=await run(f,'2026-10-09T10:00:00+05:30',()=>service.status(f.actor)); assert.equal(current.hasOpenShift,true);
    });
    await t.test('current membership, feature, employee state, tenant and tag revocation gate even exact POST retries',async()=>{
      const f=await seed(),foreign=await seed(),tag=await f.makeTag(),requestId=randomUUID(); await f.scan(tag,at('09:00:00'),requestId);
      await assert.rejects(foreign.scan(tag),status(403));
      await assert.rejects(f.scan(tag,at('09:00:00'),randomUUID(),{...f.boss,currentPointId:f.otherPoint}),status(403));
      await q('UPDATE user_points SET point_id=$1 WHERE user_id=$2',[f.otherPoint,f.worker]);
      await assert.rejects(f.scan(tag,at('09:30:00'),requestId),status(403));
      await q('UPDATE user_points SET point_id=$1 WHERE user_id=$2',[f.point,f.worker]);
      await q("UPDATE tenants SET shifts_enabled=false,attendance_mode='admin' WHERE id=$1",[f.tenant]); await assert.rejects(f.scan(tag,at('09:30:00'),requestId),status(403));
      assert.equal((await run(f,at('09:30:00'),()=>service.status(f.actor))).canScan,false);
      await q("UPDATE tenants SET shifts_enabled=true,attendance_mode='nfc' WHERE id=$1",[f.tenant]);
      await q('UPDATE users SET is_active=false WHERE id=$1',[f.worker]); await assert.rejects(f.scan(tag,at('09:30:00'),requestId),status(403));
      await q('UPDATE users SET is_active=true,dismissed_at=now() WHERE id=$1',[f.worker]); await assert.rejects(f.scan(tag,at('09:30:00'),requestId),status(403));
      await q('UPDATE users SET dismissed_at=NULL WHERE id=$1',[f.worker]);
      await run(f,at('09:30:00'),()=>service.revokeTag(f.boss,tag.id)); await assert.rejects(f.scan(tag,at('09:30:00'),requestId),status(403));
      await assert.rejects(run(f,at('09:30:00'),()=>service.activateTag(f.boss,tag.id,{token:tag.token})),status(409));
    });
    await t.test('revocation waiting behind scan serializes; committed action is readable historically, but POST replay is denied',async()=>{
      const f=await seed(),tag=await f.makeTag(),requestId=randomUUID();
      let release,entered; const gate=new Promise(r=>release=r),reached=new Promise(r=>entered=r);
      const scan=f.scan(tag,at('09:00:00'),requestId,f.actor,async sql=>{if(sql.startsWith('SELECT fingerprint,response')){entered();await gate;}});
      await reached; let revoked=false; const revoke=run(f,at('09:00:01'),()=>service.revokeTag(f.boss,tag.id)).then(()=>{revoked=true;});
      await delay(20); assert.equal(revoked,false); release(); const completed=await scan; await revoke;
      const historical=await run(f,at('10:00:00'),()=>service.result(f.actor,requestId)); assert.deepEqual(historical,{status:'completed',result:completed});
      await assert.rejects(f.scan(tag,at('10:00:00'),requestId),status(403));
      const count=(await f.events()).length; assert.deepEqual(await run(f,at('10:00:00'),()=>service.result(f.actor,randomUUID())),{status:'unknown'}); assert.equal((await f.events()).length,count);
      assert.deepEqual(await run(f,at('10:00:00'),()=>service.result({...f.actor,userID:f.otherWorker},requestId)),{status:'unknown'});
      assert.deepEqual(await run(f,at('10:00:00'),()=>service.result({...f.boss,currentPointId:f.otherPoint},requestId)),{status:'unknown'});
      const other=await seed(); assert.deepEqual(await run(other,at('10:00:00'),()=>service.result(other.actor,requestId)),{status:'unknown'});
      await q('UPDATE users SET is_active=false WHERE id=$1',[f.worker]); await assert.rejects(run(f,at('10:00:00'),()=>service.result(f.actor,requestId)),status(403));
    });
    await t.test('unknown GET while an original POST has not acquired its employee lock cannot mutate/reset it; point-bound UUID remains protected',async()=>{
      const f=await seed(),tag=await f.makeTag(),requestId=randomUUID();
      let entered,release;const reached=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
      const original=f.scan(tag,at('09:00:00'),requestId,f.actor,async sql=>{if(sql.startsWith('SELECT id FROM users')){entered();await gate;}});
      await reached;
      assert.deepEqual(await run(f,at('09:00:01'),()=>service.result(f.actor,requestId)),{status:'unknown'});
      assert.equal((await f.events()).length,0);release();const completed=await original;
      assert.deepEqual(await run(f,at('09:01:00'),()=>service.result(f.actor,requestId)),{status:'completed',result:completed});
      const otherTag=await f.makeTag(true,{...f.boss,currentPointId:f.otherPoint});
      await q('UPDATE user_points SET point_id=$1 WHERE user_id=$2',[f.otherPoint,f.worker]);
      const switched={...f.actor,currentPointId:f.otherPoint};
      assert.deepEqual(await run(f,at('09:01:00'),()=>service.result(switched,requestId)),{status:'unknown'});
      await assert.rejects(f.scan(otherTag,at('09:01:00'),requestId,switched),status(409));
      await assert.rejects(f.scan(otherTag,at('09:01:00'),randomUUID(),switched),status(409));
      assert.equal((await f.events()).length,1);
    });
    await t.test('a first point attributes nullable tag and request ledgers once; public tenant purge/remove retain the neighbor',async()=>{
      const neighbor=await seed(),neighborTag=await neighbor.makeTag(),neighborKey=randomUUID(); await neighbor.scan(neighborTag,at('09:00:00'),neighborKey);
      const f=await seed({point:false}),tag=await f.makeTag(),requestId=randomUUID(); await f.scan(tag,at('09:00:00'),requestId);
      const points=new PointsService(pool),point=await run(f,at('09:00:00'),()=>points.adminCreate(f.tenant,{name:'NFC fixture '+f.tenant}));
      assert.equal((await one('SELECT point_id FROM attendance_nfc_tags WHERE id=$1',[tag.id])).point_id,point.id);
      assert.equal((await one('SELECT point_id FROM attendance_nfc_requests WHERE request_id=$1',[requestId])).point_id,point.id);
      await run(f,at('09:00:00'),()=>points.adminCreate(f.tenant,{name:'Second'}));
      assert.equal((await run(f,at('10:00:00'),()=>service.result({...f.actor,currentPointId:point.id},requestId))).status,'completed');
      const tenantService=new TenantsService(pool,{},{});
      await tenantService.purgeTenantData(f.tenant);
      const another=await seed(),anotherTag=await another.makeTag(); await another.scan(anotherTag); await tenantService.remove(another.tenant);
      for(const id of [f.tenant,another.tenant]) for(const table of ['attendance_nfc_requests','attendance_nfc_tags']) assert.equal((await one(`SELECT COUNT(*)::int n FROM ${table} WHERE tenant_id=$1`,[id])).n,0);
      assert.equal((await run(neighbor,at('10:00:00'),()=>service.result(neighbor.actor,neighborKey))).status,'completed');
    });
  } finally {
    // Only random tenants created in this test's validated disposable fixture.
    const cleanup=new TenantsService(native,{},{});
    for(const id of tenants) await cleanup.remove(id).catch(error=>{if(error.getStatus?.()!==404) throw error;});
    await app.end(); await admin.end();
  }
});
