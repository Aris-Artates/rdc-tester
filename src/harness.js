/**
 * The `t` object every test receives, and the four results a test can end with.
 *
 *   Pass             the feature works as the sheet expects
 *   Fail             it does not (the notes say what was seen)
 *   Blocked          the test could not run (no account in .env, no Reference value, write tests off...)
 *   Not Implemented  the feature exists on the original site but not on Vercel yet
 *
 * A test returns t.pass(notes), or ends early by calling t.fail / t.blocked / t.notImplemented
 * (these throw, so nothing after them runs). Any other error counts as Fail.
 */
import { config } from './config.js';
import * as app from './app.js';

export class Outcome extends Error {
  constructor(result, notes) { super(notes); this.result = result; this.notes = notes; }
}

export const RESULTS = ['Pass', 'Fail', 'Blocked', 'Not Implemented'];

export function makeT({ page, test, sheetRow, originalPage = null }) {
  const t = {
    page,
    /** For tests with `original: true`: the same role signed in to the original WordPress site (read only). */
    original: originalPage ? { page: originalPage } : null,
    config,
    app,
    test,
    /** The sheet's "Reference (original)" cell for this test: the value seen on the original site. */
    reference: String(sheetRow?.reference ?? '').trim(),

    pass: (notes = 'OK') => new Outcome('Pass', notes),
    fail: notes => { throw new Outcome('Fail', notes); },
    blocked: notes => { throw new Outcome('Blocked', notes); },
    notImplemented: notes => { throw new Outcome('Not Implemented', notes); },

    /** Fail with `message` unless `cond` is truthy. */
    check(cond, message) { if (!cond) t.fail(message); },

    /**
     * Open a path ("/settings/location") and require that it loads.
     * A "coming soon" / missing page ends the test as Not Implemented when the test is marked
     * `pending: true` (feature not migrated yet), otherwise as Fail.
     */
    async open(path, { expect = 'allowed' } = {}) {
      const r = await app.open(page, path);
      if (expect === 'any' || r.state === expect) return r;
      if (test.pending && ['notfound', 'coming-soon'].includes(r.state)) t.notImplemented(`${path}: ${r.detail}`);
      if (r.state === 'logged-out') t.fail(`${path}: session lost or page needs sign-in (${r.detail})`);
      t.fail(`${path}: expected ${expect}, got ${r.state} - ${r.detail}`);
    },

    /** Require visible text (string = substring, case-insensitive; or a RegExp). */
    async see(text, { within = 'body', timeout = 8000 } = {}) {
      const re = text instanceof RegExp ? text : new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      const deadline = Date.now() + timeout;
      let body = '';
      while (Date.now() < deadline) {
        body = await page.locator(within).first().innerText({ timeout: 1000 }).catch(() => '');
        if (re.test(body)) return true;
        await new Promise(r => setTimeout(r, 250));
      }
      t.fail(`Text not found: ${re}`);
    },

    /** Like see() but returns true/false instead of failing. */
    async has(text, opts = {}) {
      try { await t.see(text, { timeout: 2500, ...opts }); return true; } catch (e) { if (e instanceof Outcome) return false; throw e; }
    },

    /**
     * Data-difference helper: compare a value read on Vercel with the sheet's Reference (original).
     * No Reference yet -> Blocked, and the notes carry the Vercel value so QA can fill it in.
     * Numbers compare as numbers (commas / currency ignored); anything else as trimmed text.
     */
    compareWithReference(label, vercelValue) {
      const seen = String(vercelValue ?? '').trim();
      if (!t.reference) t.blocked(`${label} on Vercel is "${seen}". Fill the Reference (original) column with the value from the original site to compare.`);
      const a = app.num(seen), b = app.num(t.reference);
      const same = a != null && b != null && /\d/.test(t.reference) ? Math.abs(a - b) < 0.005 : seen.toLowerCase() === t.reference.toLowerCase();
      if (!same) t.fail(`${label} differs. Vercel: "${seen}", original: "${t.reference}"`);
      return t.pass(`${label} matches the original: "${seen}"`);
    },
  };
  return t;
}
