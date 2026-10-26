# RDC dev + QA workflow

Everything lives in the **RDC8 IMS - QA & Dev Tickets** spreadsheet. Its tabs, in order:

| Tab | For | What you do there |
|---|---|---|
| **Dashboard** | everyone | Read only: tickets by status, test results, tickets by dev, results by module |
| **Dev Tickets** | devs | Log tickets, set *Ready for QA*, tick *Fix* / *Freedcamp* |
| **Test Cases** | QA | Write cases, pick a *Result* per case |
| **QA Dashboard** | QA | Read only: what to test or re-test next |
| **Dev Dashboard** | devs | Pick yourself in B4: your failed tickets, work in progress, and the feature trail of any page |
| **Check Log** | everyone | Read only: every result ever recorded (manual and automated) |
| **Settings** | owner | Dev list + Freedcamp names, dropdown lists, settings |

## The flow, and every click it takes

### Dev: a new task

| Step | Clicks |
|---|---|
| 1. Assigned a task. Log it: on **Dev Tickets**, select **A2** and press **Delete** | 1 key |
| 2. A row appears (`12 | `, time, date, status *In Dev*). Type the title after the `|`: `FEAT: Settings - Fund Sources - Create Page`; pick your name in **Dev** | typing + 1 pick |
| 3. Optional: a **Description**; then tick **Freedcamp** — the task is created for you (see below) | 1 click |
| 4. Done coding: set **Status** to **Ready for QA** | 1 pick |

**Type** and **Page** fill themselves from the title (`FEAT`, `Settings - Fund Sources`).
**Branch** (column B, right next to the ticket) fills itself with a valid git branch name, `type/number-title` in lower case:
`2 | FEAT: Added specific filters for Public View/Landing Page` → `feat/2-added-specific-filters-for-public-view-landing-page`.
Copy it and start the branch with `git switch -c <branch>`. It is also in the Freedcamp task's description, and
`=BRANCH_NAME(A4)` gives the same name for any ticket text anywhere in the sheet.

### QA: test cases

| Step | Clicks |
|---|---|
| 1. New manual case: on **Test Cases**, type the test in **Test** on an empty row — it gets an ID (`MAN-001`), Source *Manual*, Case Status *Active* | typing |
| 2. Type the ticket number in **Dev Ticket** (`12`, or `12, 15` if it covers two) | typing |
| 3. Test, then pick **Result**: Pass / Fail / Blocked / Not Implemented (write **Notes** first when it fails) | 1 pick |

Picking a Result fills **Last Checked** and **Tested By**, writes a **Check Log** row, and updates the ticket:

- all active cases **Pass** → ticket **Passed**
- any case **Fail** → ticket **Failed** (it shows on the Dev Dashboard with what failed)

Automated cases (from the checker, Source *Auto*) do the same when the checker runs with `--push`.

### Dev: a failed ticket

| Step | Clicks |
|---|---|
| 1. On **Dev Tickets**, tick **Fix** on the failed ticket | 1 click |
| 2. A fix ticket is made at the bottom (`15 | BUG: Settings - Fund Sources - Fix for #12`, Fix Of `12`, same dev). The failed ticket becomes **Fixing** and lists `#15` in **Fix Tickets**. Edit the title if you like, tick **Freedcamp** | 1 click |
| 3. Fixed: set the **fix ticket's** Status to **Ready for QA** → the failed ticket becomes **Ready for Re-test** on the QA Dashboard | 1 pick |

QA re-tests the **original** ticket's cases. Pass → original and fix ticket both **Passed**.
Still failing → the original goes back to **Failed** and that fix ticket is marked **Failed**; tick **Fix** again for a new one.

## Ticket statuses

| Status | Set by | Meaning |
|---|---|---|
| In Dev | new ticket | Being built |
| Ready for QA | dev | Built, waiting for QA |
| Failed | automatic | An active case failed; needs a fix ticket |
| Fixing | automatic | Its latest fix ticket is In Dev |
| Ready for Re-test | automatic | Its latest fix ticket is Ready for QA |
| Passed | automatic | Every active case passes |
| Reworked | person | A later ticket changed this feature: put that ticket in **Reworked By** |
| Closed | person | The page/item was discontinued |

Reworked and Closed are never changed by the automation.

## Closing and reworking (tickets and cases are independent)

- A **ticket** can be *Reworked* (Reworked By = the new ticket) while its **test cases stay Active**:
  the logic changed but the same checks still apply.
- A **test case** can be *Reworked* (Reworked By = the ticket that changed what it should expect) or
  *Closed* (page discontinued) while the ticket stays as it is. Retired cases are greyed out, are no longer
  counted, and the automated checker neither runs nor updates them.
- Write the replacement case as a new row linked to the reworking ticket.

## Dashboards

- **QA Dashboard**: *Ready for Re-test* (dev fixed it), *Ready for QA* (oldest first), tickets with **no
  test case yet**, and active cases never run.
- **Dev Dashboard**: pick yourself in **B4** (or All). *Failed — make a fix ticket* with what failed, work in
  progress, and the **Feature trail**: pick a page in **B27** to see every ticket that touched it, oldest first,
  with its status, fixes and reworks.
- **Dashboard**: totals for everyone.

## Freedcamp: what is automated

The team recipe (assigned to yourself, status In Progress, start and due date today, priority High,
follower Meldz A.) is fully scripted. Ticking **Freedcamp** on a ticket:

1. creates the task in project **RDC8-IMS New** with the ticket title, the Description (plus a line naming the
   sheet ticket), priority High, start and due date today, assigned to the ticket's **Dev** (by the Freedcamp
   name beside it in Settings; if none, to whoever connected Freedcamp),
2. sets it **In Progress**,
3. adds the followers from Settings (**Meldz A.**),
4. turns the cell into a link to the task.

Every 15 minutes, tasks of tickets that became **Passed** or **Closed** are marked **complete** in Freedcamp
(and reopened if the ticket goes back to failing). Turn this off in Settings.

### Connecting: once per dev

Every dev connects **their own** Freedcamp key, so tasks for their tickets are **Created by** them
(Freedcamp sets "Created by" from the key; the API cannot change it).

1. Get edit access to the spreadsheet (the owner shares it with your Google account).
2. In **Freedcamp**: click your avatar (bottom left) > **My Account** > **API** tab. Create a **Secured** key.
   Copy the **API key**; enter your Freedcamp password on that page to see the **API secret** and copy it too.
3. Make sure your name is in the **Dev** list on the **Settings** tab, with your **Freedcamp Name** beside it.
4. In the **spreadsheet**: menu **RDC QA > Connect Freedcamp…**. The first time, Google asks you to authorize
   the script with *your* Google account (*Continue* > your account > *Allow*; "unverified app" > *Advanced* >
   *Go to RDC QA*). Then answer the three boxes: your Dev name, the API key, the API secret.

Your key is stored in **your own** script storage (Apps Script user properties): other people using the sheet
cannot read it, and only your tickets use it. The sheet only records *that* you are connected.
*RDC QA > Disconnect Freedcamp* removes it again. If someone ticks Freedcamp on a ticket whose Dev has not
connected, nothing is sent and the message says who has to connect.

Freedcamp's API has no task "followers" on create, so they are added right after; if Freedcamp ever rejects a
step, the cell stays unticked and a message says why. If a Dev or follower name matches no Freedcamp user,
the task is still created (assigned to the key's owner) and the message names who was not found.

**Fixing an existing task** (e.g. after correcting a ticket's name): fix the ticket in the sheet (name, Description,
Dev, or the **Date** with the date picker), select its row(s) on Dev Tickets, then *RDC QA > Fix Freedcamp task: name,
assignee, followers & dates (selected tickets)*. The task gets the ticket's current name, a description with the
current name and branch, the assignee and followers, and its start and due date set to that Date.

## Recommended upgrades

1. **Ticket number in every commit** (already your habit: `2148 | BUG : ...`). Next step: a GitLab webhook to
   this sheet's web app could set a ticket to *Ready for QA* automatically when a commit with its number lands
   on `staging`, and link the commit. Ask for it when you want it; it needs a webhook added in GitLab.
2. **Run the checker on every Vercel deploy** (`npm run qa -- --push` from a scheduled task or CI) so automated
   cases are re-checked without anyone clicking.
3. **One test case per acceptance point** of the task, written when the ticket is logged (QA Dashboard shows
   tickets that have none), so "Ready for QA" always has something to test.
4. **Keep fixes as new tickets** (as you do): the feature trail then shows the full history of a page.
