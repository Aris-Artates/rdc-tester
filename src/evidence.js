#!/usr/bin/env node
/**
 * npm run evidence -- results/compare-<time> [--only "Accounts > Agencies"] [--headed]
 * Turns a comparison run into one ticket per page that still differs from the original, each with a
 * side-by-side screenshot (original left, Vercel right) where every difference is boxed in red:
 *   missing buttons / columns / filters   boxed on the original, the place they should be boxed on Vercel
 *   row totals                            the "Showing x to y of N entries" line (or the table) on both
 *   forms that lack fields                the button is clicked on both sites; missing fields boxed on the original
 *   access                                both pages as the role, with what each site did
 *   pages not built                       the original page next to Vercel's placeholder
 * Writes <run>/evidence/tickets.json and <run>/evidence/*.png. Read only: never clicks Save, Delete and the like.
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { ROOT, config, accountFor, originalAccountFor } from './config.js';
import { login, settle } from './app.js';
import { loginOriginal } from './original.js';
import { openLegacy, openNew, DESTRUCTIVE } from './comparelib.js';
import { ROLE_INFO } from './roles.js';

const args = process.argv.slice(2);
const opt = n => { const i = args.indexOf('--' + n); return i < 0 ? null : (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true); };
const RUN = path.resolve(ROOT, args.find(a => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--only') || '');
if (!fs.existsSync(path.join(RUN, 'results.json'))) { console.error('Give a comparison folder, e.g. npm run evidence -- results/compare-2026-10-29T03-00-00'); process.exit(1); }
const OUT = path.join(RUN, 'evidence');
fs.mkdirSync(OUT, { recursive: true });
const VIEWPORT = { width: 1366, height: 900 };
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
const nameOf = role => ROLE_INFO.find(r => r.role === role)?.name || role;
const after = (s, re) => (s.match(re) || [])[1];
const listAfter = (s, prefix) => s.slice(prefix.length).split(', ').map(x => x.trim()).filter(Boolean);

// ---- group the run's problems into tickets -----------------------------------------------------------------
const { results } = JSON.parse(fs.readFileSync(path.join(RUN, 'results.json'), 'utf8'));
const byPage = new Map();
for (const r of results) for (const p of r.pages || []) {
  if (!p.problems?.length) continue;
  if (!byPage.has(p.menu)) byPage.set(p.menu, { menu: p.menu, legacyPath: p.legacyPath, vercelPath: p.vercelPath, roles: [] });
  byPage.get(p.menu).roles.push(p);
}
const tickets = [];
const notBuiltByModule = new Map();
for (const g of byPage.values()) {
  if (opt('only') && !String(opt('only')).split(',').some(o => g.menu.toLowerCase().includes(o.trim().toLowerCase()))) continue;
  const notBuilt = g.roles.find(p => p.problems.some(x => /^Not built on Vercel|^No Vercel page/.test(x)));
  if (notBuilt) {
    // Pages Vercel has not built yet: one ticket per module, one picture per page.
    const mod = g.menu.split(' > ')[0];
    if (!notBuiltByModule.has(mod)) tickets.push(notBuiltByModule.set(mod, { kind: 'not-built', menu: mod, role: notBuilt.role, pages: [], problems: [] }).get(mod));
    const t = notBuiltByModule.get(mod);
    t.pages.push({ menu: g.menu, legacyPath: g.legacyPath, vercelPath: g.vercelPath });
    t.problems.push(`${g.menu}: ${notBuilt.problems[0]}`);
    continue;
  }
  const access = g.roles.filter(p => p.problems.some(x => x.startsWith('Access:')));
  if (access.length) {
    const looser = access.filter(p => p.problems.some(x => /Vercel lets this role open/.test(x)));
    const stricter = access.filter(p => !looser.includes(p));
    for (const [set, how] of [[looser, 'open'], [stricter, 'closed']]) if (set.length)
      tickets.push({ kind: 'access', how, menu: g.menu, legacyPath: g.legacyPath, vercelPath: g.vercelPath, role: set[0].role, roles: set.map(p => p.role), problems: set.map(p => `${nameOf(p.role)}: ${p.problems.find(x => x.startsWith('Access:')).replace(/^Access: /, '')}`) });
  }
  // Layout, data and button problems: the admin's view when it has them, else the first role that does.
  const feat = g.roles.filter(p => p.problems.some(x => !x.startsWith('Access:')));
  const base = feat.find(p => p.role === 'admin') || feat[0];
  if (base) tickets.push({ kind: 'features', menu: g.menu, legacyPath: g.legacyPath, vercelPath: g.vercelPath, role: base.role, roles: feat.map(p => p.role), problems: base.problems.filter(x => !x.startsWith('Access:')) });
}
console.log(`${tickets.length} tickets from ${byPage.size} pages that differ`);

// ---- drawing ---------------------------------------------------------------------------------------------
/** Box elements on the page. marks: [{ sel, text, label, region }] ; text matches the element's own clean text. */
async function mark(page, marks) {
  return page.evaluate(marks => {
    const clean = s => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const shown = e => !!(e.offsetParent || e.getClientRects().length) && e.getBoundingClientRect().width > 0;
    document.querySelectorAll('.rdc-mark').forEach(e => e.remove());
    let found = 0, top = Infinity;
    const box = (r, label) => {
      const d = document.createElement('div');
      d.className = 'rdc-mark';
      const pad = 4;
      Object.assign(d.style, { position: 'absolute', left: (r.left + scrollX - pad) + 'px', top: (r.top + scrollY - pad) + 'px', width: (r.width + pad * 2) + 'px', height: (r.height + pad * 2) + 'px',
        border: '4px solid #e00', borderRadius: '8px', boxShadow: '0 0 0 3px rgba(255,255,255,.85)', zIndex: 2147483647, pointerEvents: 'none' });
      if (label) {
        const t = document.createElement('div');
        t.textContent = label;
        Object.assign(t.style, { position: 'absolute', left: '-4px', top: r.top + scrollY > 40 ? '-30px' : 'calc(100% + 4px)', background: '#e00', color: '#fff', font: 'bold 13px/1.2 Arial, sans-serif',
          padding: '4px 8px', borderRadius: '4px', whiteSpace: 'nowrap', maxWidth: '700px', overflow: 'hidden', textOverflow: 'ellipsis' });
        d.appendChild(t);
      }
      document.body.appendChild(d);
      found++; top = Math.min(top, r.top + scrollY);
    };
    // The open dialog's panel: a Bootstrap/SweetAlert box on the original; on Vercel the smallest block inside
    // the full-screen overlay that still holds the title and the fields (not the dimmed backdrop).
    const dialog = () => {
      const d = [...document.querySelectorAll('.modal.show .modal-content, .modal.in .modal-content, .swal2-popup, .swal-modal, [role="dialog"]')].find(shown);
      if (d) return d;
      const o = [...document.querySelectorAll('.fixed.inset-0')].find(e => shown(e) && e.querySelector('h2, h3'));
      if (!o) return null;
      const area = e => e.getBoundingClientRect().width * e.getBoundingClientRect().height;
      return [...o.querySelectorAll('div')].filter(e => shown(e) && e.querySelector('h2, h3') && e.querySelector('label, input, select, table'))
        .sort((a, b) => area(a) - area(b))[0] || o;
    };
    // A dropdown as the user sees it: the select itself, or the widget drawn over a hidden one (select2, bootstrap-select).
    const visibleOf = sel => (shown(sel) ? sel : [sel.closest('.bootstrap-select'), sel.nextElementSibling, sel.parentElement].find(e => e && shown(e) && e.getBoundingClientRect().height < 80));
    const findSelect = m => {
      const all = [...document.querySelectorAll('select')];
      const byId = m.id && all.find(x => x.id === m.id || x.name === m.id);
      if (byId) return byId;
      const want = (m.options || []).map(clean);
      return all.filter(x => visibleOf(x)).find(x => { const have = [...x.options].map(o => clean(o.textContent)); return want.length && want.every(w => have.includes(w)); });
    };
    // The block that holds a page's filters: the smallest ancestor of a dropdown with at least two dropdowns in it.
    const filterPanel = () => {
      const ctl = [...document.querySelectorAll('select, button[role=combobox]')].filter(shown);
      for (const c of ctl) for (let e = c.parentElement; e && e !== document.body; e = e.parentElement)
        if (e.querySelectorAll('select, button[role=combobox]').length >= 2 && e.getBoundingClientRect().height > 60) return e;
      return ctl[0] || null;
    };
    for (const m of marks) {
      if (m.sel === 'DIALOG') { const d = dialog(); if (d) box(d.getBoundingClientRect(), m.label); continue; }
      if (m.sel === 'FILTER') { const x = findSelect(m); const v = x && visibleOf(x); if (v) box(v.getBoundingClientRect(), m.label); continue; }
      if (m.sel === 'FILTERS') { const x = filterPanel(); if (x) box(x.getBoundingClientRect(), m.label); continue; }
      if (m.sel === 'INFO') {
        // The "Showing 1 to 10 of N entries" line, else the table itself.
        const re = /^showing [\d,]+ to [\d,]+ of [\d,]+ entries/;
        let els = [...document.querySelectorAll('.dataTables_info, div, p, span')].filter(e => shown(e) && clean(e.innerText).length < 120 && re.test(clean(e.innerText)));
        els = els.filter(e => !els.some(o => o !== e && e.contains(o)));
        const t = els[0] || [...document.querySelectorAll('table')].find(shown);
        if (t) box(t.getBoundingClientRect(), m.label);
        continue;
      }
      let els = [...document.querySelectorAll(m.sel)].filter(shown);
      if (m.text) {
        const want = clean(m.text);
        const exact = els.filter(e => clean(e.innerText || e.value || e.textContent) === want);
        els = exact.length ? exact : els.filter(e => clean(e.innerText || e.value || e.textContent).includes(want));
        // The innermost match only: a wrapper holding the button would draw a second, larger box.
        els = els.filter(e => !els.some(o => o !== e && e.contains(o)));
      }
      if (m.textRe) { const re = new RegExp(m.textRe, 'i'); els = els.filter(e => re.test(e.innerText || '')); els = els.filter(e => !els.some(o => o !== e && e.contains(o))); }
      const e = els[0];
      if (e) box(e.getBoundingClientRect(), m.label);
    }
    return { found, top: top === Infinity ? 0 : top };
  }, marks);
}

/** Close the original's start-up notices (the "Reminder" modal and the like) so they do not hide the page. */
async function dismissPopups(page) {
  await page.evaluate(() => {
    document.querySelectorAll('.modal.show, .modal.in, .modal-backdrop, .swal2-container, .swal-overlay').forEach(e => e.remove());
    document.body.classList.remove('modal-open', 'swal2-shown');
    document.body.style.overflow = ''; document.body.style.paddingRight = '';
  }).catch(() => {});
}

async function snap(page, marks, file, { keepDialogs = false } = {}) {
  if (!keepDialogs) await dismissPopups(page);
  const r = marks?.length ? await mark(page, marks) : { found: 0, top: 0 };
  // Start the picture a little above the first box so it is in view; at most ~1.6 screens tall.
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  const y = Math.max(0, Math.min(r.top - 160, height - 1400));
  await page.screenshot({ path: file, fullPage: true, clip: { x: 0, y, width: VIEWPORT.width, height: Math.min(1400, height - y) } }).catch(async () => page.screenshot({ path: file }));
  return r.found;
}

/** One picture: the issue on top, the original on the left, Vercel on the right. */
async function compose(browser, file, { title, lines, left, right }) {
  const img = f => (f && fs.existsSync(f) ? 'data:image/png;base64,' + fs.readFileSync(f).toString('base64') : '');
  const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
  const col = (head, sub, src, note) => `<div class="c"><div class="h">${esc(head)}</div><div class="s">${esc(sub)}</div>${src ? `<img src="${src}">` : `<div class="none">${esc(note || 'No page')}</div>`}</div>`;
  const page = await browser.newPage({ viewport: { width: 2000, height: 800 } });
  await page.setContent(`<html><body style="margin:0;font-family:Arial,sans-serif;background:#f3f4f6">
    <style>.t{background:#111827;color:#fff;padding:18px 24px}.t b{font-size:24px}.t li{font-size:17px;margin:6px 0;color:#fecaca}
    .g{display:grid;grid-template-columns:1fr 1fr;gap:16px;padding:16px}.c{background:#fff;border-radius:8px;padding:10px;box-shadow:0 1px 3px rgba(0,0,0,.2)}
    .h{font-weight:bold;font-size:19px}.s{color:#555;font-size:14px;margin:2px 0 8px}.c img{width:100%;border:1px solid #ddd}.none{padding:60px;text-align:center;color:#999;font-size:20px}</style>
    <div class="t"><b>${esc(title)}</b><ul>${lines.map(l => `<li>${esc(l)}</li>`).join('')}</ul></div>
    <div class="g">${col('ORIGINAL (baseline)', left.url, img(left.file), left.note)}${col('VERCEL', right.url, img(right.file), right.note)}</div></body></html>`);
  await page.screenshot({ path: file, fullPage: true });
  await page.close();
}

// ---- marks for each kind of problem -------------------------------------------------------------------------
const BTN = 'button, a.btn, .btn, input[type=button], input[type=submit]';
function marksFor(problem) {
  const L = [], V = [];
  let s;
  if ((s = 'Buttons missing on Vercel: ') && problem.startsWith(s)) {
    for (const b of listAfter(problem, s)) L.push({ sel: BTN, text: b, label: `Missing on Vercel: ${b}` });
    V.push({ sel: 'h1, h2', label: `Not on this page: ${listAfter(problem, s).join(', ')}` });
  } else if ((s = 'Columns missing on Vercel: ') && problem.startsWith(s)) {
    for (const c of listAfter(problem, s)) L.push({ sel: 'thead th', text: c, label: 'Missing' });
    V.push({ sel: 'thead', label: `Missing columns: ${listAfter(problem, s).join(', ')}` });
  } else if (problem.startsWith('Data: ')) {
    const n = after(problem, /original lists (\d+)/), m = after(problem, /Vercel (\d+)/);
    L.push({ sel: 'INFO', label: `Original: ${n} rows` });
    V.push({ sel: 'INFO', label: m ? `Vercel: ${m} rows` : 'Vercel: no table' });
  } else if (problem.startsWith('Filters: ')) {
    const id = after(problem, /filter "([^"]+)"/), lacks = after(problem, /lacks: (.*)$/);
    const opts = (after(problem, /\(([^)]*?)\.\.\.\)/) || '').split(', ').filter(Boolean);
    L.push({ sel: 'FILTER', id, options: opts.length ? opts.slice(0, 2) : lacks ? [lacks.split(', ')[0]] : [], label: lacks ? `Vercel lacks: ${lacks}` : 'No such filter on Vercel' });
    V.push({ sel: 'FILTERS', label: 'Vercel filters: ' + (lacks ? `no "${lacks}" option` : `none for ${opts.length ? opts.slice(0, 2).join(', ') + '...' : id}`) });
  } else if (problem.startsWith('Layout: ')) {
    L.push({ sel: 'table', label: 'Table on the original' });
    V.push({ sel: 'main', label: 'No table on Vercel' });
  }
  // Only the first box of each kind keeps its label once a later box covers the same spot.
  return { L: L.filter(m => m.label !== '' || L.length > 1), V };
}

// ---- sessions ---------------------------------------------------------------------------------------------
const browser = await chromium.launch({ headless: !opt('headed') });
const sessions = new Map();
async function sessionFor(role) {
  if (sessions.has(role)) return sessions.get(role);
  const lctx = await browser.newContext({ viewport: VIEWPORT }), vctx = await browser.newContext({ viewport: VIEWPORT });
  const s = { legacy: await lctx.newPage(), vercel: await vctx.newPage(), close: async () => { await lctx.close(); await vctx.close(); } };
  if (role !== 'public') {
    const [vr, lr] = [await login(s.vercel, accountFor(role)), await loginOriginal(s.legacy, originalAccountFor(role))];
    if (!vr.ok || !lr.ok) throw new Error(`cannot sign in as ${role}`);
  }
  sessions.set(role, s);
  return s;
}

function presser(label) {
  return async page => {
    if (DESTRUCTIVE.test(label)) return false;
    // Vercel draws "+" as an icon, so "+ Add New X" is also looked for as "Add New X".
    let b = null;
    for (const text of [label, label.replace(/^[^A-Za-z0-9]+/, '').trim()]) {
      const c = page.locator(BTN).filter({ hasText: text }).filter({ visible: true }).first();
      if (await c.count()) { b = c; break; }
    }
    if (!b) return false;
    await b.click({ timeout: 8000 }).catch(() => {});
    await settle(page, 8000);
    await page.waitForTimeout(1200);
    return true;
  };
}

// ---- one ticket -----------------------------------------------------------------------------------------
async function evidence(t, n) {
  const s = await sessionFor(t.role);
  const base = path.join(OUT, `${String(n).padStart(2, '0')}-${slug(t.menu)}`);
  const shots = [];
  const pair = async (suffix, lm, vm, title, lines, prep) => {
    const lu = config.originalUrl + t.legacyPath, vu = t.vercelPath ? config.appUrl + t.vercelPath : '(no Vercel page)';
    const L = await openLegacy(s.legacy, t.legacyPath);
    const V = t.vercelPath ? await openNew(s.vercel, t.vercelPath) : null;
    if (prep) { await dismissPopups(s.legacy); await prep(); }
    const lf = base + `-${suffix}-legacy.png`, vf = base + `-${suffix}-vercel.png`;
    await snap(s.legacy, lm, lf, { keepDialogs: !!prep });
    if (V) await snap(s.vercel, vm, vf, { keepDialogs: !!prep });
    const out = base + `-${suffix}.png`;
    await compose(browser, out, { title, lines, left: { url: lu + `  (${L.detail})`, file: lf }, right: { url: vu + (V ? `  (${V.detail})` : ''), file: V ? vf : null, note: 'Vercel has no page for this menu item' } });
    shots.push(out);
  };
  const who = `as ${nameOf(t.role)}`;
  if (t.kind === 'not-built') {
    let i = 0;
    for (const pg of t.pages) {
      Object.assign(t, { legacyPath: pg.legacyPath, vercelPath: pg.vercelPath });
      await pair(`page${++i}`, [{ sel: 'main, #content, .content-wrapper, .main-panel, body', label: 'On the original' }], [{ sel: 'main, body', label: 'Not built on Vercel' }], `${pg.menu}: not built on Vercel (${who})`, [t.problems[i - 1]]);
    }
    delete t.legacyPath; delete t.vercelPath;
  } else if (t.kind === 'access') {
    const role = t.roles[0];
    await pair('access', [{ sel: 'main, #content, form, body', label: t.how === 'open' ? 'Original: blocked' : 'Original: opens' }], [{ sel: 'main, body', label: t.how === 'open' ? 'Vercel: opens' : 'Vercel: blocked' }],
      `${t.menu}: access differs from the original (${nameOf(role)})`, t.problems.slice(0, 8));
  } else {
    // Static differences on one picture; each form difference on its own picture with the dialog open.
    const statics = t.problems.filter(p => !/^"/.test(p));
    if (statics.length) {
      const m = statics.map(marksFor);
      await pair('layout', m.flatMap(x => x.L), m.flatMap(x => x.V), `${t.menu}: differs from the original (${who})`, statics);
    }
    let i = 0;
    for (const p of t.problems.filter(x => /^"/.test(x))) {
      const label = after(p, /^"([^"]+)"/);
      const fields = /lacks fields on Vercel: (.*)$/.test(p) ? after(p, /lacks fields on Vercel: (.*)$/).split(', ') : [];
      const press = presser(label);
      await pair(`click${++i}`, fields.map(f => ({ sel: 'label', text: f.replace(/:$/, ''), label: 'Missing on Vercel' })).concat(fields.length ? [] : [{ sel: 'DIALOG', label: `Original after clicking "${label}"` }]),
        [{ sel: 'DIALOG', label: fields.length ? `No ${fields.join(', ')} here` : `Vercel after clicking "${label}"` }],
        `${t.menu}: "${label}" differs (${who})`, [p], async () => { await press(s.legacy); await press(s.vercel); });
    }
  }
  return shots;
}

const out = [];
let n = 0;
for (const t of tickets) {
  n++;
  try {
    t.shots = (await evidence(t, n)).map(f => path.relative(ROOT, f).replace(/\\/g, '/'));
    console.log(`  ${String(n).padStart(2)} ${t.kind.padEnd(9)} ${t.menu}  (${t.shots.length} picture${t.shots.length === 1 ? '' : 's'})`);
  } catch (e) { t.error = String(e.message || e).split('\n')[0]; console.log(`  ${String(n).padStart(2)} ERROR ${t.menu}: ${t.error}`); }
  out.push(t);
}
for (const s of sessions.values()) await s.close();
await browser.close();
fs.writeFileSync(path.join(OUT, 'tickets.json'), JSON.stringify(out, null, 1));
console.log('Tickets: ' + path.relative(ROOT, path.join(OUT, 'tickets.json')));
