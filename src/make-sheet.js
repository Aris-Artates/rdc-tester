#!/usr/bin/env node
/**
 * npm run make-sheet
 * Writes sheet/RDC-QA-Checker.xlsx: a ready QA sheet (Tests with every test in the code,
 * Check Log, Team, Settings). Import it into Google Sheets, then run
 * RDC Checker > Set up / repair sheet to add the dropdowns, colours and Summary tab.
 */
import fs from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';
import { ROOT } from './config.js';
import { loadCatalog } from './catalog.js';

XLSX.set_fs(fs);
const tests = await loadCatalog();

const head = ['TC ID', 'Module', 'Test', 'Kind', 'Role', 'Steps to Test', 'Expected Result', 'Reference (original)', 'Ticket Status', 'Implemented on Vercel', 'Latest Result', 'Last Checked', 'Last Notes', 'Screenshot', 'Remarks'];
const rows = tests.map(t => [t.id, t.module, t.title, t.kind, t.role, t.steps, t.expected, t.reference || '', 'Active', t.pending ? 'No' : '', '', '', '', '', '']);
const wb = XLSX.utils.book_new();
const ws = XLSX.utils.aoa_to_sheet([head, ...rows]);
ws['!cols'] = [10, 18, 48, 11, 9, 48, 48, 18, 13, 13, 14, 16, 50, 14, 30].map(wch => ({ wch }));
ws['!freeze'] = { xSplit: 1, ySplit: 1 };
XLSX.utils.book_append_sheet(wb, ws, 'Tests');
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['TC ID', 'Checker', 'Checked At', 'Environment', 'Result', 'Notes', 'Screenshot']]), 'Check Log');
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Name', 'Email', 'Role'], ['RDC QA Bot', '', 'Automated checker (CHECKER_NAME in .env)']]), 'Team');
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
  ['Ticket Status', 'Result', 'Kind', 'Role', '', 'Setting', 'Value'],
  ['Active', 'Pass', 'Functional', 'public', '', 'App under test (Vercel)', 'https://rdc8ims.vercel.app'],
  ['On Hold', 'Fail', 'Logic', 'admin', '', 'Original site (reference only)', 'https://evims.rdc8ims.online'],
  ['Cancelled', 'Blocked', 'Data', 'member', '', 'Screenshot folder (Drive)', 'RDC QA Screenshots'],
  ['', 'Not Implemented', 'Access', '', '', 'Ticket Status that the checker skips', 'Cancelled'],
  ['', 'Not Started', 'Pending', '', '', 'Token', 'Stored in Apps Script > Project Settings > Script Properties > QA_TOKEN (never here)'],
]), 'Settings');

const out = path.join(ROOT, 'sheet', 'RDC-QA-Checker.xlsx');
fs.mkdirSync(path.dirname(out), { recursive: true });
XLSX.writeFile(wb, out);
console.log(`Wrote ${out} (${tests.length} tests).`);
