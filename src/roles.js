/**
 * Every account type the checker can sign in as. Accounts live in .env as
 *   NEW_<KEY>=username:password      on Vercel (the new app)
 *   LEGACY_<KEY>=username:password   on the original WordPress site (parity tests)
 * where KEY is the WordPress role (plus the member type for project reviewers). `original` / `vercel` are
 * the test usernames (see the sheet's Roles & Access tab); passwords live only in .env.
 *
 * `role` is the short name tests use (`role: 'admin'`); `menu` is the fixed ID of that role's top-menu
 * parity test, so adding a role never renumbers another. New roles go at the END of the list.
 * The role list matches the "Role" dropdown of Add New User on both sites (25 roles; Administrator is Vercel only).
 */
export const ROLE_INFO = [
  { role: 'public', key: 'PUBLIC', name: 'No sign-in' },
  { role: 'admin', key: 'RDC_ADMIN', name: 'RDC Admin', original: 'dev_rdc_admin', menu: 'PAR-001' },
  { role: 'member', key: 'MEMBER', name: 'Member without every section', original: 'dev_rdc_member' },
  { role: 'rdc_checker', key: 'RDC_CHECKER', name: 'RDC Checker', original: 'dev_rdc_checker', vercel: 'test_rdc_checker', menu: 'PAR-015' },
  { role: 'rdc_encoder', key: 'RDC_ENCODER', name: 'RDC Encoder', original: 'dev_rdc_encoder', vercel: 'test_rdc_encoder', menu: 'PAR-016' },
  { role: 'rdc_member', key: 'RDC_MEMBER', name: 'RDC Member', original: 'dev_rdc_member', menu: 'PAR-017' },
  { role: 'approving_officer', key: 'RDC_APPROVING_OFFICER', name: 'RDC Approving Officer', original: 'dev_rdc_approving_officer', menu: 'PAR-018' },
  { role: 'agency_admin', key: 'AGENCY_ADMIN', name: 'Agency Admin', original: 'dev_rdc_agency_admin', vercel: 'newtest_agency_admin', menu: 'PAR-019' },
  { role: 'agency_head', key: 'AGENCY_HEAD', name: 'Agency Head', original: 'dev_rdc_agency_head', vercel: 'newtest_agency_head', menu: 'PAR-002' },
  { role: 'agency_checker', key: 'AGENCY_CHECKER', name: 'Agency Checker', original: 'dev_rdc_agency_checker', vercel: 'newtest_agency_checker', menu: 'PAR-020' },
  { role: 'agency_encoder', key: 'AGENCY_ENCODER', name: 'Agency Encoder', original: 'dev_rdc_agency_encoder', vercel: 'newtest_agency_encoder', menu: 'PAR-021' },
  { role: 'agency_guest', key: 'AGENCY_GUEST', name: 'Agency Guest', original: 'dev_rdc_agency_guest', menu: 'PAR-022' },
  { role: 'psr', key: 'PS_REPRESENTATIVE', name: 'Private Sector Representative', original: 'dev_rdc_psr', menu: 'PAR-023' },
  { role: 'cso', key: 'CSO_MEMBER', name: 'CSO Member', original: 'dev_rdc_cso', menu: 'PAR-024' },
  { role: 'riatf', key: 'RIATF_REP', name: 'RIATF Representative', original: 'dev_rdc_riatf', menu: 'PAR-025' },
  { role: 'dbm_reviewer', key: 'PROJECT_REVIEWER_DBM', name: 'Project Reviewer (DBM Reviewer)', original: 'dev_rdc_dbm_reviewer', menu: 'PAR-026' },
  { role: 'ched_reviewer', key: 'PROJECT_REVIEWER_CHED', name: 'Project Reviewer (CHED Reviewer)', original: 'dev_rdc_ched_reviewer', menu: 'PAR-027' },
  { role: 'chief_reviewer', key: 'DBM_CHIEF_REVIEWER', name: 'DBM Chief Reviewer', original: 'dev_dbm_chief_reviewer', menu: 'PAR-028' },
  { role: 'ched_chief_reviewer', key: 'CHED_CHIEF_REVIEWER', name: 'CHED Chief Reviewer', original: 'dev_ched_chief_reviewer', menu: 'PAR-029' },
  { role: 'neda_chief_reviewer', key: 'NEDA_CHIEF_REVIEWER', name: 'NEDA Chief Reviewer', original: 'dev_neda_chief_reviewer', menu: 'PAR-030' },
  // Roles in the Add New User dropdown with no test account yet (their tests are Blocked until there is one).
  { role: 'neda_reviewer', key: 'PROJECT_REVIEWER_NEDA', name: 'Project Reviewer (NEDA Reviewer)', menu: 'PAR-031' },
  { role: 'dbm_officer', key: 'DBM_OFFICER', name: 'DBM Officer', menu: 'PAR-032' },
  { role: 'lgu_representative', key: 'LGU_REPRESENTATIVE', name: 'LGU Representative', menu: 'PAR-033' },
  { role: 'congressional_representative', key: 'CONGRESSIONAL_REPRESENTATIVE', name: 'Congressional District Representative', menu: 'PAR-034' },
  { role: 'guest_user', key: 'GUEST_USER', name: 'Guest User', menu: 'PAR-035' },
  { role: 'investor', key: 'INVESTOR', name: 'Investor', menu: 'PAR-036' },
  { role: 'gad_focal', key: 'GAD_FOCAL', name: 'GAD Focal', menu: 'PAR-037' },
  { role: 'public_user', key: 'PUBLIC_USER', name: 'Public User', menu: 'PAR-038' },
  { role: 'data_uploader', key: 'DATA_UPLOADER', name: 'Data Uploader', menu: 'PAR-039' },
  { role: 'administrator', key: 'ADMINISTRATOR', name: 'Administrator (Vercel only)', vercelOnly: true },
];

export const ROLES = ROLE_INFO.map(r => r.role);
export const roleInfo = role => ROLE_INFO.find(r => r.role === role);
