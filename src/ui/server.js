/**
 * RDC Checker UI - a small local web app (http://127.0.0.1:4417) around the CLI scripts.
 * Listens on 127.0.0.1 only: nothing on the network can reach it, because it can read .env.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ROOT } from '../config.js';

const portArg = process.argv.indexOf('--port');
const PORT = Number((portArg > 0 && process.argv[portArg + 1]) || process.env.QA_UI_PORT || 4417);
const ENV_FILE = path.join(ROOT, '.env');
const HTML = path.join(ROOT, 'src', 'ui', 'index.html');

// ---- .env schema: what the Settings tab shows ---------------------------------------------
export const SCHEMA = [
  { group: 'Sheet connection', key: 'SHEET_URL', label: 'Google Sheet link', help: 'Link to the QA sheet (only used for the "Open sheet" button).' },
  { group: 'Sheet connection', key: 'SHEET_WEBAPP_URL', label: 'Apps Script web app URL', help: 'Deploy > Manage deployments > Web app URL (ends in /exec).', secret: true },
  { group: 'Sheet connection', key: 'SHEET_TOKEN', label: 'Sheet token', help: 'Same value as the QA_TOKEN Script Property.', secret: true },
  { group: 'Sheet connection', key: 'CHECKER_NAME', label: 'Checker name', help: 'Name written in the Check Log. Add it to the Team tab.', placeholder: 'RDC QA Bot' },
  { group: 'App addresses', key: 'APP_URL_VERCEL', label: 'Vercel app URL (tested)', help: 'Base URL, no trailing slash.', placeholder: 'https://rdc8ims.vercel.app' },
  { group: 'App addresses', key: 'APP_URL_ORIGINAL', label: 'Original site URL (reference only)', help: 'Never tested; shown for QA when filling Reference values.', placeholder: 'https://evims.rdc8ims.online' },
  { group: 'Test accounts', key: 'ACCOUNT_ADMIN', label: 'admin', help: 'username:password of an administrator account.', secret: true },
  { group: 'Test accounts', key: 'ACCOUNT_MEMBER', label: 'member', help: 'username:password of a member WITHOUT access to every section.', secret: true },
  { group: 'Safety', key: 'ALLOW_WRITE_TESTS', label: 'Allow write tests', help: 'true = run tests that add then delete QA-AUTO records.', placeholder: 'false' },
  { group: 'Timing', key: 'SETTLE_MS', label: 'Settle time (ms)', help: 'How long a page must stay unchanged before it counts as loaded.', placeholder: '2500' },
  { group: 'Timing', key: 'PAGE_TIMEOUT_MS', label: 'Page timeout (ms)', help: 'Max wait for one page.', placeholder: '30000' },
  { group: 'Timing', key: 'QA_NOTIFY', label: 'Windows notifications', help: '"off" to disable the pop-up when a run ends.', placeholder: 'on' },
];

export function parseEnv(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2];
    if (/^".*"$|^'.*'$/.test(v)) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

export function formatEnv(values) {
  const quote = v => (/[#\s"'=]/.test(v) ? `"${String(v).replace(/"/g, '\\"')}"` : v);
  const lines = ['# RDC Checker settings. Never commit this file.'];
  let group = '';
  const known = new Set();
  for (const f of SCHEMA) {
    if (f.group !== group) { group = f.group; lines.push('', `# --- ${group}`); }
    known.add(f.key);
    lines.push(`${f.key}=${quote(values[f.key] ?? '')}`);
  }
  const extra = Object.keys(values).filter(k => !known.has(k) && values[k] !== '');
  if (extra.length) { lines.push('', '# --- Other'); for (const k of extra) lines.push(`${k}=${quote(values[k])}`); }
  return lines.join('\n') + '\n';
}

const readEnv = () => (fs.existsSync(ENV_FILE) ? parseEnv(fs.readFileSync(ENV_FILE, 'utf8')) : {});

// ---- jobs -----------------------------------------------------------------------------------
const jobs = new Map();
let nextId = 1;
function startJob(script, args, title) {
  const id = String(nextId++);
  const child = spawn(process.execPath, [path.join(ROOT, 'src', script), ...args], { cwd: ROOT, env: { ...process.env, FORCE_COLOR: '0' } });
  const job = { id, title, lines: [], listeners: new Set(), done: false, code: null, summary: null, child };
  const emit = line => {
    if (!line) return;
    if (line.startsWith('__SUMMARY__ ')) { try { job.summary = JSON.parse(line.slice(12)); } catch (_) {} return; }
    job.lines.push(line);
    for (const l of job.listeners) l.write(`data: ${JSON.stringify({ line })}\n\n`);
  };
  // Output chunks can split a line: keep each stream's unfinished tail until its newline arrives.
  const lineReader = () => {
    let buf = '';
    return {
      data: chunk => { buf += String(chunk); const parts = buf.split(/\r?\n/); buf = parts.pop(); parts.forEach(emit); },
      end: () => { emit(buf); buf = ''; },
    };
  };
  const out = lineReader(), err = lineReader();
  child.stdout.on('data', out.data);
  child.stderr.on('data', err.data);
  child.on('close', code => {
    out.end(); err.end();
    job.done = true; job.code = code;
    for (const l of job.listeners) { l.write(`event: done\ndata: ${JSON.stringify({ code, summary: job.summary })}\n\n`); l.end(); }
    job.listeners.clear();
  });
  jobs.set(id, job);
  return job;
}

// ---- http -----------------------------------------------------------------------------------
const send = (res, code, body, type = 'application/json') => {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
};
const readBody = req => new Promise(r => { let b = ''; req.on('data', c => (b += c)); req.on('end', () => { try { r(JSON.parse(b || '{}')); } catch (_) { r({}); } }); });
const SCRIPTS = { run: 'run.js', sync: 'sync.js' };

const server = http.createServer(async (req, res) => {
  // Same-origin only: a web page elsewhere must not be able to drive this server.
  const origin = req.headers.origin;
  if (origin && origin !== `http://127.0.0.1:${PORT}` && origin !== `http://localhost:${PORT}`) return send(res, 403, { error: 'origin' });
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  try {
    if (req.method === 'GET' && url.pathname === '/') return send(res, 200, fs.readFileSync(HTML, 'utf8'), 'text/html; charset=utf-8');
    if (req.method === 'GET' && url.pathname === '/api/env') return send(res, 200, { schema: SCHEMA, values: readEnv(), exists: fs.existsSync(ENV_FILE) });
    if (req.method === 'POST' && url.pathname === '/api/env') {
      const body = await readBody(req);
      const values = typeof body.raw === 'string' ? parseEnv(body.raw) : (body.values || {});
      fs.writeFileSync(ENV_FILE, formatEnv(values));
      return send(res, 200, { ok: true });
    }
    if (req.method === 'GET' && url.pathname === '/api/env/format') return send(res, 200, formatEnv(readEnv()), 'text/plain; charset=utf-8');
    if (req.method === 'GET' && url.pathname === '/api/catalog') {
      // In a child process so edits to test files show up without restarting the UI.
      const job = startJob('run.js', ['--list', '--json'], 'catalog');
      await new Promise(r => { const i = setInterval(() => { if (job.done) { clearInterval(i); r(); } }, 100); });
      jobs.delete(job.id);
      return send(res, 200, { tests: job.summary?.tests || [], error: job.code ? job.lines.slice(-6).join('\n') : null });
    }
    if (req.method === 'POST' && url.pathname === '/api/run') {
      const { kind = 'run', args = [], title } = await readBody(req);
      if (!SCRIPTS[kind] || !Array.isArray(args) || args.some(a => typeof a !== 'string')) return send(res, 400, { error: 'bad request' });
      const job = startJob(SCRIPTS[kind], args, title || kind);
      const npm = { run: 'qa', sync: 'sync-sheet' }[kind];
      return send(res, 200, { id: job.id, cmd: `npm run ${npm}${args.length ? ' -- ' + args.map(a => (/\s/.test(a) ? `"${a}"` : a)).join(' ') : ''}` });
    }
    if (req.method === 'GET' && url.pathname.startsWith('/api/stream/')) {
      const job = jobs.get(url.pathname.split('/').pop());
      if (!job) return send(res, 404, { error: 'no job' });
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      for (const line of job.lines) res.write(`data: ${JSON.stringify({ line })}\n\n`);
      if (job.done) { res.write(`event: done\ndata: ${JSON.stringify({ code: job.code, summary: job.summary })}\n\n`); return res.end(); }
      job.listeners.add(res);
      req.on('close', () => job.listeners.delete(res));
      return;
    }
    if (req.method === 'POST' && url.pathname.startsWith('/api/stop/')) {
      const job = jobs.get(url.pathname.split('/').pop());
      if (job && !job.done) job.child.kill();
      return send(res, 200, { ok: true });
    }
    return send(res, 404, { error: 'not found' });
  } catch (e) {
    return send(res, 500, { error: String(e.message || e) });
  }
});

const openBrowser = link => { if (!process.argv.includes('--no-open')) spawn('cmd', ['/c', 'start', '', link], { detached: true, stdio: 'ignore' }).unref(); };

server.on('error', async e => {
  if (e.code !== 'EADDRINUSE') throw e;
  const link = `http://127.0.0.1:${PORT}`;
  const ours = await fetch(link + '/api/env').then(r => r.ok).catch(() => false);
  if (ours) { console.log(`The RDC Checker is already running at ${link}. Opening it.`); openBrowser(link); setTimeout(() => process.exit(0), 1500); }
  else { console.log(`Port ${PORT} is used by another program. Set QA_UI_PORT=4418 (or any free port) in .env and start again.`); process.exitCode = 1; }
});

server.listen(PORT, '127.0.0.1', () => {
  const link = `http://127.0.0.1:${PORT}`;
  console.log(`RDC Checker UI: ${link}  (close this window to stop it)`);
  openBrowser(link);
});
