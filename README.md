# RDC Checker (rdc-tester)

Checks the **RDC8 IMS Vercel deployment** (`https://rdc8ims.vercel.app`) in a real browser and writes
the results into the QA Google Sheet, the same way a tester would. No AI runs during a check: every
test is a fixed rule in `src/tests/`.

The original WordPress site (`https://evims.rdc8ims.online`) is **never tested**. It is only the
reference: QA reads a figure there once and types it in the sheet, and the checker compares Vercel
against it.

## What it checks

| Kind | What it means | Example |
|---|---|---|
| **Functional** | A feature works | Sign-in refuses a wrong password; every page opens |
| **Logic** | A figure the app calculates is right (the checker recomputes it) | ACO NEP GAA TOTAL = sum of the rows; % inclusion = budget / endorsed |
| **Data** | A value on Vercel matches the original site | Number of users, clearance requests, provinces |
| **Access** | Who can open what | Member pages closed without a session; menus match permissions |
| **Pending** | On the original, not on Vercel yet | Records Update forms, Fund Sources, Activity Logs |

Each test ends as **Pass**, **Fail**, **Blocked** (could not run: no account, no Reference value,
write tests off) or **Not Implemented** (Pending test and the page still says "coming soon").
When a pending page gets built, its test starts reporting Pass / Fail by itself.

## Cancelled tickets

Set a row's **Ticket Status** to **Cancelled** in the sheet (or select rows, then menu
*RDC QA > Cancel selected tests*). From then on:

- the checker does not run it (`Skipped (ticket Cancelled)` in the log),
- the sheet refuses any result for it, even from an old copy of the checker,
- *Sync* never rewrites it, and the row is greyed out and left out of the Dashboard counts.

Set it back to **Active** to resume.

## The spreadsheet

RDC has its own spreadsheet, **RDC8 IMS - QA & Dev Tickets**, with these tabs in order:
**Dashboard**, **Dev Tickets**, **QA Tests**, **Check Log**, **Settings**. Details: [docs/SHEET-SETUP.md](docs/SHEET-SETUP.md).

## Dev tickets

- Devs log RDC tickets on **Dev Tickets** the same way as the team's ticket tab: clear **A2** to get the
  next number, then type `TYPE: Page - Sub-page - Task` after the `|`.
- QA puts the ticket number(s) a test covers in that test's **Dev Ticket** cell on **QA Tests** (`12` or `12, 15`).
- Each ticket's **QA Status** fills itself: *Verified* (every active test passes), *Failing*, *Not on Vercel yet*,
  *Partly checked*, *Not run yet* or *No QA test yet*. The Dashboard counts them per status and per dev.
- When a dev finishes a ticket, run only its tests: UI field *Only tests for dev ticket(s)*, or
  `npm run qa -- --ticket 12 --push`.

## Quick start (Windows)

1. Install **Node.js LTS** (once).
2. Double-click **`RDC Checker.bat`**. The first start installs packages and the test browser, then opens the UI.
3. Set up the sheet once: **[docs/SHEET-SETUP.md](docs/SHEET-SETUP.md)**.
4. **Settings** tab: web app URL, token, `ACCOUNT_ADMIN`, `ACCOUNT_MEMBER` (a member *without* every section). Save.
5. **Sheet > Sync tests to the sheet**, then **Run tests > Run**.

Terminal equivalents:

```bash
npm run qa -- --push
```

```bash
npm run qa -- --kind Logic,Data --push
```

```bash
npm run qa -- --status Fail,Blocked --push
```

`npm run qa:list` prints every test. All options are listed at the top of `src/run.js`.

## Adding a test

**[docs/ADDING-A-TEST.md](docs/ADDING-A-TEST.md)** — where the code goes, the `t` helpers, and how the
row gets into the sheet.

## Safety

- Read-only by default. Tests that add records (`writes: true`) only run with `ALLOW_WRITE_TESTS=true`;
  they name records `QA-AUTO ...` and delete them again in the same test.
- The checker never logs in to the original site and never submits the change-password form.
- `.env` (accounts, token, web app URL) is git-ignored. The UI listens on `127.0.0.1` only.

## Project layout

| Path | What |
|---|---|
| `RDC Checker.bat` | Launcher (UI) |
| `src/tests/*.js` | **The tests.** One file per area; every file here is loaded automatically |
| `src/tests/_helpers.js` | Helpers shared by tests (files starting with `_` are not tests) |
| `src/harness.js` | The `t` object tests receive, and the four results |
| `src/app.js` | Everything the checker knows about the app's screens (sign-in, menus, tables) |
| `src/run.js` | Runner: picks tests, skips Cancelled tickets, signs in per account, pushes results |
| `src/sheet.js`, `src/sync.js` | Sheet web app client; sync tests into the sheet |
| `apps-script/RdcCheckerApi.gs` | Google Apps Script for the sheet (API + setup menu) |
| `docs/FINDINGS.md` | Differences found so far between the original and Vercel |
| `results/` | Run logs, CSVs and screenshots (git-ignored) |
