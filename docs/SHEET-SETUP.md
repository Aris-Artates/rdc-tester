# The RDC QA spreadsheet: setup

RDC has its own spreadsheet, **RDC8 IMS - QA & Dev Tickets** (created 2026-10-21 under
arisartates00@gmail.com; share it with the team from the Share button). Its Apps Script project is
**RDC QA** and holds `apps-script/RdcCheckerApi.gs` from this repo.

How the tabs are used day to day: **[WORKFLOW.md](WORKFLOW.md)**.

## One-time setup (sheet owner)

1. Open the spreadsheet > **Extensions > Apps Script** (project **RDC QA**). If the code is missing or older
   than this repo, paste `apps-script/RdcCheckerApi.gs` over `Code.gs` and save.
2. Pick **rqaSetupSheet** in the function list at the top and click **Run**. Google asks for permission
   once (*Review permissions* > your account > *Allow*). Reload the spreadsheet: seven tabs and an **RDC QA** menu.
   *RDC QA > Set up / repair spreadsheet* can be run any time; it never deletes data.
3. **Settings** tab: check the **Dev** list and each dev's **Freedcamp Name** (as Freedcamp shows it,
   e.g. `Jondie Mar G.`). If RDC tickets should continue the team's shared numbering, put the next number in
   **Dev Tickets!G2** and `N | ` in **A2** before logging the first ticket.
4. **Freedcamp** (optional, recommended): **each dev** connects their own key once, with
   *RDC QA > Connect Freedcamp…* (Dev name, API key, API secret). Steps, and where the key is in Freedcamp:
   [WORKFLOW.md > Connecting: once per dev](WORKFLOW.md#connecting-once-per-dev). Keys stay private to each
   person; a dev's tickets then create tasks "Created by" that dev.
5. **Automated checker** (optional):
   - *RDC QA > Create checker token…* and copy the token it shows.
   - Apps Script: **Deploy > New deployment** > **Web app**, *Execute as* **Me**, *Who has access* **Anyone**
     > **Deploy**, copy the URL ending in `/exec`. ("Anyone" only means no Google sign-in is needed; every
     request still needs the token.) After later script changes: *Deploy > Manage deployments > Edit >
     Version: New version* (the URL stays the same).

## Connect the checker

In the checker UI **Settings** tab (or `.env`):

| Setting | Value |
|---|---|
| `SHEET_URL` | the spreadsheet's link |
| `SHEET_WEBAPP_URL` | the Web app URL from step 5 |
| `SHEET_TOKEN` | the token from *Create checker token* |
| `CHECKER_NAME` | `RDC QA Bot` |
| `ACCOUNT_ADMIN` | `username:password` of an administrator (an imported WordPress account works) |
| `ACCOUNT_MEMBER` | `username:password` of a member that does **not** have every section |
| `ALLOW_WRITE_TESTS` | `false` until you agree to let tests add + delete `QA-AUTO` records |

Then **Sheet > Sync tests to the sheet** (the automated cases appear on **Test Cases** with Source *Auto*)
and **Run tests**. Accounts still on a default password (1234 / 12345) must sign in once by hand and change it.

## Columns

**Dev Tickets** (header row 3; A2 = next ticket, G2 = counter). People fill: Ticket, Dev, Status
(In Dev / Ready for QA / Reworked / Closed), Description, Freedcamp ☐, Fix ☐, Reworked By, Notes.
Automatic (grey headers): Branch, Fix Tickets, Type, Page, Test Cases, QA Result, Last Tested, Ready At, and the
statuses Failed / Fixing / Ready for Re-test / Passed. Time and Date are stamped when the ticket is logged.

**Test Cases** (header row 1). People fill (gold headers): Dev Ticket, Reference (original), Case Status,
Reworked By, Result, Remarks; for manual cases also Test, Module, Steps, Expected, Notes. The checker's
*Sync* owns Module / Test / Kind / Steps / Expected of Auto cases. Automatic (grey): Last Checked, Tested By,
Screenshot, Dev Ticket Title, Implemented on Vercel.

## Giving a teammate access

Share the spreadsheet with them. For the checker: they clone the repo, double-click `RDC Checker.bat`, and
paste the `.env` you send privately (Settings tab > Copy / paste > *Save pasted text*).
