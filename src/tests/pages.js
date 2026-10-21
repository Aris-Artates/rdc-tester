/**
 * Every built page opens for the administrator and shows its heading.
 * One ticket per page so the sheet shows exactly which page broke.
 * To add a page: add one line to PAGES with the next free PAGE- number.
 */
const PAGES = [
  ['PAGE-001', 'Home', '/portal', 'Regional investments. Shared progress.'],
  ['PAGE-002', 'Projects', '/projects', 'Project Proposals'],
  ['PAGE-003', 'Projects', '/projects/16420', 'PROJECT PROPOSAL PROFILE'],
  ['PAGE-004', 'Reviews', '/reviews?type=all', 'Reviews'],
  ['PAGE-005', 'Monitoring', '/monitoring', 'Review Status'],
  ['PAGE-006', 'Monitoring', '/monitoring/deficiency', 'Deficiency Status'],
  ['PAGE-007', 'Monitoring', '/monitoring/ir-docs', 'IR Docs Status'],
  ['PAGE-008', 'Monitoring', '/monitoring/aco-nep-gaa', 'ACO NEP GAA Monitor'],
  ['PAGE-009', 'Reports', '/reports', 'Annex A & B'],
  ['PAGE-010', 'Records Update', '/records/bulk-upload', 'Bulk PPA Upload'],
  ['PAGE-011', 'Requests', '/requests/clearances', 'All Clearances'],
  ['PAGE-012', 'Requests', '/requests/approval', 'Approval Requests'],
  ['PAGE-013', 'Requests', '/requests/reviewers', "Reviewer's Comments"],
  ['PAGE-014', 'Requests', '/requests/research', 'Research Requests'],
  ['PAGE-015', 'Communication', '/communication/notifications', 'All Notifications'],
  ['PAGE-016', 'Communication', '/communication/messages', 'All Messages'],
  ['PAGE-017', 'Accounts', '/accounts/users', 'All Users'],
  ['PAGE-018', 'Accounts', '/accounts/members', 'Member Accounts'],
  ['PAGE-019', 'Accounts', '/accounts/member-types', 'All Member Types'],
  ['PAGE-020', 'Accounts', '/accounts/groups', 'All Groups'],
  ['PAGE-021', 'Accounts', '/accounts/roles', 'User Roles'],
  ['PAGE-022', 'Accounts', '/accounts/agencies', 'All Agencies'],
  ['PAGE-023', 'Accounts', '/accounts/agencies/new', 'Add New Agency'],
  ['PAGE-024', 'Accounts', '/accounts/agencies/gdrive', 'Assign Google Drive Folder'],
  ['PAGE-025', 'Accounts', '/accounts/sectors', 'All Sectors'],
  ['PAGE-026', 'Dev Framework', '/dev-framework/rdp-chapters', 'RDP Chapters'],
  ['PAGE-027', 'Dev Framework', '/dev-framework/sdgs-2030', 'Sustainable Development Goals'],
  ['PAGE-028', 'Dev Framework', '/dev-framework/rdp-typology', 'RDP Typology'],
  ['PAGE-029', 'Dev Framework', '/dev-framework/uuas', 'Unserved & Underserved Areas'],
  ['PAGE-030', 'Scoring Matrix', '/scoring/criteria?fy=2027', 'All Criteria'],
  ['PAGE-031', 'Scoring Matrix', '/scoring/budget-absorption', 'Budget Absorption Capacity Scoring'],
  ['PAGE-032', 'Scoring Matrix', '/scoring/readiness-docs', 'Readiness Docs Settings'],
  ['PAGE-033', 'Settings', '/settings/location', 'All Locations'],
  ['PAGE-034', 'Settings', '/settings/tier-type', 'Tier Type'],
  ['PAGE-035', 'Settings', '/settings/category', 'Category'],
  ['PAGE-036', 'Profile', '/profile', 'Profile Details'],
  ['PAGE-037', 'Dev Framework', '/dev-framework/sdgs-2030/new', 'Sustainable Development Goal'],
  ['PAGE-038', 'Scoring Matrix', '/scoring/criteria/new', 'Criteria'],
];

export default PAGES.map(([id, module, path, text]) => ({
  id, module, kind: 'Functional', role: 'admin',
  title: `Page opens: ${path}`,
  steps: `Signed in as admin, open ${path}.`,
  expected: `The page loads (no error, no redirect) and shows "${text}".`,
  async run(t) {
    await t.open(path);
    await t.see(text);
    return t.pass(`Loaded; "${text}" shown`);
  },
}));
