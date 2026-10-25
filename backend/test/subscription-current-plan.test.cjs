const test = require('node:test');
const assert = require('node:assert/strict');
const { TenantsService } = require('../dist/tenants/tenants.service');
const { pricingFromPlanRow } = require('../dist/plans/plan-pricing-row');
const ts = require('typescript');
const fs = require('node:fs');
let method = TenantsService.prototype.getSubscription;
if (process.env.SUBSCRIPTION_BASELINE_SERVICE) {
  const source = ts.createSourceFile(
    'service.ts',
    fs.readFileSync(process.env.SUBSCRIPTION_BASELINE_SERVICE, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  let node;
  const visit = (n) => {
    if (ts.isMethodDeclaration(n) && n.name.getText(source) === 'getSubscription') node = n;
    ts.forEachChild(n, visit);
  };
  visit(source);
  const js = ts.transpileModule(`const service = {${node.getText(source)}};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText;
  method = Function('pricingFromPlanRow', `${js};return service.getSubscription;`)(pricingFromPlanRow);
}
const row = (active = false, code = 'pro') => ({
  id: 'assigned-id',
  name: 'PRO',
  monthly_price: '4990',
  code,
  included_employees: code ? 5 : null,
  extra_employee_monthly_price: code ? 500 : null,
  included_points: null,
  extra_point_monthly_price: null,
  features: ['assigned-feature'],
  max_users: 7,
  is_active: active,
  description: 'Индивидуальные условия',
  sort_order: 2,
  created_at: '2026-10-26',
  private_column: 'never-return',
});
async function subscription(plan, rate = '0') {
  const queries = [];
  const service = Object.create(TenantsService.prototype);
  service.pool = {
    query: async (sql, args) => {
      queries.push(sql);
      return {
        rows: sql.includes('FROM tenants')
          ? [
              {
                name: 'Сервис',
                monthly_price: rate,
                plan_id: plan?.id ?? null,
                is_active: true,
                max_users: 9,
                current_users: '2',
                subscription_end: null,
              },
            ]
          : sql.includes('WHERE is_active=true')
            ? [{ ...row(true), id: 'new-id' }]
            : plan
              ? [plan]
              : [],
      };
    },
  };
  service.subscriptionUsage = async () => ({ employees: 2, activePoints: 1, billablePoints: 1 });
  return { result: await method.call(service, 'tenant'), queries };
}
test('assigned inactive plan is authoritative by ID, whitelisted and distinct from active same-name catalogue', async () => {
  const { result, queries } = await subscription(row(false));
  assert.equal(result.currentPlan?.id, 'assigned-id');
  assert.equal(result.currentPlan.isActive, false);
  assert.equal(result.currentPlan.pricing.includedEmployees, 5);
  assert.equal(result.monthlyPrice, 0);
  assert.equal(result.planPrice, 0);
  assert.equal(result.maxUsers, 9);
  assert.deepEqual(result.features, ['assigned-feature']);
  assert.equal(result.currentPlan.private_column, undefined);
  assert.equal(result.plans[0].id, 'new-id');
  assert.ok(queries.find((q) => q.includes('FROM plans WHERE id=$1')).includes('is_active'));
});
test('active noncomposable custom stays active; missing assignment remains null; assigned tenant rate preserved', async () => {
  const { result } = await subscription(row(true, null), '1234.50');
  assert.equal(result.currentPlan?.isActive, true);
  assert.equal(result.currentPlan.pricing, null);
  assert.equal(result.monthlyPrice, 1234.5);
  assert.equal(result.currentPlan.monthlyPrice, 4990);
  assert.equal((await subscription(null)).result.currentPlan, null);
});
