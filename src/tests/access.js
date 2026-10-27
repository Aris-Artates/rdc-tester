/** Sign-in, sign-out and per-section page permissions. */
import { open, navPaths, logout, pathOf } from '../app.js';

const MODULE = 'Access & Sign-in';

// First URL segment = permission key (src/lib/member-permissions.ts in the app repo).
const SECTIONS = {
  portal: '/portal', projects: '/projects', reviews: '/reviews', monitoring: '/monitoring', reports: '/reports',
  records: '/records/bulk-upload', requests: '/requests/clearances', communication: '/communication/notifications',
  accounts: '/accounts/users', 'dev-framework': '/dev-framework/rdp-chapters', scoring: '/scoring/criteria', settings: '/settings/location',
};
const TOP_NAV = ['Home', 'Projects', 'Analytics', 'Reviews', 'Monitoring', 'Reports', 'Records Update', 'Requests', 'Communication', 'Accounts', 'Dev Framework', 'Scoring Matrix', 'Help'];

export default [
  {
    id: 'AUTH-001', module: MODULE, kind: 'Functional', role: 'admin',
    title: 'Administrator signs in and lands on the Member Portal',
    steps: 'Sign in through Member Portal with the admin account.',
    expected: 'The app opens /portal and the profile menu shows "Administrator".',
    async run(t) {
      await t.open('/portal');
      await t.see('Administrator', { within: 'header' });
      return t.pass('Signed in; /portal open, header shows Administrator');
    },
  },
  {
    id: 'AUTH-002', module: MODULE, kind: 'Functional', role: 'admin',
    title: 'Administrator sees every top menu',
    steps: 'Signed in as admin, look at the header menu.',
    expected: 'Home, Projects, Analytics, Reviews, Monitoring, Reports, Records Update, Requests, Communication, Accounts, Dev Framework, Scoring Matrix, Help and the Settings gear.',
    async run(t) {
      await t.open('/portal');
      const text = await t.page.locator('header nav').first().innerText();
      const missing = TOP_NAV.filter(n => !text.includes(n));
      t.check(!missing.length, 'Missing menus: ' + missing.join(', '));
      t.check(await t.page.locator('button[aria-label="Settings"]').count(), 'No Settings gear');
      return t.pass('All 13 menus and the Settings gear shown');
    },
  },
  {
    id: 'AUTH-003', module: MODULE, kind: 'Functional', role: 'admin',
    title: 'Session survives a page reload',
    steps: 'Signed in, open /monitoring and reload the page.',
    expected: 'The page stays open (no sign-in prompt).',
    async run(t) {
      await t.open('/monitoring');
      await t.page.reload({ waitUntil: 'domcontentloaded' });
      await t.app.settle(t.page);
      t.check(pathOf(t.page.url()) === '/monitoring', 'After reload the app went to ' + pathOf(t.page.url()));
      return t.pass('Still signed in after reload');
    },
  },
  {
    id: 'AUTH-004', module: MODULE, kind: 'Functional', role: 'admin', last: true,
    title: 'Log Out ends the session',
    steps: 'Profile menu (top right) > Log Out > OK. Then open /portal directly.',
    expected: '"You have been logged out." then the public home page; /portal sends you back to the home page.',
    async run(t) {
      await t.open('/portal');
      await logout(t.page);
      const r = await open(t.page, '/portal');
      t.check(r.state === 'logged-out', 'After logging out /portal still gives: ' + r.state + ' - ' + r.detail);
      return t.pass('Logged out; /portal is closed again');
    },
  },
  {
    id: 'ACL-001', module: MODULE, kind: 'Access', role: 'member',
    title: 'Limited member: menus match what the member can open',
    steps: 'Sign in with the limited member account. For every section, compare the header menu with opening its page directly.',
    expected: 'A section shown in the menu opens; a section hidden from the menu redirects away when opened directly.',
    async run(t) {
      await t.open('/profile');
      const links = await navPaths(t.page);
      const bad = [], allowed = [], refused = [];
      for (const [key, path] of Object.entries(SECTIONS)) {
        const inMenu = [...links].some(l => l === path || l.startsWith('/' + key));
        const r = await open(t.page, path);
        const opens = r.state === 'allowed';
        (opens ? allowed : refused).push(key);
        if (inMenu && !opens) bad.push(`${key}: in the menu but opening it gives ${r.state} (${r.detail})`);
        if (!inMenu && opens) bad.push(`${key}: hidden from the menu but opens directly`);
      }
      t.check(refused.length, 'This account can open every section; use an account with limited permissions for NEW_MEMBER');
      t.check(!bad.length, bad.join(' | '));
      return t.pass(`Opens: ${allowed.join(', ')}. Refused: ${refused.join(', ')}.`);
    },
  },
  {
    id: 'ACL-002', module: MODULE, kind: 'Access', role: 'member',
    title: 'Member Accounts page is administrator-only',
    steps: 'Signed in as a non-admin member, open /accounts/members directly.',
    expected: 'The member is redirected away (to /portal, their first section, or /profile).',
    async run(t) {
      const r = await open(t.page, '/accounts/members');
      t.check(r.state === 'redirected', `Expected a redirect, got ${r.state} - ${r.detail}`);
      return t.pass('Redirected: ' + r.detail);
    },
  },
  {
    id: 'ACL-003', module: MODULE, kind: 'Access', role: 'member',
    title: 'Settings gear only shows for members with Settings permission',
    steps: 'Signed in as the limited member, look for the Settings gear and open /settings/location directly.',
    expected: 'Gear visible only if /settings/location opens.',
    async run(t) {
      await t.open('/profile');
      const gear = await t.page.locator('button[aria-label="Settings"]').count();
      const r = await open(t.page, '/settings/location');
      const opens = r.state === 'allowed';
      t.check(!!gear === opens, gear ? `Settings gear is shown but /settings/location gives ${r.state} (${r.detail})` : 'Settings gear is hidden but /settings/location opens');
      return t.pass(gear ? 'Gear shown and Settings opens' : 'Gear hidden and Settings refused');
    },
  },
];
