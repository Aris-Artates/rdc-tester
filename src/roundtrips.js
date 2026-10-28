/**
 * Write round-trips (npm run compare -- --write, with ALLOW_WRITE_TESTS=true): on each settings / lookup page,
 * on BOTH sites, signed in as RDC Admin:
 *   1. Add: open the page's add form, fill every empty field (text = TEST-<time>, first choice in dropdowns), save
 *   2. Find: search the list for TEST-<time>; the new row must be there
 *   3. Delete: the row's delete action, confirm; the row must be gone
 * Each site gets a result per step; the page passes when both sites get the same result (the original is the
 * baseline, so a step that fails on the original too is not Vercel's fault). Only pages in ROUND_TRIPS are
 * touched, and only rows named TEST-...; a row that could not be deleted is reported as LEFTOVER so it can
 * be removed by hand.
 */
import fs from 'node:fs';
import path from 'node:path';
import { config, accountFor, originalAccountFor } from './config.js';
import { login, settle, abs } from './app.js';
import { loginOriginal } from './original.js';
import { PAGES } from './pagemap.js';

// Lookup pages whose records nothing else depends on until used: safe to add and delete a TEST- row.
export const ROUND_TRIPS = ['Settings > SDGs 2030', 'Settings > RDP Typology', 'Settings > UUAs and Conflict-affected Vulnerable Areas',
  'Settings > Fund Sources', 'Settings > Tier Type', 'Settings > Category', 'Settings > Classifications', 'Settings > Readiness Docs'];

const sleep = ms => new Promise(r => setTimeout(r, ms));
const ADD = /^\s*\+?\s*(add|new|create)\b/i;
const SAVE = /^\s*(save|submit|add|create)\b/i;
const DELETE = /delete|remove|trash/i;
const CONFIRM = /^\s*(yes|delete|confirm|ok|remove)\b/i;

async function visibleForm(page) {
  const dialog = page.locator('.modal.show, .modal.in, [role="dialog"]').filter({ visible: true }).last();
  return (await dialog.count()) ? dialog : page.locator('main, form, body').first();
}

async function addRecord(page, name) {
  const add = page.locator('button, a.btn, a').filter({ hasText: ADD }).filter({ visible: true }).first();
  if (!(await add.count())) return 'no Add button';
  await add.click(); await sleep(1500); await settle(page, 10000);
  const form = await visibleForm(page);
  let filled = 0;
  for (const el of await form.locator('input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]):not([type=search]), textarea').filter({ visible: true }).all()) {
    if (await el.inputValue().catch(() => 'x')) continue;
    const type = await el.getAttribute('type');
    await el.fill(type === 'number' ? '1' : type === 'date' ? '2027-01-01' : type === 'email' ? 'test@rdc8ims.test' : name).catch(() => {});
    filled++;
  }
  for (const sel of await form.locator('select').filter({ visible: true }).all()) {
    const value = await sel.evaluate(s => [...s.options].find(o => o.value && !o.disabled)?.value).catch(() => null);
    if (value && !(await sel.inputValue())) await sel.selectOption(value).catch(() => {});
  }
  if (!filled) return 'the add form has no text field';
  const save = form.locator('button, input[type=submit]').filter({ hasText: SAVE }).filter({ visible: true }).last();
  if (!(await save.count())) return 'no Save button in the add form';
  await save.click(); await sleep(2500); await settle(page, 10000);
  return 'ok';
}

async function findRow(page, name) {
  const search = page.locator('input[type=search], input[placeholder*="Search" i]').filter({ visible: true }).first();
  if (await search.count()) { await search.fill(name); await sleep(1500); await settle(page, 8000); }
  return page.locator('tr').filter({ hasText: name }).first();
}

async function deleteRow(page, row) {
  let del = row.locator('button, a').filter({ hasText: DELETE }).first();
  if (!(await del.count())) del = row.locator('[aria-label*="delete" i], [title*="delete" i], .fa-trash, .bi-trash').first();
  if (!(await del.count())) {
    const menu = row.locator('button').filter({ hasText: /action|more|⋮|…/i }).first();
    if (await menu.count()) { await menu.click(); await sleep(600); del = page.locator('[role="menuitem"], .dropdown-menu.show a, .dropdown-menu.show button').filter({ hasText: DELETE }).first(); }
  }
  if (!(await del.count())) return 'no Delete action on the row';
  await del.click(); await sleep(1000);
  const confirm = page.locator('.swal-button, .swal2-confirm, [role="alertdialog"] button, [role="dialog"] button, .modal.show button').filter({ hasText: CONFIRM }).filter({ visible: true }).last();
  if (await confirm.count()) { await confirm.click(); await sleep(2000); }
  await settle(page, 8000);
  return 'ok';
}

export async function roundTrip(page, url, name) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: config.pageTimeoutMs }); await settle(page);
  const added = await addRecord(page, name);
  if (added !== 'ok') return { add: added };
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: config.pageTimeoutMs }); await settle(page);
  const row = await findRow(page, name);
  if (!(await row.count())) return { add: 'ok', find: 'the saved row is not in the list' };
  const deleted = await deleteRow(page, row);
  if (deleted !== 'ok') return { add: 'ok', find: 'ok', delete: deleted, leftover: true };
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: config.pageTimeoutMs }); await settle(page);
  const still = await findRow(page, name);
  return (await still.count()) ? { add: 'ok', find: 'ok', delete: 'row still there after Delete', leftover: true } : { add: 'ok', find: 'ok', delete: 'ok' };
}

export const summary = r => ['add', 'find', 'delete'].map(k => r[k] && `${k}: ${r[k]}`).filter(Boolean).join('; ') + (r.leftover ? ' — LEFTOVER row, delete it by hand' : '');

export async function runRoundTrips(browser, outDir) {
  const out = [];
  const [va, la] = [accountFor('admin'), originalAccountFor('admin')];
  if (!va || !la) return [{ menu: 'All', legacy: 'No RDC Admin account', vercel: '', status: 'Blocked' }];
  const lctx = await browser.newContext(), vctx = await browser.newContext();
  const [lp, vp] = [await lctx.newPage(), await vctx.newPage()];
  const [lr, vr] = [await loginOriginal(lp, la), await login(vp, va)];
  if (!lr.ok || !vr.ok) { await lctx.close(); await vctx.close(); return [{ menu: 'All', legacy: lr.ok ? '' : 'sign-in failed', vercel: vr.ok ? '' : 'sign-in failed', status: 'Blocked' }]; }
  for (const menu of ROUND_TRIPS) {
    const p = PAGES.find(x => x.menu === menu);
    if (!p?.vercel) continue;
    const name = 'TEST-' + Date.now().toString(36).toUpperCase();
    const L = await roundTrip(lp, config.originalUrl + p.legacy, name).catch(e => ({ add: 'checker error: ' + e.message.split('\n')[0] }));
    const V = await roundTrip(vp, abs(p.vercel), name).catch(e => ({ add: 'checker error: ' + e.message.split('\n')[0] }));
    const same = ['add', 'find', 'delete'].every(k => (L[k] === 'ok') === (V[k] === 'ok'));
    const row = { menu, name, legacy: summary(L), vercel: summary(V), status: same && !V.leftover ? 'Pass' : 'Fail' };
    out.push(row);
    console.log(`  write ${row.status.padEnd(5)} ${menu}  original: ${row.legacy} | Vercel: ${row.vercel}`);
    await vp.screenshot({ path: path.join(outDir, 'shots', `write-${menu.replace(/\W+/g, '-')}-vercel.png`) }).catch(() => {});
  }
  await lctx.close(); await vctx.close();
  fs.mkdirSync(outDir, { recursive: true });
  return out;
}
