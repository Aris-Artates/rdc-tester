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
import { login } from './app.js';
import { loginOriginal } from './original.js';
import { checkAccess, checkFeatures } from './comparelib.js';
import { ROLE_INFO } from './roles.js';
import { PAGES } from './pagemap.js';
import { writeReport } from './report.js';

const args = process.argv.slice(2);
const opt = n => { const i = args.indexOf('--' + n); return i < 0 ? null : (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true); };
const list = n => (typeof opt(n) === 'string' ? opt(n).split(',').map(s => s.trim()).filter(Boolean) : null);

const VIEWPORT = { width: 1366, height: 900 };
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const OUT = path.join(ROOT, 'results', 'compare-' + stamp);
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

// ---- one page for one role ---------------------------------------------------------------------------
async function comparePage(ctx, p, role, dir) {
  const res = { menu: p.menu, legacyPath: p.legacy, vercelPath: p.vercel, role, problems: [], notes: [], shots: {} };
  const a = await checkAccess(ctx, p);
  res.legacyAccess = a.legacy; res.vercelAccess = a.vercel; res.problems.push(...a.problems);
  if (a.verdict === 'original-broken') { res.status = 'Blocked'; res.notes.push(`Original site: ${a.legacy.detail}`); return res; }
  if (a.legacy.state === 'allowed') res.shots.legacy = await shot(ctx.legacy, dir, p, 'legacy');
  if (a.vercel && ['allowed', 'crashed', 'coming-soon'].includes(a.vercel.state)) res.shots.vercel = await shot(ctx.vercel, dir, p, 'vercel');
  if (a.verdict === 'both-open') {
    const f = await checkFeatures(ctx, p, { click: !opt('no-click') });
    res.problems.push(...f.problems); res.notes.push(...f.notes);
    Object.assign(res, { clicks: f.clicks, data: f.data, buttons: f.buttons });
  }
  res.status = res.problems.length ? 'Fail' : 'Pass';
  return res;
}

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
