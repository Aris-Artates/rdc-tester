import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { roleInfo } from './roles.js';

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
  appUrl: stripSlash(env('APP_URL_VERCEL', 'https://evims.vercel.app')),
  originalUrl: stripSlash(env('APP_URL_ORIGINAL', 'https://evims.rdc8ims.online')),
  allowWrite: bool('ALLOW_WRITE_TESTS'),
};

// "username:password", or just "username" for the QA accounts (npm run accounts), which share QA_PASSWORD.
const parseAccount = raw => {
  const i = raw.indexOf(':');
  if (i < 0) return raw && env('QA_PASSWORD') ? { username: raw, password: env('QA_PASSWORD') } : null;
  return i < 1 ? null : { username: raw.slice(0, i), password: raw.slice(i + 1) };
};
const oldKey = role => String(role).toUpperCase().replace(/[^A-Z0-9]+/g, '_');
const keyOf = role => roleInfo(role)?.key || oldKey(role);

/** The .env names of a role's accounts: NEW_<ROLE> on Vercel, LEGACY_<ROLE> on the original site. */
export const newKey = role => 'NEW_' + keyOf(role);
export const legacyKey = role => 'LEGACY_' + keyOf(role);

/** { username, password } for a role on Vercel (NEW_RDC_ADMIN), or null when not set. Old ACCOUNT_<ROLE> still read. */
export function accountFor(role) {
  return parseAccount(env(newKey(role)) || env('ACCOUNT_' + oldKey(role)));
}

/** "Use different accounts" (ORIGINAL_SEPARATE_ACCOUNTS): the original site has its own accounts. */
export const separateOriginalAccounts = () => bool('ORIGINAL_SEPARATE_ACCOUNTS');

/**
 * The same role's account on the original WordPress site (LEGACY_RDC_ADMIN; old ORIGINAL_ACCOUNT_<ROLE> still read).
 * With "Use different accounts" ticked only that one is used; otherwise the Vercel account is used when it is empty.
 */
export function originalAccountFor(role) {
  const own = parseAccount(env(legacyKey(role)) || env('ORIGINAL_ACCOUNT_' + oldKey(role)));
  return separateOriginalAccounts() ? own : own || accountFor(role);
}
