#!/usr/bin/env node
/**
 * npm run sync-sheet [-- --add-only]
 * Adds every test that is in the code but not in the sheet's "Test Cases" tab (Case Status "Active"),
 * and refreshes Module / Test / Kind / Role / Steps / Expected of existing active rows.
 * Never touches Case Status, Dev Ticket, Reference (original), Result or Remarks, and never touches a Closed / Reworked case.
 */
import { loadCatalog, sheetFields } from './catalog.js';
import { syncTests } from './sheet.js';

const tests = (await loadCatalog()).map(sheetFields);
const r = await syncTests(tests, { update: !process.argv.includes('--add-only') });
console.log(`Sheet synced: ${r.added.length} added, ${r.updated.length} updated, ${r.skippedCancelled.length} closed / reworked cases left alone.`);
if (r.added.length) console.log('  Added: ' + r.added.join(', '));
if (r.updated.length) console.log('  Updated: ' + r.updated.join(', '));
