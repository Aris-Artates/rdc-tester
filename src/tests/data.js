/**
 * Data differences: a figure read on Vercel vs the same figure on the ORIGINAL site.
 *
 * The checker never logs in to the original site. QA reads the value there once and types it
 * in the sheet's "Reference (original)" column. Until that cell is filled the test is Blocked
 * and its notes show the Vercel value, so filling the reference is a quick copy.
 * `reference:` below is only a starting value that "sync" writes into an EMPTY sheet cell.
 */
import { countEntries } from './_helpers.js';

const MODULE = 'Data Difference';

/** Read one stat card on the public home page ("Projects Mapped" -> "7,579"). */
async function homeStat(t, label) {
  await t.open('/');
  const v = await t.page.evaluate(l => {
    const el = [...document.querySelectorAll('div')].find(d => d.children.length === 0 && d.textContent.trim().toLowerCase() === l.toLowerCase());
    return el?.nextElementSibling?.textContent.trim() ?? null;
  }, label);
  t.check(v, `No "${label}" stat on the home page`);
  return v;
}

/** [id, title, role, path, how to read the value, where to read it on the original] */
const COUNTS = [
  ['DATA-010', 'Number of users', '/accounts/users', 'Users > All Users: total entries'],
  ['DATA-011', 'Number of clearance requests', '/requests/clearances', 'Requests > Clearances: total entries'],
  ['DATA-012', 'Number of research requests', '/requests/research', 'Requests > Research Requests: total entries'],
  ['DATA-013', 'Number of agencies', '/accounts/agencies', 'Accounts > Agencies: total entries'],
  ['DATA-014', 'Number of tier types', '/settings/tier-type', 'Settings > Tier Type: total entries'],
  ['DATA-015', 'Number of project categories', '/settings/category', 'Settings > Category: total entries'],
  ['DATA-016', 'Number of member types', '/accounts/member-types', 'Accounts > Member Types: total entries'],
  ['DATA-017', 'Number of sectors', '/accounts/sectors', 'Accounts > Sectors: total entries'],
  ['DATA-018', 'Number of SDGs', '/dev-framework/sdgs-2030', 'Dev Framework > SDGs 2030: total entries'],
  ['DATA-019', 'Number of RDP chapters', '/dev-framework/rdp-chapters', 'Dev Framework > RDP Chapters: total entries'],
];

const LOCATIONS = [
  ['DATA-020', 'Province', '6'],
  ['DATA-021', 'Congressional District', ''],
  ['DATA-022', 'City/Municipality', ''],
  ['DATA-023', 'Barangay', ''],
];

export default [
  ...[['DATA-001', 'Projects Mapped'], ['DATA-002', 'Indicative Investment'], ['DATA-003', 'Implementing Agencies'], ['DATA-004', 'Fiscal Years Covered']]
    .map(([id, label]) => ({
      id, module: MODULE, kind: 'Data', role: 'public',
      title: `Home page "${label}" matches the original`,
      steps: `Read "${label}" on the Vercel home page; compare with the same figure on the original site.`,
      expected: 'Same value as the original (these stats are hard-coded on Vercel today, so they drift when data changes).',
      async run(t) { return t.compareWithReference(label, await homeStat(t, label)); },
    })),
  ...COUNTS.map(([id, title, path, where]) => ({
    id, module: MODULE, kind: 'Data', role: 'admin',
    title: `${title} matches the original`,
    steps: `Open ${path} on Vercel and read the total ("Showing ... of N entries"). Original: ${where}.`,
    expected: 'Same total as the original site.',
    async run(t) {
      await t.open(path);
      const n = await countEntries(t.page);
      t.check(n != null, 'Could not read a total on the page');
      return t.compareWithReference(title, n);
    },
  })),
  ...LOCATIONS.map(([id, kind, reference]) => ({
    id, module: MODULE, kind: 'Data', role: 'admin', reference,
    title: `Locations: number of ${kind} records matches the original`,
    steps: `Open /settings/location, choose ${kind}, read the total.`,
    expected: 'Same count as the original site (Eastern Visayas has 6 provinces).',
    async run(t) {
      await t.open('/settings/location');
      await t.page.getByRole('button', { name: kind, exact: true }).first().click({ timeout: 8000 }).catch(() => t.fail(`No "${kind}" tab`));
      await t.page.waitForTimeout(600);
      return t.compareWithReference(`${kind} count`, await countEntries(t.page));
    },
  })),
];
