#!/usr/bin/env node
/**
 * npm run compare -- [options]
 *   --role admin,agency_head   only these roles (default: every role with an account on both sites, plus "public")
 *   --page "Accounts"          only pages whose menu path contains this text (comma list allowed)
 *   --workers 3                roles checked at the same time (default 3)
 *   --no-click                 do not click buttons (faster: access, layout and data only)
 *   --write                    also run the write round-trips (src/roundtrips.js): needs ALLOW_WRITE_TESTS=true
 *   --headed                   show the browsers
 *
 * For every role and every page of the original site's menus (src/pagemap.js), with the ORIGINAL SITE AS THE
 * BASELINE and Vercel as the site under test:
 *   access   the role can open the page on both sites, or is blocked on both
 *   layout   every column, filter and button the original offers is on Vercel
 *   buttons  clicking each non-destructive button does the same thing on both (same dialog and fields,
 *            same page, or a download); destructive ones (Save, Delete, Approve...) only with --write
 *   data     the table holds the same number of rows (the "Showing 1 to 10 of N entries" total)
 * Writes results/compare-<time>/index.html: a summary grid plus, per page, side-by-side screenshots and
 * every difference. Read only unless --write.
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { ROOT, config, accountFor, originalAccountFor } from './config.js';
import { login, open as openVercel, settle } from './app.js';
import { loginOriginal } from './original.js';
import { readShape } from './shape.js';
import { compareSelects, columnsMissing } from './parity.js';
import { ROLE_INFO } from './roles.js';
import { PAGES } from './pagemap.js';
import { writeReport } from './report.js';

const args = process.argv.slice(2);
const opt = n => { const i = args.indexOf('--' + n); return i < 0 ? null : (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true); };
const list = n => (typeof opt(n) === 'string' ? opt(n).split(',').map(s => s.trim()).filter(Boolean) : null);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Buttons whose click changes data, sends something or leaves the app: never clicked by the layout pass.
const DESTRUCTIVE = /delete|remove|trash|save|submit|approve|disapprove|endorse|lock|unlock|send|upload|import|restore|reset|archive|log ?out|sign ?out|publish|post|confirm|yes|proceed|update|apply|generate|sync|clear/i;
// The original site says a page is not for this role with a redirect, its login form, or a message.
const DENIED_TEXT = /(do not|don't) have (permission|access)|not allowed|unauthori[sz]ed|access denied|restricted page|permission denied/i;

const VIEWPORT = { width: 1366, height: 900 };
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const OUT = path.join(ROOT, 'results', 'compare-' + stamp);
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

// ---- per site: open a page and say whether the role got it ------------------------------------------
async function openLegacy(page, p) {
  const want = new URL(config.originalUrl + p).pathname;
  const resp = await page.goto(config.originalUrl + p, { waitUntil: 'domcontentloaded', timeout: config.pageTimeoutMs }).catch(e => ({ error: e }));
  if (resp?.error) return { state: 'crashed', detail: 'Navigation failed: ' + resp.error.message.split('\n')[0] };
  const body = await settle(page);
  const now = new URL(page.url()).pathname;
  if (await page.locator('#ajax-login-form').isVisible().catch(() => false)) return { state: 'blocked', detail: 'Original site shows its login form' };
  if (resp && resp.status() >= 500) return { state: 'crashed', detail: `HTTP ${resp.status()}` };
  if (resp && resp.status() === 404) return { state: 'notfound', detail: 'HTTP 404' };
  if (now !== want) return { state: 'blocked', detail: 'Sent to ' + now };
  if (DENIED_TEXT.test(body) && body.length < 4000) return { state: 'blocked', detail: 'Page says: ' + body.match(DENIED_TEXT)[0] };
  return { state: 'allowed', detail: 'Page loaded' };
}
async function openNew(page, p) {
  const r = await openVercel(page, p);
  if (r.state === 'redirected' || r.state === 'logged-out') return { ...r, state: 'blocked' };
  return r;
}

// ---- what a page holds ----------------------------------------------------------------------------------
/** Row total from "Showing 1 to 10 of 1,234 entries" (both sites), else the rows shown. */
async function rowTotal(page) {
  return page.evaluate(() => {
    const t = document.body.innerText;
    const m = t.match(/Showing\s+[\d,]+\s+to\s+[\d,]+\s+of\s+([\d,]+)\s+entries/i);
    if (m) return { total: Number(m[1].replace(/,/g, '')), how: 'entries' };
    if (/Showing 0 to 0 of 0 entries|No entries|No data available/i.test(t)) return { total: 0, how: 'entries' };
    const table = [...document.querySelectorAll('table')].find(x => x.offsetParent && !x.closest('.modal, [role="dialog"]'));
    return table ? { total: table.querySelectorAll('tbody tr').length, how: 'rows shown' } : null;
  });
}

/** Visible buttons with their labels (icon-only buttons by aria-label/title), in page order. */
async function buttonsOf(page) {
  return page.evaluate(() => {
    const clean = s => String(s || '').replace(/\s+/g, ' ').trim();
    const shown = e => !!(e.offsetParent || e.getClientRects().length);
    const out = [];
    for (const b of document.querySelectorAll('button, a.btn, .btn, input[type=button], input[type=submit]')) {
      if (!shown(b) || b.closest('nav, header, footer, .modal, [role="dialog"], [data-sonner-toaster], thead, .dataTables_paginate, [aria-label="pagination"]')) continue;
      const label = clean(b.innerText || b.value) || clean(b.getAttribute('aria-label') || b.title);
      if (!label || label.length > 40 || /^[«‹›»…\d\s]+$|^(Previous|Next|First|Last|Toggle Dropdown)$/i.test(label)) continue;
      out.push({ label, inTable: !!b.closest('table') });
    }
    return out;
  });
}

/**
 * Click the first visible button with this label and report what happened:
 * dialog (title + field labels) | page (new path) | download | none. Then puts the page back.
 */
async function clickOutcome(page, site, label, reopen) {
  const before = page.url();
  const target = page.locator('button, a.btn, .btn, input[type=button]').filter({ hasText: label }).filter({ visible: true }).first();
  if (!(await target.count())) return { kind: 'missing' };
  const download = page.waitForEvent('download', { timeout: 4000 }).catch(() => null);
  const popup = page.context().waitForEvent('page', { timeout: 4000 }).catch(() => null);
  await target.click({ timeout: 8000 }).catch(() => {});
  await sleep(1500);
  const [d, w] = await Promise.all([download, popup]);
  let out;
  if (d) out = { kind: 'download', detail: d.suggestedFilename() };
  else if (w) { out = { kind: 'new tab', detail: new URL(w.url()).pathname }; await w.close().catch(() => {}); }
  else if (page.url() !== before) {
    await page.waitForLoadState('load', { timeout: config.pageTimeoutMs }).catch(() => {});
    await settle(page, 10000);
    // A separate add/edit page is a form too: keep its field labels so it can be compared with a dialog.
    const fields = await page.evaluate(() => [...document.querySelectorAll('label')].filter(l => l.offsetParent && !l.closest('nav, header, footer, .modal, [role="dialog"]'))
      .map(l => String(l.innerText || '').split('\n')[0].replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 25));
    out = { kind: 'page', detail: new URL(page.url()).pathname + new URL(page.url()).search, fields };
  } else {
    const dialog = await page.evaluate(() => {
      const clean = s => String(s || '').replace(/\s+/g, ' ').trim();
      // Bootstrap / SweetAlert modals on the original; Radix dialogs or plain full-screen overlays (".fixed.inset-0") on Vercel.
      const box = [...document.querySelectorAll('.modal.show, .modal.in, [role="dialog"], .swal-modal, .swal2-popup, .fixed.inset-0')].find(e => (e.offsetParent || e.getClientRects().length) && e.querySelector('h2, h3, .modal-title, label, input'));
      if (!box) return null;
      const title = clean(box.querySelector('.modal-title, h2, h3, .swal-title, .swal2-title')?.textContent);
      // A label's first line only: a label that wraps a dropdown would otherwise carry every option's text.
      const fields = [...box.querySelectorAll('label')].map(l => clean(String(l.innerText || l.textContent).split('\n')[0])).filter(Boolean).slice(0, 25);
      return { title, fields };
    });
    out = dialog ? { kind: 'dialog', detail: dialog.title, fields: dialog.fields } : { kind: 'none' };
  }
  // Put the page back the way it was for the next button.
  await page.keyboard.press('Escape').catch(() => {});
  if (page.url() !== before || out.kind === 'dialog') await reopen();
  return out;
}

// ---- one page for one role ---------------------------------------------------------------------------
async function comparePage(ctx, p, role, dir) {
  const res = { menu: p.menu, legacyPath: p.legacy, vercelPath: p.vercel, role, problems: [], notes: [], shots: {} };
  const L = await openLegacy(ctx.legacy, p.legacy);
  res.legacyAccess = L;
  if (!p.vercel) {
    res.access = L.state === 'allowed' ? 'missing' : 'ok';
    if (L.state === 'allowed') res.problems.push('No Vercel page for this original page yet');
    res.status = L.state === 'allowed' ? 'Fail' : 'Pass';
    if (L.state === 'allowed') res.shots.legacy = await shot(ctx.legacy, dir, p, 'legacy');
    return res;
  }
  const V = await openNew(ctx.vercel, p.vercel);
  res.vercelAccess = V;
  if (L.state === 'crashed' || L.state === 'notfound') { res.status = 'Blocked'; res.notes.push(`Original site: ${L.detail}`); return res; }
  if (L.state !== V.state) {
    if (L.state === 'blocked' && V.state === 'allowed') res.problems.push(`Access: Vercel lets this role open the page; the original blocks it (${L.detail})`);
    else if (L.state === 'allowed' && V.state === 'blocked') res.problems.push(`Access: the original lets this role open the page; Vercel blocks it (${V.detail})`);
    else res.problems.push(`Access: original ${L.state} (${L.detail}), Vercel ${V.state} (${V.detail})`);
  }
  if (L.state === 'allowed') res.shots.legacy = await shot(ctx.legacy, dir, p, 'legacy');
  if (V.state === 'allowed' || V.state === 'crashed' || V.state === 'coming-soon') res.shots.vercel = await shot(ctx.vercel, dir, p, 'vercel');
  if (L.state !== 'allowed' || V.state !== 'allowed') { res.status = res.problems.length ? 'Fail' : 'Pass'; return res; }

  // Layout: columns, filters, buttons (the original is the baseline; Vercel extras are notes).
  const [ls, vs] = [await ctx.legacy.evaluate(readShape), await ctx.vercel.evaluate(readShape)];
  const oc = ls.tables[0] || [], vc = vs.tables[0] || [];
  if (oc.length && !vc.length) res.problems.push('Layout: the original has a table, Vercel has none');
  else if (oc.length) {
    const { gone, renamed } = columnsMissing(oc, vc);
    if (gone.length) res.problems.push('Columns missing on Vercel: ' + gone.join(', '));
    if (renamed.length) res.notes.push('Renamed columns: ' + renamed.join(', '));
    const extra = columnsMissing(vc, oc).gone;
    if (extra.length) res.notes.push('Vercel adds columns: ' + extra.join(', '));
  }
  const { lines, notes } = compareSelects(ls.selects, vs.selects);
  res.problems.push(...lines.map(l => 'Filters: ' + l)); res.notes.push(...notes);

  const [lb, vb] = [await buttonsOf(ctx.legacy), await buttonsOf(ctx.vercel)];
  const pageButtons = list => [...new Set(list.filter(b => !b.inTable).map(b => b.label))];
  const rowButtons = list => [...new Set(list.filter(b => b.inTable).map(b => b.label))];
  const goneTop = columnsMissing(pageButtons(lb), pageButtons(vb)).gone;
  if (goneTop.length) res.problems.push('Buttons missing on Vercel: ' + goneTop.join(', '));
  // Row buttons are mostly status chips whose labels depend on the rows shown, so they are a note, not a failure.
  const goneRow = columnsMissing(rowButtons(lb), rowButtons(vb)).gone;
  if (goneRow.length) res.notes.push('Row buttons on the original not seen on Vercel\'s first page: ' + goneRow.join(', '));
  res.buttons = { legacy: lb.length, vercel: vb.length };
  res.notes.push(`Buttons: original ${pageButtons(lb).length} on the page + ${rowButtons(lb).length} row actions, Vercel ${pageButtons(vb).length} + ${rowButtons(vb).length}`);

  // Data: the same number of rows (legacy is the baseline).
  const [lt, vt] = [await rowTotal(ctx.legacy), await rowTotal(ctx.vercel)];
  res.data = { legacy: lt, vercel: vt };
  if (lt && vt && lt.total !== vt.total) res.problems.push(`Data: the original lists ${lt.total} rows, Vercel ${vt.total}`);
  else if (lt && !vt) res.problems.push(`Data: the original lists ${lt.total} rows, Vercel shows no table`);

  // Button functions: click what both sites offer (non-destructive only) and compare the outcome.
  if (!opt('no-click')) {
    const both = pageButtons(lb).filter(l => !DESTRUCTIVE.test(l) && !columnsMissing([l], pageButtons(vb)).gone.length).slice(0, 10);
    res.clicks = [];
    for (const label of both) {
      const vLabel = pageButtons(vb).find(v => !columnsMissing([label], [v]).gone.length) || label;
      const lo = await clickOutcome(ctx.legacy, 'legacy', label, () => openLegacy(ctx.legacy, p.legacy));
      const vo = await clickOutcome(ctx.vercel, 'vercel', vLabel, () => openNew(ctx.vercel, p.vercel));
      // A button hidden behind a menu or a collapsed panel cannot be clicked directly; the layout check covers it.
      if (lo.kind === 'missing' || vo.kind === 'missing') continue;
      // An add page on one site and a dialog on the other are the same feature when both are forms.
      const kind = o => ((o.kind === 'dialog' || o.kind === 'page') && o.fields?.length ? 'form' : o.kind);
      const same = kind(lo) === kind(vo);
      const click = { label, legacy: lo, vercel: vo, same };
      if (same && lo.fields?.length) {
        const gone = columnsMissing(lo.fields.filter(f => !NOT_FIELD.test(f)), (vo.fields || []).filter(f => !NOT_FIELD.test(f))).gone;
        if (gone.length) { click.same = false; res.problems.push(`"${label}" form lacks fields on Vercel: ${gone.join(', ')}`); }
      } else if (!same) res.problems.push(`"${label}": the original gives ${describe(lo)}, Vercel ${describe(vo)}`);
      res.clicks.push(click);
    }
  }
  res.status = res.problems.length ? 'Fail' : 'Pass';
  return res;
}
// Table controls inside a dialog ("10 entries per page", "Search:") are not form fields.
const NOT_FIELD = /entries per page|^search:?$|^show$|^\d+$/i;
const describe = o => o.kind + (o.detail ? ` "${o.detail}"` : '');

async function shot(page, dir, p, site) {
  const file = path.join(dir, `${slug(p.menu)}-${site}.png`);
  await page.screenshot({ path: file }).catch(() => {});
  return path.relative(OUT, file).replace(/\\/g, '/');
}

// ---- one role -----------------------------------------------------------------------------------------
async function runRole(browser, info, pages) {
  const dir = path.join(OUT, 'shots', info.role);
  fs.mkdirSync(dir, { recursive: true });
  const out = { role: info.role, name: info.name, pages: [], blocked: null };
  const lctx = await browser.newContext({ viewport: VIEWPORT, acceptDownloads: true });
  const vctx = await browser.newContext({ viewport: VIEWPORT, acceptDownloads: true });
  const ctx = { legacy: await lctx.newPage(), vercel: await vctx.newPage() };
  try {
    if (info.role !== 'public') {
      const va = accountFor(info.role), la = originalAccountFor(info.role);
      if (!va || !la) { out.blocked = `No account in .env (${!va ? 'NEW_' + info.key : ''}${!va && !la ? ', ' : ''}${!la ? 'LEGACY_' + info.key : ''})`; return out; }
      const [vr, lr] = [await login(ctx.vercel, va), await loginOriginal(ctx.legacy, la)];
      if (!vr.ok || !lr.ok) { out.blocked = [!vr.ok && 'Vercel: ' + vr.message, !lr.ok && lr.message].filter(Boolean).join(' | ').replace(/\(username.*?\)/g, ''); return out; }
    }
    for (const p of pages) {
      const r = await comparePage(ctx, p, info.role, dir).catch(e => ({ menu: p.menu, legacyPath: p.legacy, vercelPath: p.vercel, role: info.role, status: 'Blocked', problems: [], notes: ['Checker error: ' + String(e.message || e).split('\n')[0]], shots: {} }));
      out.pages.push(r);
      console.log(`  ${info.role.padEnd(20)} ${r.status.padEnd(7)} ${p.menu}${r.problems.length ? '  — ' + r.problems[0].slice(0, 120) : ''}`);
    }
  } finally { await lctx.close(); await vctx.close(); }
  return out;
}

// ---- main -----------------------------------------------------------------------------------------------
const roleFilter = list('role');
const roles = ROLE_INFO.filter(r => !r.vercelOnly && (roleFilter ? roleFilter.includes(r.role) : r.role === 'public' || (accountFor(r.role) && originalAccountFor(r.role))));
const pageFilter = list('page');
const pages = PAGES.filter(p => !pageFilter || pageFilter.some(f => p.menu.toLowerCase().includes(f.toLowerCase())));
fs.mkdirSync(OUT, { recursive: true });
console.log(`Comparing ${pages.length} pages for ${roles.length} roles: ${roles.map(r => r.role).join(', ')}`);
console.log(`Original (baseline): ${config.originalUrl}   Vercel (tested): ${config.appUrl}`);

const browser = await chromium.launch({ headless: !opt('headed') });
const results = [];
const queue = [...roles];
const workers = Math.max(1, Number(opt('workers')) || 3);
await Promise.all(Array.from({ length: Math.min(workers, queue.length) }, async () => {
  while (queue.length) { const info = queue.shift(); results.push(await runRole(browser, info, pages)); }
}));

let writes = null;
if (opt('write')) {
  if (!config.allowWrite) console.log('--write skipped: set ALLOW_WRITE_TESTS=true in .env first.');
  else { const { runRoundTrips } = await import('./roundtrips.js'); writes = await runRoundTrips(browser, OUT); }
}
await browser.close();

results.sort((a, b) => roles.findIndex(r => r.role === a.role) - roles.findIndex(r => r.role === b.role));
const file = writeReport(OUT, { results, writes, pages, started: stamp, originalUrl: config.originalUrl, vercelUrl: config.appUrl });
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ results, writes }, null, 1));
const all = results.flatMap(r => r.pages);
const count = s => all.filter(x => x.status === s).length;
console.log(`\nDone: ${count('Pass')} Pass, ${count('Fail')} Fail, ${count('Blocked')} Blocked across ${results.length} roles${results.some(r => r.blocked) ? ` (${results.filter(r => r.blocked).length} roles could not sign in)` : ''}.`);
console.log('Report: ' + file);
