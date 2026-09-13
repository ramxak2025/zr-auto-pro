#!/usr/bin/env node
/**
 * Добавить обработанную TestFlight-сборку во ВНЕШНЮЮ группу тестировщиков через
 * App Store Connect API (у `eas submit --groups` есть только внутренние группы).
 *
 * Ключ и идентификаторы — те же, что в mobile/eas.json → submit.production.ios
 * (ascApiKeyPath / ascApiKeyId / ascApiKeyIssuerId / ascAppId). Ключ читается
 * ТОЛЬКО с диска владельца и никуда, кроме api.appstoreconnect.apple.com, не
 * уходит; в вывод не попадает.
 *
 * Использование (из корня репо):
 *   node scripts/testflight-external-group.cjs groups
 *   node scripts/testflight-external-group.cjs builds 3.7.2 87
 *   node scripts/testflight-external-group.cjs add 3.7.2 87 "Autexa beta"
 *   node scripts/testflight-external-group.cjs review 3.7.2 87   # статус / отправка на Beta App Review
 *
 * `add` ждёт, пока сборка станет VALID (обработана Apple, обычно 5–30 минут
 * после загрузки), и добавляет её в группу. Добавление во внешнюю группу
 * САМО ПО СЕБЕ на Beta App Review не отправляет (проверено 2026-09-13:
 * externalBuildState остаётся READY_FOR_BETA_SUBMISSION) — после `add`
 * обязательно `review`: он создаёт betaAppReviewSubmission, и сборка уходит
 * в WAITING_FOR_REVIEW. Для уже отправленной сборки `review` только печатает
 * состояние.
 *
 * Зависимость `jsonwebtoken` берётся из backend/node_modules (ES256 для JWT
 * App Store Connect). Node ≥ 18 (глобальный fetch).
 */
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const easJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'mobile', 'eas.json'), 'utf8'));
const ios = easJson.submit.production.ios;
const KEY_ID = ios.ascApiKeyId;
const ISSUER = ios.ascApiKeyIssuerId;
const APP_ID = ios.ascAppId;
const KEY_PATH = ios.ascApiKeyPath;

const jwt = require(path.join(repoRoot, 'backend', 'node_modules', 'jsonwebtoken'));

function token() {
  const key = fs.readFileSync(KEY_PATH, 'utf8');
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign({ iss: ISSUER, iat: now, exp: now + 600, aud: 'appstoreconnect-v1' }, key, {
    algorithm: 'ES256',
    header: { alg: 'ES256', kid: KEY_ID, typ: 'JWT' },
  });
}

async function api(method, route, body) {
  const res = await fetch('https://api.appstoreconnect.apple.com' + route, {
    method,
    headers: { Authorization: 'Bearer ' + token(), 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${route} → ${res.status} ${text.slice(0, 600)}`);
  return text ? JSON.parse(text) : null;
}

async function groups() {
  const g = await api('GET', `/v1/betaGroups?filter[app]=${APP_ID}&limit=50`);
  return g.data.map((x) => ({
    id: x.id,
    name: x.attributes.name,
    internal: x.attributes.isInternalGroup,
    publicLink: x.attributes.publicLink,
  }));
}

async function builds(version, buildNumber) {
  const b = await api(
    'GET',
    `/v1/builds?filter[app]=${APP_ID}&filter[version]=${buildNumber}&filter[preReleaseVersion.version]=${version}&sort=-uploadedDate&limit=10`,
  );
  return b.data.map((x) => ({
    id: x.id,
    build: x.attributes.version,
    state: x.attributes.processingState,
    uploaded: x.attributes.uploadedDate,
    expired: x.attributes.expired,
  }));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForValidBuild(version, buildNumber, maxMinutes = 45) {
  const deadline = Date.now() + maxMinutes * 60_000;
  for (;;) {
    const bs = await builds(version, buildNumber);
    const valid = bs.find((x) => x.state === 'VALID' && !x.expired);
    if (valid) return valid;
    if (Date.now() > deadline)
      throw new Error(`сборка ${version} (${buildNumber}) не стала VALID за ${maxMinutes} мин: ${JSON.stringify(bs)}`);
    console.log(`ждём обработку Apple… (${bs.map((x) => x.state).join(', ') || 'ещё не видна'})`);
    await sleep(60_000);
  }
}

(async () => {
  const [cmd, version, buildNumber, groupName] = process.argv.slice(2);
  if (cmd === 'groups') {
    console.log(JSON.stringify(await groups(), null, 2));
    return;
  }
  if (cmd === 'builds') {
    console.log(JSON.stringify(await builds(version, buildNumber), null, 2));
    return;
  }
  if (cmd === 'add') {
    const gs = await groups();
    const group = gs.find((g) => g.name === groupName);
    if (!group) throw new Error(`группа «${groupName}» не найдена; есть: ${gs.map((g) => g.name).join(', ')}`);
    const build = await waitForValidBuild(version, buildNumber);
    await api('POST', `/v1/betaGroups/${group.id}/relationships/builds`, { data: [{ type: 'builds', id: build.id }] });
    console.log(
      `сборка ${version} (${buildNumber}) добавлена в группу «${group.name}»${group.internal ? '' : ' (внешняя)'}`,
    );
    const review = await api('GET', `/v1/builds/${build.id}/betaAppReviewSubmission`).catch((e) => ({
      error: e.message,
    }));
    console.log('Beta App Review:', JSON.stringify(review && review.data ? review.data.attributes : review));
    return;
  }
  if (cmd === 'review') {
    // Состояние внешнего тестирования и, если сборка ещё не отправлена, —
    // отправка на Beta App Review. Добавление во внешнюю группу не всегда
    // создаёт submission само; для первой сборки версии он обязателен.
    const build = await waitForValidBuild(version, buildNumber);
    const detail = await api('GET', `/v1/builds/${build.id}/buildBetaDetail`);
    const state = detail.data.attributes.externalBuildState;
    console.log('externalBuildState:', state);
    if (state === 'READY_FOR_BETA_SUBMISSION') {
      const sub = await api('POST', '/v1/betaAppReviewSubmissions', {
        data: {
          type: 'betaAppReviewSubmissions',
          relationships: { build: { data: { type: 'builds', id: build.id } } },
        },
      });
      console.log('отправлено на Beta App Review:', sub.data.attributes.betaReviewState);
    }
    return;
  }
  console.log(
    'usage: groups | builds <version> <buildNumber> | add <version> <buildNumber> "<group name>" | review <version> <buildNumber>',
  );
})().catch((e) => {
  console.error('ОШИБКА:', e.message);
  process.exit(1);
});
