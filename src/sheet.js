/**
 * Talks to the QA sheet through its Apps Script web app (apps-script/RdcCheckerApi.gs).
 * Without SHEET_WEBAPP_URL the checker still runs; results then only go to the CSV.
 */
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { config, ROOT } from './config.js';

export const sheetConfigured = () => !!(config.webappUrl && config.token);

/**
 * Google hands a web app's answer over through a second address, and that hand-off sometimes
 * fails with an HTML page. Large answers come gzipped; a non-JSON page is retried.
 * A write that times out is not retried: the sheet may still have saved it, and a retry would save it twice.
 */
async function call(method, params, body, { timeoutMs = 60000 } = {}) {
  if (!sheetConfigured()) throw new Error('SHEET_WEBAPP_URL / SHEET_TOKEN missing in .env');
  const u = new URL(config.webappUrl);
  if (method === 'GET') { u.searchParams.set('token', config.token); for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v); }
  let lastErr = '';
  for (let attempt = 1; attempt <= 4; attempt++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(u, method === 'GET' ? { redirect: 'follow', signal: ctl.signal }
        : { method: 'POST', redirect: 'follow', signal: ctl.signal, headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ token: config.token, ...body }) });
      const text = await res.text();
      let json = null;
      try { json = JSON.parse(text); } catch (_) {}
      if (json) {
        if (json.gz) Object.assign(json, JSON.parse(zlib.gunzipSync(Buffer.from(json.gz, 'base64')).toString('utf8')));
        if (!json.ok) throw new Error('Sheet refused: ' + json.error);
        return json;
      }
      lastErr = explainHtml(text, res);
      if (!/did not return JSON/.test(lastErr)) break;
    } catch (e) {
      if (/^Sheet refused/.test(e.message)) throw e;
      lastErr = 'No answer from the web app: ' + (e.name === 'AbortError' ? `timed out after ${Math.round(timeoutMs / 1000)}s` : e.message);
      if (e.name === 'AbortError' && method === 'POST') break;
    } finally { clearTimeout(timer); }
    if (attempt < 4) await new Promise(r => setTimeout(r, 3000 * attempt));
  }
  throw new Error(lastErr);
}

function explainHtml(text, res) {
  const title = (text.match(/<title>([^<]*)<\/title>/i) || [])[1] || '';
  const where = `(HTTP ${res.status}, page "${title.trim() || 'untitled'}")`;
  if (/Script function not found: do(Get|Post)/i.test(text)) return `The web app has no doGet/doPost: save RdcCheckerApi.gs and deploy a New version. ${where}`;
  if (/accounts\.google\.com|ServiceLogin/i.test(text + res.url)) return `Google asked for a sign-in: set the deployment's "Who has access" to "Anyone". ${where}`;
  if (/\/dev(\?|$)/.test(config.webappUrl)) return `SHEET_WEBAPP_URL ends in /dev; use the URL that ends in /exec. ${where}`;
  return `The web app did not return JSON. ${text.replace(/\s+/g, ' ').slice(0, 160)} ${where}`;
}

/**
 * Test rows from the sheet's "Test Cases" tab, by TC ID:
 * { id, caseStatus, devTicket, reference, latest, ... }.
 * Cached so a passing Google hiccup doesn't stop a run. The copy is only used for the SAME web app,
 * and never to hide a setup mistake (sign-in page, wrong token, old deployment): those must be fixed.
 */
const CACHE = path.join(ROOT, 'results', 'sheet-cache.json');
export async function loadSheetRows() {
  try {
    const { rows } = await call('GET', { action: 'tests' });
    fs.mkdirSync(path.dirname(CACHE), { recursive: true });
    fs.writeFileSync(CACHE, JSON.stringify({ at: new Date().toISOString(), url: config.webappUrl, rows }));
    return new Map(rows.map(r => [r.id, r]));
  } catch (e) {
    const transient = /No answer from the web app|did not return JSON/.test(e.message);
    const c = transient && fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : null;
    if (!c || c.url !== config.webappUrl) throw e;
    console.log(`  Sheet not readable just now (${e.message}); using the copy from ${c.at.slice(0, 16).replace('T', ' ')}.`);
    return new Map(c.rows.map(r => [r.id, r]));
  }
}

/** Closed or Reworked test cases are no longer tested ("Cancelled" is the old name for Closed). */
export const isRetired = row => /^(closed|reworked|cancel+ed)$/i.test(String(row?.caseStatus ?? row?.ticketStatus ?? '').trim());

/** Append results to the Check Log and update each test's latest result. Closed / Reworked cases are refused by the sheet too. */
export async function pushResults(results, { chunkSize = 40, timeoutMs = 60000, onChunk } = {}) {
  let written = 0, skipped = [], unknown = [], older = [];
  for (let i = 0; i < results.length; i += chunkSize) {
    const chunk = results.slice(i, i + chunkSize).map(r => ({
      tcId: r.id, checker: r.checker || config.checker, env: r.env || 'Vercel', result: r.result, notes: r.notes,
      ...(r.checkedAt ? { checkedAt: r.checkedAt } : {}),
      screenshot: r.screenshot && fs.existsSync(r.screenshot) ? { name: path.basename(r.screenshot), base64: fs.readFileSync(r.screenshot).toString('base64') } : null,
    }));
    let res;
    try { res = await call('POST', null, { action: 'results', rows: chunk }, { timeoutMs }); }
    catch (e) { e.written = written; throw e; }
    written += res.written; skipped = skipped.concat(res.skippedCancelled || []);
    unknown = unknown.concat(res.unknown || []); older = older.concat(res.older || []);
    onChunk?.(Math.min(i + chunkSize, results.length), results.length);
  }
  return { written, skipped, unknown, older };
}

/** Add tests that are in the code but not in the sheet; refresh descriptions of active ones. */
export const syncTests = (tests, { update = true } = {}) => call('POST', null, { action: 'sync', tests, update });

/** Same columns as the Check Log, for pasting by hand when not pushing. */
export function writeCsv(file, results) {
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [['TC ID', 'Checker', 'Checked At', 'Environment', 'Result', 'Notes', 'Screenshot'].map(esc).join(',')];
  for (const r of results) lines.push([r.id, config.checker, r.at, 'Vercel', r.result, r.notes, r.screenshot || ''].map(esc).join(','));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '﻿' + lines.join('\r\n'));
}
