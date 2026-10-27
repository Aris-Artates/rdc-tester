/**
 * Original vs Vercel, one to one: the same page on both sites must offer the same columns, filters,
 * buttons and dialogs (see src/parity.js). Each test signs in with the same role on both sites
 * (NEW_<ROLE> on Vercel, LEGACY_<ROLE> on the original site; see src/roles.js). Read only.
 */
import { runParity } from '../parity.js';
import { ROLE_INFO } from '../roles.js';

const OFFICE = 'Department of Finance - BTr Borongan Eastern Samar Provincial Office';
const office = {
  vercel: `/monitoring/agency/54/${encodeURIComponent(OFFICE)}?year=2027`,
  original: `/rdc_dashboard/review_status.php?agency_id=54&yr=2027&district=${encodeURIComponent(OFFICE)}`,
};

const pair = (id, module, title, role, spec) => ({
  id, module, kind: 'Data', role, original: true,
  title: `Same as original: ${title}`,
  steps: `Open ${spec.original} on the original site and ${spec.vercel} on Vercel as the same role; compare ${Object.keys(spec).filter(k => !['vercel', 'original', 'alias'].includes(k)).join(', ')}.`,
  expected: 'Everything the original offers is on Vercel (missing items are listed); Vercel extras are noted.',
  run: t => runParity(t, spec),
});

export default [
  pair('PAR-001', 'Navigation', 'top menus for RDC Admin', 'admin',
    { original: '/rdc_dashboard/rdp_chapters.php', vercel: '/portal', menu: true }),
  pair('PAR-002', 'Navigation', 'top menus for Agency Head', 'agency_head',
    { original: '/rdc_dashboard/deficiency_status.php', vercel: '/portal', menu: true }),
  pair('PAR-003', 'Requests', 'Approval Requests columns and filters', 'admin',
    { original: '/rdc_dashboard/approval_request.php', vercel: '/requests/approval', columns: true, filters: true }),
  pair('PAR-004', 'Requests', "Reviewer's Requests columns and filters", 'admin',
    { original: '/rdc_dashboard/reviewers_comment_approval_request.php', vercel: '/requests/reviewers', columns: true, filters: true }),
  pair('PAR-005', 'Requests', 'Clearances Requests columns and filters', 'admin',
    { original: '/rdc_dashboard/clearance.php', vercel: '/requests/clearances', columns: true, filters: true }),
  pair('PAR-006', 'Monitoring', 'Deficiency Status columns and filters', 'admin',
    { original: '/rdc_dashboard/deficiency_status.php', vercel: '/monitoring/deficiency', columns: true, filters: true }),
  pair('PAR-007', 'Monitoring', 'Review Status (all agencies) columns and filters', 'admin',
    { original: '/rdc_dashboard/review_status_evaluator.php', vercel: '/monitoring', columns: true, filters: true }),
  pair('PAR-008', 'Monitoring', 'Review Status office page actions and filters', 'admin',
    { ...office, buttons: ['Endorsed by RDC', 'Edit Priority Rank', 'Bulk Lock/Unlock'], filters: true }),
  pair('PAR-009', 'Monitoring', 'Review Status "Endorsed by RDC" dialog columns', 'admin',
    { ...office, dialog: { button: 'Endorsed by RDC', title: 'Endorsed by RDC' } }),
  pair('PAR-010', 'Monitoring', 'Review Status "Bulk Locking/Unlocking" dialog columns', 'admin',
    { ...office, dialog: { button: 'Bulk Lock/Unlock', title: 'Bulk Locking/Unlocking' } }),
  pair('PAR-011', 'Dev Framework', 'RDP Chapters columns and actions', 'admin',
    { original: '/rdc_dashboard/rdp_chapters.php', vercel: '/dev-framework/rdp-chapters', columns: true, buttons: true }),
  pair('PAR-012', 'Accounts', 'Users columns and filters', 'admin',
    { original: '/rdc_dashboard/user.php', vercel: '/accounts/users', columns: true, filters: true }),
  pair('PAR-013', 'Accounts', 'Agencies columns', 'admin',
    { original: '/rdc_dashboard/agency.php', vercel: '/accounts/agencies', columns: true }),
  pair('PAR-014', 'Projects', 'Projects list columns and filters', 'admin',
    { original: '/rdc_dashboard/project_proposals.php', vercel: '/projects', columns: true, filters: true }),
  // Every other role's top menus (fixed IDs in src/roles.js). "/" lands each role on its own dashboard on the
  // original site; /profile is open to every member on Vercel. PAR-001 / PAR-002 cover RDC Admin and Agency Head.
  ...ROLE_INFO.filter(r => r.menu && !['PAR-001', 'PAR-002'].includes(r.menu)).map(r =>
    pair(r.menu, 'Navigation', `top menus for ${r.name}`, r.role, { original: '/', vercel: '/profile', menu: true })),
];
