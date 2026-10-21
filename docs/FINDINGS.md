# Findings: original site vs Vercel (2026-10-21)

Source: the `rdc8-ims` repo at GitLab `main` `104e340` (the code deployed on Vercel), the public part of
both sites, and the checker's first run. Pages behind sign-in were checked from the code only. Run the
admin/member tests with real accounts to confirm them on the live site.

## Verified live (no sign-in needed)

| Test | Result | Note |
|---|---|---|
| PUB-001 to PUB-005, PUB-007 | Pass | Home page, map (pins render), sign-in dialog, wrong-password and empty-field messages, member pages closed without a session |
| PUB-006 Show/hide password | **Not Implemented** | Planned (`.lovable/plan/show-hide-password...`) but the field is still always `type="password"`; there is no eye button |
| DATA-001 to 004 Home stats | Blocked (needs reference) | Vercel shows 7,579 projects, ₱374.62 B, 62 agencies, 2021–2027. These are **hard-coded** in `src/routes/index.tsx`, so they will drift from the real data |

## Expected to fail (found in the code; tests are in place)

| Test | Problem |
|---|---|
| SET-003 | Deleting a **Category** shows "Tier type deleted." (copy-paste message in `settings.category.tsx`) |
| ACL-003 | The **Settings gear** is shown to every member, even without Settings permission; clicking its links just redirects (gear rendered unconditionally in `AppShell.tsx`) |

## Not migrated yet (Pending tests -> Not Implemented)

- Records Update: Budget Absorption, Annual Procurement, Risk Management, Form A1, A2, C, D, IP, Comments Update (PEND-001..009)
- Settings: Fund Sources, Classifications, Enable/Disable Menus, Application Settings (PEND-010..013)
- Accounts: Activity Logs (PEND-014)
- Project Profile workflow steps 2–7 (PEND-020..025): still "coming soon"
- Agencies > Edit (PEND-030): shows "Edit ... coming soon."
- Send An Email: links out to `webmail.rdc8ims.online` (by design)

## Real data vs mock-up

Uses **migrated data** from the original (Data tests can compare against it): Users, Member Accounts,
Clearances, Research Requests, Locations, Tier Types, Categories; Project Profile comments, workflow
statuses and contact messages are saved.

**Mock-up / sample data** (will not match the original until wired to the database): Projects list and
proposal details, Reviews, all Monitoring pages (Review Status, Deficiency, IR Docs, ACO NEP GAA), Reports
(Annex A/B), Bulk Upload, Approval and Reviewer's requests, Notifications, Messages, Member Types, Groups,
Roles, Agencies, Sectors, Dev Framework, Scoring Matrix, Profile. Their **Logic** tests (totals,
percentages, paging) still apply: the calculations are real even when the data is sample data.
