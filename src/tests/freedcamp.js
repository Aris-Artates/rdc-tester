/**
 * The tasks on Freedcamp (RDC8-IMS New) and their dev tickets, checked on Vercel. Read only: decisions
 * (approve, endorse, lock, status changes) are opened up to their confirmation step and never sent.
 * Roles: NEW_RDC_ADMIN, NEW_AGENCY_HEAD, NEW_RDC_APPROVING_OFFICER, NEW_DBM_CHIEF_REVIEWER (see src/roles.js).
 */
import { readTable, num, showingEntries, toastText } from '../app.js';
import { firstTable } from './_helpers.js';

const OFFICE = 'Department of Finance - BTr Borongan Eastern Samar Provincial Office';
const OFFICE_PATH = `/monitoring/agency/54/${encodeURIComponent(OFFICE)}?year=2027`;
const button = (t, name) => t.page.getByRole('button', { name, exact: true });
const cardCount = async (t, label) => num(await t.page.locator('button, div').filter({ hasText: new RegExp(`^${label}\\s*\\d`) }).first().innerText().catch(() => ''));

export default [
  // ---- Ticket 2: public map filters
  {
    id: 'FC-001', module: 'Landing Page', kind: 'Functional', role: 'public',
    title: 'Ticket 2: public map has all the project filters',
    steps: 'Open / signed out and look at the Investment Map filters.',
    expected: 'Fiscal Year, Agency, Province, City / Municipality, Tier Type, Typology and Congressional District dropdowns are shown.',
    async run(t) {
      await t.open('/');
      const want = ['Fiscal Year', 'Agency', 'Province', 'City / Municipality', 'Tier Type', 'Typology', 'Congressional District'];
      const gone = [];
      for (const label of want) if (!(await t.page.getByLabel(label, { exact: true }).count())) gone.push(label);
      t.check(!gone.length, 'Missing filters: ' + gone.join(', '));
      return t.pass('All 7 filters shown');
    },
  },
  // ---- Ticket 4: Users No. column
  {
    id: 'FC-002', module: 'Accounts', kind: 'Logic', role: 'admin',
    title: 'Ticket 4: Users No. column recounts after a search',
    steps: 'Open /accounts/users, search "a", read the No. column.',
    expected: 'No. runs 1, 2, 3... down the filtered list.',
    async run(t) {
      await t.open('/accounts/users');
      await t.page.getByLabel('Search:').fill('a');
      await t.page.waitForTimeout(800);
      const { rows } = await firstTable(t);
      const nos = rows.filter(r => r.length > 2).map(r => num(r[0]));
      t.check(nos.length, 'No users match "a"');
      const bad = nos.findIndex((n, i) => n !== i + 1);
      t.check(bad < 0, `Row ${bad + 1} shows No. ${nos[bad]}`);
      return t.pass(`${nos.length} rows numbered 1-${nos.length}`);
    },
  },
  // ---- Ticket 5: Add User modal
  {
    id: 'FC-003', module: 'Accounts', kind: 'Functional', role: 'admin',
    title: 'Ticket 5: Add New User modal stays open on an outside click',
    steps: 'Open /accounts/users, click + Add New User, click outside the modal.',
    expected: 'The modal is still open.',
    async run(t) {
      await t.open('/accounts/users');
      await t.page.getByRole('button', { name: /Add New User/ }).click();
      // The user dialog is a full-screen overlay (div.fixed.inset-0) holding an "Add New User" heading.
      const modal = t.page.locator('div.fixed.inset-0').filter({ hasText: 'Add New User' });
      await modal.waitFor({ timeout: 8000 });
      await t.page.mouse.click(10, 10);
      await t.page.waitForTimeout(800);
      t.check(await modal.isVisible().catch(() => false), 'The Add New User modal closed after clicking outside it');
      return t.pass('Modal stayed open');
    },
  },
  // ---- Ticket 6: RDP outcomes CSV
  {
    id: 'FC-004', module: 'Dev Framework', kind: 'Functional', role: 'admin',
    title: 'Ticket 6: RDP outcomes upload needs a CSV file',
    steps: 'Open /dev-framework/rdp-chapters?tab=outcomes without choosing a file.',
    expected: 'A CSV file picker and the year select are shown; "Upload Outcomes via CSV" is disabled.',
    async run(t) {
      await t.open('/dev-framework/rdp-chapters?tab=outcomes');
      t.check(await t.page.locator('input[type="file"][accept*="csv"]').count(), 'No CSV file picker');
      const up = t.page.getByRole('button', { name: /Upload Outcomes via CSV/ });
      t.check(await up.count(), 'No "Upload Outcomes via CSV" button');
      t.check(await up.isDisabled(), 'Upload is enabled with no file chosen');
      return t.pass('Picker shown; upload disabled until a file is chosen');
    },
  },
  {
    id: 'FC-005', module: 'Dev Framework', kind: 'Logic', role: 'admin',
    title: 'Ticket 6: CSV naming an unknown chapter is refused and saves nothing',
    steps: 'On the Outcomes tab choose a CSV whose chapter does not exist, click Upload Outcomes via CSV.',
    expected: 'Error toast starting "Nothing was saved." naming the chapter.',
    async run(t) {
      await t.open('/dev-framework/rdp-chapters?tab=outcomes');
      const csv = 'RDP Chapter,Outcome 1\n"QA-AUTO no such chapter",Test outcome\n';
      await t.page.locator('input[type="file"][accept*="csv"]').setInputFiles({ name: 'qa-unknown-chapter.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
      await t.page.getByRole('button', { name: /Upload Outcomes via CSV/ }).click();
      const toast = await toastText(t.page);
      t.check(/Nothing was saved/i.test(toast) && /QA-AUTO no such chapter/.test(toast), `Toast was: "${toast}"`);
      return t.pass(toast.slice(0, 160));
    },
  },
  // ---- Ticket 7: Approval Requests
  {
    id: 'FC-006', module: 'Requests', kind: 'Logic', role: 'admin',
    title: 'Ticket 7: Approval Requests status cards add up to the list total',
    steps: 'Open /requests/approval (FY default). Read the Pending, Approved, Disapproved cards and "Showing ... of N entries".',
    expected: 'Pending + Approved + Disapproved = N, and "Pending Items" equals the Pending card.',
    async run(t) {
      await t.open('/requests/approval');
      const body = (await t.page.locator('main').innerText()).replace(/,/g, '');
      const card = l => Number((body.match(new RegExp(`${l}\\s*\\n\\s*(\\d+)`, 'i')) || [])[1]);
      const [p, a, d] = ['PENDING', 'APPROVED', 'DISAPPROVED'].map(card);
      const items = Number((body.match(/Pending Items = (\d+)/) || [])[1]);
      const s = await showingEntries(t.page);
      t.check(s, 'No "Showing ... of N entries"');
      t.check(p + a + d === s.of, `Cards ${p} + ${a} + ${d} = ${p + a + d}, list says ${s.of}`);
      t.check(items === p, `Pending Items = ${items}, Pending card = ${p}`);
      return t.pass(`${p} + ${a} + ${d} = ${s.of}`);
    },
  },
  {
    id: 'FC-007', module: 'Requests', kind: 'Functional', role: 'admin',
    title: 'Ticket 7: Approval Requests search by PPA ID',
    steps: "Open /requests/approval, take the first row's PPA ID and search for it.",
    expected: 'The list narrows to that PPA.',
    async run(t) {
      await t.open('/requests/approval');
      const { head, rows } = await firstTable(t);
      const c = head.findIndex(h => /PPA ID/i.test(h));
      const id = rows[0]?.[c];
      t.check(id && /^\d+$/.test(id), 'No PPA ID in the first row');
      await t.page.getByLabel('Search:').fill(id);
      // The search runs on the server: wait until the list has changed to the result.
      let after = null;
      for (const end = Date.now() + 20000; Date.now() < end; await t.page.waitForTimeout(500)) {
        after = await readTable(t.page.locator('table').first());
        if (after.rows.length && after.rows.every(r => r[c] === id)) break;
      }
      t.check(after.rows.length && after.rows.every(r => r[c] === id), `Search ${id} still shows other rows after 20 s`);
      return t.pass(`Search ${id}: ${after.rows.length} row(s)`);
    },
  },
  {
    id: 'FC-008', module: 'Requests', kind: 'Access', role: 'agency_head',
    title: 'Ticket 7: Agency Head sees only their own agency',
    steps: 'Sign in as an Agency Head, open /requests/approval, open Filter by.',
    expected: 'Filter by offers All plus one agency only.',
    async run(t) {
      await t.open('/requests/approval');
      const opts = await t.page.locator('select').filter({ has: t.page.locator('option', { hasText: /^All$/ }) }).last().locator('option').allInnerTexts();
      t.check(opts.length <= 2, `Filter by lists ${opts.length - 1} agencies`);
      return t.pass('Agency list: ' + (opts[1] || '(none with requests)'));
    },
  },
  // ---- Kenneth: Approve / Disapprove
  {
    id: 'FC-009', module: 'Requests', kind: 'Access', role: 'agency_head',
    title: 'Approval Requests: Agency Head gets Approve / Disapprove',
    steps: 'As an Agency Head, click the eye button of the first request.',
    expected: 'Project Details opens with Approve and Disapprove (not clicked).',
    async run(t) {
      await t.open('/requests/approval');
      const eye = t.page.getByRole('button', { name: /View request for PPA/ }).first();
      if (!(await eye.count())) t.blocked('This agency has no approval requests in the default year');
      await eye.click();
      const dialog = t.page.getByRole('dialog');
      await dialog.waitFor({ timeout: 8000 });
      const ok = (await dialog.getByRole('button', { name: 'Approve', exact: true }).count()) && (await dialog.getByRole('button', { name: 'Disapprove', exact: true }).count());
      await t.page.keyboard.press('Escape');
      t.check(ok, 'Approve / Disapprove not offered');
      return t.pass('Approve and Disapprove offered');
    },
  },
  {
    id: 'FC-010', module: 'Requests', kind: 'Access', role: 'admin',
    title: 'Approval Requests: RDC Admin cannot approve',
    steps: 'As RDC Admin, click the eye button of the first request.',
    expected: '"You are not allowed to use this function." and no Approve / Disapprove.',
    async run(t) {
      await t.open('/requests/approval');
      await t.page.getByRole('button', { name: /View request for PPA/ }).first().click();
      const toast = await toastText(t.page);
      t.check(/not allowed/i.test(toast), `Expected the "not allowed" notice, got "${toast}"`);
      t.check(!(await t.page.getByRole('dialog').count()), 'A decision dialog opened');
      return t.pass(toast);
    },
  },
  // ---- Kenneth: Deficiency Status actions
  {
    id: 'FC-011', module: 'Monitoring', kind: 'Access', role: 'agency_head',
    title: 'Deficiency Status: Agency Head can change a project status',
    steps: 'As an Agency Head, open /monitoring/deficiency and look at the Action column.',
    expected: 'Rows have a "Change status" control with Set as Draft, Submitted to Agency Head and Send to RDC (not used).',
    async run(t) {
      await t.open('/monitoring/deficiency');
      const pick = t.page.getByLabel('Change project status').first();
      if (!(await pick.count())) t.blocked('No projects listed for this agency in the default year');
      const opts = await pick.locator('option').allInnerTexts();
      const want = ['Set as Draft', 'Submitted to Agency Head', 'Send to RDC'];
      t.check(want.every(w => opts.includes(w)), 'Options: ' + opts.join(', '));
      return t.pass('Options: ' + opts.slice(1).join(', '));
    },
  },
  {
    id: 'FC-012', module: 'Monitoring', kind: 'Access', role: 'approving_officer',
    title: 'Deficiency Status: RDC Approving Officer has no status actions',
    steps: 'As an RDC Approving Officer, open /monitoring/deficiency.',
    expected: 'No "Change status" controls.',
    async run(t) {
      await t.open('/monitoring/deficiency');
      t.check(!(await t.page.getByLabel('Change project status').count()), 'Status controls are shown');
      return t.pass('No status controls');
    },
  },
  // ---- Kenneth: Reviewer's Requests
  {
    id: 'FC-013', module: 'Requests', kind: 'Access', role: 'chief_reviewer',
    title: "Reviewer's Requests: Chief Reviewer can approve / disapprove",
    steps: "As a Chief Reviewer, open /requests/reviewers and look at the first row's Action menu.",
    expected: 'The Action menu is enabled (nothing is approved).',
    async run(t) {
      await t.open('/requests/reviewers');
      // Rows arrive from the server after the page settles.
      await t.page.getByRole('button', { name: /Action/ }).first().waitFor({ timeout: 20000 }).catch(() => {});
      const action = t.page.locator('table tbody tr').first().getByRole('button', { name: /Action/ });
      if (!(await action.count())) t.blocked('No reviewer requests for this chief');
      t.check(!(await action.isDisabled()), 'The Action menu is disabled for the Chief Reviewer');
      return t.pass('Action menu enabled');
    },
  },
  {
    id: 'FC-014', module: 'Requests', kind: 'Access', role: 'admin',
    title: "Reviewer's Requests: only Chief Reviewers can decide",
    steps: "As RDC Admin, open /requests/reviewers and look at the first row's Action menu.",
    expected: 'The Action menu is disabled.',
    async run(t) {
      await t.open('/requests/reviewers');
      // Rows arrive from the server after the page settles.
      await t.page.getByRole('button', { name: /Action/ }).first().waitFor({ timeout: 20000 }).catch(() => {});
      const action = t.page.locator('table tbody tr').first().getByRole('button', { name: /Action/ });
      if (!(await action.count())) t.blocked('No reviewer requests listed');
      t.check(await action.isDisabled(), 'RDC Admin can open the Approve / Disapprove menu');
      return t.pass('Action menu disabled');
    },
  },
  // ---- Ticket 8 / 9 (Jondie): proposals and photos
  {
    id: 'FC-015', module: 'Projects', kind: 'Functional', role: 'admin',
    title: 'Ticket 8: Add New Proposal opens the proposal form',
    steps: 'Open /projects and click Add New Proposal.',
    expected: '/projects/new opens with the proposal form.',
    async run(t) {
      await t.open('/projects');
      const add = t.page.getByRole('link', { name: /Add New Proposal/ });
      t.check(await add.count(), 'No Add New Proposal button');
      await add.click();
      await t.page.waitForURL(/\/projects\/new/, { timeout: 15000 });
      t.check(await t.page.locator('main input, main select, main textarea').count() >= 5, 'No proposal fields on /projects/new');
      return t.pass('/projects/new form shown');
    },
  },
  {
    id: 'FC-016', module: 'Projects', kind: 'Functional', role: 'admin', pending: true,
    title: 'Ticket 9: Project Profile offers photo upload',
    steps: 'Open the first project in /projects and look at its photo gallery.',
    expected: 'An image upload control is shown on proposals that can be edited.',
    async run(t) {
      await t.open('/projects');
      const href = await t.page.locator('a[href^="/projects/"]').evaluateAll(as => as.map(a => a.getAttribute('href')).find(h => /^\/projects\/\d+$/.test(h)));
      t.check(href, 'No projects listed');
      await t.open(href);
      if (!(await t.page.locator('input[type="file"][accept*="image"]').count())) t.notImplemented('No photo upload on the Project Profile yet');
      return t.pass('Photo upload shown');
    },
  },
  // ---- Tickets 10 / 11: Review Status office page
  {
    id: 'FC-017', module: 'Monitoring', kind: 'Access', role: 'admin',
    title: 'Tickets 10 + 11: RDC Admin gets Endorsed by RDC and Bulk Lock/Unlock',
    steps: `Open ${OFFICE_PATH}.`,
    expected: 'Both buttons are shown, and every PPA title has a padlock.',
    async run(t) {
      await t.open(OFFICE_PATH);
      t.check(await button(t, 'Endorsed by RDC').count(), 'No "Endorsed by RDC" button');
      t.check(await button(t, 'Bulk Lock/Unlock').count(), 'No "Bulk Lock/Unlock" button');
      const rows = await t.page.locator('table tbody tr').filter({ has: t.page.locator('a[href^="/projects/"]') }).count();
      const locks = await t.page.locator('table [role="img"][aria-label*="LOCKED"]').count();
      t.check(locks === rows, `${rows} PPA rows but ${locks} padlocks`);
      return t.pass(`${rows} rows, ${locks} padlocks`);
    },
  },
  {
    id: 'FC-018', module: 'Monitoring', kind: 'Logic', role: 'admin',
    title: 'Ticket 10: Endorsed by RDC lists exactly the PPAs sent to RDC',
    steps: `Open ${OFFICE_PATH}, read the "Sent to RDC" card, open Endorsed by RDC.`,
    expected: 'The dialog lists as many PPAs as the Sent to RDC card.',
    async run(t) {
      await t.open(OFFICE_PATH);
      const sent = await cardCount(t, 'Sent to RDC');
      await button(t, 'Endorsed by RDC').click();
      const dialog = t.page.getByRole('dialog');
      await dialog.waitFor({ timeout: 8000 });
      const listed = await dialog.locator('tbody input[type="checkbox"]').count();
      await t.page.keyboard.press('Escape');
      t.check(listed === sent, `Card says ${sent} sent to RDC, dialog lists ${listed}`);
      return t.pass(`${listed} listed`);
    },
  },
  {
    id: 'FC-019', module: 'Monitoring', kind: 'Logic', role: 'admin',
    title: "Ticket 11: Bulk Lock/Unlock lists every PPA of the office",
    steps: `Open ${OFFICE_PATH}, read Total Projects, open Bulk Lock/Unlock.`,
    expected: 'The dialog lists Total Projects PPAs, each with a padlock.',
    async run(t) {
      await t.open(OFFICE_PATH);
      const total = num((await t.page.locator('main').innerText()).match(/Total Projects\s*\n\s*([\d,]+)/)?.[1]);
      await button(t, 'Bulk Lock/Unlock').click();
      const dialog = t.page.getByRole('dialog');
      await dialog.waitFor({ timeout: 8000 });
      const listed = await dialog.locator('tbody input[type="checkbox"]').count();
      const locks = await dialog.locator('[role="img"][aria-label*="LOCKED"]').count();
      await t.page.keyboard.press('Escape');
      t.check(listed === total && locks === listed, `Total Projects ${total}, listed ${listed}, padlocks ${locks}`);
      return t.pass(`${listed} listed with padlocks`);
    },
  },
  {
    id: 'FC-020', module: 'Monitoring', kind: 'Access', role: 'approving_officer',
    title: 'Tickets 10 + 11: Approving Officer can endorse but not lock',
    steps: `As an RDC Approving Officer, open ${OFFICE_PATH}.`,
    expected: '"Endorsed by RDC" shown, "Bulk Lock/Unlock" not shown.',
    async run(t) {
      await t.open(OFFICE_PATH);
      t.check(await button(t, 'Endorsed by RDC').count(), 'No "Endorsed by RDC" for the Approving Officer');
      t.check(!(await button(t, 'Bulk Lock/Unlock').count()), '"Bulk Lock/Unlock" shown to a non-admin');
      return t.pass('Endorse only');
    },
  },
];
