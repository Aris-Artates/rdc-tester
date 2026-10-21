/**
 * Everything the checker knows about the RDC8 IMS (Vercel) screens.
 * If the app's layout changes, this should be the main file that needs edits.
 */
import { config } from './config.js';

const NOT_FOUND_TEXT = /^\s*(404\s*)?Page not found\.?/im;
const COMING_SOON_TEXT = /This page is coming soon\.|section is coming soon/i;
const CRASH_TEXT = /This page didn't load|Application error|Internal Server Error|Something went wrong/i;

const sleep = ms => new Promise(r => setTimeout(r, ms));
export const pathOf = url => new URL(url, config.appUrl).pathname.replace(/\/+$/, '') || '/';
export const abs = p => (/^https?:/.test(p) ? p : config.appUrl + (p.startsWith('/') ? p : '/' + p));

/** Wait until the network is quiet and the page text stops changing for SETTLE_MS. */
export async function settle(page, maxMs = config.pageTimeoutMs) {
  await page.waitForLoadState('networkidle', { timeout: Math.min(maxMs, 15000) }).catch(() => {});
  const deadline = Date.now() + maxMs;
  let last = '', since = Date.now();
  while (Date.now() < deadline) {
    const text = await page.locator('body').innerText().catch(() => '');
    if (text !== last) { last = text; since = Date.now(); }
    else if (Date.now() - since >= Math.min(config.settleMs, 1500)) return text;
    await sleep(250);
  }
  return last;
}

/**
 * Open a path and decide what the user actually got:
 *   allowed | redirected | logged-out | notfound | coming-soon | crashed
 * The app never shows an "Access denied" card: a page the member may not open
 * silently redirects (to /portal, the first allowed section, or /profile); no session goes to "/".
 */
export async function open(page, path) {
  const want = pathOf(abs(path));
  const resp = await page.goto(abs(path), { waitUntil: 'domcontentloaded', timeout: config.pageTimeoutMs }).catch(e => ({ error: e }));
  if (resp?.error) return { state: 'crashed', detail: 'Navigation failed: ' + resp.error.message.split('\n')[0] };
  const body = await settle(page);
  const now = pathOf(page.url());
  if (CRASH_TEXT.test(body)) return { state: 'crashed', detail: 'Error page: ' + body.match(CRASH_TEXT)[0] };
  if ((resp && resp.status() === 404) || (NOT_FOUND_TEXT.test(body) && body.length < 2500)) return { state: 'notfound', detail: 'Page not found' };
  if (COMING_SOON_TEXT.test(body)) return { state: 'coming-soon', detail: '"coming soon" placeholder' };
  if (now !== want) {
    if (now === '/' && want !== '/') return { state: 'logged-out', detail: 'Sent back to the public home page' };
    return { state: 'redirected', detail: 'Ended on ' + now, to: now };
  }
  return { state: 'allowed', detail: 'Page loaded' };
}

/** Sign in through the Member Portal dialog on the home page. Returns { ok, message, landed }. */
export async function login(page, account) {
  await page.goto(abs('/'), { waitUntil: 'domcontentloaded', timeout: config.pageTimeoutMs });
  // React must be hydrated before the dialog opens; a click before that does nothing.
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  const dialog = page.getByRole('dialog');
  for (let attempt = 0; attempt < 3 && !(await dialog.isVisible().catch(() => false)); attempt++) {
    await page.getByRole('button', { name: /Member Portal/ }).first().click({ timeout: 10000 }).catch(() => {});
    await dialog.waitFor({ timeout: 4000 }).catch(() => {});
    // Already signed in: the button goes straight to /portal.
    if (pathOf(page.url()) !== '/') return { ok: true, message: 'Already signed in', landed: pathOf(page.url()) };
  }
  if (!(await dialog.isVisible().catch(() => false))) return { ok: false, message: 'The "Member Portal Sign In" dialog did not open' };
  await dialog.locator('input[name="username"]').fill(account.username);
  await dialog.locator('input[name="password"]').fill(account.password);
  await dialog.getByRole('button', { name: /^Sign In$/ }).click();
  const deadline = Date.now() + config.pageTimeoutMs;
  while (Date.now() < deadline) {
    if (pathOf(page.url()) !== '/') {
      await settle(page);
      return { ok: true, message: 'Signed in; landed on ' + pathOf(page.url()), landed: pathOf(page.url()) };
    }
    const alert = await dialog.getByRole('alert').innerText().catch(() => '');
    if (alert) return { ok: false, message: `Sign-in refused: "${alert.trim()}" (username "${account.username}", password of ${account.password.length} characters)` };
    await sleep(250);
  }
  return { ok: false, message: 'Sign In did nothing within ' + config.pageTimeoutMs / 1000 + 's' };
}

/** Log out through the profile menu (top right). The app asks a native confirm(), which is accepted. */
export async function logout(page) {
  if (pathOf(page.url()) === '/') await open(page, '/profile');
  const menu = page.locator('header button').filter({ has: page.locator('svg.lucide-chevron-down') }).last();
  await menu.hover({ timeout: 10000 });
  page.once('dialog', d => d.accept().catch(() => {}));
  await page.getByRole('button', { name: /Log Out/ }).click({ timeout: 10000 });
  await page.waitForURL(u => pathOf(u.toString()) === '/', { timeout: config.pageTimeoutMs });
}

/** Every same-site link path in the header navigation, including hover dropdowns. */
export async function navPaths(page) {
  const found = new Set();
  const collect = async () => {
    const hrefs = await page.locator('header a[href], nav a[href]').evaluateAll(as => as.map(a => a.getAttribute('href')));
    for (const h of hrefs) if (h && h.startsWith('/')) found.add(h.split(/[?#]/)[0].replace(/\/+$/, '') || '/');
  };
  await collect();
  // Dropdowns render only while hovered: hover each top-level item and read again.
  const items = page.locator('header nav > *');
  const n = Math.min(await items.count(), 40);
  for (let i = 0; i < n; i++) {
    await items.nth(i).hover({ timeout: 2000 }).catch(() => {});
    await sleep(200);
    await collect();
  }
  await page.locator('button[aria-label="Settings"]').first().click({ timeout: 2000 }).then(collect).catch(() => {});
  await page.keyboard.press('Escape').catch(() => {});
  return found;
}

/** Numbers in a text cell: "₱ 1,234.50" -> 1234.5, "12.5%" -> 12.5, "Pending" / "—" -> null. */
export function num(text) {
  const m = String(text ?? '').replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}

/**
 * A table as plain text: { head: [leaf header texts], rows: [[cell texts]], foot: [[cell texts]] }.
 * `head` is the LAST header row (the leaf columns); group headers above it are ignored.
 */
export async function readTable(locator) {
  return locator.evaluate(table => {
    const cells = tr => [...tr.cells].map(c => c.innerText.trim());
    const headRows = [...table.querySelectorAll('thead tr')];
    return {
      head: headRows.length ? cells(headRows[headRows.length - 1]) : [],
      rows: [...table.querySelectorAll('tbody tr')].map(cells),
      foot: [...table.querySelectorAll('tfoot tr')].map(cells),
    };
  });
}

/** "Showing 1 to 10 of 57 entries" -> { from: 1, to: 10, of: 57 } (null when not shown). */
export async function showingEntries(page) {
  const body = await page.locator('body').innerText();
  const m = body.replace(/,/g, '').match(/Showing\s+(\d+)\s+to\s+(\d+)\s+of\s+(\d+)\s+entries/i);
  return m ? { from: +m[1], to: +m[2], of: +m[3] } : null;
}

/** Visible toast text (sonner), or '' when none appears within `ms`. */
export async function toastText(page, ms = 8000) {
  const t = page.locator('[data-sonner-toast]').last();
  return t.waitFor({ timeout: ms }).then(() => t.innerText()).catch(() => '');
}
