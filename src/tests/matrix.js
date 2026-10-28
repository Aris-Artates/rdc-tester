/**
 * The original-vs-Vercel matrix: for EVERY account type and EVERY page of the original site's menus
 * (src/pagemap.js), with the original as the baseline. Two cases per page and role:
 *   ACC-<page>-<role>  Access: the role can open the page on both sites, or is blocked on both
 *   CMP-<page>-<role>  Data:   same columns, filters and buttons, buttons do the same thing, same row totals
 * plus WRT-<nn> write round-trips on the settings lookup pages (RDC Admin, needs ALLOW_WRITE_TESTS=true).
 * Run one role:  npm run qa -- --role agency_head --kind Access,Data
 * Run one page:  npm run qa -- --only ACC-51-AHD,CMP-51-AHD
 */
import { PAGES } from '../pagemap.js';
import { ROLE_INFO } from '../roles.js';
import { checkAccess, checkFeatures, openLegacy, openNew } from '../comparelib.js';
import { ROUND_TRIPS, roundTrip, summary } from '../roundtrips.js';

/** Short role codes used in the IDs (ACC-51-AHD = page 51, Agency Head). */
export const ROLE_CODES = {
  public: 'PUB', admin: 'ADM', rdc_checker: 'RCHK', rdc_encoder: 'RENC', rdc_member: 'RMEM', approving_officer: 'RAO',
  agency_admin: 'AADM', agency_head: 'AHD', agency_checker: 'ACHK', agency_encoder: 'AENC', agency_guest: 'AGST',
  psr: 'PSR', cso: 'CSO', riatf: 'RIATF', dbm_reviewer: 'DBMR', ched_reviewer: 'CHEDR', chief_reviewer: 'DBMC',
  ched_chief_reviewer: 'CHEDC', neda_chief_reviewer: 'NEDAC', neda_reviewer: 'NEDAR', dbm_officer: 'DBMO',
  lgu_representative: 'LGU', congressional_representative: 'CONG', guest_user: 'GST', investor: 'INV', gad_focal: 'GAD',
  public_user: 'PUSR', data_uploader: 'UPL',
};

// The access check of each page, kept for the CMP case that follows it in the same run (same role, same pages).
const seen = new Map();
const ctxOf = t => ({ legacy: t.original.page, vercel: t.page });
const moduleOf = p => p.menu.split(' > ')[0];
const verb = a => (a.verdict === 'both-open' ? 'opens on both sites' : 'is blocked on both sites');

async function access(t, p, role) {
  const a = await checkAccess(ctxOf(t), p);
  seen.set(role + '|' + p.no, a);
  return a;
}

function accCase(r, p, code) {
  return {
    id: `ACC-${p.no}-${code}`, module: moduleOf(p), kind: 'Access', role: r.role, original: true,
    title: `${r.name}: ${p.menu} - same access as the original`,
    steps: `As ${r.name}, open ${p.legacy} on the original site and ${p.vercel || '(no Vercel page)'} on Vercel.`,
    expected: 'Opens on both sites, or is blocked on both (the original decides).',
    run: async t => {
      const a = await access(t, p, r.role);
      if (a.verdict === 'original-broken') t.blocked(`Original site: ${a.legacy.detail}`);
      if (a.verdict === 'no-vercel-page') t.notImplemented(a.problems.join('; '));
      if (a.problems.length) t.fail(a.problems.join('; '));
      return t.pass(`The page ${verb(a)}`);
    },
  };
}

function cmpCase(r, p, code) {
  return {
    id: `CMP-${p.no}-${code}`, module: moduleOf(p), kind: 'Data', role: r.role, original: true,
    title: `${r.name}: ${p.menu} - same buttons, functions and data as the original`,
    steps: `As ${r.name}, open the page on both sites; compare columns, filters, buttons, what each non-destructive button opens, and the row total.`,
    expected: 'Everything the original offers is on Vercel and does the same; the same number of rows.',
    run: async t => {
      const ctx = ctxOf(t);
      // Reuse the ACC case's visit when it ran just before; otherwise open the page now.
      let a = seen.get(r.role + '|' + p.no);
      const here = a && a.verdict === 'both-open' && t.page.url().includes(p.vercel.split('?')[0]) && t.original.page.url().includes(p.legacy.split('?')[0]);
      if (!here) a = await access(t, p, r.role);
      if (a.verdict === 'original-broken') t.blocked(`Original site: ${a.legacy.detail}`);
      if (a.verdict === 'no-vercel-page') t.notImplemented(a.problems.join('; ') || 'No Vercel page for this original page yet');
      if (a.verdict === 'both-blocked') return t.pass('Closed to this role on both sites: nothing to compare');
      if (a.verdict === 'differs') t.fail(`Cannot compare: access differs (see ACC-${p.no}-${code}). ${a.problems.join('; ')}`);
      const f = await checkFeatures(ctx, p);
      if (f.problems.length) t.fail(f.problems.join('; ') + (f.notes.length ? ' | ' + f.notes.join('; ') : ''));
      return t.pass('Same as the original' + (f.notes.length ? ' | ' + f.notes.join('; ') : ''));
    },
  };
}

function writeCase(menu, i) {
  const p = PAGES.find(x => x.menu === menu);
  return {
    id: `WRT-${String(i + 1).padStart(2, '0')}`, module: moduleOf(p), kind: 'Functional', role: 'admin', original: true, writes: true,
    title: `${menu}: add, find and delete a TEST- record works the same on both sites`,
    steps: `On ${p.legacy} (original) and ${p.vercel} (Vercel): Add with every field filled (TEST-<time>), find it in the list, delete it.`,
    expected: 'Each step works on Vercel whenever it works on the original; no TEST- row is left behind.',
    run: async t => {
      if (!t.config.allowWrite) t.blocked('Write tests are off (ALLOW_WRITE_TESTS=false in .env)');
      const name = 'TEST-' + Date.now().toString(36).toUpperCase();
      const L = await roundTrip(t.original.page, t.config.originalUrl + p.legacy, name);
      const V = await roundTrip(t.page, t.app.abs(p.vercel), name);
      const same = ['add', 'find', 'delete'].every(k => (L[k] === 'ok') === (V[k] === 'ok'));
      const notes = `Original: ${summary(L)} | Vercel: ${summary(V)}`;
      if (!same || V.leftover) t.fail(notes);
      // Leave both pages where the next case expects to start.
      await openLegacy(t.original.page, p.legacy); await openNew(t.page, p.vercel);
      return t.pass(notes);
    },
  };
}

export default [
  ...ROLE_INFO.filter(r => ROLE_CODES[r.role]).flatMap(r => PAGES.flatMap(p => [accCase(r, p, ROLE_CODES[r.role]), cmpCase(r, p, ROLE_CODES[r.role])])),
  ...ROUND_TRIPS.map(writeCase),
];
