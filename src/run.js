#!/usr/bin/env node
/**
 * npm run qa -- [options]
 *   --only PUB-001,ACO-002     only these TC IDs
 *   --module "Monitoring,Settings"  only these modules
 *   --kind Logic,Data          only these kinds (Functional, Logic, Data, Access, Pending)
 *   --role admin,agency_head  only tests that use these accounts (see ROLES in src/catalog.js)
 *   --status Fail,Blocked      only tests whose LATEST sheet result is one of these (retest)
 *   --ticket 12,15             only tests linked to these dev tickets (sheet column "Dev Ticket")
 *   --push                     write results to the sheet ("Check Log" + "QA Tests")
 *   --shots fail|all|none      screenshots (default fail)
 *   --headed                   show the browser
 *   --dry                      list what would run; no browser
 *   --list                     print the whole test catalog and exit
 *
 * Test cases set to Closed or Reworked in the sheet are never run and never written.
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { config, accountFor, originalAccountFor, separateOriginalAccounts, newKey, legacyKey, ROOT } from './config.js';
import { loadCatalog, ROLES } from './catalog.js';
import { loginOriginal } from './original.js';
import { loadSheetRows, sheetConfigured, isRetired, pushResults, writeCsv } from './sheet.js';
import { login, pathOf } from './app.js';
import { makeT, Outcome } from './harness.js';
import { notify, summaryLine } from './notify.js';

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf('--' + name); return i < 0 ? dflt : (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true); };
const list = v => (typeof v === 'string' ? v.split(',').map(s => s.trim().toLowerCase()).filter(Boolean) : null);

const catalog = await loadCatalog();
if (opt('list')) {
  if (opt('json')) { console.log(summaryLine({ kind: 'catalog', tests: catalog.map(({ run, ...t }) => t) })); process.exit(0); }
  for (const t of catalog) console.log(`${t.id.padEnd(9)} ${t.kind.padEnd(10)} ${t.role.padEnd(7)} ${t.module.padEnd(22)} ${t.title}${t.pending ? '  [pending]' : ''}${t.writes ? '  [writes]' : ''}`);
  console.log(`\n${catalog.length} tests.`);
  process.exit(0);
}

// ---- sheet: ticket status, references, latest results
let sheet = new Map();
if (sheetConfigured()) {
  try { sheet = await loadSheetRows(); console.log(`Sheet: ${sheet.size} test rows read.`); }
  catch (e) { console.log(`Sheet not read (${e.message}). Running without it: no cancel list, no references, no push.`); }
} else console.log('Sheet not configured (SHEET_WEBAPP_URL / SHEET_TOKEN): no cancel list, no references, results go to the CSV only.');

// A filter flag without a value ("--kind --push") would silently mean "everything": refuse it.
for (const f of ['only', 'module', 'kind', 'role', 'status', 'ticket']) {
  if (opt(f) === true) { console.log(`--${f} needs a value, e.g. --${f} ${{ only: 'PUB-001', module: '"Access & Sign-in"', kind: 'Logic', role: 'admin', status: 'Fail', ticket: '12' }[f]}`); process.exit(1); }
}
const only = list(opt('only')), modules = list(opt('module')), kinds = list(opt('kind')), roles = list(opt('role')), statuses = list(opt('status'));
const tickets = list(opt('ticket'))?.map(s => s.replace(/\D/g, '')).filter(Boolean);
// Retest without the sheet: take each test's latest result from the newest local run that has it.
const localLatest = new Map();
if (statuses && !sheet.size) {
  const runs = fs.existsSync(path.join(ROOT, 'results')) ? fs.readdirSync(path.join(ROOT, 'results')).filter(d => d.startsWith('run-')).sort().reverse() : [];
  for (const d of runs) {
    const file = path.join(ROOT, 'results', d, 'results.csv');
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, 'utf8').replace(/^﻿/, '').split(/\r?\n/).slice(1)) {
      const [id, , , , result] = (line.match(/"((?:[^"]|"")*)"/g) || []).map(c => c.slice(1, -1));
      if (id && result && !localLatest.has(id)) localLatest.set(id, { latest: result });
    }
  }
  console.log(`Retest without the sheet: latest results of ${localLatest.size} tests taken from ${runs.length} local runs.`);
}
if (tickets && !sheet.size) { console.log('--ticket needs the sheet (the Dev Ticket links live there).'); process.exit(1); }
const linkedTo = row => String(row?.devTicket || '').split(/\D+/).filter(Boolean);
const cancelled = [], notInSheet = [];
const selected = catalog.filter(t => {
  if (only && !only.includes(t.id.toLowerCase())) return false;
  if (modules && !modules.includes(t.module.toLowerCase())) return false;
  if (kinds && !kinds.includes(t.kind.toLowerCase())) return false;
  if (roles && !roles.includes(t.role)) return false;
  const row = sheet.get(t.id);
  const latest = (row || localLatest.get(t.id))?.latest;
  if (statuses && !statuses.includes(String(latest || 'not started').toLowerCase())) return false;
  if (tickets && !linkedTo(row).some(n => tickets.includes(n))) return false;
  if (isRetired(row)) { cancelled.push(t.id); return false; }
  if (sheet.size && !row) notInSheet.push(t.id);
  return true;
});

// public first, then each account; tests marked `last` (log out) end their group.
const order = ROLES;
const groups = order.map(role => ({ role, tests: selected.filter(t => t.role === role).sort((a, b) => !!a.last - !!b.last) })).filter(g => g.tests.length);

console.log(`\n${selected.length} tests to run on ${config.appUrl}.`);
if (tickets) console.log(`  Linked to dev ticket ${tickets.join(', ')}: ${selected.map(t => t.id).join(', ') || 'none (fill the Dev Ticket column in the sheet)'}`);
if (cancelled.length) console.log(`  Skipped (case Closed / Reworked): ${cancelled.join(', ')}`);
if (notInSheet.length) console.log(`  Not in the sheet yet (run "npm run sync-sheet"; their results are not pushed): ${notInSheet.join(', ')}`);
for (const g of groups) console.log(`  ${g.role.padEnd(7)} ${g.tests.length} tests${g.role !== 'public' && !accountFor(g.role) ? `  (no ${newKey(g.role)} in .env: they will be Blocked)` : ''}`);
if (opt('dry')) { for (const g of groups) for (const t of g.tests) console.log(`    ${t.id} ${t.title}`); process.exit(0); }

// ---- run
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = path.join(ROOT, 'results', 'run-' + stamp);
fs.mkdirSync(path.join(outDir, 'screenshots'), { recursive: true });
const shots = opt('shots', 'fail');
const browser = await chromium.launch({ headless: !opt('headed') });
const results = [];
const counts = { Pass: 0, Fail: 0, Blocked: 0, 'Not Implemented': 0 };

async function record(page, test, outcome) {
  const res = { id: test.id, result: outcome.result, notes: String(outcome.notes || '').slice(0, 1500), at: new Date().toLocaleString() };
  const wantShot = page && (shots === 'all' || (shots === 'fail' && outcome.result === 'Fail'));
  if (wantShot) {
    const file = path.join(outDir, 'screenshots', `${test.id}.png`);
    await page.screenshot({ path: file }).then(() => { res.screenshot = file; }).catch(() => {});
  }
  results.push(res); counts[res.result]++;
  console.log(`  ${res.result.padEnd(15)} ${test.id.padEnd(9)} ${test.title}${res.result === 'Pass' ? '' : '\n' + ' '.repeat(18) + res.notes}`);
}

async function runOne(t, test) {
  try {
    const out = await Promise.race([
      test.run(t),
      new Promise((_, rej) => setTimeout(() => rej(new Error('Test took longer than 3 minutes')), 180000)),
    ]);
    return out instanceof Outcome ? out : new Outcome('Fail', 'Test ended without t.pass()');
  } catch (e) {
    if (e instanceof Outcome) return e;
    return new Outcome('Fail', 'Error: ' + String(e.message || e).split('\n')[0]);
  }
}

let pushedUpTo = 0, pushedTotal = 0, skippedBySheet = [];
async function flush(label) {
  writeCsv(path.join(outDir, 'results.csv'), results);
  if (!opt('push') || !sheet.size) return;
  const batch = results.slice(pushedUpTo).filter(r => sheet.has(r.id));
  pushedUpTo = results.length;
  if (!batch.length) return;
  try {
    const { written, skipped } = await pushResults(batch);
    pushedTotal += written; skippedBySheet = skippedBySheet.concat(skipped);
    console.log(`  -> ${written} results written to the sheet (${label})${skipped.length ? `; refused as Closed / Reworked: ${skipped.join(', ')}` : ''}`);
  } catch (e) {
    pushedUpTo -= batch.length;
    console.log(`  -> PUSH FAILED (${label}): ${e.message}. Kept in the CSV; retried with the next batch.`);
  }
}

for (const { role, tests } of groups) {
  console.log(`\n== ${role}`);
  const account = role === 'public' ? null : accountFor(role);
  if (role !== 'public' && !account) {
    for (const test of tests) await record(null, test, new Outcome('Blocked', `No ${newKey(role)} in .env`));
    await flush(role);
    continue;
  }
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  let originalContext = null;
  const page = await context.newPage();
  page.setDefaultTimeout(config.pageTimeoutMs);
  try {
    let signIn = null;
    if (account) {
      signIn = await login(page, account);
      console.log('  ' + signIn.message);
      if (signIn.ok && signIn.landed === '/change-password') signIn = { ok: false, message: 'Account must change its default password first (sign in once by hand and change it)' };
      if (!signIn.ok) {
        for (const test of tests) await record(null, test, new Outcome('Blocked', 'Sign-in failed: ' + signIn.message));
        continue;
      }
    }
    // Parity tests also need the same role on the original site (read only).
    let originalPage = null, originalProblem = '';
    if (tests.some(t => t.original)) {
      const origAccount = role === 'public' ? null : originalAccountFor(role);
      if (role !== 'public' && !origAccount) {
        originalProblem = separateOriginalAccounts()
          ? `"Use different accounts" is on but no ${legacyKey(role)} is set (Settings > Original-site accounts)`
          : `No ${legacyKey(role)} or ${newKey(role)} in .env`;
      }
      else {
        originalContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
        originalPage = await originalContext.newPage();
        originalPage.setDefaultTimeout(config.pageTimeoutMs);
        if (origAccount) {
          const r = await loginOriginal(originalPage, origAccount);
          console.log('  ' + r.message);
          if (!r.ok) { originalProblem = r.message; originalPage = null; }
        }
      }
    }
    for (const test of tests) {
      if (test.original && !originalPage) { await record(null, test, new Outcome('Blocked', 'Original site: ' + originalProblem)); continue; }
      const mk = () => makeT({ page, test, sheetRow: sheet.get(test.id), originalPage: test.original ? originalPage : null });
      let outcome = await runOne(mk(), test);
      // Session dropped mid-run: sign in again once and retry, so one expiry doesn't fail the rest.
      if (outcome.result === 'Fail' && account && !test.last && pathOf(page.url()) === '/' && (await login(page, account)).ok) {
        outcome = await runOne(mk(), test);
      }
      await record(page, test, outcome);
    }
  } finally {
    await originalContext?.close().catch(() => {});
    await context.close().catch(() => {});
    await flush(role);
  }
}
await browser.close();

// ---- output
const csv = path.join(outDir, 'results.csv');
await flush('final retry');
const line = Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ');
console.log(`\nDone: ${line}. CSV: ${csv}`);
console.log(opt('push') ? `Written to the sheet: ${pushedTotal} of ${results.length}.` : 'Not pushed. Re-run with --push, or paste the CSV into the Check Log.');
console.log(summaryLine({ kind: 'run', counts, csv, pushed: pushedTotal, cancelled }));
await notify('RDC checker finished', line);
