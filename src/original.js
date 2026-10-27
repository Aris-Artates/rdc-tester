/**
 * The original WordPress site (APP_URL_ORIGINAL), used only as the reference for parity tests:
 * the checker reads it, never changes it.
 */
import { config } from './config.js';
import { settle } from './app.js';

const abs = p => (/^https?:/.test(p) ? p : config.originalUrl + (p.startsWith('/') ? p : '/' + p));
const LOGIN_FORM = '#ajax-login-form';

/** Sign in through the home page's AJAX login form. Returns { ok, message }. */
export async function loginOriginal(page, account) {
  await page.goto(abs('/'), { waitUntil: 'domcontentloaded', timeout: config.pageTimeoutMs });
  const form = page.locator(LOGIN_FORM);
  if (!(await form.count())) return { ok: true, message: 'Original site: already signed in' };
  await form.locator('#username').fill(account.username);
  await form.locator('#password').fill(account.password);
  await form.locator('#wp-submit').click();
  // The form signs in by AJAX, then reloads or redirects. Wait for that, then prove the session by opening
  // a dashboard page (no login form = signed in), whatever page WordPress chose to land on.
  const deadline = Date.now() + config.pageTimeoutMs * 2;
  while (Date.now() < deadline) {
    if (new URL(page.url()).pathname !== '/' || !(await form.isVisible().catch(() => false))) break;
    await new Promise(r => setTimeout(r, 500));
  }
  // The form's last line is its status ("Signing in...", or the error WordPress sent back).
  const status = (await form.innerText().catch(() => '')).split('\n').map(l => l.trim()).filter(Boolean).pop() || '';
  await settle(page);
  const check = await openOriginal(page, '/rdc_dashboard/rdp_chapters.php');
  if (check.state === 'allowed') return { ok: true, message: 'Original site: signed in as ' + account.username };
  const why = /signing in/i.test(status) ? 'the login form never finished ("Signing in...")' : `the login form says "${status}"`;
  return { ok: false, message: `Original site did not sign in "${account.username}": ${why}. Use this role's original-site account in ORIGINAL_ACCOUNT_<ROLE> in .env.` };
}

/** Open an original-site path. Returns { state: 'allowed' | 'logged-out' | 'crashed', detail }. */
export async function openOriginal(page, path) {
  const resp = await page.goto(abs(path), { waitUntil: 'domcontentloaded', timeout: config.pageTimeoutMs }).catch(e => ({ error: e }));
  if (resp?.error) return { state: 'crashed', detail: 'Navigation failed: ' + resp.error.message.split('\n')[0] };
  await settle(page);
  if (await page.locator(LOGIN_FORM).count()) return { state: 'logged-out', detail: 'Original site shows its login page' };
  if (resp && resp.status() >= 400) return { state: 'crashed', detail: `Original site answered HTTP ${resp.status()}` };
  return { state: 'allowed', detail: 'Page loaded' };
}
