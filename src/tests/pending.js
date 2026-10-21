/**
 * Features the ORIGINAL site has that Vercel does not have yet.
 *
 * Every test here is `pending: true`: while Vercel shows "This page is coming soon." (or a 404),
 * the result is "Not Implemented", not Fail. The day the page is built, the same test starts
 * reporting Pass / Fail on its own. Make the checks stricter once you know what the new page
 * should show (see docs/ADDING-A-TEST.md).
 */
const MODULE = 'Not Yet Migrated';

/** [id, path, label, what the page must have once built] */
const PAGES = [
  ['PEND-001', '/records/budget-absorption', 'Records Update > Budget Absorption', 'table'],
  ['PEND-002', '/records/annual-procurement', 'Records Update > Annual Procurement', 'table'],
  ['PEND-003', '/records/risk-management', 'Records Update > Risk Management', 'table'],
  ['PEND-004', '/records/form-a1', 'Records Update > Form A1', 'table'],
  ['PEND-005', '/records/form-a2', 'Records Update > Form A2', 'table'],
  ['PEND-006', '/records/form-c', 'Records Update > Form C', 'table'],
  ['PEND-007', '/records/form-d', 'Records Update > Form D', 'table'],
  ['PEND-008', '/records/form-ip', 'Records Update > Form IP', 'table'],
  ['PEND-009', '/records/comments-update', 'Records Update > Comments Update', 'table'],
  ['PEND-010', '/settings/fund-sources', 'Settings > Fund Sources', 'table'],
  ['PEND-011', '/settings/classifications', 'Settings > Classifications', 'table'],
  ['PEND-012', '/settings/menus', 'Settings > Enable/Disable Menus', 'form'],
  ['PEND-013', '/settings/application', 'Settings > Application Settings', 'form'],
  ['PEND-014', '/accounts/activity-logs', 'Accounts > Activity Logs', 'table'],
];

const pages = PAGES.map(([id, path, label, must]) => ({
  id, module: MODULE, kind: 'Pending', role: 'admin', pending: true,
  title: `${label} is migrated`,
  steps: `Signed in as admin, open ${path}.`,
  expected: `The page is built (not "coming soon") and shows its ${must === 'table' ? 'records table' : 'settings form'} like the original site.`,
  async run(t) {
    await t.open(path);
    const has = must === 'table'
      ? await t.page.locator('table').count()
      : await t.page.locator('form, input, select, [role="switch"], [role="checkbox"]').count();
    t.check(has, `Page is built but shows no ${must}`);
    return t.pass(`Built; ${must} present`);
  },
}));

// The six Project Profile workflow steps after "Project Details" still say "coming soon".
const STEPS = ['Responsiveness to Dev Goals', 'Cost Components', 'GAD Responsiveness', 'Risk Management', 'Implementation Readiness Docs', 'Budget Absorption Capacity'];
const steps = STEPS.map((step, i) => ({
  id: `PEND-${String(20 + i).padStart(3, '0')}`, module: MODULE, kind: 'Pending', role: 'admin', pending: true,
  title: `Project Profile step "${step}" is migrated`,
  steps: `Open /projects/16420 and click the "${step}" step.`,
  expected: 'The step shows its content (not "coming soon").',
  async run(t) {
    await t.open('/projects/16420');
    await t.page.getByText(step, { exact: false }).first().click({ timeout: 10000 }).catch(() => t.fail(`No "${step}" step on the page`));
    await t.page.waitForTimeout(800);
    if (await t.has(/section is coming soon/i)) t.notImplemented(`"${step}" still says coming soon`);
    return t.pass(`"${step}" shows content`);
  },
}));

export default [
  ...pages,
  ...steps,
  {
    id: 'PEND-030', module: MODULE, kind: 'Pending', role: 'admin', pending: true,
    title: 'Agencies > Edit agency is migrated',
    steps: 'Open /accounts/agencies, open a row\'s menu and click Edit.',
    expected: 'An edit form opens (not the "Edit ... coming soon." message).',
    async run(t) {
      await t.open('/accounts/agencies');
      const menu = t.page.locator('table tbody tr').first().locator('button').last();
      await menu.click({ timeout: 10000 }).catch(() => t.fail('No row menu button in the agencies table'));
      await t.page.getByRole('button', { name: /^Edit$/ }).first().click({ timeout: 5000 }).catch(() => t.fail('No Edit item in the row menu'));
      if ((await t.app.toastText(t.page, 3000)).match(/coming soon/i)) t.notImplemented('Edit shows "coming soon"');
      t.check(await t.page.locator('[role="dialog"] input, form input').count(), 'Edit opened nothing');
      return t.pass('Edit form opens');
    },
  },
];
