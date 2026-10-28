#!/usr/bin/env node
/**
 * npm run sync-sheet [-- --add-only]
 * Adds every test that is in the code but not in the sheet's "Test Cases" tab (Case Status "Active"),
 * and refreshes Module / Test / Kind / Role / Steps / Expected of existing active rows.
 * Never touches Case Status, Dev Ticket, Reference (original), Result or Remarks, and never touches a Closed / Reworked case.
 *
 * npm run sync-sheet -- --export
 * Writes apps-script/test-cases.json instead (no web app needed). Commit and push it, then in the sheet:
 * RDC QA > Sync test cases from rdc-tester, which reads that file from GitHub and does the same sync.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.js';
import { loadCatalog, sheetFields } from './catalog.js';
import { syncTests } from './sheet.js';

const tests = (await loadCatalog()).map(sheetFields);
if (process.argv.includes('--export')) {
  const file = path.join(ROOT, 'apps-script', 'test-cases.json');
  fs.writeFileSync(file, JSON.stringify({ exported: new Date().toISOString(), tests }) + '\n');
  console.log(`${tests.length} test cases written to ${path.relative(ROOT, file)}. Commit and push it, then use RDC QA > Sync test cases from rdc-tester.`);
} else {
  const r = await syncTests(tests, { update: !process.argv.includes('--add-only') });
  console.log(`Sheet synced: ${r.added.length} added, ${r.updated.length} updated, ${r.skippedCancelled.length} closed / reworked cases left alone.`);
  if (r.added.length) console.log('  Added: ' + r.added.join(', '));
  if (r.updated.length) console.log('  Updated: ' + r.updated.join(', '));
}
