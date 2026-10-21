/** Public site (no sign-in): home page, Member Portal dialog, protected pages. */
import { open } from '../app.js';

const MODULE = 'Public Site';

export default [
  {
    id: 'PUB-001', module: MODULE, kind: 'Functional', role: 'public',
    title: 'Home page loads with its main sections',
    steps: 'Open the home page.',
    expected: 'Hero, stats, "Regional Investment Map", "Announcements & Issuances", "Citizen Services" and "Transparency Seal" are shown.',
    async run(t) {
      await t.open('/');
      for (const s of ['Projects Mapped', 'Regional Investment Map', 'Announcements & Issuances', 'Citizen Services', 'Transparency Seal']) await t.see(s);
      return t.pass('All main sections shown');
    },
  },
  {
    id: 'PUB-002', module: MODULE, kind: 'Functional', role: 'public',
    title: 'Regional Investment Map shows project pins',
    steps: 'Open the home page and scroll to the Regional Investment Map.',
    expected: 'An OpenStreetMap map with project markers/clusters and the status legend (Ongoing, For Implementation, Completed, Pipeline).',
    async run(t) {
      await t.open('/');
      const map = t.page.locator('.leaflet-container').first();
      await map.scrollIntoViewIfNeeded({ timeout: 10000 }).catch(() => {});
      t.check(await map.isVisible().catch(() => false), 'No Leaflet map on the page');
      await t.page.waitForTimeout(1500);
      const markers = await t.page.locator('.leaflet-marker-icon, .leaflet-interactive').count();
      t.check(markers > 0, 'Map shows no markers');
      for (const s of ['Ongoing', 'For Implementation', 'Completed', 'Pipeline']) await t.see(s);
      return t.pass(`${markers} markers/clusters on the map`);
    },
  },
  {
    id: 'PUB-003', module: MODULE, kind: 'Functional', role: 'public',
    title: 'Member Portal opens the sign-in dialog',
    steps: 'Click "Member Portal" in the header.',
    expected: 'Dialog "Member Portal Sign In" with "Username or email", "Password", "Sign In" and "Back to public site".',
    async run(t) {
      await t.open('/');
      await t.page.getByRole('button', { name: /Member Portal/ }).first().click();
      const d = t.page.getByRole('dialog');
      await d.waitFor({ timeout: 8000 }).catch(() => t.fail('Dialog did not open'));
      for (const s of ['Member Portal Sign In', 'Username or email', 'Password', 'Back to public site']) await t.see(s, { within: '[role="dialog"]' });
      t.check(await d.locator('input[name="username"]').count(), 'No username field');
      t.check((await d.locator('input[name="password"]').getAttribute('type')) === 'password', 'Password field is not masked');
      return t.pass('Dialog and fields present');
    },
  },
  {
    id: 'PUB-004', module: MODULE, kind: 'Functional', role: 'public',
    title: 'Sign-in refuses a wrong username / password',
    steps: 'Open Member Portal, enter an account that does not exist, click Sign In.',
    expected: '"Incorrect username or password." is shown and the user stays on the public site.',
    async run(t) {
      const r = await t.app.login(t.page, { username: 'qa-auto-nobody-' + Date.now(), password: 'wrong-password' });
      t.check(!r.ok, 'A non-existent account was let in: ' + r.message);
      t.check(/Incorrect username or password/i.test(r.message), 'Unexpected message: ' + r.message);
      return t.pass('Refused with "Incorrect username or password."');
    },
  },
  {
    id: 'PUB-005', module: MODULE, kind: 'Functional', role: 'public',
    title: 'Sign-in with empty fields asks for both fields',
    steps: 'Open Member Portal and click Sign In without typing anything.',
    expected: '"Enter your username or email and your password." is shown.',
    async run(t) {
      await t.open('/');
      await t.page.getByRole('button', { name: /Member Portal/ }).first().click();
      const d = t.page.getByRole('dialog');
      await d.waitFor({ timeout: 8000 });
      await d.getByRole('button', { name: /^Sign In$/ }).click();
      await t.see('Enter your username or email and your password', { within: '[role="dialog"]' });
      return t.pass('Validation message shown');
    },
  },
  {
    id: 'PUB-006', module: MODULE, kind: 'Functional', role: 'public', pending: true,
    title: 'Show / hide password eye in the sign-in dialog',
    steps: 'Open Member Portal, type a password, click the eye icon in the Password box.',
    expected: 'The password becomes readable; clicking again hides it. The button is labelled "Show password" / "Hide password".',
    async run(t) {
      await t.open('/');
      await t.page.getByRole('button', { name: /Member Portal/ }).first().click();
      const d = t.page.getByRole('dialog');
      await d.waitFor({ timeout: 8000 });
      const eye = d.getByRole('button', { name: /Show password/i });
      if (!(await eye.count())) t.notImplemented('No "Show password" button in the dialog yet');
      const pw = d.locator('input[name="password"]');
      await pw.fill('secret123');
      await eye.click();
      t.check((await pw.getAttribute('type')) === 'text', 'Clicking "Show password" did not reveal the password');
      await d.getByRole('button', { name: /Hide password/i }).click();
      t.check((await pw.getAttribute('type')) === 'password', 'Clicking "Hide password" did not hide it again');
      return t.pass('Eye toggles the password');
    },
  },
  {
    id: 'PUB-007', module: MODULE, kind: 'Access', role: 'public',
    title: 'Member pages are closed without a session',
    steps: 'Without signing in, open /portal, /projects, /monitoring, /accounts/users, /settings/location, /profile directly.',
    expected: 'Each one sends the visitor back to the public home page.',
    async run(t) {
      const paths = ['/portal', '/projects', '/monitoring', '/monitoring/aco-nep-gaa', '/accounts/users', '/accounts/members', '/settings/location', '/requests/clearances', '/profile'];
      const bad = [];
      for (const p of paths) {
        const r = await open(t.page, p);
        if (r.state !== 'logged-out') bad.push(`${p}: ${r.state} (${r.detail})`);
      }
      t.check(!bad.length, 'Opened without a session: ' + bad.join(' | '));
      return t.pass('All refused: ' + paths.join(', '));
    },
  },
  {
    // Signed in: without a session every unknown path redirects to "/" before the 404 can show.
    id: 'PUB-008', module: MODULE, kind: 'Functional', role: 'admin',
    title: 'Unknown address shows the 404 page',
    steps: 'Signed in, open /this-page-does-not-exist.',
    expected: '"Page not found" with a "Go home" link.',
    async run(t) {
      await t.open('/qa-auto-missing-page', { expect: 'any' });
      await t.see(/Page not found/i);
      await t.see(/Go home/i);
      return t.pass('404 page shown');
    },
  },
];
