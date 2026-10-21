import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

// Always read the .env next to the project, wherever the tool is started from.
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(ROOT, '.env'), override: true });

// An empty line in .env ("KEY=") counts as not set, so the default applies.
const env = (k, d = '') => (process.env[k] || d).trim();
const bool = k => /^(1|true|yes|on)$/i.test(env(k));
const stripSlash = u => u.replace(/\/+$/, '');

export const config = {
  webappUrl: env('SHEET_WEBAPP_URL'),
  token: env('SHEET_TOKEN'),
  sheetUrl: env('SHEET_URL'),
  checker: env('CHECKER_NAME', 'RDC QA Bot'),
  settleMs: Number(env('SETTLE_MS', '2500')),
  pageTimeoutMs: Number(env('PAGE_TIMEOUT_MS', '30000')),
  // The host lives only in .env, never in the tests: tests use paths ("/projects").
  appUrl: stripSlash(env('APP_URL_VERCEL', 'https://rdc8ims.vercel.app')),
  originalUrl: stripSlash(env('APP_URL_ORIGINAL', 'https://evims.rdc8ims.online')),
  allowWrite: bool('ALLOW_WRITE_TESTS'),
};

/** { username, password } for a role ("admin" -> ACCOUNT_ADMIN), or null when not set. */
export function accountFor(role) {
  const raw = env('ACCOUNT_' + String(role).toUpperCase().replace(/[^A-Z0-9]+/g, '_'));
  const i = raw.indexOf(':');
  if (i < 1) return null;
  return { username: raw.slice(0, i), password: raw.slice(i + 1) };
}
