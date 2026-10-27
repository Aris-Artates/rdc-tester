/**
 * Loads every test from src/tests/*.js (files starting with "_" are helpers, not tests)
 * and checks each one is complete. A new test file is picked up automatically.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from './config.js';

export const KINDS = ['Functional', 'Logic', 'Data', 'Access', 'Pending'];
/**
 * Every account the checker can sign in as: ACCOUNT_<ROLE> on Vercel and ORIGINAL_ACCOUNT_<ROLE> on the
 * original site (parity tests). `original` / `vercel` are the test usernames (see the sheet's Roles & Access
 * tab); passwords live only in .env. Runs go in this order.
 */
export const ROLE_INFO = [
  { role: 'public', name: 'No sign-in' },
  { role: 'admin', name: 'RDC Admin', original: 'dev_rdc_admin' },
  { role: 'member', name: 'Member without every section', original: 'dev_rdc_member' },
  { role: 'rdc_checker', name: 'RDC Checker', original: 'dev_rdc_checker', vercel: 'test_rdc_checker' },
  { role: 'rdc_encoder', name: 'RDC Encoder', original: 'dev_rdc_encoder', vercel: 'test_rdc_encoder' },
  { role: 'rdc_member', name: 'RDC Member', original: 'dev_rdc_member' },
  { role: 'approving_officer', name: 'RDC Approving Officer', original: 'dev_rdc_approving_officer' },
  { role: 'agency_admin', name: 'Agency Admin', original: 'dev_rdc_agency_admin', vercel: 'newtest_agency_admin' },
  { role: 'agency_head', name: 'Agency Head', original: 'dev_rdc_agency_head', vercel: 'newtest_agency_head' },
  { role: 'agency_checker', name: 'Agency Checker', original: 'dev_rdc_agency_checker', vercel: 'newtest_agency_checker' },
  { role: 'agency_encoder', name: 'Agency Encoder', original: 'dev_rdc_agency_encoder', vercel: 'newtest_agency_encoder' },
  { role: 'agency_guest', name: 'Agency Guest', original: 'dev_rdc_agency_guest' },
  { role: 'psr', name: 'Private Sector Representative', original: 'dev_rdc_psr' },
  { role: 'cso', name: 'CSO Member', original: 'dev_rdc_cso' },
  { role: 'riatf', name: 'RIATF Representative', original: 'dev_rdc_riatf' },
  { role: 'dbm_reviewer', name: 'Project Reviewer (DBM)', original: 'dev_rdc_dbm_reviewer' },
  { role: 'ched_reviewer', name: 'Project Reviewer (CHED)', original: 'dev_rdc_ched_reviewer' },
  { role: 'chief_reviewer', name: 'DBM Chief Reviewer', original: 'dev_dbm_chief_reviewer' },
  { role: 'ched_chief_reviewer', name: 'CHED Chief Reviewer', original: 'dev_ched_chief_reviewer' },
  { role: 'neda_chief_reviewer', name: 'NEDA Chief Reviewer', original: 'dev_neda_chief_reviewer' },
];
export const ROLES = ROLE_INFO.map(r => r.role);

export async function loadCatalog() {
  const dir = path.join(ROOT, 'src', 'tests');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.js') && !f.startsWith('_')).sort();
  const tests = [], problems = [], seen = new Map();
  for (const f of files) {
    const mod = await import(pathToFileURL(path.join(dir, f)).href);
    for (const test of mod.default || []) {
      const where = `${f}: ${test.id || '(no id)'}`;
      for (const k of ['id', 'module', 'title', 'kind', 'role', 'steps', 'expected']) if (!test[k]) problems.push(`${where} has no "${k}"`);
      if (typeof test.run !== 'function') problems.push(`${where} has no run(t) function`);
      if (test.kind && !KINDS.includes(test.kind)) problems.push(`${where}: kind "${test.kind}" is not one of ${KINDS.join(', ')}`);
      if (test.role && !ROLES.includes(test.role)) problems.push(`${where}: role "${test.role}" is not one of ${ROLES.join(', ')}`);
      if (seen.has(test.id)) problems.push(`${test.id} is used twice (${seen.get(test.id)} and ${f})`);
      seen.set(test.id, f);
      tests.push({ ...test, file: f });
    }
  }
  if (problems.length) throw new Error('Test catalog problems:\n  ' + problems.join('\n  '));
  return tests;
}

/** What the sheet stores about a test (everything except the code). */
export const sheetFields = t => ({
  id: t.id, module: t.module, title: t.title, kind: t.kind, role: t.role,
  steps: t.steps, expected: t.expected, reference: t.reference || '', pending: !!t.pending, writes: !!t.writes,
});
