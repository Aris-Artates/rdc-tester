#!/usr/bin/env node
/**
 * npm run push-results [-- <run folder or results.csv>] [--status Fail,Blocked] [--dry]
 * Sends a finished (or stopped) run's results.csv to the sheet, for runs made without --push or whose pushes
 * failed. Without a path it takes the newest results/run-* folder that has a results.csv.
 * Each result keeps the time it was checked. Results the sheet already has (its Last Checked is the same or
 * newer) are not sent again, and the sheet never lets an older result replace a newer one.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.js';
import { loadSheetRows, sheetConfigured, isRetired, pushResults } from './sheet.js';

const args = process.argv.slice(2);
const opt = k => { const i = args.indexOf('--' + k); return i < 0 ? null : (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true); };
const target = args.find((a, i) => !a.startsWith('--') && !(i && args[i - 1] === '--status'));

function findCsv() {
  if (target) {
    const p = path.resolve(target);
    return fs.existsSync(p) && fs.statSync(p).isDirectory() ? path.join(p, 'results.csv') : p;
  }
  const dir = path.join(ROOT, 'results');
  const runs = fs.existsSync(dir) ? fs.readdirSync(dir).filter(d => /^run-/.test(d)).sort().reverse() : [];
  const run = runs.find(d => fs.existsSync(path.join(dir, d, 'results.csv')));
  return run ? path.join(dir, run, 'results.csv') : null;
}

/** RFC 4180 rows (the notes can hold commas, quotes and line breaks). */
function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const csv = findCsv();
if (!csv || !fs.existsSync(csv)) { console.log(`No results.csv found${target ? ' at ' + target : ' under results/'}.`); process.exit(1); }
const [head, ...lines] = parseCsv(fs.readFileSync(csv, 'utf8').replace(/^﻿/, ''));
const col = name => head.indexOf(name);
const need = ['TC ID', 'Checker', 'Checked At', 'Environment', 'Result', 'Notes', 'Screenshot'];
if (need.some(n => col(n) < 0)) { console.log(`${csv} is not a results.csv (columns: ${head.join(', ')}).`); process.exit(1); }

const statuses = typeof opt('status') === 'string' ? opt('status').split(',').map(s => s.trim()) : null;
let results = lines.filter(r => r[col('TC ID')]).map(r => {
  const at = new Date(r[col('Checked At')]);
  const shot = r[col('Screenshot')];
  return {
    id: r[col('TC ID')], checker: r[col('Checker')], env: r[col('Environment')], result: r[col('Result')], notes: r[col('Notes')],
    checkedAt: isNaN(at) ? null : at.toISOString(),
    // An older run's screenshot paths may be relative to the project.
    screenshot: shot ? (path.isAbsolute(shot) ? shot : path.join(ROOT, shot)) : '',
  };
});
if (statuses) results = results.filter(r => statuses.includes(r.result));
const undated = results.filter(r => !r.checkedAt).length;
console.log(`${results.length} results in ${path.relative(ROOT, csv)}${statuses ? ` (${statuses.join(', ')})` : ''}${undated ? `, ${undated} without a readable time (sent as checked now)` : ''}.`);

if (!sheetConfigured()) { console.log('SHEET_WEBAPP_URL / SHEET_TOKEN missing in .env: nothing sent.'); process.exit(1); }
let sheet;
try { sheet = await loadSheetRows(); }
catch (e) { console.log(`Sheet not reached: ${e.message.split(' <')[0]}
Nothing sent; the CSV is unchanged, so run this again once the sheet answers.`); process.exit(1); }
const notInSheet = [], retired = [], already = [];
const knowsTimes = [...sheet.values()].some(r => 'checkedAt' in r);
const send = results.filter(r => {
  const row = sheet.get(r.id);
  if (!row) { notInSheet.push(r.id); return false; }
  if (isRetired(row)) { retired.push(r.id); return false; }
  if (row.checkedAt && r.checkedAt && new Date(row.checkedAt) >= new Date(r.checkedAt)) { already.push(r.id); return false; }
  return true;
});
if (!knowsTimes) console.log('  The sheet\'s web app is an older version: it cannot tell which results it already has, and stamps them with the time sent. Deploy the current RdcCheckerApi.gs to keep the original times.');
if (already.length) console.log(`  Already in the sheet (same or newer result): ${already.length}`);
if (retired.length) console.log(`  Closed / Reworked, not sent: ${retired.join(', ')}`);
if (notInSheet.length) console.log(`  Not in the sheet (run "npm run sync-sheet" first): ${notInSheet.join(', ')}`);

if (opt('dry')) { console.log(`Dry run: ${send.length} would be sent.`); process.exit(0); }
if (!send.length) { console.log('Nothing to send.'); process.exit(0); }
// Small batches with a long wait: each result is several cell writes (and maybe a Drive upload) in the sheet,
// and Apps Script allows a call up to 6 minutes. If one still times out, running this again carries on, because
// whatever the sheet saved is skipped next time.
let out;
try {
  out = await pushResults(send, { chunkSize: 10, timeoutMs: 330000, onChunk: (n, total) => process.stdout.write(`\r  Sent ${n} of ${total}`) });
  process.stdout.write('\n');
} catch (e) {
  console.log(`\n${e.message}. ${e.written || 0} written before that. Run npm run push-results again to send the rest.`);
  process.exit(1);
}
const { written, skipped, older } = out;
console.log(`Written to the sheet: ${written} of ${send.length}.${skipped.length ? ` Refused as Closed / Reworked: ${skipped.join(', ')}.` : ''}`);
if (older.length) console.log(`  Logged only (the sheet has a newer result): ${older.join(', ')}`);
