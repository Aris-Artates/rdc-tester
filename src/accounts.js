#!/usr/bin/env node
/**
 * npm run accounts [-- --only qa_admin,qa_agyhd] [--site vercel|legacy] [--check] [--headed]
 *
 * Creates one QA account per role on BOTH sites, with the same username on both and ONE shared password:
 *   - QA_PASSWORD in .env is generated the first time (24 random characters) and never printed.
 *   - Each account is made through that site's own "Add New User" form, signed in as an admin:
 *     SETUP_ADMIN_NEW / SETUP_ADMIN_LEGACY (username:password) if set, else NEW_RDC_ADMIN / LEGACY_RDC_ADMIN.
 *   - Every account is then proven by signing in with it; .env gets NEW_<ROLE>=<username> and
 *     LEGACY_<ROLE>=<username> (no password: the checker uses QA_PASSWORD for entries without one).
 * --check   only sign in with each account (creates nothing).
 * Accounts that already exist are left as they are and only checked.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { chromium } from 'playwright';
import { ROOT, config, newKey, legacyKey } from './config.js';
import { login, abs, settle } from './app.js';
import { loginOriginal } from './original.js';
import { roleInfo } from './roles.js';

const ENV_FILE = path.join(ROOT, '.env');
// The agency the agency-type accounts belong to (same ID on both sites: Vercel's data was migrated from WordPress).
const QA_AGENCY = 54;

/**
 * One row per account: checker role, username (same on both sites), WordPress role, member type ID (the
 * "Member Type" dropdown on both sites), and whether it needs an agency. Member types 1 RDC 8, 4 DBM 8,
 * 5 Private Sector, 6 CSO, 7 Government Agency, 8 LGU, 9 Guest, 10 Investor, 16/18/19 DBM/CHED/NEDA Reviewer,
 * 22 House of Representatives. Roles that no member type offers use the closest type (see `pickRole`).
 */
export const ACCOUNTS = [
  ['admin', 'qa_admin', 'rdc_admin', 1],
  ['rdc_checker', 'qa_rdcchk', 'rdc_checker', 1],
  ['rdc_encoder', 'qa_rdcenc', 'rdc_encoder', 1],
  ['rdc_member', 'qa_rdcmem', 'rdc_member', 1],
  ['approving_officer', 'qa_rdcao', 'rdc_approving_officer', 1],
  ['agency_admin', 'qa_agyadm', 'agency_admin', 7, true],
  ['agency_head', 'qa_agyhd', 'agency_head', 7, true],
  ['agency_checker', 'qa_agychk', 'agency_checker', 7, true],
  ['agency_encoder', 'qa_agyenc', 'agency_encoder', 7, true],
  ['agency_guest', 'qa_agygst', 'agency_guest', 7, true],
  ['psr', 'qa_psr', 'ps_representative', 5],
  ['cso', 'qa_cso', 'cso_member', 6],
  ['riatf', 'qa_riatf', 'riatf_rep', 1],
  ['dbm_reviewer', 'qa_dbmrev', 'project_reviewer', 16],
  ['ched_reviewer', 'qa_chedrev', 'project_reviewer', 18],
  ['neda_reviewer', 'qa_nedarev', 'project_reviewer', 19],
  ['chief_reviewer', 'qa_dbmchf', 'dbm_chief_reviewer', 16],
  ['ched_chief_reviewer', 'qa_chedchf', 'ched_chief_reviewer', 18],
  ['neda_chief_reviewer', 'qa_nedachf', 'neda_chief_reviewer', 19],
  ['dbm_officer', 'qa_dbmofc', 'dbm_officer', 4],
  ['lgu_representative', 'qa_lgu', 'lgu_representative', 8],
  ['congressional_representative', 'qa_cong', 'congressional_representative', 22],
  ['guest_user', 'qa_guest', 'guest_user', 9],
  ['investor', 'qa_inv', 'investor', 10],
  ['gad_focal', 'qa_gad', 'gad_focal', 7, true],
  ['public_user', 'qa_pub', 'public_user', 9],
  ['data_uploader', 'qa_upl', 'data_uploader', 1],
].map(([role, username, wpRole, memberType, agency = false]) => ({ role, username, wpRole, memberType, agency, name: roleInfo(role)?.name || role }));
// "Member without every section" (ACL tests) uses the RDC Member account.
const ALSO = { member: 'qa_rdcmem' };

const args = process.argv.slice(2);
const opt = n => { const i = args.indexOf('--' + n); return i < 0 ? null : (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---- .env: change only the lines we own, keep everything else as written ----------------------
const readEnvText = () => (fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf8') : '');
const envValue = k => (readEnvText().match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1] || '').trim().replace(/^"(.*)"$/, '$1');
function setEnv(values) {
  let text = readEnvText();
  for (const [k, v] of Object.entries(values)) {
    const line = `${k}=${v}`;
    text = new RegExp(`^${k}=.*$`, 'm').test(text) ? text.replace(new RegExp(`^${k}=.*$`, 'm'), line) : text.replace(/\n?$/, '\n') + line + '\n';
  }
  fs.writeFileSync(ENV_FILE, text);
}

/** 24 characters from letters, digits and symbols that need no quoting in .env or URLs (no # : = quotes or spaces). */
function newPassword() {
  const sets = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnopqrstuvwxyz', '23456789', '!@%^*-_+'];
  const all = sets.join('');
  const pick = s => s[crypto.randomInt(s.length)];
  const chars = [...sets.map(pick), ...Array.from({ length: 20 }, () => pick(all))];
  for (let i = chars.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; }
  return chars.join('');
}

const parse = raw => { const i = raw.indexOf(':'); return i < 1 ? null : { username: raw.slice(0, i), password: raw.slice(i + 1) }; };
const setupAdmin = site => parse(envValue(site === 'vercel' ? 'SETUP_ADMIN_NEW' : 'SETUP_ADMIN_LEGACY') || envValue(site === 'vercel' ? 'NEW_RDC_ADMIN' : 'LEGACY_RDC_ADMIN'));

// ---- the two Add New User forms -------------------------------------------------------------------
/**
 * Choose the account's role. Both forms only list the roles linked to the chosen member type; when the
 * planned type does not offer the role, every other type is tried. The original site keeps the other roles
 * in the list, only hidden, so there the planned type is kept and the role is set directly.
 */
async function pickRole(page, typeSel, roleSel, a, site) {
  const offered = async () => page.locator(roleSel).evaluate((s, want) => [...s.options].some(o => o.value === want && o.style.display !== 'none' && !o.hidden), a.wpRole);
  const types = await page.locator(typeSel).evaluate(s => [...s.options].map(o => o.value).filter(Boolean));
  for (const t of [String(a.memberType), ...types.filter(t => t !== String(a.memberType))]) {
    await page.locator(typeSel).selectOption(t);
    await sleep(200);
    if (await offered()) { await page.locator(roleSel).selectOption(a.wpRole); return t === String(a.memberType) ? '' : ` (member type ${t})`; }
  }
  if (site === 'legacy') {
    await page.locator(typeSel).selectOption(String(a.memberType));
    await page.locator(roleSel).selectOption(a.wpRole);
    return ' (role set directly: no member type lists it)';
  }
  throw new Error(`no member type offers the role "${a.wpRole}" in the Add New User form`);
}

async function createVercel(page, a, password) {
  await page.goto(abs('/accounts/users'), { waitUntil: 'domcontentloaded', timeout: config.pageTimeoutMs });
  await settle(page);
  const add = page.getByRole('button', { name: '+ Add New User' });
  if (!(await add.count())) throw new Error('no "+ Add New User" button: the setup admin is not a Vercel admin');
  await add.click();
  const field = l => page.locator(`label:text-is("${l}") + input`);
  await field('Username').waitFor({ timeout: 15000 });
  await field('Username').fill(a.username);
  await page.locator('label:text-is("Password") + div input').fill(password);
  const note = await pickRole(page, 'label:text-is("Member Type") + select', 'label:text-is("Role") + select', a, 'vercel');
  if (a.agency) await page.locator('label:text-is("Agency Name") + select').selectOption(String(QA_AGENCY));
  await field('First Name').fill('QA');
  await field('Last Name').fill(a.name);
  await page.locator('label:text-is("Email Address") + input').fill(`${a.username}@rdc8ims.test`);
  await page.getByRole('button', { name: 'Save Changes' }).click();
  const toast = page.locator('[data-sonner-toast]').last();
  await toast.waitFor({ timeout: 20000 });
  const text = (await toast.innerText()).replace(/\s+/g, ' ').trim();
  if (/already taken|already used/i.test(text)) return 'already existed';
  if (/error|could not|must|enter|select/i.test(text) && !/created|saved|added/i.test(text)) throw new Error(text);
  return 'created' + note;
}

async function createLegacy(page, a, password) {
  await page.goto(config.originalUrl + '/rdc_dashboard/add_new-user.php', { waitUntil: 'domcontentloaded', timeout: config.pageTimeoutMs });
  await settle(page);
  const form = page.locator('form#add');
  if (!(await form.count())) throw new Error('no Add New User form: the setup admin cannot add users on the original site');
  await form.locator('input[name="user_login"]').fill(a.username);
  await form.locator('#password-input').fill(password);
  const note = await pickRole(page, 'form#add select[name="memberType"]', 'form#add #role', a, 'legacy');
  // The agency picker stores the chosen agency's ID in #selectedAgencyInput, exactly as clicking it does.
  if (a.agency) await form.locator('#selectedAgencyInput').evaluate((el, id) => { el.value = String(id); }, QA_AGENCY);
  for (const box of await form.locator('input[name="fy[]"]').all()) await box.check().catch(() => {});
  await form.locator('input[name="first_name"]').fill('QA');
  await form.locator('input[name="last_name"]').fill(a.name);
  await form.locator('input[name="user_email"]').fill(`${a.username}@rdc8ims.test`);
  const answer = page.waitForResponse(r => r.request().method() === 'POST' && /admin-ajax\.php/.test(r.url()), { timeout: config.pageTimeoutMs });
  await page.locator('#submit_btn').click();
  const resp = await answer;
  const body = await resp.text().catch(() => '');
  let msg = body;
  try { const j = JSON.parse(body); msg = [j.message, j.msg, j.data?.message, typeof j.data === 'string' ? j.data : ''].filter(Boolean).join(' ') || body; } catch { /* plain text */ }
  msg = msg.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (/exist|taken|already/i.test(msg)) return 'already existed';
  if (resp.status() >= 400 || /error|fail|invalid|required/i.test(msg)) throw new Error(`HTTP ${resp.status()}: ${msg}`);
  return 'created' + note;
}

/** Sign in with a fresh browser context; true when the site accepted the account. */
async function canSignIn(browser, site, account) {
  const ctx = await browser.newContext();
  try {
    const page = await ctx.newPage();
    const r = site === 'vercel' ? await login(page, account) : await loginOriginal(page, account);
    return r.ok;
  } catch { return false; } finally { await ctx.close(); }
}

// ---- main -------------------------------------------------------------------------------------------
if (!fs.existsSync(ENV_FILE)) fs.writeFileSync(ENV_FILE, fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8'));
let password = envValue('QA_PASSWORD');
if (!password) { password = newPassword(); setEnv({ QA_PASSWORD: password }); console.log('Made a new shared password and saved it as QA_PASSWORD in .env (not shown here).'); }
if (password.length < 12) { console.log('QA_PASSWORD in .env is shorter than 12 characters. Empty it to get a new one.'); process.exit(1); }

const only = typeof opt('only') === 'string' ? opt('only').split(',').map(s => s.trim()) : null;
const sites = typeof opt('site') === 'string' ? [opt('site')] : ['vercel', 'legacy'];
const plan = ACCOUNTS.filter(a => !only || only.includes(a.username) || only.includes(a.role));
const checkOnly = !!opt('check');
const browser = await chromium.launch({ headless: !opt('headed') });
const result = Object.fromEntries(plan.map(a => [a.username, {}]));

for (const site of sites) {
  const label = site === 'vercel' ? 'Vercel' : 'Original site';
  console.log(`\n== ${label}`);
  let page = null;
  if (!checkOnly) {
    const admin = setupAdmin(site);
    if (!admin) { console.log(`  No admin to create accounts with: set ${site === 'vercel' ? 'SETUP_ADMIN_NEW' : 'SETUP_ADMIN_LEGACY'}=username:password in .env (an RDC Admin on that site).`); continue; }
    page = await (await browser.newContext()).newPage();
    const r = site === 'vercel' ? await login(page, admin) : await loginOriginal(page, admin);
    if (!r.ok) { console.log(`  The setup admin "${admin.username}" could not sign in: ${r.message.replace(/\(username.*/, '')}`); continue; }
    console.log(`  Signed in as ${admin.username} to add users.`);
  }
  for (const a of plan) {
    const account = { username: a.username, password };
    let status;
    if (await canSignIn(browser, site, account)) status = 'ready (already existed)';
    else if (checkOnly) status = 'NOT READY: cannot sign in';
    else {
      try {
        const made = site === 'vercel' ? await createVercel(page, a, password) : await createLegacy(page, a, password);
        status = (await canSignIn(browser, site, account)) ? `ready (${made})`
          : made === 'already existed' ? 'NOT READY: the username exists with another password' : `NOT READY: ${made}, but signing in failed`;
      } catch (e) { status = 'NOT READY: ' + String(e.message || e).split('\n')[0].slice(0, 200); }
    }
    result[a.username][site] = status;
    console.log(`  ${a.username.padEnd(11)} ${a.name.padEnd(38)} ${status}`);
    if (status.startsWith('ready')) setEnv({ [site === 'vercel' ? newKey(a.role) : legacyKey(a.role)]: a.username, ...Object.fromEntries(Object.entries(ALSO).filter(([, u]) => u === a.username).map(([r]) => [site === 'vercel' ? newKey(r) : legacyKey(r), a.username])) });
  }
}
await browser.close();

const ready = s => plan.filter(a => result[a.username][s]?.startsWith('ready')).length;
console.log(`\nReady: Vercel ${ready('vercel')}/${plan.length}, original site ${ready('legacy')}/${plan.length}. .env updated for every ready account (password = QA_PASSWORD).`);
fs.mkdirSync(path.join(ROOT, 'results'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'results', 'accounts.csv'), ['Role,Username,Vercel,Original site', ...plan.map(a => [a.name, a.username, result[a.username].vercel || '', result[a.username].legacy || ''].map(v => `"${v.replace(/"/g, '""')}"`).join(','))].join('\n') + '\n');
console.log('Summary saved to results/accounts.csv');
