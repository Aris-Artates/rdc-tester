/**
 * The original-vs-Vercel checks for one page, shared by `npm run compare` (src/compare.js, HTML report) and the
 * ACC- / CMP- test cases (src/tests/matrix.js, the sheet). The original site is the baseline.
 *   checkAccess    the role can open the page on both sites, or is blocked on both
 *   checkFeatures  columns, filters, buttons, what each non-destructive button does, row totals
 * `ctx` is { legacy: <page signed in to the original>, vercel: <page signed in to Vercel> } as the same role.
 */
import { config } from './config.js';
import { open as openVercel, settle } from './app.js';
import { readShape } from './shape.js';
import { compareSelects, columnsMissing } from './parity.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Buttons whose click changes data, sends something or leaves the app: never clicked by the layout pass.
export const DESTRUCTIVE = /delete|remove|trash|save|submit|approve|disapprove|endorse|lock|unlock|send|upload|import|restore|reset|archive|log ?out|sign ?out|publish|post|confirm|yes|proceed|update|apply|generate|sync|clear/i;
// The original site says a page is not for this role with a redirect, its login form, or a message.
const DENIED_TEXT = /(do not|don't) have (permission|access)|not allowed|unauthori[sz]ed|access denied|restricted page|permission denied/i;
// Table controls inside a dialog ("10 entries per page", "Search:") are not form fields.
const NOT_FIELD = /entries per page|^search:?$|^show$|^\d+$/i;

// ---- per site: open a page and say whether the role got it ------------------------------------------
export async function openLegacy(page, p) {
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
export async function openNew(page, p) {
  const r = await openVercel(page, p);
  if (r.state === 'redirected' || r.state === 'logged-out') return { ...r, state: 'blocked' };
  return r;
}

// ---- what a page holds ----------------------------------------------------------------------------------
/** Row total from "Showing 1 to 10 of 1,234 entries" (both sites), else the rows shown. */
export async function rowTotal(page) {
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
export async function buttonsOf(page) {
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
 * dialog (title + field labels) | page (new path + field labels) | download | new tab | none. Then puts the page back.
 */
export async function clickOutcome(page, label, reopen) {
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
export const describe = o => o.kind + (o.detail ? ` "${o.detail}"` : '');

// ---- the two checks ---------------------------------------------------------------------------------------
/**
 * Open the page on both sites. { legacy, vercel, problems, verdict } where verdict is
 * 'both-open' | 'both-blocked' | 'differs' | 'no-vercel-page' | 'original-broken'.
 */
export async function checkAccess(ctx, p) {
  const L = await openLegacy(ctx.legacy, p.legacy);
  const out = { legacy: L, vercel: null, problems: [] };
  if (L.state === 'crashed' || L.state === 'notfound') return { ...out, verdict: 'original-broken' };
  if (!p.vercel) {
    if (L.state === 'allowed') out.problems.push('No Vercel page for this original page yet');
    return { ...out, verdict: L.state === 'allowed' ? 'no-vercel-page' : 'both-blocked' };
  }
  const V = await openNew(ctx.vercel, p.vercel);
  out.vercel = V;
  // A Vercel page that is still a "coming soon" placeholder (or missing) is not built yet, like no page at all.
  if (L.state === 'allowed' && (V.state === 'coming-soon' || V.state === 'notfound')) {
    out.problems.push(`Not built on Vercel yet: ${p.vercel} shows ${V.detail}`);
    return { ...out, verdict: 'no-vercel-page' };
  }
  if (L.state === V.state) return { ...out, verdict: L.state === 'allowed' ? 'both-open' : 'both-blocked' };
  if (L.state === 'blocked' && V.state === 'allowed') out.problems.push(`Access: Vercel lets this role open the page; the original blocks it (${L.detail})`);
  else if (L.state === 'allowed' && V.state === 'blocked') out.problems.push(`Access: the original lets this role open the page; Vercel blocks it (${V.detail})`);
  else out.problems.push(`Access: original ${L.state} (${L.detail}), Vercel ${V.state} (${V.detail})`);
  return { ...out, verdict: 'differs' };
}

/** With the page open on both sites: everything the original offers must be on Vercel and act the same. */
export async function checkFeatures(ctx, p, { click = true } = {}) {
  const res = { problems: [], notes: [], clicks: [], data: null, buttons: null };
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

  // Data: the same number of rows (the original is the baseline).
  const [lt, vt] = [await rowTotal(ctx.legacy), await rowTotal(ctx.vercel)];
  res.data = { legacy: lt, vercel: vt };
  if (lt && vt && lt.total !== vt.total) res.problems.push(`Data: the original lists ${lt.total} rows, Vercel ${vt.total}`);
  else if (lt && !vt) res.problems.push(`Data: the original lists ${lt.total} rows, Vercel shows no table`);

  // Button functions: click what both sites offer (non-destructive only) and compare the outcome.
  if (click) {
    const both = pageButtons(lb).filter(l => !DESTRUCTIVE.test(l) && !columnsMissing([l], pageButtons(vb)).gone.length).slice(0, 10);
    for (const label of both) {
      const vLabel = pageButtons(vb).find(v => !columnsMissing([label], [v]).gone.length) || label;
      const lo = await clickOutcome(ctx.legacy, label, () => openLegacy(ctx.legacy, p.legacy));
      const vo = await clickOutcome(ctx.vercel, vLabel, () => openNew(ctx.vercel, p.vercel));
      // A button hidden behind a menu or a collapsed panel cannot be clicked directly; the layout check covers it.
      if (lo.kind === 'missing' || vo.kind === 'missing') continue;
      // An add page on one site and a dialog on the other are the same feature when both are forms.
      const kind = o => ((o.kind === 'dialog' || o.kind === 'page') && o.fields?.length ? 'form' : o.kind);
      const same = kind(lo) === kind(vo);
      const c = { label, legacy: lo, vercel: vo, same };
      if (same && lo.fields?.length) {
        const gone = columnsMissing(lo.fields.filter(f => !NOT_FIELD.test(f)), (vo.fields || []).filter(f => !NOT_FIELD.test(f))).gone;
        if (gone.length) { c.same = false; res.problems.push(`"${label}" form lacks fields on Vercel: ${gone.join(', ')}`); }
      } else if (!same) res.problems.push(`"${label}": the original gives ${describe(lo)}, Vercel ${describe(vo)}`);
      res.clicks.push(c);
    }
  }
  return res;
}
