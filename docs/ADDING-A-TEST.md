# Adding a new test

A test lives in **two places** that share one **TC ID**:

1. **Code** — `src/tests/<area>.js`: what the checker does.
2. **Sheet** — one row on the **Test Cases** tab of the **RDC8 IMS - QA & Dev Tickets** spreadsheet: the row people read, filter, close, link to a dev ticket and fill references for.

The code is the source of truth for *what* is tested; the sheet is the source of truth for *whether*
it is tested (Case Status) and for the original site's values (Reference).

---

## Step 1. Pick the file and the ID

| File | Area | ID prefix in use |
|---|---|---|
| `src/tests/public.js` | Home page, sign-in dialog | `PUB-` |
| `src/tests/access.js` | Sign-in/out, permissions | `AUTH-`, `ACL-` |
| `src/tests/pages.js` | "Page opens" smoke tests (one line each) | `PAGE-` |
| `src/tests/features.js` | Completed features + calculations | `MON-`, `ACO-`, `SET-`, `USR-`, `CLR-`, `RES-`, `PRJ-`, `CPW-` |
| `src/tests/data.js` | Vercel value vs original value | `DATA-` |
| `src/tests/pending.js` | On the original, not on Vercel yet | `PEND-` |
| `src/tests/parity.js` | Same page on the original and Vercel offers the same columns, filters, buttons, dialogs, menus | `PAR-` |
| `src/tests/freedcamp.js` | The Freedcamp tasks / dev tickets, per role | `FC-` |

**A parity test** is one line: `pair('PAR-015', 'Reports', 'Annex A columns', 'admin', { original: '/rdc_dashboard/x.php',
vercel: '/reports/x', columns: true, filters: true })`. Other checks: `buttons: true` (or a list of button names),
`dialog: { button: 'Vercel button', title: 'Original modal title' }`, `menu: true`, and `alias: { 'Original wording':
'Vercel wording' }` when a label was renamed on purpose. It gets `original: true`, so the runner signs the same role in
to the original site (`ORIGINAL_ACCOUNT_<ROLE>`, else `ACCOUNT_<ROLE>`). Roles are listed in `ROLES` in
`src/catalog.js`; each needs `ACCOUNT_<ROLE>` in `.env`.

Use the next free number of the prefix (`npm run qa:list` shows all IDs). A new area can get its own
file, e.g. `src/tests/reports.js` with prefix `RPT-`: every `.js` file in `src/tests/` is loaded
automatically (files starting with `_` are helpers, not tests). **Never reuse or renumber an ID**:
the sheet's history is keyed on it. The checker refuses to start if two tests share an ID.

## Step 2. Write the test

Add an object to the file's `export default [ ... ]` list:

```js
{
  id: 'RPT-001',                       // unique, never reused
  module: 'Reports',                   // groups rows in the sheet and the Dashboard
  kind: 'Functional',                  // Functional | Logic | Data | Access | Pending
  role: 'admin',                       // public (no sign-in) | admin | member
  title: 'Annex A: filtering by agency narrows the list',
  steps: 'Open /reports?annex=a, pick an agency, click Filter.',     // shown in the sheet
  expected: 'Only that agency\'s PPAs remain.',                      // shown in the sheet
  // optional:
  // pending: true,     on the original but not on Vercel yet -> "Not Implemented" while it says coming soon / 404
  // writes: true,      adds/edits records; only runs with ALLOW_WRITE_TESTS=true; must clean up after itself
  // reference: '6',    starting value for "Reference (original)" (Sync writes it only into an EMPTY cell)
  // last: true,        run after the other tests of its account (e.g. log out)
  async run(t) {
    await t.open('/reports?annex=a');                 // fails (or Not Implemented if pending) if it does not load
    await t.page.getByRole('button', { name: 'Filter' }).click();
    await t.see('Annex A');                           // fails if the text is not on the page
    const rows = await t.page.locator('table tbody tr').count();
    t.check(rows > 0, 'No rows after filtering');     // fails with this message if false
    return t.pass(`${rows} rows`);                    // notes written to the sheet
  },
},
```

### The `t` helpers

| Helper | Does |
|---|---|
| `await t.open(path)` | Opens a path on Vercel and requires it to load. A redirect / sign-in page / error = **Fail**; "coming soon" or 404 on a `pending` test = **Not Implemented**. `t.open(path, { expect: 'any' })` accepts anything and returns `{ state, detail }`. |
| `await t.see(text \| /regex/)` | Waits up to 8 s for the text; **Fail** if absent. `{ within: 'header' }` limits where to look. |
| `await t.has(text)` | Same, but returns true/false. |
| `t.check(condition, message)` | **Fail** with `message` when the condition is false. |
| `return t.pass(notes)` | **Pass**. Every test must end with this (or one of the three below). |
| `t.fail(notes)` / `t.blocked(notes)` / `t.notImplemented(notes)` | End the test now with that result. |
| `t.reference` | The sheet's **Reference (original)** cell for this test. |
| `return t.compareWithReference(label, vercelValue)` | Data tests: Blocked if no reference yet (notes show the Vercel value), Pass if equal (numbers compare as numbers, commas/₱ ignored), else Fail with both values. |
| `t.page` | The Playwright page, for anything else (`t.page.getByRole(...)`, `.locator(...)`, `.fill(...)`). |
| `t.app.readTable(locator)` | A table as text: `{ head, rows, foot }`. |
| `t.app.num('₱ 1,234.50')` | `1234.5` (null for "Pending" / "—"). |
| `t.app.showingEntries(page)` | `{ from, to, of }` from "Showing X to Y of N entries". |
| `t.app.toastText(page)` | The text of the pop-up message (toast) that appears next. |
| `t.config.allowWrite` | Whether write tests are allowed. |

Shared helpers for test files are in `src/tests/_helpers.js` (`heading`, `countEntries`, `firstTable`, `col`, `qaName`).
If the app's sign-in, menu or "coming soon" text changes, fix it once in `src/app.js`, not in every test.

### Patterns

**A new page that only needs to open** — one line in `src/tests/pages.js`:

```js
['PAGE-039', 'Reports', '/reports?annex=b', 'Annex A & B'],
```

**A data difference** (Vercel vs original) — in `src/tests/data.js`, add a line to `COUNTS`:

```js
['DATA-024', 'Number of fund sources', '/settings/fund-sources', 'Settings > Fund Sources: total entries'],
```

**A logic check** — read the numbers on screen, recompute, compare:

```js
const { head, rows, foot } = await firstTable(t);
const i = col(head, 'Cost');
const sum = rows.reduce((s, r) => s + (t.app.num(r[i]) ?? 0), 0);
t.check(Math.abs(sum - t.app.num(foot[0][i])) < 0.01, `Rows add up to ${sum}, total shows ${foot[0][i]}`);
```

**A feature the original has but Vercel doesn't yet** — mark it `pending: true` and write the check
as if the page existed. While Vercel says "coming soon" it reports **Not Implemented**; once built, it reports Pass/Fail.
For a missing button inside an existing page, end early yourself:

```js
if (!(await t.page.getByRole('button', { name: 'Export' }).count())) t.notImplemented('No Export button yet');
```

## Step 3. Try it

```bash
npm run qa -- --only RPT-001 --headed
```

`--headed` shows the browser so you can watch it. Results print in the terminal and go to
`results/run-.../results.csv` (no `--push`, so nothing is written to the sheet yet).

## Step 4. Put it in the sheet

**Option A — automatic (recommended):** UI **Sheet > Sync tests to the sheet**, or:

```bash
npm run sync-sheet
```

New IDs are added at the bottom of **Test Cases** with Source **Auto** and Case Status **Active**. For existing active rows,
Module / Test / Kind / Steps / Expected are refreshed from the code. Case Status, Dev Ticket, Result,
Reference (original) and Remarks are never touched, and **Closed / Reworked cases are never changed**.
Use `npm run sync-sheet -- --add-only` to add new rows without refreshing existing ones.

**Option B — by hand:** add a row on **Test Cases** with the same **TC ID** as the code, fill Module, Test,
Kind, Steps to Test, Expected Result, set **Source = Auto** and **Case Status = Active**. (The next Sync overwrites the
descriptive columns with the code's text, so keep them the same.)

A test that is in the code but **not** in the sheet still runs, but its result is **not** written
to the sheet (the log says `Not in the sheet yet`).

## Step 5. Link it to its dev ticket

If the test checks work from a ticket on the **Dev Tickets** tab, type the ticket number in the
row's **Dev Ticket** cell (several: `12, 15`). The link lives only in the sheet, not in the code,
so QA can change it without a commit. **Dev Ticket Title** and the ticket's QA columns on **Dev Tickets** update
on the next run, or right away with *RDC QA > Refresh dev ticket QA status*.

## Step 6. Run it for real and commit

```bash
npm run qa -- --only RPT-001 --push
```

Or, once linked, everything for that ticket:

```bash
npm run qa -- --ticket 12 --push
```

Commit the test file.

---

## Retiring a test

Do **not** delete the code or the row. Set **Case Status = Closed** (or **Reworked** with the ticket in Reworked By) in the sheet: the checker skips it,
the sheet refuses results for it, and its history stays. If you also delete it from the code later,
leave the sheet row as Closed.

## Writing safe write-tests

- Mark `writes: true`; start with `if (!t.config.allowWrite) t.blocked(...)` (see `addAndDelete` in `features.js`).
- Name everything with `qaName('Label')` -> `QA-AUTO Label 202610211530` so leftovers are easy to find.
- Delete what you created in the same test, and check it is gone.
- Never touch real records, never submit the change-password form, never write on the original site.
