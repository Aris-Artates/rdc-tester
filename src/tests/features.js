/**
 * Completed features: how they behave, and whether their calculations ("logic") are right.
 * Logic tests recompute a figure from the rows on screen and compare it with what the app shows.
 */
import fs from 'node:fs';
import { readTable, num, showingEntries, toastText } from '../app.js';
import { firstTable, col, qaName } from './_helpers.js';

const close = (a, b, tol = 0.011) => a != null && b != null && Math.abs(a - b) <= tol;

// ---------------------------------------------------------------- Monitoring > Review Status
const reviewStatus = [
  {
    id: 'MON-001', module: 'Monitoring', kind: 'Logic', role: 'admin',
    title: 'Review Status: PAGE TOTAL equals the sum of the rows shown',
    steps: 'Open /monitoring. Add up each number column of the visible agency rows.',
    expected: 'Every PAGE TOTAL cell equals the sum of its column.',
    async run(t) {
      await t.open('/monitoring');
      const { rows, foot } = await firstTable(t);
      const body = rows.filter(r => r.length >= 20);
      t.check(body.length, 'No agency rows in the table');
      const pageTotal = foot.find(r => /PAGE TOTAL/i.test(r[0]));
      t.check(pageTotal, 'No PAGE TOTAL row');
      // Footer: [label(colSpan 4), ...number columns]; body: [No., Agency, star, Sector, ...number columns].
      const bad = [];
      for (let i = 1; i < pageTotal.length; i++) {
        const shown = num(pageTotal[i]);
        if (shown == null) continue;
        const sum = body.reduce((s, r) => s + (num(r[i + 3]) ?? 0), 0);
        if (!close(sum, shown, 0.5)) bad.push(`column ${i + 4}: rows add up to ${sum}, PAGE TOTAL shows ${pageTotal[i]}`);
      }
      t.check(!bad.length, bad.join(' | '));
      return t.pass(`${body.length} rows; every PAGE TOTAL cell matches`);
    },
  },
  {
    id: 'MON-002', module: 'Monitoring', kind: 'Logic', role: 'admin',
    title: 'Review Status: "Projects Sent to RDC" percentage is right',
    steps: 'Open /monitoring and read "Projects Sent to RDC: a/b (p%)".',
    expected: 'p = a / b x 100, rounded to 2 decimals; a and b match the GRAND TOTAL row.',
    async run(t) {
      await t.open('/monitoring');
      const text = (await t.page.locator('body').innerText()).replace(/,/g, '');
      const m = text.match(/Projects Sent to RDC:\s*(\d+)\s*\/\s*(\d+)\s*\(\s*([\d.]+)%\)/);
      t.check(m, 'No "Projects Sent to RDC: a/b (p%)" line');
      const [a, b, p] = [+m[1], +m[2], +m[3]];
      const want = b ? +(a / b * 100).toFixed(2) : 0;
      t.check(close(p, want), `Shows ${p}%, ${a}/${b} is ${want}%`);
      return t.pass(`${a}/${b} = ${p}%`);
    },
  },
  {
    id: 'MON-003', module: 'Monitoring', kind: 'Functional', role: 'admin',
    title: 'Review Status: search filters the agencies',
    steps: 'Open /monitoring, type a word that matches nothing in Search.',
    expected: '"No agencies match your search." is shown.',
    async run(t) {
      await t.open('/monitoring');
      await t.page.getByLabel('Search:').fill('zzqa-no-match');
      await t.see('No agencies match your search.');
      return t.pass('Empty-search message shown');
    },
  },
  {
    id: 'MON-004', module: 'Monitoring', kind: 'Logic', role: 'admin',
    title: 'Monitoring tables: entries-per-page and "Showing X to Y of N" agree',
    steps: 'On Review Status, Deficiency Status and IR Docs Status, set 10 entries per page and compare the rows with the "Showing" line.',
    expected: 'Rows on the page = Y - X + 1, and never more than 10.',
    async run(t) {
      const notes = [];
      for (const path of ['/monitoring', '/monitoring/deficiency', '/monitoring/ir-docs']) {
        await t.open(path);
        const sel = t.page.locator('select').filter({ has: t.page.locator('option', { hasText: /^10$/ }) }).first();
        if (await sel.count()) { await sel.selectOption('10'); await t.page.waitForTimeout(500); }
        const s = await showingEntries(t.page);
        t.check(s, `${path}: no "Showing X to Y of N entries" line`);
        const { rows } = await firstTable(t);
        const data = rows.filter(r => r.length > 3).length;
        t.check(data === s.to - s.from + 1, `${path}: ${data} rows on the page but "Showing ${s.from} to ${s.to}"`);
        t.check(data <= 10, `${path}: ${data} rows with 10 entries per page`);
        notes.push(`${path}: ${s.from}-${s.to} of ${s.of}`);
      }
      return t.pass(notes.join('; '));
    },
  },
];

// ---------------------------------------------------------------- ACO NEP GAA Monitor
async function acoTable(t, tab = 'All View') {
  await t.open('/monitoring/aco-nep-gaa');
  const tabs = t.page.locator('[aria-label="Budget monitor views"]');
  await tabs.getByRole('tab', { name: tab }).click({ timeout: 10000 }).catch(() => t.fail(`No "${tab}" tab`));
  await t.page.waitForTimeout(600);
  const table = t.page.locator('[role="tabpanel"][data-state="active"] table').first();
  t.check(await table.count(), `No table under "${tab}"`);
  const data = await readTable(table);
  // Project rows have every column; agency and tier rows are a single wide cell.
  data.projects = data.rows.filter(r => r.length >= data.head.length - 1 && r.length > 3);
  return data;
}

const aco = [
  {
    id: 'ACO-001', module: 'ACO NEP GAA Monitor', kind: 'Functional', role: 'admin',
    title: 'ACO NEP GAA Monitor shows its six views',
    steps: 'Open /monitoring/aco-nep-gaa.',
    expected: 'Tabs: All View (first), Inclusion in ACO, Inclusion in NEP, Inclusion in GAA, Ways Forward, Excel-Style View.',
    async run(t) {
      await t.open('/monitoring/aco-nep-gaa');
      const names = (await t.page.locator('[aria-label="Budget monitor views"] [role="tab"]').allInnerTexts()).map(s => s.trim());
      const want = ['All View', 'Inclusion in ACO', 'Inclusion in NEP', 'Inclusion in GAA', 'Ways Forward', 'Excel-Style View'];
      const missing = want.filter(w => !names.some(n => n.toLowerCase().includes(w.toLowerCase())));
      t.check(!missing.length, 'Missing tabs: ' + missing.join(', ') + '. Found: ' + names.join(', '));
      t.check(/all view/i.test(names[0] || ''), 'First tab is "' + names[0] + '", expected All View');
      return t.pass('Tabs: ' + names.join(', '));
    },
  },
  {
    id: 'ACO-002', module: 'ACO NEP GAA Monitor', kind: 'Logic', role: 'admin',
    title: 'ACO NEP GAA: TOTAL row equals the sum of the project rows',
    steps: 'Open the monitor (All View). Add up Endorsed cost, ACO, NEP and GAA budgets of the project rows on the page.',
    expected: 'Each TOTAL amount equals its column sum ("Pending" counts as 0).',
    async run(t) {
      const { head, projects, foot } = await acoTable(t);
      t.check(projects.length, 'No project rows');
      const total = foot[0];
      t.check(total && /TOTAL/i.test(total[0]), 'No TOTAL row');
      const cols = { Endorsed: col(head, 'Endorsed by RDC'), 'ACO budget': col(head, 'Proposed Budget'), 'GAA budget': col(head, 'Budget in GAA') };
      // The second "Proposed Budget (PhP)" column is the NEP one.
      cols['NEP budget'] = head.findIndex((h, i) => i > cols['ACO budget'] && /Proposed Budget/i.test(h));
      const bad = [], ok = [];
      for (const [label, i] of Object.entries(cols)) {
        if (i < 0) { bad.push(`no "${label}" column`); continue; }
        const sum = projects.reduce((s, r) => s + (num(r[i]) ?? 0), 0);
        const shown = num(total[i]);
        if (close(sum, shown, 0.02)) ok.push(`${label} ${total[i]}`); else bad.push(`${label}: rows add up to ${sum.toFixed(2)}, TOTAL shows ${total[i]}`);
      }
      t.check(!bad.length, bad.join(' | '));
      return t.pass(`${projects.length} rows; ` + ok.join(', '));
    },
  },
  {
    id: 'ACO-003', module: 'ACO NEP GAA Monitor', kind: 'Logic', role: 'admin',
    title: 'ACO NEP GAA: each row\'s % inclusion = stage budget / endorsed cost',
    steps: 'For every project row, divide the ACO, NEP and GAA budgets by the endorsed cost.',
    expected: '% Inclusion = budget / endorsed x 100 (2 decimals); "Pending" when the budget is not encoded.',
    async run(t) {
      const { head, projects } = await acoTable(t);
      const endorsed = col(head, 'Endorsed by RDC');
      const pct = head.map((h, i) => (/% Inclusion/i.test(h) ? i : -1)).filter(i => i >= 0);
      t.check(endorsed >= 0 && pct.length === 3, `Columns not found (endorsed ${endorsed}, % columns ${pct.length})`);
      const bad = [];
      let checked = 0;
      for (const r of projects) {
        const e = num(r[endorsed]);
        for (const p of pct) {
          const amount = num(r[p - 1]);
          if (/pending/i.test(r[p])) { if (amount != null && e) bad.push(`"${r[col(head, 'Programs')]?.slice(0, 40)}": % is Pending but budget is ${r[p - 1]}`); continue; }
          if (!e || amount == null) continue;
          checked++;
          const want = +(amount / e * 100).toFixed(2);
          if (!close(num(r[p]), want)) bad.push(`"${r[col(head, 'Programs')]?.slice(0, 40)}": shows ${r[p]}, ${amount}/${e} = ${want}%`);
        }
      }
      t.check(checked, 'No row had both a budget and an endorsed cost to check');
      t.check(!bad.length, bad.slice(0, 5).join(' | ') + (bad.length > 5 ? ` (+${bad.length - 5} more)` : ''));
      return t.pass(`${checked} percentages checked`);
    },
  },
  {
    id: 'ACO-004', module: 'ACO NEP GAA Monitor', kind: 'Logic', role: 'admin',
    title: 'ACO NEP GAA: Download Excel gives a workbook with live formulas',
    steps: 'Click "Download Excel" and open the file.',
    expected: 'An .xlsx downloads; it has project rows and its totals are formulas (not typed numbers).',
    async run(t) {
      await t.open('/monitoring/aco-nep-gaa');
      const btn = t.page.getByRole('button', { name: /Download Excel/ });
      t.check(await btn.count(), 'No "Download Excel" button');
      await btn.waitFor({ state: 'visible' });
      const [dl] = await Promise.all([t.page.waitForEvent('download', { timeout: 20000 }), btn.click()]).catch(() => [null]);
      t.check(dl, 'Clicking "Download Excel" downloaded nothing');
      const file = await dl.path();
      const XLSX = await import('xlsx');
      const wb = XLSX.read(fs.readFileSync(file), { cellFormula: true });
      let formulas = 0, cells = 0;
      for (const name of wb.SheetNames) for (const [k, c] of Object.entries(wb.Sheets[name])) if (!k.startsWith('!')) { cells++; if (c.f) formulas++; }
      t.check(/\.xlsx$/i.test(dl.suggestedFilename()), 'Downloaded file is not .xlsx: ' + dl.suggestedFilename());
      t.check(formulas > 0, `Workbook has ${cells} cells but no formulas`);
      return t.pass(`${dl.suggestedFilename()}: ${wb.SheetNames.length} sheet(s), ${formulas} formulas`);
    },
  },
  {
    id: 'ACO-005', module: 'ACO NEP GAA Monitor', kind: 'Functional', role: 'admin',
    title: 'ACO NEP GAA: search with no match shows the empty message',
    steps: 'Type a word that matches nothing in "Search PPA".',
    expected: '"No projects match your filters."',
    async run(t) {
      await t.open('/monitoring/aco-nep-gaa');
      await t.page.getByLabel('Search PPA').or(t.page.getByPlaceholder(/Search PPA/i)).first().fill('zzqa-no-match');
      await t.see('No projects match your filters.');
      return t.pass('Empty message shown');
    },
  },
];

// ---------------------------------------------------------------- Settings (real data)
/** Add a record through an "Add New X" dialog, then delete it again from its row menu. */
async function addAndDelete(t, { path, addLabel, placeholder, savedToast, deletedToast }) {
  if (!t.config.allowWrite) t.blocked('Write tests are off (ALLOW_WRITE_TESTS=false in .env)');
  await t.open(path);
  const name = qaName(addLabel.replace('Add New ', ''));
  await t.page.getByRole('button', { name: addLabel }).click();
  await t.page.getByPlaceholder(placeholder).fill(name);
  await t.page.getByRole('button', { name: /^Save$/ }).click();
  const saved = await toastText(t.page);
  if (savedToast) t.check(savedToast.test(saved), `After Save the message was "${saved || '(none)'}"`);
  await t.page.getByLabel('Search:').fill(name).catch(() => {});
  const row = t.page.locator('table tbody tr', { hasText: name }).first();
  await row.waitFor({ timeout: 10000 }).catch(() => t.fail(`"${name}" not in the list after Save`));
  // Delete (the app asks a native confirm(), accepted here).
  t.page.once('dialog', d => d.accept().catch(() => {}));
  await row.getByRole('button', { name: /Action/ }).click();
  await t.page.getByRole('button', { name: /^Delete$/ }).click();
  const gone = await toastText(t.page);
  await row.waitFor({ state: 'detached', timeout: 10000 }).catch(() => t.fail(`"${name}" still listed after Delete (message: "${gone}")`));
  t.check(deletedToast.test(gone), `Record deleted, but the message says "${gone || '(none)'}"`);
  return t.pass(`Added and deleted "${name}"; messages: "${saved}", "${gone}"`);
}

const settings = [
  {
    id: 'SET-001', module: 'Settings', kind: 'Functional', role: 'admin',
    title: 'Location: all four location kinds list records',
    steps: 'Open /settings/location and switch through Province, Congressional District, City/Municipality, Barangay.',
    expected: 'Each kind shows a table with rows.',
    async run(t) {
      await t.open('/settings/location');
      const notes = [];
      for (const kind of ['Province', 'Congressional District', 'City/Municipality', 'Barangay']) {
        await t.page.getByRole('button', { name: kind, exact: true }).first().click({ timeout: 8000 }).catch(() => t.fail(`No "${kind}" tab`));
        await t.page.waitForTimeout(600);
        const s = await showingEntries(t.page);
        t.check(s && s.of > 0, `${kind}: no rows`);
        notes.push(`${kind} ${s.of}`);
      }
      return t.pass(notes.join(', '));
    },
  },
  {
    id: 'SET-002', module: 'Settings', kind: 'Functional', role: 'admin', writes: true,
    title: 'Tier Type: add, then delete a tier type',
    steps: 'Add New Tier Type "QA-AUTO ..." > Save; find it; Action > Delete > OK.',
    expected: 'It appears in the list, then disappears; messages confirm both.',
    run: t => addAndDelete(t, { path: '/settings/tier-type', addLabel: 'Add New Tier Type', placeholder: 'e.g. Tier 3', deletedToast: /tier type deleted/i }),
  },
  {
    id: 'SET-003', module: 'Settings', kind: 'Functional', role: 'admin', writes: true,
    title: 'Category: add, then delete a category (delete message says "Category")',
    steps: 'Add New Category "QA-AUTO ..." > Save; find it; Action > Delete > OK.',
    expected: 'It appears, then disappears; the delete message says "Category deleted." (not "Tier type deleted.").',
    run: t => addAndDelete(t, { path: '/settings/category', addLabel: 'Add New Category', placeholder: 'e.g. Road', deletedToast: /category deleted/i }),
  },
  {
    id: 'SET-004', module: 'Settings', kind: 'Functional', role: 'admin',
    title: 'Tier Type: Save with an empty name is refused',
    steps: 'Add New Tier Type, leave Tier Type empty, click Save.',
    expected: '"Enter the Tier Type." and nothing is saved.',
    async run(t) {
      await t.open('/settings/tier-type');
      await t.page.getByRole('button', { name: 'Add New Tier Type' }).click();
      await t.page.getByRole('button', { name: /^Save$/ }).click();
      const msg = await toastText(t.page);
      t.check(/Enter the Tier Type/i.test(msg), `Message was "${msg || '(none)'}"`);
      return t.pass('Refused with "Enter the Tier Type."');
    },
  },
];

// ---------------------------------------------------------------- Accounts, requests, projects
const others = [
  {
    id: 'USR-001', module: 'Accounts', kind: 'Functional', role: 'admin',
    title: 'Users: list shows the migrated accounts with all columns',
    steps: 'Open /accounts/users.',
    expected: 'Columns No., User Name, Name, Agency, Email, Cellphone Numbers, Member Type, Group, Date Created, Last Login; rows present.',
    async run(t) {
      await t.open('/accounts/users');
      const { head, rows } = await firstTable(t);
      const want = ['User Name', 'Name', 'Agency', 'Email', 'Member Type', 'Group', 'Date Created', 'Last Login'];
      const missing = want.filter(w => col(head, w) < 0);
      t.check(!missing.length, 'Missing columns: ' + missing.join(', '));
      t.check(rows.length > 0, 'No users listed');
      return t.pass(`${rows.length} rows on the first page`);
    },
  },
  {
    id: 'USR-002', module: 'Accounts', kind: 'Functional', role: 'admin',
    title: 'Users: Deleted Users view opens and goes back',
    steps: 'Click "Deleted Users (N)", then "Back to All Users".',
    expected: 'Heading changes to "Deleted Users" and back to "All Users".',
    async run(t) {
      await t.open('/accounts/users');
      await t.page.getByRole('button', { name: /Deleted Users/ }).click();
      await t.see(/^\s*Deleted Users\s*$/m, { within: 'main' });
      await t.page.getByRole('button', { name: /Back to All Users/ }).click();
      await t.see(/^\s*All Users\s*$/m, { within: 'main' });
      return t.pass('Toggles both ways');
    },
  },
  {
    id: 'USR-003', module: 'Accounts', kind: 'Functional', role: 'admin',
    title: 'Users: search narrows the list',
    steps: 'Type a word that matches nothing in Search.',
    expected: 'No user rows remain.',
    async run(t) {
      await t.open('/accounts/users');
      await t.page.getByLabel('Search:').fill('zzqa-no-match');
      await t.page.waitForTimeout(800);
      const { rows } = await firstTable(t);
      const left = rows.filter(r => r.length > 3).length;
      t.check(left === 0, `${left} rows still shown`);
      return t.pass('Search leaves no rows');
    },
  },
  {
    id: 'CLR-001', module: 'Requests', kind: 'Functional', role: 'admin',
    title: 'Clearances: migrated requests are listed',
    steps: 'Open /requests/clearances.',
    expected: 'The status cards and a table of clearance requests from the old site.',
    async run(t) {
      await t.open('/requests/clearances');
      const s = await showingEntries(t.page);
      t.check(s && s.of > 0, 'No clearance requests listed');
      return t.pass(`${s.of} clearance requests`);
    },
  },
  {
    id: 'RES-001', module: 'Requests', kind: 'Functional', role: 'admin',
    title: 'Research Requests: list and "Add New Research Request" form open',
    steps: 'Open /requests/research and click "Add New Research Request", then close it.',
    expected: 'The form opens with a title field; closing it saves nothing.',
    async run(t) {
      await t.open('/requests/research');
      await t.page.getByRole('button', { name: /Add New Research Request/ }).click();
      t.check(await t.page.getByPlaceholder('Title here').isVisible({ timeout: 5000 }).catch(() => false), 'Form did not open');
      await t.page.getByRole('button', { name: 'Close' }).first().click().catch(() => t.page.keyboard.press('Escape'));
      return t.pass('Form opens and closes');
    },
  },
  {
    id: 'PRJ-001', module: 'Projects', kind: 'Functional', role: 'admin',
    title: 'Project Profile: details, workflow steps and map',
    steps: 'Open /projects/16420.',
    expected: 'Title "PPA ID: 16420", PROJECT PROPOSAL PROFILE, the 7 workflow steps, and a location map.',
    async run(t) {
      await t.open('/projects/16420');
      t.check(/16420/.test(await t.page.title()), 'Tab title has no PPA ID: ' + (await t.page.title()));
      for (const s of ['PROJECT PROPOSAL PROFILE', 'Project Details', 'Cost Components', 'Budget Absorption Capacity']) await t.see(s);
      t.check(await t.page.locator('.leaflet-container').count(), 'No location map');
      return t.pass('Profile, steps and map shown');
    },
  },
  {
    id: 'PRJ-002', module: 'Projects', kind: 'Functional', role: 'admin',
    title: 'Project Profile: unknown PPA ID shows "Proposal unavailable"',
    steps: 'Open /projects/99999999.',
    expected: 'A "not found" message instead of an error page.',
    async run(t) {
      await t.open('/projects/99999999', { expect: 'any' });
      t.check(/unavailable|not found/i.test(await t.page.title() + await t.page.locator('body').innerText()), 'No "not found" message');
      return t.pass('Not-found message shown');
    },
  },
  {
    id: 'PRJ-003', module: 'Projects', kind: 'Functional', role: 'admin',
    title: 'Projects list: clicking a project name opens its profile',
    steps: 'Open /projects and click the first project name.',
    expected: 'The Project Proposal Profile for that PPA opens.',
    async run(t) {
      await t.open('/projects');
      const link = t.page.locator('table a[href^="/projects/"]').first();
      t.check(await link.count(), 'No project links in the table');
      const href = await link.getAttribute('href');
      await link.click();
      await t.page.waitForURL(u => u.pathname === href, { timeout: 15000 }).catch(() => t.fail('Did not open ' + href));
      await t.see('PROJECT PROPOSAL PROFILE');
      return t.pass('Opened ' + href);
    },
  },
  {
    id: 'CPW-001', module: 'Profile', kind: 'Functional', role: 'admin',
    title: 'Change password page opens',
    steps: 'Open /change-password (nothing is submitted).',
    expected: '"Change your password" with the password fields.',
    async run(t) {
      await t.open('/change-password');
      await t.see('Change your password');
      t.check(await t.page.locator('input[type="password"]').count() >= 2, 'Password fields missing');
      return t.pass('Page and fields shown');
    },
  },
];

export default [...reviewStatus, ...aco, ...settings, ...others];
