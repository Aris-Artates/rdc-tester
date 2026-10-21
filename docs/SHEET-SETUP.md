# Setting up the QA tabs (one time)

The QA tabs go in the team's existing **Enhancement Checker - Symphonics** spreadsheet, next to the
dev ticket log **Usable Tickets - Leyeco**. They are separate tabs, all named `RDC QA - ...`.
The ticket tab and its `onEdit` counter are not changed. The checker only **reads** the ticket tab.

Needs: edit access to the spreadsheet, and about 10 minutes.

## 1. Add the script as a second file

1. In the spreadsheet: **Extensions > Apps Script**. You will see the existing file `UsableTickets.gs`. **Leave it as it is.**
2. Click **+** next to *Files* > **Script**, name it `RdcChecker`, delete the empty function in it, and
   paste the whole of `apps-script/RdcCheckerApi.gs`. Save (Ctrl+S).
   (Every name in it starts with `rqa` / `RQA_`, so it cannot clash with `UsableTickets.gs`. It adds
   `onOpen`, `doGet` and `doPost`, which the existing file does not have.)
3. **Project Settings** (gear, left) > **Script Properties** > *Add script property*:
   `QA_TOKEN` = a long random string (for example 40 random letters and digits). Keep it; it goes in `.env` too.
4. Back in the spreadsheet, **reload the page**. A menu **RDC QA** appears.
5. **RDC QA > Set up / repair sheet**. Google asks for permission the first time (the spreadsheet,
   and Drive for failure screenshots): allow it, then run the menu item again.

It creates or repairs these tabs. Data is never deleted, so it is safe to run again:

| Tab | Content | Who fills it |
|---|---|---|
| **RDC QA - Tests** | TC ID, Module, Test, Kind, Role, Steps to Test, Expected Result | the code (*Sync*) |
| | **Reference (original)**, **Ticket Status**, **Dev Ticket**, **Remarks** (gold headers) | **QA** |
| | Dev Ticket Title, Implemented on Vercel, Latest Result, Last Checked, Last Notes, Screenshot | the checker |
| **RDC QA - Check Log** | One row per check: TC ID, Dev Ticket, Checker, Checked At, Environment, Result, Notes, Screenshot | the checker |
| **RDC QA - Summary** | Per module: active tests, Pass, Fail, Blocked, Not Implemented, Not Started, Cancelled | formulas |
| **RDC QA - Dev Tickets** | Per linked dev ticket: title, dev, date, QA Status, linked tests, counts | the checker (rebuilt on every run) |
| **RDC QA - Settings** | Dropdown lists, plus the settings below | QA (rarely) |

Settings you may change (column F/G of **RDC QA - Settings**):

| Setting | Default | Meaning |
|---|---|---|
| Dev ticket tab | `Usable Tickets - Leyeco` | Where ticket numbers are looked up |
| Dev ticket first row | `4` | First ticket row on that tab |
| Also list dev tickets matching (regex) | *(empty)* | e.g. `RDC\|IMS`: matching tickets with no QA test are listed as *No QA test yet* |
| Screenshot folder (Drive) | `RDC QA Screenshots` | Where failure screenshots are saved |

Only **Cancelled** in Ticket Status stops the checker. *On Hold* is just a label for people.

## 2. Publish the web app

1. Apps Script: **Deploy > New deployment** > type **Web app**.
2. *Execute as*: **Me**. *Who has access*: **Anyone**. ("Anyone" only means no Google sign-in is
   needed to reach the URL. Every request still needs the token.)
3. **Deploy**, then copy the **Web app URL** (it ends in `/exec`).
4. After any later change to the script: **Deploy > Manage deployments > Edit (pencil) > Version: New version > Deploy**.
   The URL stays the same.

## 3. Connect the checker

In the checker UI, **Settings** tab (or `.env`):

| Setting | Value |
|---|---|
| `SHEET_URL` | the spreadsheet's normal link |
| `SHEET_WEBAPP_URL` | the Web app URL from step 2 |
| `SHEET_TOKEN` | the `QA_TOKEN` value from step 1 |
| `CHECKER_NAME` | `RDC QA Bot` |
| `ACCOUNT_ADMIN` | `username:password` of an administrator (an imported WordPress account works) |
| `ACCOUNT_MEMBER` | `username:password` of a member that does **not** have every section |
| `ALLOW_WRITE_TESTS` | `false` until you agree to let tests add + delete `QA-AUTO` records |

Then **Sheet > Sync tests to the sheet**. The log should say `Sheet synced: N added`.
Accounts still on a default password (1234 / 12345) must sign in once by hand and change it.
Until then, every test for that account is Blocked.

## 4. Link tests to dev tickets

On **RDC QA - Tests**, type the dev ticket number(s) in **Dev Ticket** (e.g. `2151` or `2151, 2160`).
Then *RDC QA > Refresh dev ticket links* (or just run the checker). **Dev Ticket Title** shows the ticket's text,
or `(not found on the ticket tab)` for a mistyped number. The ticket appears on **RDC QA - Dev Tickets**.

When a dev finishes a ticket, run only its tests:

```bash
npm run qa -- --ticket 2151 --push
```

## 5. Fill the references (Data tests)

Run the **Data** kind once. Each Data test is Blocked with a note like
`Number of users on Vercel is "512". Fill the Reference (original) column...`.
Read the same figure on the original site and type it in **Reference (original)**. The next run compares them.

## Giving a teammate access

They clone the repo and double-click `RDC Checker.bat`. You send them your `.env` privately
(Settings tab > Copy), minus any accounts they should not use. They paste it in Settings > *Save pasted text*.
