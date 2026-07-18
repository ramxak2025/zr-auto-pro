const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

const backendRoot = join(__dirname, '..');
const readSource = (relativePath) => readFileSync(join(backendRoot, relativePath), 'utf8');

test('RateLimitGuard is registered exactly once as a global guard', () => {
  const mainSource = readSource('src/main.ts');
  const globalRegistrations = mainSource.match(
    /app\.useGlobalGuards\(\s*new RateLimitGuard\(\)\s*\)/g,
  );

  assert.equal(globalRegistrations?.length ?? 0, 1);
});

test('auth routes do not reapply the global RateLimitGuard', () => {
  const authControllerSource = readSource('src/auth/auth.controller.ts');

  assert.doesNotMatch(
    authControllerSource,
    /import\s+\{\s*RateLimitGuard\s*\}\s+from\s+['"]\.\.\/common\/guards\/rate-limit\.guard['"]/,
  );
  assert.doesNotMatch(authControllerSource, /@UseGuards\([^)]*\bRateLimitGuard\b[^)]*\)/);
});
