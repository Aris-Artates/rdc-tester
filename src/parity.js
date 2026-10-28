/**
 * One-to-one checks between the original WordPress site and Vercel. They compare what a page OFFERS
 * (columns, filters and their choices, action buttons, dialog columns, menus), not the data in it:
 * the two databases have drifted since the migration, so counts and rows are expected to differ.
 *
 * Fail  = something the original offers is missing on Vercel (listed in the notes).
 * Pass  = everything on the original is on Vercel; Vercel extras are listed as notes.
 */
import { readShape } from './shape.js';
import { openOriginal } from './original.js';

const norm = s => String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
// Page-size dropdowns ("10, 20, 50, All") differ by design and say nothing about features.
const isPageSize = opts => opts.every(o => /^(\d+|all)$/i.test(o.trim()));
// Placeholder options ("---Tier---", "All", "All Agencies", "Select...", or a first option that only names the
// filter, like "Status") are labels, not choices; they must not make two unrelated dropdowns look alike.
const LABEL_WORDS = /^(status|tier|tier type|agency|year|budget year|fiscal year|sector|type|category|province|district|office)$/i;
const isPlaceholder = (o, i = -1) => {
  const s = o.trim();
  return /^-+.*-+$/.test(s) || /^(all|select|choose)\b/i.test(s) || (i === 0 && LABEL_WORDS.test(s));
};

/** Items of `want` with no equal item in `have` (after normalising; `alias` maps original -> Vercel wording). */
export function missingFrom(want, have, alias = {}) {
  const got = new Set(have.map(norm));
  return want.filter(w => !got.has(norm(alias[w] ?? w)));
}

// Column wording: "#" is "No", plurals count as singular, filler words are ignored.
const FILLER = new Set(['the', 'of', 'in', 'and', 'to', 'by', 'php']);
const words = s => norm(String(s || '').replace(/#/g, ' no ')).split(' ').filter(w => w && !FILLER.has(w)).map(w => w.length > 3 ? w.replace(/s$/, '') : w);
const within = (a, b) => a.length > 0 && a.every(w => b.includes(w));

/**
 * Like missingFrom for column headers, but a renamed column still counts when one name's words are all in the
 * other ("Agency Acronym" ~ "Acronym", "Applicable Year" ~ "Applicable Fiscal Year", "PPA ID" ~ "Project / PPA ID").
 * Returns { gone, renamed } where renamed lists "original ~ Vercel" pairs matched that way.
 */
export function columnsMissing(want, have, alias = {}) {
  const gone = [], renamed = [];
  const exact = new Set(have.map(norm));
  for (const w of want) {
    const target = alias[w] ?? w;
    if (exact.has(norm(target))) continue;
    const tw = words(target);
    const hit = have.find(h => { const hw = words(h); return within(tw, hw) || within(hw, tw); });
    if (hit) renamed.push(`${w} ~ ${hit}`); else gone.push(w);
  }
  return { gone, renamed };
}

/** Compare two shapes' dropdowns. Returns lines describing what the original offers that Vercel lacks. */
export function compareSelects(orig, verc, { dataListSize = 15 } = {}) {
  const lines = [], notes = [];
  const choices = s => s.options.filter((x, i) => !isPlaceholder(x, i));
  const vs = verc.filter(s => !isPageSize(s.options));
  for (const o of orig.filter(s => !isPageSize(s.options))) {
    const want = choices(o);
    if (!want.length) continue;
    let best = null, bestHit = 0;
    for (const v of vs) {
      const hit = want.length - missingFrom(want, choices(v)).length;
      if (hit > bestHit) { best = v; bestHit = hit; }
    }
    const label = o.id ? `"${o.id}"` : `"${want.slice(0, 2).join(' / ')}..."`;
    if (!best) { lines.push(`filter ${label} (${want.slice(0, 3).join(', ')}...) has no matching dropdown`); continue; }
    if (want.length > dataListSize) {
      // Long lists (agencies, offices) depend on data; only say how they differ in size.
      if (best.options.length < want.length) notes.push(`filter ${label}: original lists ${want.length}, Vercel ${best.options.length}`);
      continue;
    }
    const gone = missingFrom(want, best.options);
    if (gone.length) lines.push(`filter ${label} lacks: ${gone.join(', ')}`);
  }
  return { lines, notes };
}

/** Column headers of the original's (hidden) modal whose title matches. */
export async function originalDialogColumns(page, title) {
  return page.evaluate(want => {
    const clean = s => String(s || '').replace(/\s+/g, ' ').trim();
    // "Total<br>No. of Projects" must read "Total No. of Projects", not "TotalNo. of Projects".
    const text = e => { const c = e.cloneNode(true); c.querySelectorAll('br').forEach(b => b.replaceWith(' ')); return clean(c.textContent); };
    const modal = [...document.querySelectorAll('.modal')].find(m => clean(m.querySelector('.modal-title')?.textContent).toLowerCase() === want.toLowerCase());
    if (!modal) return null;
    const table = modal.querySelector('table');
    return table ? [...table.querySelectorAll('thead th')].filter(th => (th.colSpan || 1) <= 1).map(text).filter(Boolean) : [];
  }, title);
}

/** Click a button on the Vercel page and read the opened dialog's column headers; closes it again. */
export async function vercelDialogColumns(page, buttonName) {
  const button = page.getByRole('button', { name: buttonName, exact: true }).first();
  if (!(await button.count())) return null;
  await button.click();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor({ timeout: 8000 }).catch(() => {});
  const heads = await dialog.locator('table thead th').allInnerTexts().catch(() => []);
  await page.keyboard.press('Escape').catch(() => {});
  return heads.map(h => h.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

/** Top-level menu labels on either site. */
export async function topMenu(page, site) {
  return page.evaluate(site => {
    const clean = s => String(s || '').replace(/\s+/g, ' ').trim();
    const items = site === 'original'
      ? [...document.querySelectorAll('nav ul > li > a, .navbar-nav > li > a')].filter(a => !a.closest('ul ul') && a.offsetParent)
      : [...document.querySelectorAll('header nav > *')];
    return [...new Set(items.map(e => clean(e.innerText.split('\n')[0])).filter(Boolean))];
  }, site);
}

/**
 * Run a parity spec: { vercel, original, columns?, filters?, buttons?, dialog?: { button, title }, menu?, alias? }.
 * `t.original.page` must be signed in to the original site (the runner does this for tests with `original`).
 */
export async function runParity(t, spec) {
  const o = t.original;
  if (!o) t.blocked('No original-site session (set LEGACY_<ROLE> in .env)');
  const r = await openOriginal(o.page, spec.original);
  if (r.state !== 'allowed') t.blocked(`Original ${spec.original}: ${r.detail}`);
  await t.open(spec.vercel);
  const [os, vs] = [await o.page.evaluate(readShape), await t.page.evaluate(readShape)];
  const missing = [], extra = [], notes = [];
  const alias = spec.alias || {};

  if (spec.columns) {
    const oc = os.tables[0] || [], vc = vs.tables[0] || [];
    if (!oc.length) notes.push('original shows no table');
    else if (!vc.length) missing.push('the table');
    else {
      const { gone, renamed } = columnsMissing(oc, vc, alias);
      if (gone.length) missing.push('columns: ' + gone.join(', '));
      if (renamed.length) notes.push('renamed columns: ' + renamed.join(', '));
      const added = columnsMissing(vc, oc, Object.fromEntries(Object.entries(alias).map(([a, b]) => [b, a]))).gone;
      if (added.length) extra.push('columns: ' + added.join(', '));
    }
  }
  if (spec.filters) {
    const { lines, notes: n } = compareSelects(os.selects, vs.selects);
    missing.push(...lines); notes.push(...n);
  }
  if (spec.buttons) {
    const want = spec.buttons === true ? os.buttons : spec.buttons;
    const gone = missingFrom(want, vs.buttons, alias);
    if (gone.length) missing.push('buttons: ' + gone.join(', '));
  }
  if (spec.dialog) {
    const oc = await originalDialogColumns(o.page, spec.dialog.title);
    if (oc == null) notes.push(`original has no "${spec.dialog.title}" dialog`);
    else {
      const vc = await vercelDialogColumns(t.page, spec.dialog.button);
      if (vc == null) missing.push(`"${spec.dialog.button}" button`);
      else {
        const gone = columnsMissing(oc, vc, alias).gone.filter(c => !/^no\.?$/i.test(c));
        if (gone.length) missing.push(`"${spec.dialog.title}" dialog columns: ${gone.join(', ')}`);
      }
    }
  }
  if (spec.menu) {
    const gone = missingFrom(await topMenu(o.page, 'original'), await topMenu(t.page, 'vercel'), alias);
    if (gone.length) missing.push('menus: ' + gone.join(', '));
  }

  const tail = [extra.length ? 'Vercel adds ' + extra.join('; ') : '', notes.join('; ')].filter(Boolean).join(' | ');
  if (missing.length) t.fail('Missing on Vercel: ' + missing.join('; ') + (tail ? ' | ' + tail : ''));
  return t.pass('Same as the original' + (tail ? ' | ' + tail : ''));
}
