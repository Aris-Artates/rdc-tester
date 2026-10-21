# Setting up the QA sheet (one time)

You need: a Google account that will own the sheet, and 10 minutes.

## 1. Create the sheet

Either:

- **From the ready file** (has every current test already): in Google Drive, *New > File upload*
  `sheet/RDC-QA-Checker.xlsx`, open it, then *File > Save as Google Sheets*. Use the Google Sheets copy from here on.
- **Or start blank**: *New > Google Sheets*. The setup step below creates the tabs, and *Sync* fills the tests.

## 2. Add the script

1. In the sheet: **Extensions > Apps Script**.
2. Delete what is in `Code.gs` and paste the whole of `apps-script/RdcCheckerApi.gs`. Save (Ctrl+S).
3. **Project Settings** (gear, left) > **Script Properties** > *Add script property*:
   `QA_TOKEN` = a long random string (for example 40 random letters and digits). Keep it; it goes in `.env` too.
4. Back in the sheet, **reload the page**. A menu **RDC Checker** appears.
5. **RDC Checker > Set up / repair sheet**. Google asks for permission the first time (it needs the
   sheet, and Drive for failure screenshots): allow it, then run the menu item again.

It creates or repairs these tabs (data is never deleted; safe to run again):

| Tab | Columns / content | Who fills it |
|---|---|---|
| **Tests** | TC ID, Module, Test, Kind, Role, Steps to Test, Expected Result | the code (*Sync*) |
| | **Reference (original)**, **Ticket Status**, **Remarks** (gold headers) | **QA** |
| | Implemented on Vercel, Latest Result, Last Checked, Last Notes, Screenshot | the checker |
| **Check Log** | TC ID, Checker, Checked At, Environment, Result, Notes, Screenshot — one row per check | the checker |
| **Summary** | Per module: active tests, Pass, Fail, Blocked, Not Implemented, Not Started, Cancelled | formulas |
| **Team** | Name, Email, Role — add `RDC QA Bot` (or your CHECKER_NAME) and each tester | QA |
| **Settings** | Dropdown lists (Ticket Status, Result, Kind, Role) and reference links | QA (rarely) |

Dropdowns: **Ticket Status** = Active / On Hold / Cancelled, **Kind**, **Role**. A Cancelled row turns grey with strikethrough.
Only **Cancelled** stops the checker; *On Hold* is just a label for people.

## 3. Publish the web app

1. Apps Script: **Deploy > New deployment** > type **Web app**.
2. *Execute as*: **Me**. *Who has access*: **Anyone**. ("Anyone" only means no Google sign-in is
   needed to reach the URL; every request still needs the token.)
3. **Deploy**, copy the **Web app URL** (ends in `/exec`).
4. After any later change to the script: **Deploy > Manage deployments > Edit (pencil) > Version: New version > Deploy**.
   The URL stays the same.

## 4. Connect the checker

In the checker UI, **Settings** tab (or `.env`):

| Setting | Value |
|---|---|
| `SHEET_URL` | the sheet's normal link |
| `SHEET_WEBAPP_URL` | the Web app URL from step 3 |
| `SHEET_TOKEN` | the `QA_TOKEN` value from step 2 |
| `CHECKER_NAME` | `RDC QA Bot` (must also be in the Team tab) |
| `ACCOUNT_ADMIN` | `username:password` of an administrator (an imported WordPress account works) |
| `ACCOUNT_MEMBER` | `username:password` of a member that does **not** have every section |
| `ALLOW_WRITE_TESTS` | `false` until you agree to let tests add + delete `QA-AUTO` records |

Then **Sheet > Sync tests to the sheet**. In the log you should see `Sheet synced: N added`.
Accounts still on a default password (1234 / 12345) must sign in once by hand and change it, or every
test for that account is Blocked.

## 5. Fill the references (Data tests)

Run the **Data** kind once. Each Data test is Blocked with a note like
`Number of users on Vercel is "512". Fill the Reference (original) column...`.
Read the same figure on the original site and type it in **Reference (original)**. Next run compares them.

## Giving a teammate access

They clone the repo and double-click `RDC Checker.bat`; you send them your `.env` privately
(Settings tab > Copy) minus accounts they should not use; they paste it in Settings > *Save pasted text*.
Add their CHECKER_NAME to the Team tab.
