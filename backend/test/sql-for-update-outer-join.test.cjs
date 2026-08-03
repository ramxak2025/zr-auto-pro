const assert = require('node:assert/strict');
const { readdirSync, readFileSync, statSync } = require('node:fs');
const { join, relative, sep } = require('node:path');
const test = require('node:test');

/**
 * СТРАЖ КЛАССА БАГОВ «FOR UPDATE cannot be applied to the nullable side of an
 * outer join» (Sentry AUTEXA-BACKEND-Q, SalaryService.decidePayout).
 *
 * PostgreSQL отвергает `SELECT … LEFT JOIN … FOR UPDATE` в РАНТАЙМЕ, а не при
 * подготовке: запрос спокойно живёт в коде и падает 500 только когда до него
 * дошёл конкретный продуктовый путь (принять/отклонить выплату). Ни typecheck,
 * ни lint, ни code review такое не ловят — поэтому статический страж.
 *
 * ПРАВИЛО: если в запросе есть LEFT / RIGHT / FULL JOIN, то `FOR UPDATE`
 * обязан быть адресным — `FOR UPDATE OF <alias>` с алиасом обязательной
 * (не-nullable) стороны. Это и корректно по Postgres, и правильнее по смыслу:
 * лочим строку, которую собираемся менять, а не всё, что приджойнили.
 *
 * Разбор — простой SQL-строк из исходников:
 *   1. вырезаем комментарии, собираем строковые литералы (шаблонные и обычные);
 *   2. для каждого вхождения FOR UPDATE берём ЕГО скоуп — текст ближайшей
 *      объемлющей пары скобок (то есть подзапроса, к которому FOR UPDATE
 *      реально относится), а не весь литерал;
 *   3. из скоупа вычищаем вложенные скобки, чтобы LEFT JOIN во ВЛОЖЕННОМ
 *      подзапросе не считался за outer join верхнего уровня;
 *   4. если в оставшемся тексте есть outer join, а у FOR UPDATE нет `OF` —
 *      это тот самый баг.
 *
 * Известное ограничение: SQL, склеенный из нескольких литералов через `+`,
 * страж видит по кускам. В backend/src такого сейчас нет (все FOR UPDATE живут
 * внутри одного литерала); если появится — этот тест его просто не покроет,
 * а не соврёт.
 */

const SRC_ROOT = join(__dirname, '..', 'src');

const collectTsFiles = (dir, acc = []) => {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) collectTsFiles(full, acc);
    else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) acc.push(full);
  }
  return acc;
};

/** Читает обычный литерал в кавычках, начиная с открывающей кавычки. */
const readQuoted = (src, start, quote) => {
  let i = start + 1;
  while (i < src.length) {
    const c = src[i];
    if (c === '\\') {
      i += 2;
      continue;
    }
    if (c === quote || c === '\n') return { end: i + 1, text: src.slice(start + 1, i) };
    i++;
  }
  return { end: src.length, text: src.slice(start + 1) };
};

/**
 * Читает шаблонный литерал. `${…}` заменяется пробелом: интерполяция — это
 * выражение, а не SQL, и её содержимое не должно влиять на разбор.
 */
const readTemplate = (src, start) => {
  let i = start + 1;
  let text = '';
  while (i < src.length) {
    const c = src[i];
    if (c === '\\') {
      text += ' ';
      i += 2;
      continue;
    }
    if (c === '`') return { end: i + 1, text };
    if (c === '$' && src[i + 1] === '{') {
      // Пропускаем выражение целиком, считая вложенные фигурные скобки и
      // не спотыкаясь о кавычки/бэктики внутри него.
      let depth = 1;
      i += 2;
      while (i < src.length && depth > 0) {
        const d = src[i];
        if (d === '{') depth++;
        else if (d === '}') depth--;
        else if (d === '`') {
          i = readTemplate(src, i).end;
          continue;
        } else if (d === '"' || d === "'") {
          i = readQuoted(src, i, d).end;
          continue;
        }
        i++;
      }
      text += ' ';
      continue;
    }
    text += c;
    i++;
  }
  return { end: src.length, text };
};

/** Все строковые литералы файла, вне комментариев, с офсетом начала. */
const extractLiterals = (src) => {
  const literals = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (c === '`') {
      const r = readTemplate(src, i);
      literals.push({ text: r.text, offset: i });
      i = r.end;
      continue;
    }
    if (c === '"' || c === "'") {
      const r = readQuoted(src, i, c);
      literals.push({ text: r.text, offset: i });
      i = r.end;
      continue;
    }
    i++;
  }
  return literals;
};

/** Текст ближайшего объемлющего подзапроса вокруг позиции. */
const enclosingScope = (sql, at) => {
  let depth = 0;
  let start = 0;
  for (let k = at - 1; k >= 0; k--) {
    const c = sql[k];
    if (c === ')') depth++;
    else if (c === '(') {
      if (depth === 0) {
        start = k + 1;
        break;
      }
      depth--;
    }
  }
  depth = 0;
  let end = sql.length;
  for (let k = at; k < sql.length; k++) {
    const c = sql[k];
    if (c === '(') depth++;
    else if (c === ')') {
      if (depth === 0) {
        end = k;
        break;
      }
      depth--;
    }
  }
  return sql.slice(start, end);
};

/** Убирает вложенные скобочные группы — остаётся только текущий уровень запроса. */
const stripNestedParens = (text) => {
  let out = text;
  for (;;) {
    const next = out.replace(/\([^()]*\)/g, ' ');
    if (next === out) return out;
    out = next;
  }
};

const FOR_UPDATE_RE = /\bFOR\s+UPDATE\b/gi;
const FOR_UPDATE_OF_RE = /\bFOR\s+UPDATE\s+OF\b/i;
const OUTER_JOIN_RE = /\b(LEFT|RIGHT|FULL)\s+(OUTER\s+)?JOIN\b/i;
// Локирующий запрос — только SELECT. `FOR UPDATE` в комментарии внутри SQL или
// в тексте-описании нас не касается; отсекаем по наличию SELECT … FROM в скоупе.
const IS_SELECT_RE = /\bSELECT\b[\s\S]*\bFROM\b/i;

const findViolations = () => {
  const violations = [];
  for (const file of collectTsFiles(SRC_ROOT)) {
    const source = readFileSync(file, 'utf8');
    for (const literal of extractLiterals(source)) {
      const { text } = literal;
      if (!/\bFOR\s+UPDATE\b/i.test(text)) continue;
      FOR_UPDATE_RE.lastIndex = 0;
      let m;
      while ((m = FOR_UPDATE_RE.exec(text)) !== null) {
        const scope = enclosingScope(text, m.index);
        if (!IS_SELECT_RE.test(scope)) continue;
        const sameLevel = stripNestedParens(scope);
        if (!OUTER_JOIN_RE.test(sameLevel)) continue;
        if (FOR_UPDATE_OF_RE.test(text.slice(m.index))) continue;
        const line = source.slice(0, literal.offset).split('\n').length;
        violations.push({
          file: relative(join(__dirname, '..'), file).split(sep).join('/'),
          line,
          join: sameLevel.match(OUTER_JOIN_RE)[0].replace(/\s+/g, ' '),
        });
      }
    }
  }
  return violations;
};

test('нет ни одного FOR UPDATE без OF в запросе с LEFT/RIGHT/FULL JOIN', () => {
  const violations = findViolations();
  const report = violations.map((v) => `  ${v.file}:${v.line} — «${v.join}» + FOR UPDATE без OF <alias>`).join('\n');
  assert.equal(
    violations.length,
    0,
    `Postgres упадёт в рантайме: «FOR UPDATE cannot be applied to the nullable side of an outer join».\n` +
      `Исправление — адресный лок: FOR UPDATE OF <алиас обязательной стороны>.\n${report}`,
  );
});

// ── Самопроверка стража: он обязан ловить баг и не шуметь на корректном коде ──

const scanText = (sql) => {
  FOR_UPDATE_RE.lastIndex = 0;
  let m;
  let hits = 0;
  while ((m = FOR_UPDATE_RE.exec(sql)) !== null) {
    const scope = enclosingScope(sql, m.index);
    if (!IS_SELECT_RE.test(scope)) continue;
    if (!OUTER_JOIN_RE.test(stripNestedParens(scope))) continue;
    if (FOR_UPDATE_OF_RE.test(sql.slice(m.index))) continue;
    hits++;
  }
  return hits;
};

test('страж ловит ровно тот запрос, который падал в проде (decidePayout)', () => {
  const broken = `SELECT p.*, u.full_name AS employee_name
       FROM salary_payouts p
       LEFT JOIN users u ON u.id = p.employee_id
      WHERE p.id = $1 AND p.tenant_id = $2
      FOR UPDATE`;
  assert.equal(scanText(broken), 1);
});

test('адресный FOR UPDATE OF p при LEFT JOIN — не нарушение', () => {
  const fixed = `SELECT p.*, u.full_name AS employee_name
       FROM salary_payouts p
       LEFT JOIN users u ON u.id = p.employee_id
      WHERE p.id = $1
      FOR UPDATE OF p`;
  assert.equal(scanText(fixed), 0);
});

test('FOR UPDATE без джойнов и с INNER JOIN — не нарушение', () => {
  assert.equal(scanText('SELECT * FROM checks WHERE id=$1 FOR UPDATE'), 0);
  assert.equal(scanText('SELECT a.id FROM a JOIN b ON b.id=a.b_id WHERE a.id=$1 FOR UPDATE'), 0);
});

test('LEFT JOIN во ВЛОЖЕННОМ подзапросе не приписывается внешнему FOR UPDATE', () => {
  const ok = `SELECT id FROM jobs
      WHERE tenant_id IN (SELECT t.id FROM tenants t LEFT JOIN plans p ON p.id = t.plan_id)
      FOR UPDATE`;
  assert.equal(scanText(ok), 0);
});

test('LEFT JOIN внутри самого подзапроса с FOR UPDATE SKIP LOCKED — нарушение', () => {
  const broken = `UPDATE jobs SET status='x' WHERE id IN (
        SELECT j.id FROM jobs j LEFT JOIN users u ON u.id = j.user_id
        WHERE j.status='pending' ORDER BY j.created_at LIMIT 10 FOR UPDATE SKIP LOCKED
      ) RETURNING *`;
  assert.equal(scanText(broken), 1);
});
