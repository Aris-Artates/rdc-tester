/**
 * Loads every test from src/tests/*.js (files starting with "_" are helpers, not tests)
 * and checks each one is complete. A new test file is picked up automatically.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from './config.js';

export const KINDS = ['Functional', 'Logic', 'Data', 'Access', 'Pending'];
// Each role signs in with ACCOUNT_<ROLE> (and ORIGINAL_ACCOUNT_<ROLE> on the original site, for parity tests).
export const ROLES = ['public', 'admin', 'member', 'agency_head', 'approving_officer', 'chief_reviewer'];

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
