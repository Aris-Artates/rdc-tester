# The RDC QA spreadsheet

RDC is its own project, so it has its own spreadsheet: **RDC8 IMS - QA & Dev Tickets**
(created 2026-10-21 under arisartates00@gmail.com; share it with the team from the Share button).
Its Apps Script project is **RDC QA** and holds `apps-script/RdcCheckerApi.gs` from this repo.

## Tabs

| # | Tab | What it is | Who fills it |
|---|---|---|---|
| 1 | **Dashboard** | QA cards (active, Pass, Fail, Blocked, Not Implemented, not run, pass rate, cancelled), dev ticket cards (logged, Verified, Failing, Not on Vercel yet, ...), results by module, tickets by dev, open failures, and two charts | formulas (rebuilt by *Set up*) |
| 2 | **Dev Tickets** | RDC's ticket log, same habit as the team's "Usable Tickets" tab | devs (A–D, J) / the checker (E–I) |
| 3 | **QA Tests** | One row per checker test | the code (*Sync*) + QA (gold columns) |
| 4 | **Check Log** | One row per check: TC ID, Dev Ticket, Checker, Checked At, Environment, Result, Notes, Screenshot | the checker |
| 5 | **Settings** | Dropdown lists (Ticket Status, Result, Kind, Role, **Dev**) and settings | QA (rarely) |

### Dev Tickets

- **A2** shows the next ticket (`12 | `). **Clear A2 (Delete key)** and a new row appears with that number,
  the time and the date; A2 moves on to the next number. Type the ticket after the `|`:
  `12 | FEAT: Settings - Fund Sources - Create Page`. Pick the dev in column D.
- **G2** is the counter. To continue the team's shared numbering instead of starting at 1, type the next number in G2
  and the same `N | ` in A2 (or set *First ticket number* in Settings before the first *Set up*).
- Columns **E–I** (grey headers) are filled by the checker from the QA Tests linked to the ticket:
  **QA Status** (*Verified*, *Failing*, *Not on Vercel yet*, *Partly checked*, *Not run yet*, *No QA test yet*),
  Linked Tests, Pass, Fail, Last Checked. **J** is free notes.

### QA Tests

| Columns | Who |
|---|---|
| TC ID, Module, Test, Kind, Role, Steps to Test, Expected Result | the code, via *Sync* |
| **Reference (original)**, **Ticket Status**, **Dev Ticket**, **Remarks** (gold headers) | **QA** |
| Dev Ticket Title, Implemented on Vercel, Latest Result, Last Checked, Last Notes, Screenshot (grey headers) | the checker |

- **Dev Ticket**: the ticket number(s) the test covers (`12` or `12, 15`). Dev Ticket Title fills itself.
- **Ticket Status = Cancelled**: the checker never runs or updates that test (row turns grey). Menu *RDC QA > Cancel selected tests* does it for a selection.

## One-time setup (sheet owner)

1. Open the spreadsheet > **Extensions > Apps Script** (project **RDC QA**). The code is already there; if not,
   paste `apps-script/RdcCheckerApi.gs` over `Code.gs` and save.
2. Pick **rqaSetupSheet** in the function list at the top and click **Run**. Google asks for permission once
   (*Review permissions* > your account > *Allow*): the script needs this spreadsheet, and Drive for failure screenshots.
3. Back in the spreadsheet, reload. You get the five tabs above and a menu **RDC QA**. *RDC QA > Set up / repair spreadsheet*
   can be run any time; it never deletes data.
4. **Project Settings** (gear) > **Script Properties** > add `QA_TOKEN` = a long random string. It goes in `.env` too.
5. **Deploy > New deployment** > type **Web app**, *Execute as* **Me**, *Who has access* **Anyone** > **Deploy**, copy the
   URL ending in `/exec`. ("Anyone" only means no Google sign-in is needed; every request still needs the token.)
   After later script changes: *Deploy > Manage deployments > Edit > Version: New version*. The URL stays the same.

## Connect the checker

In the checker UI **Settings** tab (or `.env`):

| Setting | Value |
|---|---|
| `SHEET_URL` | the spreadsheet's link |
| `SHEET_WEBAPP_URL` | the Web app URL from step 5 |
| `SHEET_TOKEN` | the `QA_TOKEN` value from step 4 |
| `CHECKER_NAME` | `RDC QA Bot` |
| `ACCOUNT_ADMIN` | `username:password` of an administrator (an imported WordPress account works) |
| `ACCOUNT_MEMBER` | `username:password` of a member that does **not** have every section |
| `ALLOW_WRITE_TESTS` | `false` until you agree to let tests add + delete `QA-AUTO` records |

Then **Sheet > Sync tests to the sheet** (all 114 tests appear on QA Tests) and **Run tests**.
Accounts still on a default password (1234 / 12345) must sign in once by hand and change it.

## Daily use

- Dev logs a ticket on **Dev Tickets**; QA links the matching tests by typing the ticket number in **Dev Ticket** on **QA Tests**.
- When the ticket is done: `npm run qa -- --ticket 12 --push` (or the UI field *Only tests for dev ticket(s)*).
- The ticket's **QA Status** and the **Dashboard** update after every run (*RDC QA > Refresh dev ticket QA status* to force it).
- **Data** tests stay Blocked until **Reference (original)** has the value from the original site; their notes show the Vercel value.

## Giving a teammate access

Share the spreadsheet with them. For the checker: they clone the repo, double-click `RDC Checker.bat`, and paste the
`.env` you send privately (Settings tab > Copy / paste > *Save pasted text*).
