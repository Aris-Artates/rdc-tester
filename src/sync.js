#!/usr/bin/env node
/**
 * npm run sync-sheet [-- --add-only]
 * Adds every test that is in the code but not in the sheet's "QA Tests" tab (Ticket Status "Active"),
 * and refreshes Module / Test / Kind / Role / Steps / Expected of existing active rows.
 * Never touches Ticket Status, Dev Ticket, Reference (original) or Remarks, and never touches a Cancelled row.
 */
import { loadCatalog, sheetFields } from './catalog.js';
import { syncTests } from './sheet.js';

const tests = (await loadCatalog()).map(sheetFields);
const r = await syncTests(tests, { update: !process.argv.includes('--add-only') });
console.log(`Sheet synced: ${r.added.length} added, ${r.updated.length} updated, ${r.skippedCancelled.length} cancelled rows left alone.`);
if (r.added.length) console.log('  Added: ' + r.added.join(', '));
if (r.updated.length) console.log('  Updated: ' + r.updated.join(', '));
