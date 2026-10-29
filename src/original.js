/**
 * The original WordPress site (APP_URL_ORIGINAL), used only as the reference for parity tests:
 * the checker reads it, never changes it.
 */
import { config } from './config.js';
import { settle } from './app.js';

const abs = p => (/^https?:/.test(p) ? p : config.originalUrl + (p.startsWith('/') ? p : '/' + p));
const LOGIN_FORM = '#ajax-login-form';

/**
 * Sign in through the home page's AJAX login form, the same way the Leyeco checker signs in: wait for the
 * page to go quiet, type and check the fields took the text, then wait for the login request's answer and
 * report its status. Returns { ok, message }.
 */
export async function loginOriginal(page, account) {
  await page.goto(abs('/'), { waitUntil: 'load', timeout: config.pageTimeoutMs });
  // Text typed before the page's scripts finish loading is dropped: wait for the page to go quiet first.
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  const form = page.locator(LOGIN_FORM);
  if (!(await form.count())) return { ok: true, message: 'Original site: already signed in' };
  for (let attempt = 0; attempt < 3; attempt++) {
    await form.locator('#username').fill(account.username);
    await form.locator('#password').fill(account.password);
    await new Promise(r => setTimeout(r, 300));
    if ((await form.locator('#username').inputValue()) === account.username) break;
    await new Promise(r => setTimeout(r, 1000));
  }
  const answer = page.waitForResponse(r => r.request().method() === 'POST' && /wp-login\.php|admin-ajax\.php/.test(r.url()), { timeout: config.pageTimeoutMs }).catch(() => null);
  await form.locator('#wp-submit').click();
  const resp = await answer;
  const sent = `username "${account.username}", password of ${account.password.length} characters`;
  if (!resp) return { ok: false, message: `Original site: Sign In sent no login request (form not ready?) (${sent})` };
  // The site is behind Cloudflare: 403 here is its bot protection refusing the checker, not WordPress refusing the account.
  if (resp.status() === 403) return { ok: false, message: `Original site: Cloudflare refused the automated sign-in (HTTP 403 on ${new URL(resp.url()).pathname}). The site admin needs a Cloudflare rule that lets the checker through; the account was not checked (${sent}).` };
  if (resp.status() >= 400) return { ok: false, message: `Original site: login answered HTTP ${resp.status()} (${sent})` };
  // Accepted: the form then reloads or redirects; give it time before proving the session below.
  const deadline = Date.now() + config.pageTimeoutMs;
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
  return { ok: false, message: `Original site did not sign in "${account.username}": ${why}. Put this role's original-site account in LEGACY_<ROLE> in .env.` };
}

/** Open an original-site path. Returns { state: 'allowed' | 'logged-out' | 'crashed', detail }. */
export async function openOriginal(page, path) {
  const resp = await page.goto(abs(path), { waitUntil: 'domcontentloaded', timeout: config.pageTimeoutMs }).catch(e => ({ error: e }));
  if (resp?.error) return { state: 'crashed', detail: 'Navigation failed: ' + resp.error.message.split('\n')[0] };
  await settle(page);
  if (await page.locator(LOGIN_FORM).count()) return { state: 'logged-out', detail: 'Original site shows its login page' };
  // Signed-out visitors are also sent to WordPress's own login page, which has a different form.
  if (/\/wp-login\.php/.test(new URL(page.url()).pathname)) return { state: 'logged-out', detail: 'Original site sent the visitor to /wp-login.php' };
  if (resp && resp.status() >= 400) return { state: 'crashed', detail: `Original site answered HTTP ${resp.status()}` };
  return { state: 'allowed', detail: 'Page loaded' };
}
