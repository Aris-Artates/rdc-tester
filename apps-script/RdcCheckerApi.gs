/**
 * RDC8 IMS - QA & Dev Tickets spreadsheet script (project "RDC QA").
 *
 * Paste this whole file over Code.gs (Extensions > Apps Script), save, pick rqaSetupSheet and Run once.
 * See docs/SHEET-SETUP.md and docs/WORKFLOW.md in the rdc-tester repo.
 *
 * Tabs: Dashboard | Dev Tickets | Parent Tasks | Test Cases | QA Dashboard | Dev Dashboard | Check Log | Settings
 *
 * The flow it supports:
 *   Dev:  clear Dev Tickets!A2 -> new ticket (In Dev) -> type the title -> tick Freedcamp -> set Ready for QA.
 *   QA:   add test cases (Test Cases tab, Dev Ticket = ticket number) -> pick a Result per case.
 *         Any Fail -> ticket Failed. Dev ticks "Fix" on it -> a fix ticket is made -> ticket shows Fixing.
 *         Fix ticket set to Ready for QA -> ticket shows Ready for Re-test on the QA Dashboard.
 *         All active cases Pass -> ticket Passed (and its fix tickets too).
 *   Tickets and test cases can each be Reworked (with the ticket that reworked them) or Closed, independently.
 *
 * Web app for the automated checker (Deploy > Web app, Execute as: Me, Who has access: Anyone),
 * every request carries the token in Script Property QA_TOKEN (menu: RDC QA > Create checker token):
 *   GET  ?token=..&action=tests -> { rows: [ { id, module, title, kind, reference, caseStatus, devTicket, latest, checkedAt } ] }
 *   POST { token, action: 'results', rows: [ { tcId, checker, env, result, notes, screenshot, checkedAt? } ] }
 *        checkedAt (ISO) is when an earlier run checked it (npm run push-results); a result older than the
 *        test's Last Checked only goes to the Check Log.
 *   POST { token, action: 'sync', tests: [ { id, module, title, kind, steps, expected, reference, pending } ], update }
 *
 * Freedcamp (menu: RDC QA > Connect Freedcamp): ticking a ticket's Freedcamp box creates the task with
 * the team's fixed settings. Parent Task (a Freedcamp task link) makes it a subtask of that task; a fix ticket
 * gets its main ticket's task there automatically. Two buttons on Dev Tickets (and the menu) copy one way, for the
 * selected tickets or all, after showing every change: "Sheet -> Freedcamp" (name, description, assignee, dates,
 * parent, status) and "Freedcamp -> Sheet" (the same back). Every 15 minutes only statuses sync: Passed / Closed
 * tickets complete their task; a task completed in Freedcamp moves a No Progress or In Dev ticket to Ready for QA
 * and a Fixing or Reworked ticket to Ready for Re-test; other statuses stay as they are.
 *
 * Subtasks: the Parent Tasks tab lists the project's tasks that are not tickets (type a title there to create one).
 * Parent Task on Dev Tickets is a dropdown of those and of every ticket with a task. "New Subtasks" (on both tabs):
 * one line per subtask; each becomes a ticket under that parent and its Freedcamp subtask is created.
 */

var RQA_DASH = 'Dashboard', RQA_TICKETS = 'Dev Tickets', RQA_CASES = 'Test Cases', RQA_QA = 'QA Dashboard',
  RQA_DEV = 'Dev Dashboard', RQA_LOG = 'Check Log', RQA_SETTINGS = 'Settings', RQA_PARENTS = 'Parent Tasks';
var RQA_ORDER = [RQA_DASH, RQA_TICKETS, RQA_PARENTS, RQA_CASES, RQA_QA, RQA_DEV, RQA_LOG, RQA_SETTINGS];
var RQA_NAVY = '#1f2a44', RQA_GOLD = '#8a6d1d', RQA_GREY = '#5f6b7a';
var RQA_TZ = 'Asia/Manila';

// ---- Dev Tickets: A2 = "<next> | " (clear it to log a ticket), headers row 3, tickets from row 4.
// The counter is the cell right of "DO NOT TOUCH -->" in row 2 (G2 on a new sheet); it is found by that label
// so it keeps working when columns are inserted before it.
var RQA_T = { first: 4, head: 3, counter: 'A2', brain: 'G2', brainLabel: 'DO NOT TOUCH -->' };
var RQA_TK = {
  ticket: 'Ticket', time: 'Time', date: 'Date', dev: 'Dev', status: 'Status', desc: 'Description', fc: 'Freedcamp',
  branch: 'Branch', fix: 'Fix', fixOf: 'Fix Of', reworkedBy: 'Reworked By', fixes: 'Fix Tickets', type: 'Type', page: 'Page',
  cases: 'Test Cases', qa: 'QA Result', lastTested: 'Last Tested', readyAt: 'Ready At', notes: 'Notes', parent: 'Parent Task',
  newSubs: 'New Subtasks',
};
var RQA_TK_ORDER = ['ticket', 'branch', 'time', 'date', 'dev', 'status', 'desc', 'fc', 'fix', 'fixOf', 'reworkedBy', 'fixes', 'type', 'page',
  'cases', 'qa', 'lastTested', 'readyAt', 'notes', 'parent', 'newSubs'];

// ---- Parent Tasks: header row 1. Pick list (hidden) feeds the Parent Task dropdown on Dev Tickets.
var RQA_PT = { task: 'Task', title: 'Title', assignee: 'Assignee', status: 'Status', subs: 'Subtasks', newSubs: 'New Subtasks', dev: 'Dev', pick: 'Pick list' };
var RQA_PT_ORDER = ['task', 'title', 'assignee', 'status', 'subs', 'newSubs', 'dev', 'pick'];
var RQA_TK_AUTO = ['branch', 'fixes', 'type', 'page', 'cases', 'qa', 'lastTested', 'readyAt'];

// ---- Test Cases: header row 1.
var RQA_TC = {
  id: 'TC ID', devTicket: 'Dev Ticket', module: 'Module', title: 'Test', kind: 'Kind', source: 'Source',
  steps: 'Steps to Test', expected: 'Expected Result', reference: 'Reference (original)', caseStatus: 'Case Status',
  reworkedBy: 'Reworked By', result: 'Result', checkedAt: 'Last Checked', testedBy: 'Tested By', notes: 'Notes',
  shot: 'Screenshot', devTitle: 'Dev Ticket Title', implemented: 'Implemented on Vercel', remarks: 'Remarks',
};
var RQA_TC_ORDER = ['id', 'devTicket', 'module', 'title', 'kind', 'source', 'steps', 'expected', 'reference', 'caseStatus',
  'reworkedBy', 'result', 'checkedAt', 'testedBy', 'notes', 'shot', 'devTitle', 'implemented', 'remarks'];
var RQA_LOG_HEADERS = ['TC ID', 'Dev Ticket', 'Tested By', 'Checked At', 'Environment', 'Result', 'Notes', 'Screenshot'];

var RQA_S = { noProgress: 'No Progress', inDev: 'In Dev', ready: 'Ready for QA', passed: 'Passed', failed: 'Failed', fixing: 'Fixing',
  retest: 'Ready for Re-test', reworked: 'Reworked', closed: 'Closed' };
var RQA_LISTS = {
  'Case Status': ['Active', 'Reworked', 'Closed'],
  'Ticket Status': [RQA_S.noProgress, RQA_S.inDev, RQA_S.ready, RQA_S.failed, RQA_S.fixing, RQA_S.retest, RQA_S.passed, RQA_S.reworked, RQA_S.closed],
  'Result': ['Pass', 'Fail', 'Blocked', 'Not Implemented'],
  'Kind': ['Functional', 'Logic', 'Data', 'Access', 'Pending', 'Manual'],
  'Dev': ['Aris', 'Jondie', 'Shean', 'Kenneth', 'Kurt'],
  'Freedcamp Name': ['Aris A.', 'Jondie Mar G.', 'Shean T.', 'Kenneth V.', ''],
};
var RQA_LIST_KEYS = Object.keys(RQA_LISTS);
var RQA_SET_COL = RQA_LIST_KEYS.length + 2; // settings live two columns right of the lists
var RQA_DEFAULT_SETTINGS = [
  ['Setting', 'Value'],
  ['App under test (Vercel)', 'https://rdc8ims.vercel.app'],
  ['Original site (reference only)', 'https://evims.rdc8ims.online'],
  ['First ticket number', '1'],
  ['Fix ticket type', 'BUG'],
  ['Screenshot folder (Drive)', 'RDC QA Screenshots'],
  ['Freedcamp project ID', '3783356'],
  ['Freedcamp followers', 'Meldz A.'],
  ['Freedcamp priority (0-3)', '3'],
  ['Freedcamp: complete task when ticket Passed/Closed', 'Yes'],
];
var RQA_STATUS_COLOURS = {
  'No Progress': '#f1f3f4', 'In Dev': '#e8eefc', 'Ready for QA': '#fff3cd', 'Failed': '#f8d7da', 'Fixing': '#fde2c8', 'Ready for Re-test': '#ffe08a',
  'Passed': '#d4edda', 'Reworked': '#e6dcf5', 'Closed': '#e0e0e0',
};
var RQA_RESULT_COLOURS = { 'Pass': '#d4edda', 'Fail': '#f8d7da', 'Blocked': '#fff3cd', 'Not Implemented': '#d6d8f5' };

// ================================================================ menu + simple onEdit

function onOpen() {
  SpreadsheetApp.getUi().createMenu('RDC QA')
    .addItem('Set up / repair spreadsheet', 'rqaSetupSheet')
    .addItem('Refresh statuses', 'rqaRefresh')
    .addItem('Sync test cases from rdc-tester', 'rqaSyncTestsFromRepo')
    .addItem('Import parity tickets from rdc-tester', 'rqaImportTicketsFromRepo')
    .addSeparator()
    .addItem('Sheet \u2192 Freedcamp (selected or all tickets)', 'rqaFcPushClick')
    .addItem('Freedcamp \u2192 Sheet (selected or all tickets)', 'rqaFcPullClick')
    .addItem('Refresh Parent Tasks list', 'rqaRefreshParentTasks')
    .addItem('Connect Freedcamp…', 'rqaConnectFreedcamp')
    .addItem('Disconnect Freedcamp', 'rqaDisconnectFreedcamp')
    .addItem('Create checker token…', 'rqaCreateToken')
    .addToUi();
}

/** Sheet-only automation (no outside calls, so it works for every editor). Freedcamp runs in rqaOnEditFreedcamp. */
function onEdit(e) {
  if (!e || !e.range) return;
  var sh = e.range.getSheet(), name = sh.getName();
  if (name === RQA_TICKETS) return rqaTicketEdit_(e, sh);
  if (name === RQA_CASES) return rqaCaseEdit_(e, sh);
}

function rqaTicketEdit_(e, sh) {
  var r = e.range.getRow(), c = e.range.getColumn();
  if (e.range.getA1Notation() === RQA_T.counter) {
    var v = e.range.getValue();
    if (!v || String(v).trim() === '') rqaNewTicket_(sh, null);
    return;
  }
  if (r < RQA_T.first || e.range.getNumRows() > 1) return;
  var h = rqaHeaders_(sh, RQA_T.head);
  if (c === h[RQA_TK.fix] + 1 && e.value === 'TRUE') {
    sh.getRange(r, c).setValue(false);
    var parent = rqaParseTicket_(sh.getRange(r, h[RQA_TK.ticket] + 1).getDisplayValue());
    if (!parent) return SpreadsheetApp.getActive().toast('Type the ticket title first.', 'Fix ticket', 5);
    // The fix ticket's task becomes a subtask of the main ticket's task (its Freedcamp link, when it has one).
    var mainLink = sh.getRange(r, h[RQA_TK.fc] + 1).getRichTextValue(), mainUrl = mainLink && mainLink.getLinkUrl();
    var num = rqaNewTicket_(sh, { fixOf: parent.num, dev: sh.getRange(r, h[RQA_TK.dev] + 1).getValue(), parentUrl: mainUrl || '',
      title: rqaSetting_('Fix ticket type') + ': ' + (rqaPageOf_(parent.title) || parent.title) + ' - Fix for #' + parent.num });
    SpreadsheetApp.getActive().toast('Fix ticket #' + num + ' created at the bottom. Edit its title if needed.', 'Fix ticket', 6);
    return rqaRefresh();
  }
  if (h[RQA_TK.parent] != null && c === h[RQA_TK.parent] + 1) {
    var pid = rqaFcTaskId_(e.range.getDisplayValue());
    if (pid) e.range.setRichTextValue(rqaParentRich_(pid));
    return;
  }
  if (c === h[RQA_TK.status] + 1) {
    if (e.value === RQA_S.ready) sh.getRange(r, h[RQA_TK.readyAt] + 1).setValue(new Date());
    return rqaRefresh();
  }
  if (c === h[RQA_TK.ticket] + 1 || c === h[RQA_TK.fixOf] + 1) return rqaRefresh();
  if (c === h[RQA_TK.fc] + 1 && e.value === 'TRUE') {
    var dev = String(sh.getRange(r, h[RQA_TK.dev] + 1).getValue() || '');
    if (!rqaFreedcampReady_(dev)) {
      sh.getRange(r, c).setValue(false);
      SpreadsheetApp.getActive().toast(dev ? dev + ' has not connected Freedcamp yet: ' + dev + ' runs RDC QA > Connect Freedcamp once.'
        : 'Pick the Dev first, then tick Freedcamp.', 'Freedcamp', 8);
    }
  }
}

function rqaCaseEdit_(e, sh) {
  var r = e.range.getRow(), c = e.range.getColumn();
  if (r < 2 || e.range.getNumRows() > 1) return;
  var h = rqaHeaders_(sh, 1);
  var cell = function (k) { return sh.getRange(r, h[RQA_TC[k]] + 1); };
  // A new manual test case: typing its Test gives it an ID, Source and status.
  if (c === h[RQA_TC.title] + 1 && e.value && !cell('id').getValue()) {
    cell('id').setValue(rqaNextManualId_(sh, h));
    cell('source').setValue('Manual'); cell('kind').setValue('Manual'); cell('caseStatus').setValue('Active');
  }
  // Picking a Result is the whole manual test: time, tester and log entry are filled in.
  if (c === h[RQA_TC.result] + 1 && e.value) {
    var now = new Date(), who = rqaWho_();
    cell('checkedAt').setValue(now); cell('testedBy').setValue(who);
    if (e.value !== 'Blocked') cell('implemented').setValue(e.value === 'Not Implemented' ? 'No' : 'Yes');
    rqaAppendLog_([{ id: cell('id').getValue(), ticket: cell('devTicket').getValue(), who: who, at: now, env: 'Manual', result: e.value, notes: cell('notes').getValue(), link: '' }]);
  }
  if ([RQA_TC.result, RQA_TC.devTicket, RQA_TC.caseStatus].some(function (k) { return c === h[k] + 1; })) rqaRefresh();
}

/** Adds the next ticket row. Returns its number. */
function rqaNewTicket_(sh, opts) {
  var lock = opts && opts.noLock ? null : LockService.getDocumentLock();
  if (lock) lock.waitLock(10000);
  try {
    var brain = rqaBrain_(sh), num = Number(brain.getValue());
    if (!num) return 0;
    var h = rqaHeaders_(sh, RQA_T.head);
    var row = Math.max(rqaLastTicketRow_(sh, h) + 1, RQA_T.first);
    var now = new Date();
    var set = function (k, v) { sh.getRange(row, h[RQA_TK[k]] + 1).setValue(v); };
    set('ticket', num + ' | ' + (opts && opts.title ? opts.title : ''));
    set('time', Utilities.formatDate(now, RQA_TZ, 'hh:mm a'));
    set('date', new Date(Utilities.formatDate(now, RQA_TZ, 'yyyy/MM/dd')));
    set('status', opts && opts.status ? opts.status : RQA_S.inDev);
    if (opts && opts.desc) set('desc', opts.desc);
    if (opts && opts.dev) set('dev', opts.dev);
    if (opts && opts.fixOf) set('fixOf', Number(opts.fixOf));
    if (opts && opts.parentUrl && h[RQA_TK.parent] != null) {
      sh.getRange(row, h[RQA_TK.parent] + 1).setRichTextValue(rqaParentRich_(rqaFcTaskId_(opts.parentUrl)));
    }
    brain.setValue(num + 1);
    sh.getRange(RQA_T.counter).setValue((num + 1) + ' | ');
    return num;
  } finally {
    if (lock) lock.releaseLock();
  }
}

/** The ticket counter: the cell right of the "DO NOT TOUCH -->" label in row 2 (G2 if the label is gone). */
function rqaBrain_(sh) {
  var row = sh.getRange(2, 1, 1, Math.max(sh.getLastColumn(), 8)).getValues()[0];
  for (var i = 0; i < row.length; i++) if (String(row[i]).trim() === RQA_T.brainLabel) return sh.getRange(2, i + 2);
  return sh.getRange(RQA_T.brain);
}

function rqaLastTicketRow_(sh, h) {
  var last = sh.getLastRow();
  if (last < RQA_T.first) return RQA_T.first - 1;
  var vals = sh.getRange(RQA_T.first, h[RQA_TK.ticket] + 1, last - RQA_T.first + 1, 1).getValues();
  for (var i = vals.length - 1; i >= 0; i--) if (String(vals[i][0]).trim() !== '') return RQA_T.first + i;
  return RQA_T.first - 1;
}

function rqaNextManualId_(sh, h) {
  var ids = sh.getLastRow() > 1 ? sh.getRange(2, h[RQA_TC.id] + 1, sh.getLastRow() - 1, 1).getValues() : [];
  var max = 0;
  ids.forEach(function (r) { var m = String(r[0]).match(/^MAN-(\d+)$/); if (m) max = Math.max(max, Number(m[1])); });
  return 'MAN-' + ('00' + (max + 1)).slice(-3);
}

function rqaWho_() {
  var email = '';
  try { email = Session.getActiveUser().getEmail(); } catch (_) {}
  return email ? email.split('@')[0] : 'Manual';
}

// ================================================================ the status engine

/** "12 | FEAT: Settings - Fund Sources - Create Page" -> { num: '12', type: 'FEAT', title: 'Settings - Fund Sources - Create Page' } */
function rqaParseTicket_(text) {
  var m = String(text || '').match(/^\s*(\d+)\s*\|\s*(?:([A-Za-z/ ]+?)\s*:\s*)?(.*)$/);
  if (!m || !m[3].trim()) return null;
  return { num: m[1], type: (m[2] || '').trim().toUpperCase(), title: m[3].trim() };
}
/** "Settings - Fund Sources - Create Page" -> "Settings - Fund Sources" (everything before the last " - "). */
function rqaPageOf_(title) {
  var parts = String(title || '').split(/\s+-\s+/);
  return parts.length > 1 ? parts.slice(0, -1).join(' - ') : '';
}
/**
 * A valid git branch name for a ticket: "<type>/<number>-<title>", lower case, words joined by "-".
 *   2, "FEAT", "Added specific filters for Public View/Landing Page"
 *   -> "feat/2-added-specific-filters-for-public-view-landing-page"
 * Combined types ("PERF/UI") become "perf-ui"; no type gives "task". Accents are dropped, anything git does not
 * allow (spaces, ~ ^ : ? * [ \, "..", "@{", a trailing "." or ".lock") cannot survive, and the title part is cut
 * at a word boundary to keep the name at most 70 characters.
 */
function rqaBranchName_(num, type, title) {
  var clean = function (s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  };
  var prefix = (clean(type) || 'task') + '/' + String(num).replace(/\D/g, '');
  var slug = clean(title), max = 70 - prefix.length - 1;
  if (slug.length > max) slug = slug.slice(0, max).replace(/-[^-]*$/, '') || slug.slice(0, max);
  return slug ? prefix + '-' + slug : prefix;
}

/**
 * Sheet formula: =BRANCH_NAME(A4) turns a ticket ("2 | FEAT: Added ...") into its git branch name.
 * @param {string} ticket The ticket text, e.g. "2 | FEAT: Added specific filters for Public View/Landing Page".
 * @return The branch name, e.g. "feat/2-added-specific-filters-for-public-view-landing-page".
 * @customfunction
 */
function BRANCH_NAME(ticket) {
  var p = rqaParseTicket_(ticket);
  return p ? rqaBranchName_(p.num, p.type, p.title) : '';
}

function rqaTicketNums_(v) { return String(v || '').split(/[^0-9]+/).filter(String); }
var RQA_RETIRED = /^(closed|reworked|cancel+ed)$/i;

/**
 * Recomputes every automatic cell: each ticket's Type, Page, Test Cases, QA Result, Fix Tickets, Last Tested
 * and Status; each test case's Dev Ticket Title. Reworked and Closed tickets keep their status.
 */
function rqaRefresh() {
  var ss = SpreadsheetApp.getActive();
  var tk = ss.getSheetByName(RQA_TICKETS), cs = ss.getSheetByName(RQA_CASES);
  if (!tk || !cs) return;
  var th = rqaHeaders_(tk, RQA_T.head), ch = rqaHeaders_(cs, 1);
  var lastT = rqaLastTicketRow_(tk, th);
  var tWidth = tk.getLastColumn();
  var tVals = lastT >= RQA_T.first ? tk.getRange(RQA_T.first, 1, lastT - RQA_T.first + 1, tWidth).getValues() : [];
  var tDisp = lastT >= RQA_T.first ? tk.getRange(RQA_T.first, th[RQA_TK.ticket] + 1, lastT - RQA_T.first + 1, 1).getDisplayValues() : [];
  var tg = function (row, k) { return row[th[RQA_TK[k]]]; };

  var tickets = {}, order = [];
  tVals.forEach(function (row, i) {
    var p = rqaParseTicket_(tDisp[i][0]);
    if (!p) return;
    var t = { num: p.num, i: i, type: p.type, title: p.title, page: rqaPageOf_(p.title), status: String(tg(row, 'status') || ''),
      fixOf: String(tg(row, 'fixOf') || '').replace(/\D/g, ''), readyAt: tg(row, 'readyAt') instanceof Date ? tg(row, 'readyAt') : null,
      cases: [], active: [], fixes: [] };
    tickets[p.num] = t; order.push(t);
  });
  order.forEach(function (t) { if (t.fixOf && tickets[t.fixOf]) tickets[t.fixOf].fixes.push(t); });

  // Test cases, and their Dev Ticket Title.
  var lastC = cs.getLastRow();
  var cVals = lastC > 1 ? cs.getRange(2, 1, lastC - 1, cs.getLastColumn()).getValues() : [];
  var cg = function (row, k) { return ch[RQA_TC[k]] == null ? '' : row[ch[RQA_TC[k]]]; };
  var titles = [];
  cVals.forEach(function (row) {
    var id = String(cg(row, 'id')).trim(), nums = rqaTicketNums_(cg(row, 'devTicket'));
    titles.push([nums.map(function (n) { var t = tickets[n]; return t ? n + ' | ' + (t.type ? t.type + ': ' : '') + t.title : n + ' | (not on Dev Tickets)'; }).join('\n')]);
    if (!id) return;
    var c = { id: id, result: String(cg(row, 'result') || ''), at: cg(row, 'checkedAt') instanceof Date ? cg(row, 'checkedAt') : null,
      notes: String(cg(row, 'notes') || ''), retired: RQA_RETIRED.test(String(cg(row, 'caseStatus') || '').trim()) };
    nums.forEach(function (n) { if (tickets[n]) { tickets[n].cases.push(c); if (!c.retired) tickets[n].active.push(c); } });
  });
  if (titles.length && ch[RQA_TC.devTitle] != null) cs.getRange(2, ch[RQA_TC.devTitle] + 1, titles.length, 1).setValues(titles);

  // Status of ordinary tickets first, then of fix tickets (they follow their parent's re-test).
  var lastFail = function (t) { var m = null; t.active.forEach(function (c) { if (c.result === 'Fail' && c.at && (!m || c.at > m)) m = c.at; }); return m; };
  var derive = function (t) {
    if (t.status === RQA_S.reworked || t.status === RQA_S.closed || !t.active.length) return t.status || RQA_S.inDev;
    var fails = t.active.filter(function (c) { return c.result === 'Fail'; });
    if (fails.length) {
      var fix = t.fixes[t.fixes.length - 1], failAt = lastFail(t);
      // Set to Ready for Re-test (by Freedcamp or by hand) after the last fail: wait for QA's next result.
      if (t.status === RQA_S.retest && t.readyAt && (!failAt || t.readyAt > failAt)) return RQA_S.retest;
      if (!fix || fix.status === RQA_S.failed) return RQA_S.failed;
      if ((fix.status === RQA_S.ready || fix.status === RQA_S.passed) && fix.readyAt && (!failAt || fix.readyAt > failAt)) return RQA_S.retest;
      if (fix.status === RQA_S.ready && fix.readyAt && failAt && failAt >= fix.readyAt) { fix.status = RQA_S.failed; return RQA_S.failed; }
      return RQA_S.fixing;
    }
    if (t.active.every(function (c) { return c.result === 'Pass'; })) return RQA_S.passed;
    // Some cases not run yet: anything QA was waiting on goes back to "Ready for QA".
    if ([RQA_S.failed, RQA_S.fixing, RQA_S.retest].indexOf(t.status) >= 0) return RQA_S.ready;
    return t.status || RQA_S.inDev;
  };
  order.forEach(function (t) { if (!t.fixOf || t.active.length) t.newStatus = derive(t); });
  order.forEach(function (t) {
    if (t.newStatus) return;
    var p = tickets[t.fixOf];
    if (t.status === RQA_S.reworked || t.status === RQA_S.closed) t.newStatus = t.status;
    else if (p && p.newStatus === RQA_S.passed && (t.status === RQA_S.ready || t.status === RQA_S.passed)) t.newStatus = RQA_S.passed;
    else t.newStatus = t.status || RQA_S.inDev; // includes Failed set by derive() above
  });

  // Write the automatic columns in one go per column.
  if (order.length) {
    var col = function (k, fn) {
      var vals = tVals.map(function (row) { return [row[th[RQA_TK[k]]]]; });
      order.forEach(function (t) { vals[t.i][0] = fn(t); });
      tk.getRange(RQA_T.first, th[RQA_TK[k]] + 1, vals.length, 1).setValues(vals);
    };
    col('status', function (t) { return t.newStatus; });
    col('type', function (t) { return t.type; });
    col('page', function (t) { return t.page; });
    col('branch', function (t) { return rqaBranchName_(t.num, t.type, t.title); });
    col('fixes', function (t) { return t.fixes.map(function (f) { return '#' + f.num; }).join(', '); });
    col('cases', function (t) { return t.cases.map(function (c) { return c.id + (c.retired ? ' (retired)' : ''); }).join(', '); });
    col('qa', rqaQaText_);
    col('lastTested', function (t) { var m = ''; t.cases.forEach(function (c) { if (c.at && (!m || c.at > m)) m = c.at; }); return m; });
  }
}

/** "2 pass · 1 fail: SET-003 (says Tier type deleted)" */
function rqaQaText_(t) {
  if (!t.cases.length) return 'No test case yet';
  if (!t.active.length) return 'All test cases retired';
  var n = { Pass: 0, Fail: 0, Blocked: 0, 'Not Implemented': 0, '': 0 };
  t.active.forEach(function (c) { n[n.hasOwnProperty(c.result) ? c.result : '']++; });
  var parts = [];
  if (n.Pass) parts.push(n.Pass + ' pass');
  if (n.Fail) parts.push(n.Fail + ' fail');
  if (n.Blocked) parts.push(n.Blocked + ' blocked');
  if (n['Not Implemented']) parts.push(n['Not Implemented'] + ' not on Vercel');
  if (n['']) parts.push(n[''] + ' not run');
  var fails = t.active.filter(function (c) { return c.result === 'Fail'; })
    .map(function (c) { return c.id + (c.notes ? ' (' + c.notes.slice(0, 120) + ')' : ''); });
  return parts.join(' · ') + (fails.length ? ': ' + fails.join('; ') : '');
}

// ================================================================ setup

/** Builds or repairs every tab, header, dropdown, colour and dashboard. Never deletes data. */
function rqaSetupSheet() {
  var ss = SpreadsheetApp.getActive();
  var st = rqaSetupSettings_(ss);
  var tk = rqaSetupTickets_(ss, st);
  var cs = rqaSetupCases_(ss, st);
  rqaSetupLog_(ss);
  var L = rqaLetters_(tk, cs);
  rqaBuildDashboard_(ss, L);
  rqaBuildQaDashboard_(ss, L);
  rqaBuildDevDashboard_(ss, L, st);
  RQA_ORDER.forEach(function (name, i) { ss.setActiveSheet(ss.getSheetByName(name)); ss.moveActiveSheet(i + 1); });
  var tabColours = ['#1f2a44', '#2f6fec', '#6b4fbb', '#1e8e3e', '#b7791f', '#c62828', '#5f6b7a', '#9aa3b2'];
  RQA_ORDER.forEach(function (n, i) { ss.getSheetByName(n).setTabColor(tabColours[i]); });
  var blank = ss.getSheetByName('Sheet1');
  if (blank && blank.getLastRow() === 0 && blank.getLastColumn() === 0) ss.deleteSheet(blank);
  rqaRefresh();
  ss.setActiveSheet(ss.getSheetByName(RQA_DASH));
  ss.toast('All tabs are ready.', 'RDC QA', 5);
}

/** Only Dev Tickets and Parent Tasks: new columns, dropdowns, notes, widths and the buttons. Dashboards untouched. */
function rqaRepairTickets() {
  var ss = SpreadsheetApp.getActive();
  rqaSetupTickets_(ss, ss.getSheetByName(RQA_SETTINGS));
  rqaRefresh();
  var note = '';
  if (rqaFcKeys_()) { try { rqaRefreshParents_(rqaFcProjectTasks_()); } catch (err) { note = ' Parent Tasks list not refreshed: ' + err.message; } }
  ss.toast('Dev Tickets and Parent Tasks repaired.' + note, 'RDC QA', 8);
}

function rqaSetupSettings_(ss) {
  var st = rqaTab_(ss, RQA_SETTINGS);
  if (st.getRange(1, 1).getValue() === '') {
    st.getRange(1, 1, 1, RQA_LIST_KEYS.length).setValues([RQA_LIST_KEYS]);
    RQA_LIST_KEYS.forEach(function (n, i) { st.getRange(2, i + 1, RQA_LISTS[n].length, 1).setValues(RQA_LISTS[n].map(function (v) { return [v]; })); });
  }
  var have = st.getRange(1, RQA_SET_COL, Math.max(st.getLastRow(), 1), 1).getValues().map(function (r) { return r[0]; });
  RQA_DEFAULT_SETTINGS.forEach(function (pair) {
    if (have.indexOf(pair[0]) >= 0) return;
    var r = 1;
    while (have[r - 1] !== undefined && have[r - 1] !== '') r++;
    st.getRange(r, RQA_SET_COL, 1, 2).setValues([pair]);
    have[r - 1] = pair[0];
  });
  rqaHeaderStyle_(st.getRange(1, 1, 1, RQA_LIST_KEYS.length));
  rqaHeaderStyle_(st.getRange(1, RQA_SET_COL, 1, 2));
  st.setColumnWidths(1, RQA_LIST_KEYS.length, 130);
  st.setColumnWidth(RQA_SET_COL, 330); st.setColumnWidth(RQA_SET_COL + 1, 260);
  st.setFrozenRows(1);
  st.getRange(RQA_DEFAULT_SETTINGS.length + 3, RQA_SET_COL, 3, 1).setValues([
    ['Lists in columns A:F feed the dropdowns. Add a dev under "Dev" with their Freedcamp name beside it.'],
    ['Secrets (QA_TOKEN, Freedcamp key) are kept in the script, never here: use the RDC QA menu.'],
    ['Ticket Status values are used by the scripts: rename them only together with the code.'],
  ]).setFontColor(RQA_GREY).setFontStyle('italic');
  return st;
}

function rqaSetupTickets_(ss, st) {
  var sh = rqaTab_(ss, RQA_TICKETS);
  var headers = RQA_TK_ORDER.map(function (k) { return RQA_TK[k]; });
  if (sh.getRange(RQA_T.head, 1).getValue() === '') {
    var start = Number(rqaSetting_('First ticket number')) || 1;
    sh.getRange(1, 1).setValue('CURRENT USABLE TICKET:');
    sh.getRange(RQA_T.counter).setValue(start + ' | ');
    sh.getRange(2, 6).setValue(RQA_T.brainLabel);
    sh.getRange(RQA_T.brain).setValue(start);
    sh.getRange(2, 6, 1, 2).setFontColor(RQA_GREY).setFontStyle('italic'); // only on a new sheet: keep people's own styling
  }
  // Sheets made before the Branch column existed: insert it right next to the ticket (column B).
  // Everything after column A moves one to the right; the counter is found by its label, so it keeps working.
  var h0 = rqaHeaders_(sh, RQA_T.head);
  if (h0[RQA_TK.ticket] != null && h0[RQA_TK.branch] == null) {
    sh.getRange(1, 2, 1, sh.getMaxColumns() - 1).breakApart();
    sh.insertColumnAfter(h0[RQA_TK.ticket] + 1);
    sh.getRange(RQA_T.head, h0[RQA_TK.ticket] + 2).setValue(RQA_TK.branch);
  }
  rqaEnsureHeaders_(sh, headers, RQA_T.head);
  var h = rqaHeaders_(sh, RQA_T.head);
  sh.getRange(1, 1).setFontWeight('bold').setFontColor(RQA_NAVY);
  sh.getRange(RQA_T.counter).setFontWeight('bold').setFontSize(13).setBackground('#fff3cd')
    .setNote('Clear this cell (Delete) to log the next ticket, then type its title after the "|" in the new row.');
  sh.getRange(RQA_T.head, h[RQA_TK.branch] + 1).setNote('Git branch name made from the ticket: type/number-title. Copy it into: git switch -c <branch>');
  sh.getRange(1, 2, 1, sh.getMaxColumns() - 1).breakApart();
  sh.getRange(1, 3, 1, 9).merge().setValue('FORMAT:  12 | FEAT: Main page - Sub-page - Task     ·     Dev: Ready for QA when done     ·     Fix = make a fix ticket     ·     Freedcamp = send the task')
    .setFontColor(RQA_GREY).setFontStyle('italic');
  rqaHeaderStyle_(sh.getRange(RQA_T.head, 1, 1, sh.getLastColumn()));
  RQA_TK_AUTO.forEach(function (k) { sh.getRange(RQA_T.head, h[RQA_TK[k]] + 1).setBackground(RQA_GREY); });
  sh.getRange(RQA_T.head, h[RQA_TK.reworkedBy] + 1).setNote('Ticket number that reworked this feature (with Status = Reworked).');
  sh.getRange(RQA_T.head, h[RQA_TK.fixOf] + 1).setNote('For a fix ticket: the failed ticket it fixes. Filled in by the Fix box.');
  sh.getRange(RQA_T.head, h[RQA_TK.parent] + 1).setNote('Pick the parent (a Parent Tasks task or a ticket) to make this ticket\'s task its subtask; ' +
    'a pasted Freedcamp link or task number works too. Fix tickets get their main ticket\'s task here automatically. Works before or after the task is sent.');
  sh.getRange(RQA_T.head, h[RQA_TK.newSubs] + 1).setNote('Type subtasks of this ticket here, one per line (Alt+Enter between lines), then leave the cell. ' +
    'Each line becomes a new ticket under this one (same type, page and Dev) and its Freedcamp subtask is created. Start a line with BUG: (or another type) to change its type.');
  var ps = rqaSetupParents_(ss, st, sh, h), pick = rqaLetter_(ps.h[RQA_PT.pick] + 1);
  rqaAddSyncButton_(sh, h);
  sh.getRange(RQA_T.head, h[RQA_TK.status] + 1).setNote('Dev sets In Dev / Ready for QA. Failed, Fixing, Ready for Re-test and Passed follow the test cases. Reworked / Closed stay as set.');
  sh.setFrozenRows(RQA_T.head); sh.setFrozenColumns(1);
  var widths = { ticket: 380, time: 70, date: 75, dev: 85, status: 120, desc: 240, fc: 85, branch: 300, fix: 45, fixOf: 60, reworkedBy: 85, fixes: 85,
    type: 70, page: 170, cases: 160, qa: 300, lastTested: 130, readyAt: 130, notes: 220, parent: 260, newSubs: 260 };
  Object.keys(widths).forEach(function (k) { sh.setColumnWidth(h[RQA_TK[k]] + 1, widths[k]); });
  var rows = Math.max(sh.getMaxRows() - RQA_T.first + 1, 1);
  var col = function (k) { return sh.getRange(RQA_T.first, h[RQA_TK[k]] + 1, rows, 1); };
  col('dev').setDataValidation(rqaListRule_(st, 'Dev'));
  col('status').setDataValidation(rqaListRule_(st, 'Ticket Status'));
  // A Freedcamp cell turns into a link once sent, so its checkbox must accept that text.
  col('fc').setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().setAllowInvalid(true).build());
  col('fix').insertCheckboxes();
  col('parent').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInRange(ps.sh.getRange(pick + '2:' + pick), true).setAllowInvalid(true).build());
  col('fixOf').setNumberFormat('0'); col('reworkedBy').setNumberFormat('@');
  col('date').setNumberFormat('mm/dd/yy');
  col('lastTested').setNumberFormat('mmm d, h:mm am/pm'); col('readyAt').setNumberFormat('mmm d, h:mm am/pm');
  ['ticket', 'desc', 'qa', 'cases', 'notes', 'parent', 'newSubs'].forEach(function (k) { col(k).setWrap(true); });
  sh.getRange(RQA_T.first, 1, rows, sh.getLastColumn()).setVerticalAlignment('top');
  var status = col('status'), B = SpreadsheetApp.newConditionalFormatRule;
  sh.setConditionalFormatRules(Object.keys(RQA_STATUS_COLOURS).map(function (s) {
    return B().whenTextEqualTo(s).setBackground(RQA_STATUS_COLOURS[s]).setRanges([status]).build();
  }).concat([
    B().whenFormulaSatisfied('=$' + rqaLetter_(h[RQA_TK.status] + 1) + RQA_T.first + '="' + RQA_S.closed + '"')
      .setFontColor('#888888').setStrikethrough(true).setRanges([col('ticket')]).build(),
  ]));
  return { sh: sh, h: h };
}

function rqaSetupCases_(ss, st) {
  var t = rqaTab_(ss, RQA_CASES);
  // Older layouts called the case status "Ticket Status"; rename it in place.
  var old = rqaHeaders_(t, 1);
  if (old['Ticket Status'] != null && old[RQA_TC.caseStatus] == null) t.getRange(1, old['Ticket Status'] + 1).setValue(RQA_TC.caseStatus);
  rqaEnsureHeaders_(t, RQA_TC_ORDER.map(function (k) { return RQA_TC[k]; }), 1);
  t.setFrozenRows(1); t.setFrozenColumns(2);
  var h = rqaHeaders_(t, 1);
  var rows = Math.max(t.getMaxRows() - 1, 1);
  var col = function (k) { return t.getRange(2, h[RQA_TC[k]] + 1, rows, 1); };
  col('caseStatus').setDataValidation(rqaListRule_(st, 'Case Status'));
  col('kind').setDataValidation(rqaListRule_(st, 'Kind'));
  col('result').setDataValidation(rqaListRule_(st, 'Result'));
  col('devTicket').setNumberFormat('@'); col('reworkedBy').setNumberFormat('@');
  col('checkedAt').setNumberFormat('mmm d, yyyy h:mm am/pm');
  ['title', 'steps', 'expected', 'notes', 'devTitle'].forEach(function (k) { col(k).setWrap(true); });
  t.getRange(2, 1, rows, t.getLastColumn()).setVerticalAlignment('top');
  var widths = { id: 85, devTicket: 75, module: 140, title: 300, kind: 90, source: 70, steps: 280, expected: 280, reference: 130,
    caseStatus: 100, reworkedBy: 85, result: 120, checkedAt: 140, testedBy: 100, notes: 320, shot: 100, devTitle: 260, implemented: 100, remarks: 200 };
  Object.keys(widths).forEach(function (k) { t.setColumnWidth(h[RQA_TC[k]] + 1, widths[k]); });
  rqaHeaderStyle_(t.getRange(1, 1, 1, t.getLastColumn()));
  t.setRowHeight(1, 40);
  ['devTicket', 'reference', 'caseStatus', 'reworkedBy', 'result', 'remarks'].forEach(function (k) { t.getRange(1, h[RQA_TC[k]] + 1).setBackground(RQA_GOLD); });
  ['checkedAt', 'testedBy', 'shot', 'devTitle', 'implemented'].forEach(function (k) { t.getRange(1, h[RQA_TC[k]] + 1).setBackground(RQA_GREY); });
  t.getRange(1, h[RQA_TC.devTicket] + 1).setNote('Ticket number(s) this case tests, e.g. 12 or 12, 15.');
  t.getRange(1, h[RQA_TC.caseStatus] + 1).setNote('Active = tested. Reworked (put the ticket in Reworked By) or Closed (page discontinued) = no longer tested.');
  t.getRange(1, h[RQA_TC.result] + 1).setNote('Pick the result after testing; time, tester and the Check Log fill themselves. The checker writes here too.');
  t.getRange(1, h[RQA_TC.title] + 1).setNote('Manual case: type the test here on an empty row and it gets an ID (MAN-001...).');
  var letter = function (k) { return rqaLetter_(h[RQA_TC[k]] + 1); };
  var B = SpreadsheetApp.newConditionalFormatRule;
  t.setConditionalFormatRules([
    B().whenFormulaSatisfied('=OR($' + letter('caseStatus') + '2="Closed",$' + letter('caseStatus') + '2="Reworked")')
      .setBackground('#eeeeee').setFontColor('#888888').setStrikethrough(true).setRanges([t.getRange(2, 1, rows, t.getLastColumn())]).build(),
  ].concat(rqaResultRules_(col('result'))));
  if (!t.getFilter()) t.getRange(1, 1, t.getMaxRows(), t.getLastColumn()).createFilter();
  return { sh: t, h: h };
}

function rqaSetupLog_(ss) {
  var log = rqaTab_(ss, RQA_LOG);
  var h0 = rqaHeaders_(log, 1);
  if (h0['Checker'] != null && h0['Tested By'] == null) log.getRange(1, h0['Checker'] + 1).setValue('Tested By');
  rqaEnsureHeaders_(log, RQA_LOG_HEADERS, 1);
  log.setFrozenRows(1);
  rqaHeaderStyle_(log.getRange(1, 1, 1, log.getLastColumn()));
  var h = rqaHeaders_(log, 1), rows = Math.max(log.getMaxRows() - 1, 1);
  [['TC ID', 90], ['Dev Ticket', 80], ['Tested By', 110], ['Checked At', 150], ['Environment', 100], ['Result', 120], ['Notes', 520], ['Screenshot', 110]]
    .forEach(function (p) { log.setColumnWidth(h[p[0]] + 1, p[1]); });
  log.getRange(2, h['Checked At'] + 1, rows, 1).setNumberFormat('mmm d, yyyy h:mm am/pm');
  log.getRange(2, h['Notes'] + 1, rows, 1).setWrap(true);
  log.getRange(2, 1, rows, log.getLastColumn()).setVerticalAlignment('top');
  log.setConditionalFormatRules(rqaResultRules_(log.getRange(2, h['Result'] + 1, rows, 1)));
}

// ================================================================ dashboards

/** Whole-column references used by the dashboards' formulas. */
function rqaLetters_(tk, cs) {
  var T = {}, C = {};
  Object.keys(RQA_TK).forEach(function (k) { var c = rqaLetter_(tk.h[RQA_TK[k]] + 1); T[k] = "'" + RQA_TICKETS + "'!" + c + RQA_T.first + ':' + c; });
  Object.keys(RQA_TC).forEach(function (k) { var c = rqaLetter_(cs.h[RQA_TC[k]] + 1); C[k] = "'" + RQA_CASES + "'!" + c + '2:' + c; });
  return { T: T, C: C, activeCases: C.id + ',"<>",' + C.caseStatus + ',"<>Closed",' + C.caseStatus + ',"<>Reworked"' };
}

function rqaDashStart_(ss, name, title, subtitle) {
  var d = rqaTab_(ss, name);
  d.getCharts().forEach(function (c) { d.removeChart(c); });
  d.clear(); d.clearConditionalFormatRules();
  d.getRange(1, 1, d.getMaxRows(), d.getMaxColumns()).clearDataValidations();
  d.setHiddenGridlines(true);
  d.getRange('A1:P1').merge().setValue(title).setFontSize(18).setFontWeight('bold').setFontColor('#ffffff').setBackground(RQA_NAVY);
  d.setRowHeight(1, 42);
  d.getRange('A2:P2').merge().setValue(subtitle).setFontColor(RQA_GREY).setFontStyle('italic');
  d.setFrozenRows(2);
  return d;
}

/** A KPI card: small label over a big number. */
function rqaCard_(d, row, col, label, formula, bg) {
  d.getRange(row, col).setValue(label).setFontSize(9).setFontWeight('bold').setFontColor(RQA_GREY).setBackground(bg).setHorizontalAlignment('center').setWrap(true);
  d.getRange(row + 1, col).setFormula(formula).setFontSize(22).setFontWeight('bold').setBackground(bg).setHorizontalAlignment('center');
  d.setRowHeight(row + 1, 40);
}

/** A titled list fed by one FILTER formula, with max rows reserved below it. */
function rqaList_(d, row, col, title, headers, formula, max, empty, colour) {
  d.getRange(row, col).setValue(title).setFontWeight('bold').setFontColor(colour || RQA_NAVY);
  rqaHeaderStyle_(d.getRange(row + 1, col, 1, headers.length).setValues([headers]));
  d.getRange(row + 2, col).setFormula('=IFERROR(ARRAY_CONSTRAIN(' + formula + ',' + max + ',' + headers.length + '),"' + empty + '")');
  d.getRange(row + 2, col, max, headers.length).setWrap(true).setVerticalAlignment('top').setFontSize(9);
}

function rqaBuildDashboard_(ss, L) {
  var T = L.T, C = L.C, A = L.activeCases;
  var d = rqaDashStart_(ss, RQA_DASH, 'RDC8 IMS — QA & Dev Tickets',
    'Vercel: ' + rqaSetting_('App under test (Vercel)') + '   ·   Original: ' + rqaSetting_('Original site (reference only)') + '   ·   QA work: QA Dashboard   ·   Dev work: Dev Dashboard');
  d.setColumnWidths(1, 16, 96);
  d.getRange('A4').setValue('TICKETS').setFontWeight('bold').setFontColor(RQA_NAVY);
  var st = RQA_LISTS['Ticket Status'];
  st.forEach(function (s, i) { rqaCard_(d, 5, i + 1, s, '=COUNTIF(' + T.status + ',"' + s + '")', RQA_STATUS_COLOURS[s]); });
  rqaCard_(d, 5, st.length + 1, 'All tickets', '=COUNTA(' + T.ticket + ')', '#eef1f7');
  rqaCard_(d, 5, st.length + 2, 'Logged this week', '=COUNTIFS(' + T.ticket + ',"<>",' + T.date + ',">="&(TODAY()-WEEKDAY(TODAY(),3)))', '#eef1f7');

  d.getRange('A8').setValue('TEST CASES').setFontWeight('bold').setFontColor(RQA_NAVY);
  var res = function (r) { return '=COUNTIFS(' + A + ',' + C.result + ',"' + r + '")'; };
  rqaCard_(d, 9, 1, 'Active cases', '=COUNTIFS(' + A + ')', '#eef1f7');
  rqaCard_(d, 9, 2, 'Pass', res('Pass'), RQA_RESULT_COLOURS.Pass);
  rqaCard_(d, 9, 3, 'Fail', res('Fail'), RQA_RESULT_COLOURS.Fail);
  rqaCard_(d, 9, 4, 'Blocked', res('Blocked'), RQA_RESULT_COLOURS.Blocked);
  rqaCard_(d, 9, 5, 'Not on Vercel', res('Not Implemented'), RQA_RESULT_COLOURS['Not Implemented']);
  rqaCard_(d, 9, 6, 'Not run yet', '=COUNTIFS(' + A + ',' + C.result + ',"")', '#eef1f7');
  rqaCard_(d, 9, 7, 'Pass rate', '=IFERROR(B10/(B10+C10),0)', '#eef1f7');
  d.getRange('G10').setNumberFormat('0%');
  rqaCard_(d, 9, 8, 'Manual cases', '=COUNTIFS(' + A + ',' + C.source + ',"Manual")', '#eef1f7');
  rqaCard_(d, 9, 9, 'Automated', '=COUNTIFS(' + A + ',' + C.source + ',"Auto")', '#eef1f7');
  rqaCard_(d, 9, 10, 'Retired', '=COUNTIF(' + C.caseStatus + ',"Closed")+COUNTIF(' + C.caseStatus + ',"Reworked")', '#e0e0e0');

  // Tickets by dev (left) and results by module (right).
  d.getRange('A12').setValue('TICKETS BY DEV').setFontWeight('bold').setFontColor(RQA_NAVY);
  var devHead = ['Dev', 'Tickets', 'In Dev', 'Ready for QA', 'Failed / Fixing', 'Passed'];
  rqaHeaderStyle_(d.getRange(13, 1, 1, devHead.length).setValues([devHead]));
  d.getRange('A14').setFormula("=IFERROR(FILTER('" + RQA_SETTINGS + "'!" + rqaListLetter_('Dev') + '2:' + rqaListLetter_('Dev') + ",'" + RQA_SETTINGS + "'!" + rqaListLetter_('Dev') + '2:' + rqaListLetter_('Dev') + '<>""),"")');
  var f = [];
  for (var r = 14; r <= 23; r++) {
    var dv = '$A' + r, by = function (s) { return 'COUNTIFS(' + T.dev + ',' + dv + ',' + T.status + ',"' + s + '")'; };
    f.push(['=IF(' + dv + '="","",COUNTIF(' + T.dev + ',' + dv + '))', '=IF(' + dv + '="","",' + by(RQA_S.inDev) + ')', '=IF(' + dv + '="","",' + by(RQA_S.ready) + '+' + by(RQA_S.retest) + ')',
      '=IF(' + dv + '="","",' + by(RQA_S.failed) + '+' + by(RQA_S.fixing) + ')', '=IF(' + dv + '="","",' + by(RQA_S.passed) + ')']);
  }
  d.getRange(14, 2, 10, 5).setFormulas(f).setHorizontalAlignment('center');

  d.getRange('H12').setValue('RESULTS BY MODULE').setFontWeight('bold').setFontColor(RQA_NAVY);
  var modHead = ['Module', 'Active', 'Pass', 'Fail', 'Blocked', 'Not on Vercel', 'Not run', 'Pass %'];
  rqaHeaderStyle_(d.getRange(13, 8, 1, modHead.length).setValues([modHead]));
  d.getRange('H14').setFormula('=IFERROR(SORT(UNIQUE(FILTER(' + C.module + ',' + C.module + '<>""))),"")');
  var mf = [];
  for (var mr = 14; mr <= 43; mr++) {
    var m = '$H' + mr, by2 = function (x) { return '=IF(' + m + '="","",COUNTIFS(' + C.module + ',' + m + ',' + A + (x ? ',' + C.result + ',' + x : '') + '))'; };
    mf.push([by2(''), by2('"Pass"'), by2('"Fail"'), by2('"Blocked"'), by2('"Not Implemented"'), by2('""'), '=IF(' + m + '="","",IFERROR(J' + mr + '/(J' + mr + '+K' + mr + '),""))']);
  }
  d.getRange(14, 9, 30, 7).setFormulas(mf).setHorizontalAlignment('center');
  d.getRange('O14:O43').setNumberFormat('0%');
  d.setColumnWidth(8, 150);
  var B = SpreadsheetApp.newConditionalFormatRule, rows = d.getRange('H14:O43');
  d.setConditionalFormatRules([
    B().whenFormulaSatisfied('=AND($H14<>"",$K14>0)').setBackground('#fbe9eb').setRanges([rows]).build(),
    B().whenFormulaSatisfied('=AND($H14<>"",$I14>0,$J14=$I14)').setBackground('#e9f6ec').setRanges([rows]).build(),
  ]);

  // Charts: ticket pipeline and test results.
  d.insertChart(d.newChart().setChartType(Charts.ChartType.COLUMN).addRange(d.getRange(5, 1, 2, st.length))
    .setTransposeRowsAndColumns(true).setOption('title', 'Tickets by status').setOption('legend', { position: 'none' })
    .setOption('colors', ['#2f6fec']).setPosition(25, 1, 0, 0).setOption('width', 620).setOption('height', 300).build());
  d.getRange('R5:S10').setValues([['Result', 'Cases'], ['Pass', ''], ['Fail', ''], ['Blocked', ''], ['Not on Vercel', ''], ['Not run yet', '']]);
  d.getRange('S6:S10').setFormulas([['=B10'], ['=C10'], ['=D10'], ['=E10'], ['=F10']]);
  d.getRange('R5:S10').setFontColor('#ffffff'); // chart data, kept out of sight
  d.insertChart(d.newChart().setChartType(Charts.ChartType.PIE).addRange(d.getRange('R5:S10'))
    .setOption('title', 'Active test cases').setOption('pieHole', 0.45)
    .setOption('colors', ['#1e8e3e', '#c62828', '#b7791f', '#5b5bd6', '#b0b7c3'])
    .setPosition(45, 8, 0, 0).setOption('width', 480).setOption('height', 300).build());
}

function rqaBuildQaDashboard_(ss, L) {
  var T = L.T, C = L.C, A = L.activeCases;
  var d = rqaDashStart_(ss, RQA_QA, 'QA Dashboard', 'What to test next. Test on the Test Cases tab: pick a Result per case and the ticket updates itself.');
  d.setColumnWidths(1, 16, 105);
  rqaCard_(d, 4, 1, 'Ready for Re-test', '=COUNTIF(' + T.status + ',"' + RQA_S.retest + '")', RQA_STATUS_COLOURS[RQA_S.retest]);
  rqaCard_(d, 4, 2, 'Ready for QA', '=COUNTIF(' + T.status + ',"' + RQA_S.ready + '")', RQA_STATUS_COLOURS[RQA_S.ready]);
  rqaCard_(d, 4, 3, 'Need test cases', '=COUNTIFS(' + T.status + ',"' + RQA_S.ready + '",' + T.qa + ',"No test case yet")+COUNTIFS(' + T.status + ',"' + RQA_S.inDev + '",' + T.qa + ',"No test case yet")', '#fff3cd');
  rqaCard_(d, 4, 4, 'Cases not run', '=COUNTIFS(' + A + ',' + C.result + ',"")', '#eef1f7');
  rqaCard_(d, 4, 5, 'Cases failing', '=COUNTIFS(' + A + ',' + C.result + ',"Fail")', RQA_RESULT_COLOURS.Fail);
  rqaCard_(d, 4, 6, 'Cases blocked', '=COUNTIFS(' + A + ',' + C.result + ',"Blocked")', RQA_RESULT_COLOURS.Blocked);
  var cols = function () { return Array.prototype.slice.call(arguments).join(','); };
  rqaList_(d, 7, 1, 'READY FOR RE-TEST (dev fixed it)', ['Ticket', 'Dev', 'Fix Tickets', 'Test Cases', 'Last QA Result'],
    'SORT(FILTER({' + cols(T.ticket, T.dev, T.fixes, T.cases, T.qa) + '},' + T.status + '="' + RQA_S.retest + '"),1,TRUE)', 20, 'Nothing to re-test', '#b7791f');
  rqaList_(d, 7, 7, 'READY FOR QA (not tested yet)', ['Ticket', 'Dev', 'Ready Since', 'Test Cases', 'QA Result'],
    'SORT(FILTER({' + cols(T.ticket, T.dev, T.readyAt, T.cases, T.qa) + '},' + T.status + '="' + RQA_S.ready + '"),3,TRUE)', 20, 'Nothing waiting', RQA_NAVY);
  d.getRange(9, 9, 20, 1).setNumberFormat('mmm d, h:mm am/pm');
  rqaList_(d, 30, 1, 'TICKETS WITHOUT A TEST CASE (add one on Test Cases)', ['Ticket', 'Dev', 'Status', 'Page'],
    'SORT(FILTER({' + cols(T.ticket, T.dev, T.status, T.page) + '},' + T.qa + '="No test case yet",(' + T.status + '="' + RQA_S.ready + '")+(' + T.status + '="' + RQA_S.inDev + '")),1,TRUE)', 20, 'Every open ticket has a test case');
  rqaList_(d, 30, 7, 'ACTIVE CASES NEVER RUN', ['TC ID', 'Dev Ticket', 'Test', 'Source'],
    'FILTER({' + cols(C.id, C.devTicket, C.title, C.source) + '},' + C.id + '<>"",' + C.result + '="",' + C.caseStatus + '<>"Closed",' + C.caseStatus + '<>"Reworked")', 20, 'All active cases have a result');
  d.setColumnWidth(1, 300); d.setColumnWidth(5, 260); d.setColumnWidth(7, 300); d.setColumnWidth(11, 260); d.setColumnWidth(9, 220);
}

function rqaBuildDevDashboard_(ss, L, st) {
  var T = L.T;
  var d = rqaDashStart_(ss, RQA_DEV, 'Dev Dashboard', 'Pick yourself in B4 to see only your tickets. Tick "Fix" on a failed ticket (Dev Tickets tab) to make its fix ticket.');
  d.setColumnWidths(1, 16, 105);
  d.getRange('A4').setValue('Dev:').setFontWeight('bold').setHorizontalAlignment('right');
  var devs = rqaListValues_(st, 'Dev');
  d.getRange('B4').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['All'].concat(devs), true).build())
    .setValue('All').setBackground('#fff3cd').setFontWeight('bold');
  var mine = '((' + T.dev + '=$B$4)+($B$4="All"))';
  var cnt = function (s) { return '=SUMPRODUCT((' + T.status + '="' + s + '")*' + mine + ')'; };
  [RQA_S.failed, RQA_S.fixing, RQA_S.inDev, RQA_S.ready, RQA_S.retest, RQA_S.passed].forEach(function (s, i) {
    rqaCard_(d, 5, i + 1, s, cnt(s), RQA_STATUS_COLOURS[s]);
  });
  var cols = function () { return Array.prototype.slice.call(arguments).join(','); };
  rqaList_(d, 8, 1, 'FAILED — make a fix ticket (tick Fix on the ticket)', ['Ticket', 'Dev', 'What failed', 'Fix Tickets'],
    'SORT(FILTER({' + cols(T.ticket, T.dev, T.qa, T.fixes) + '},' + T.status + '="' + RQA_S.failed + '",' + mine + '),1,TRUE)', 15, 'No failed tickets', '#c62828');
  rqaList_(d, 8, 7, 'IN PROGRESS (In Dev and Fixing)', ['Ticket', 'Dev', 'Status', 'Fix Of'],
    'SORT(FILTER({' + cols(T.ticket, T.dev, T.status, T.fixOf) + '},((' + T.status + '="' + RQA_S.inDev + '")+(' + T.status + '="' + RQA_S.fixing + '")),' + mine + '),1,TRUE)', 15, 'Nothing in progress');

  // Feature trail: every ticket that touched one page, oldest first.
  d.getRange('A26').setValue('FEATURE TRAIL BY PAGE').setFontWeight('bold').setFontColor(RQA_NAVY);
  d.getRange('A27').setValue('Page:').setFontWeight('bold').setHorizontalAlignment('right');
  d.getRange('R1').setValue('Pages');
  d.getRange('R2').setFormula('=IFERROR(SORT(UNIQUE(FILTER(' + T.page + ',' + T.page + '<>""))),"")');
  d.getRange('R1:R300').setFontColor('#ffffff'); // dropdown source, kept out of sight
  d.getRange('B27:D27').merge().setDataValidation(SpreadsheetApp.newDataValidation().requireValueInRange(d.getRange('R2:R300'), true).build())
    .setBackground('#fff3cd').setFontWeight('bold');
  rqaList_(d, 28, 1, '', ['#', 'Type', 'Ticket', 'Dev', 'Date', 'Status', 'Fix Of', 'Reworked By', 'QA Result'],
    'ARRAYFORMULA(SORT(FILTER({IFERROR(VALUE(REGEXEXTRACT(' + T.ticket + '&"","^\\s*(\\d+)")),0),' + cols(T.type, T.ticket, T.dev, T.date, T.status, T.fixOf, T.reworkedBy, T.qa) + '},' +
    T.page + '=$B$27,' + T.page + '<>""),1,TRUE))', 60, 'Pick a page in B27');
  d.getRange(30, 5, 60, 1).setNumberFormat('mm/dd/yy');
  d.setColumnWidth(1, 300); d.setColumnWidth(3, 300); d.setColumnWidth(7, 300); d.setColumnWidth(9, 260);
}

// ================================================================ small helpers

function rqaTab_(ss, name) { return ss.getSheetByName(name) || ss.insertSheet(name); }

function rqaEnsureHeaders_(sh, headers, row) {
  var width = sh.getLastColumn();
  var have = width ? sh.getRange(row, 1, 1, width).getValues()[0].map(String) : [];
  if (!have.filter(String).length) { sh.getRange(row, 1, 1, headers.length).setValues([headers]); return; }
  var missing = headers.filter(function (x) { return have.indexOf(x) < 0; });
  var end = have.length;
  while (end > 0 && have[end - 1] === '') end--;
  if (missing.length) sh.getRange(row, end + 1, 1, missing.length).setValues([missing]);
}

function rqaHeaders_(sh, row) {
  var out = {};
  if (!sh.getLastColumn()) return out;
  sh.getRange(row, 1, 1, sh.getLastColumn()).getValues()[0].forEach(function (v, i) { if (v !== '' && out[String(v)] == null) out[String(v)] = i; });
  return out;
}

function rqaHeaderStyle_(range) {
  return range.setFontWeight('bold').setBackground(RQA_NAVY).setFontColor('#ffffff').setWrap(true).setVerticalAlignment('middle');
}

function rqaResultRules_(range) {
  var B = SpreadsheetApp.newConditionalFormatRule;
  return Object.keys(RQA_RESULT_COLOURS).map(function (r) { return B().whenTextEqualTo(r).setBackground(RQA_RESULT_COLOURS[r]).setRanges([range]).build(); });
}

function rqaLetter_(n) { var s = ''; while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
function rqaListLetter_(name) { return rqaLetter_(RQA_LIST_KEYS.indexOf(name) + 1); }

function rqaListRule_(st, name) {
  var c = rqaListLetter_(name);
  return SpreadsheetApp.newDataValidation().requireValueInRange(st.getRange(c + '2:' + c), true).setAllowInvalid(false).build();
}

function rqaListValues_(st, name) {
  var c = RQA_LIST_KEYS.indexOf(name) + 1;
  return st.getRange(2, c, Math.max(st.getLastRow() - 1, 1), 1).getValues().map(function (r) { return String(r[0]); }).filter(String);
}

function rqaSetting_(name) {
  var st = SpreadsheetApp.getActive().getSheetByName(RQA_SETTINGS);
  if (st && st.getLastRow() > 1) {
    var v = st.getRange(1, RQA_SET_COL, st.getLastRow(), 2).getValues();
    for (var j = 0; j < v.length; j++) if (v[j][0] === name) return String(v[j][1]);
  }
  for (var i = 0; i < RQA_DEFAULT_SETTINGS.length; i++) if (RQA_DEFAULT_SETTINGS[i][0] === name) return RQA_DEFAULT_SETTINGS[i][1];
  return '';
}

function rqaAppendLog_(entries) {
  var log = SpreadsheetApp.getActive().getSheetByName(RQA_LOG);
  if (!log || !entries.length) return;
  var h = rqaHeaders_(log, 1), start = log.getLastRow() + 1;
  var put = function (name, fn) { if (h[name] != null) log.getRange(start, h[name] + 1, entries.length, 1).setValues(entries.map(function (x) { return [fn(x)]; })); };
  put('TC ID', function (x) { return x.id; }); put('Dev Ticket', function (x) { return x.ticket; });
  put('Tested By', function (x) { return x.who; }); put('Checked At', function (x) { return x.at; });
  put('Environment', function (x) { return x.env; }); put('Result', function (x) { return x.result; });
  put('Notes', function (x) { return x.notes; }); put('Screenshot', function (x) { return x.link; });
}

// ================================================================ checker token

function rqaCreateToken() {
  var ui = SpreadsheetApp.getUi();
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('QA_TOKEN') && ui.alert('A checker token already exists. Replace it? (The old one stops working.)', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  var token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  props.setProperty('QA_TOKEN', token);
  ui.alert('Checker token', 'Put this in the checker Settings as SHEET_TOKEN (it is not shown again):\n\n' + token, ui.ButtonSet.OK);
}

// ================================================================ web app (automated checker)

function rqaAuth_(token) {
  var want = PropertiesService.getScriptProperties().getProperty('QA_TOKEN');
  if (!want || token !== want) throw new Error('Bad or missing token');
}
function rqaJson_(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }
function rqaGz_(obj) {
  var gz = Utilities.gzip(Utilities.newBlob(JSON.stringify(obj), 'application/json'));
  return rqaJson_({ ok: true, gz: Utilities.base64Encode(gz.getBytes()) });
}

function rqaReadCases_() {
  var sh = SpreadsheetApp.getActive().getSheetByName(RQA_CASES);
  if (!sh) throw new Error('No "' + RQA_CASES + '" tab: run RDC QA > Set up / repair spreadsheet');
  var h = rqaHeaders_(sh, 1), last = sh.getLastRow();
  var vals = last > 1 ? sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues() : [];
  var g = function (r, k) { return h[RQA_TC[k]] == null ? '' : r[h[RQA_TC[k]]]; };
  var rows = [];
  vals.forEach(function (r, i) {
    var id = String(g(r, 'id')).trim();
    if (!id) return;
    rows.push({ row: i + 2, id: id, module: g(r, 'module'), title: g(r, 'title'), kind: g(r, 'kind'), source: g(r, 'source'),
      reference: g(r, 'reference'), caseStatus: String(g(r, 'caseStatus') || 'Active'), devTicket: String(g(r, 'devTicket')), latest: g(r, 'result'),
      checkedAt: g(r, 'checkedAt') instanceof Date ? g(r, 'checkedAt') : null });
  });
  return { sh: sh, h: h, rows: rows, lastRow: last };
}

function doGet(e) {
  try {
    rqaAuth_(e.parameter.token);
    if (e.parameter.action !== 'tests') throw new Error('Unknown action');
    return rqaGz_({ rows: rqaReadCases_().rows.map(function (r) { delete r.row; r.ticketStatus = r.caseStatus; return r; }) });
  } catch (err) {
    return rqaJson_({ ok: false, error: String(err.message || err) });
  }
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    var body = JSON.parse(e.postData.contents);
    rqaAuth_(body.token);
    lock.waitLock(30000);
    var out;
    if (body.action === 'results') out = rqaWriteResults_(body.rows || []);
    else if (body.action === 'sync') out = rqaSyncTests_(body.tests || [], body.update !== false);
    else throw new Error('Unknown action');
    SpreadsheetApp.flush();
    try { rqaRefresh(); } catch (err) { out.refreshError = String(err.message || err); }
    return rqaJson_(out);
  } catch (err) {
    return rqaJson_({ ok: false, error: String(err.message || err) });
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

function rqaWriteResults_(items) {
  var C = rqaReadCases_();
  var byId = {};
  C.rows.forEach(function (r) { byId[r.id] = r; });
  var now = new Date(), folder = null, out = [], skipped = [], unknown = [], older = [];
  items.forEach(function (it) {
    var row = byId[it.tcId];
    if (!row) { unknown.push(it.tcId); return; }
    // Closed / Reworked cases are never updated, whatever the checker sends.
    if (RQA_RETIRED.test(row.caseStatus.trim())) { skipped.push(it.tcId); return; }
    var link = '';
    if (it.screenshot && it.screenshot.base64) {
      if (!folder) {
        var name = rqaSetting_('Screenshot folder (Drive)') || 'RDC QA Screenshots';
        var f = DriveApp.getFoldersByName(name);
        folder = f.hasNext() ? f.next() : DriveApp.createFolder(name);
      }
      link = folder.createFile(Utilities.newBlob(Utilities.base64Decode(it.screenshot.base64), 'image/png', it.screenshot.name)).getUrl();
    }
    var at = it.checkedAt ? new Date(it.checkedAt) : now;
    if (isNaN(at.getTime())) at = now;
    out.push({ it: it, row: row, link: link, at: at });
  });
  rqaAppendLog_(out.map(function (o) {
    return { id: o.it.tcId, ticket: o.row.devTicket, who: o.it.checker || 'RDC QA Bot', at: o.at, env: o.it.env || 'Vercel', result: o.it.result, notes: o.it.notes || '', link: o.link };
  }));
  out.forEach(function (o) {
    // An earlier run's result never replaces a newer one: it stays in the Check Log only.
    if (o.row.checkedAt && o.row.checkedAt > o.at) { older.push(o.it.tcId); return; }
    var set = function (k, v) { if (C.h[RQA_TC[k]] != null) C.sh.getRange(o.row.row, C.h[RQA_TC[k]] + 1).setValue(v); };
    set('result', o.it.result); set('checkedAt', o.at); set('testedBy', o.it.checker || 'RDC QA Bot');
    set('notes', o.it.notes || ''); set('shot', o.link);
    if (o.it.result !== 'Blocked') set('implemented', o.it.result === 'Not Implemented' ? 'No' : 'Yes');
  });
  return { ok: true, written: out.length, skippedCancelled: skipped, unknown: unknown, older: older };
}

function rqaSyncTests_(tests, update) {
  var C = rqaReadCases_();
  var byId = {};
  C.rows.forEach(function (r) { byId[r.id] = r; });
  var added = [], updated = [], skipped = [];
  var owned = ['module', 'title', 'kind', 'steps', 'expected'];
  var width = C.sh.getLastColumn(), newRows = [];
  tests.forEach(function (t) {
    var row = byId[t.id];
    if (!row) {
      var r = []; for (var i = 0; i < width; i++) r.push('');
      var put = function (k, v) { if (C.h[RQA_TC[k]] != null) r[C.h[RQA_TC[k]]] = v; };
      owned.forEach(function (k) { put(k, t[k] || ''); });
      put('id', t.id); put('source', 'Auto'); put('reference', t.reference || ''); put('caseStatus', 'Active');
      put('implemented', t.pending ? 'No' : '');
      newRows.push(r); added.push(t.id);
      return;
    }
    if (RQA_RETIRED.test(row.caseStatus.trim())) { skipped.push(t.id); return; }
    if (!update) return;
    var cur = C.sh.getRange(row.row, 1, 1, width).getValues()[0], changed = false;
    owned.forEach(function (k) {
      var c = C.h[RQA_TC[k]];
      if (c != null && String(cur[c]) !== String(t[k] || '')) { C.sh.getRange(row.row, c + 1).setValue(t[k] || ''); changed = true; }
    });
    var rc = C.h[RQA_TC.reference];
    if (rc != null && t.reference && String(cur[rc]) === '') { C.sh.getRange(row.row, rc + 1).setValue(t.reference); changed = true; }
    if (changed) updated.push(t.id);
  });
  if (newRows.length) C.sh.getRange(C.lastRow + 1, 1, newRows.length, width).setValues(newRows);
  return { ok: true, added: added, updated: updated, skippedCancelled: skipped };
}

/**
 * Menu: adds / refreshes the checker's test cases from apps-script/test-cases.json in the rdc-tester repo
 * (made by "npm run sync-sheet -- --export"). Same rules as the checker's own sync; no web app or token needed.
 */
function rqaSyncTestsFromRepo() {
  var ui = SpreadsheetApp.getUi();
  var res = UrlFetchApp.fetch(RQA_CASES_URL, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) return ui.alert('Could not read the test cases from GitHub (HTTP ' + res.getResponseCode() + ').');
  var data = JSON.parse(res.getContentText());
  var r = rqaSyncTests_(data.tests || [], true);
  rqaRefresh();
  ui.alert('Test cases synced', r.added.length + ' added, ' + r.updated.length + ' updated, ' + r.skippedCancelled.length +
    ' closed / reworked left alone (exported ' + String(data.exported || '').slice(0, 16).replace('T', ' ') + ').', ui.ButtonSet.OK);
}
var RQA_CASES_URL = 'https://raw.githubusercontent.com/Aris-Artates/rdc-tester/main/apps-script/test-cases.json';

/**
 * RDC QA > Import parity tickets from rdc-tester: the differences `npm run evidence` found between the original
 * site and Vercel (apps-script/parity-tickets.json). Each new one becomes a Dev Tickets row with no Dev and status
 * No Progress, and an unassigned No Progress Freedcamp task. A ticket whose title is already on the sheet is skipped.
 * Optional per ticket: task (an existing Freedcamp task to link and rename instead of making one), dev, status;
 * and parent (per ticket or for the whole file) to make the new task a subtask.
 */
function rqaImportTicketsFromRepo() {
  var ui = SpreadsheetApp.getUi();
  var res = UrlFetchApp.fetch(RQA_IMPORT_URL + '?t=' + Date.now(), { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) return ui.alert('Could not read the parity tickets from GitHub (HTTP ' + res.getResponseCode() + ').');
  var json = JSON.parse(res.getContentText()), list = json.tickets || [];
  var sh = SpreadsheetApp.getActive().getSheetByName(RQA_TICKETS), h = rqaHeaders_(sh, RQA_T.head);
  // Sheets made before "No Progress" existed: add it to the status dropdown's list in Settings.
  var st = SpreadsheetApp.getActive().getSheetByName(RQA_SETTINGS), statuses = rqaListValues_(st, 'Ticket Status');
  if (statuses.indexOf(RQA_S.noProgress) < 0) st.getRange(statuses.length + 2, RQA_LIST_KEYS.indexOf('Ticket Status') + 1).setValue(RQA_S.noProgress);
  var last = rqaLastTicketRow_(sh, h);
  var have = {};
  if (last >= RQA_T.first) sh.getRange(RQA_T.first, h[RQA_TK.ticket] + 1, last - RQA_T.first + 1, 1).getDisplayValues().forEach(function (v) {
    var t = rqaParseTicket_(v[0]);
    if (t) have[(t.type + ': ' + t.title).toLowerCase()] = true;
  });
  var made = [], skipped = [], failed = [];
  list.forEach(function (t) {
    if (have[t.title.toLowerCase()]) return skipped.push(t.title);
    // A ticket (or the whole file) may name a Freedcamp parent task: the new task becomes its subtask.
    var parent = String(t.parent || json.parent || '');
    var parentUrl = parent ? 'https://freedcamp.com/view/' + rqaSetting_('Freedcamp project ID') + '/tasks/' + parent : '';
    var num = rqaNewTicket_(sh, { title: t.title, status: t.status || RQA_S.noProgress, desc: t.description, parentUrl: parentUrl, dev: t.dev || '' });
    var row = rqaLastTicketRow_(sh, h), full = num + ' | ' + t.title;
    try {
      // A ticket that already has a Freedcamp task (t.task) reuses it, renamed to the new ticket number.
      var task = t.task ? { id: String(t.task), url: 'https://freedcamp.com/view/' + rqaSetting_('Freedcamp project ID') + '/tasks/' + t.task }
        : rqaCreateFreedcampTask_(full, t.description, '', parent || null, { open: true });
      if (t.task) rqaFc_('post', 'tasks/' + t.task, { title: full });
      sh.getRange(row, h[RQA_TK.fc] + 1).clearDataValidations().setRichTextValue(SpreadsheetApp.newRichTextValue().setText('Task ' + task.id).setLinkUrl(task.url).build());
      made.push(full + '  ->  Task ' + task.id);
    } catch (err) {
      failed.push(full + ': ' + String(err.message || err));
    }
  });
  rqaRefresh();
  ui.alert('Parity tickets imported', made.length + ' added (No Progress, no Dev, unassigned Freedcamp task), ' + skipped.length + ' already on the sheet' +
    (failed.length ? ', ' + failed.length + ' without a Freedcamp task:\n' + failed.join('\n') : '.'), ui.ButtonSet.OK);
}
var RQA_IMPORT_URL = 'https://raw.githubusercontent.com/Aris-Artates/rdc-tester/main/apps-script/parity-tickets.json';

// ================================================================ Freedcamp

/*
 * Each dev connects their OWN Freedcamp key. It is kept in that person's user properties, which only they can
 * read, and their own triggers act only on tickets whose Dev is them: the task is then "Created by" that dev.
 * Script properties hold only the NAMES of connected devs (FREEDCAMP_DEVS). A key saved by the first version
 * (one shared key in script properties) still works as a fallback for devs who have not connected yet.
 */
var RQA_FC_KEYS = ['FREEDCAMP_API_KEY', 'FREEDCAMP_API_SECRET', 'FREEDCAMP_ME', 'FREEDCAMP_SYNCED', 'FREEDCAMP_DEV'];

/** The key the running person uses: their own, or the old shared one. Null when neither exists. */
function rqaFcKeys_() {
  var u = PropertiesService.getUserProperties();
  if (u.getProperty('FREEDCAMP_API_KEY')) return { props: u, shared: false, dev: u.getProperty('FREEDCAMP_DEV') || '' };
  var s = PropertiesService.getScriptProperties();
  if (s.getProperty('FREEDCAMP_API_KEY')) return { props: s, shared: true, dev: '' };
  return null;
}
function rqaFcDevs_() { return JSON.parse(PropertiesService.getScriptProperties().getProperty('FREEDCAMP_DEVS') || '{}'); }
function rqaFcSetDev_(dev, on) {
  var reg = rqaFcDevs_();
  if (on) reg[dev] = true; else delete reg[dev];
  PropertiesService.getScriptProperties().setProperty('FREEDCAMP_DEVS', JSON.stringify(reg));
}
/** Whether a ticket of this dev can be sent: the dev connected, or the old shared key exists. */
function rqaFreedcampReady_(dev) { return !!rqaFcDevs_()[dev] || !!PropertiesService.getScriptProperties().getProperty('FREEDCAMP_API_KEY'); }
/** Inside a trigger: should THIS person's trigger act on a ticket of `dev`? (Exactly one trigger says yes.) */
function rqaFcHandles_(keys, dev) { return keys && (keys.shared ? !rqaFcDevs_()[dev] : keys.dev === dev); }

/** Menu: the person running it connects their own Freedcamp key for their own tickets. */
function rqaConnectFreedcamp() {
  var ui = SpreadsheetApp.getUi();
  var devs = rqaListValues_(SpreadsheetApp.getActive().getSheetByName(RQA_SETTINGS), 'Dev');
  var d = ui.prompt('Connect Freedcamp (1/3)', 'Which Dev are you? Type your name as it is in the Dev list: ' + devs.join(', '), ui.ButtonSet.OK_CANCEL);
  if (d.getSelectedButton() !== ui.Button.OK) return;
  var dev = devs.filter(function (x) { return x.toLowerCase() === d.getResponseText().trim().toLowerCase(); })[0];
  if (!dev) return ui.alert('"' + d.getResponseText().trim() + '" is not in the Dev list (Settings tab). Add yourself there first.');
  var k = ui.prompt('Connect Freedcamp (2/3)', 'In Freedcamp: your avatar > My Account > API. Create a SECURED key and paste the API KEY here.', ui.ButtonSet.OK_CANCEL);
  if (k.getSelectedButton() !== ui.Button.OK || !k.getResponseText().trim()) return;
  var s = ui.prompt('Connect Freedcamp (3/3)', 'Paste the API SECRET (shown on the same page after entering your Freedcamp password).', ui.ButtonSet.OK_CANCEL);
  if (s.getSelectedButton() !== ui.Button.OK || !s.getResponseText().trim()) return;
  var mine = ScriptApp.getProjectTriggers().filter(function (t) { return /^rqa(OnEditFreedcamp|SyncFreedcamp)$/.test(t.getHandlerFunction()); });
  var user = PropertiesService.getUserProperties();
  var before = user.getProperty('FREEDCAMP_DEV');
  RQA_FC_KEYS.forEach(function (p) { user.deleteProperty(p); });
  user.setProperties({ FREEDCAMP_API_KEY: k.getResponseText().trim(), FREEDCAMP_API_SECRET: s.getResponseText().trim(), FREEDCAMP_DEV: dev });
  try {
    rqaFcMe_();
  } catch (err) {
    RQA_FC_KEYS.forEach(function (p) { user.deleteProperty(p); });
    return ui.alert('Freedcamp refused the key: ' + err.message);
  }
  if (before && before !== dev) rqaFcSetDev_(before, false);
  rqaFcSetDev_(dev, true);
  // Whoever made the old shared connection had its triggers; reconnecting personally retires the shared key.
  if (mine.length) RQA_FC_KEYS.forEach(function (p) { PropertiesService.getScriptProperties().deleteProperty(p); });
  mine.forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('rqaOnEditFreedcamp').forSpreadsheet(SpreadsheetApp.getActive()).onEdit().create();
  ScriptApp.newTrigger('rqaSyncFreedcamp').timeBased().everyMinutes(15).create();
  ui.alert('Connected as ' + dev + '. Ticking Freedcamp on ' + dev + '\'s tickets now creates the task from your Freedcamp account (Created by you).');
}

/** Menu: the person running it disconnects their own key. */
function rqaDisconnectFreedcamp() {
  var mine = ScriptApp.getProjectTriggers().filter(function (t) { return /^rqa(OnEditFreedcamp|SyncFreedcamp)$/.test(t.getHandlerFunction()); });
  var user = PropertiesService.getUserProperties(), dev = user.getProperty('FREEDCAMP_DEV');
  if (dev) rqaFcSetDev_(dev, false);
  RQA_FC_KEYS.forEach(function (p) { user.deleteProperty(p); });
  // The person whose triggers used the old shared key also removes that key.
  if (mine.length && !dev) RQA_FC_KEYS.forEach(function (p) { PropertiesService.getScriptProperties().deleteProperty(p); });
  mine.forEach(function (t) { ScriptApp.deleteTrigger(t); });
  SpreadsheetApp.getActive().toast('Freedcamp disconnected' + (dev ? ' for ' + dev : '') + '.', 'Freedcamp', 5);
}

/** One Freedcamp API call with a secured key (HMAC-SHA1 of key + timestamp). Returns the response's data (`whole`: the whole body). */
function rqaFc_(method, path, payload, whole) {
  var keys = rqaFcKeys_();
  if (!keys) throw new Error('Freedcamp is not connected for you (RDC QA > Connect Freedcamp)');
  var key = keys.props.getProperty('FREEDCAMP_API_KEY'), secret = keys.props.getProperty('FREEDCAMP_API_SECRET');
  var opts = { method: method, muteHttpExceptions: true };
  if (payload) { opts.contentType = 'application/json'; opts.payload = JSON.stringify(payload); }
  // Freedcamp answers 429 (too many requests) after many calls in a short time: wait and try again, up to ~15 s.
  for (var attempt = 0, res; ; attempt++) {
    var ts = String(Math.floor(Date.now() / 1000));
    var hash = Utilities.computeHmacSignature(Utilities.MacAlgorithm.HMAC_SHA_1, key + ts, secret)
      .map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
    var url = 'https://freedcamp.com/api/v1/' + path + (path.indexOf('?') >= 0 ? '&' : '?') + 'api_key=' + encodeURIComponent(key) + '&timestamp=' + ts + '&hash=' + hash;
    res = UrlFetchApp.fetch(url, opts);
    if (res.getResponseCode() !== 429 || attempt >= 3) break;
    Utilities.sleep(Math.min(2000 * Math.pow(2, attempt), 20000));
  }
  var body = {};
  try { body = JSON.parse(res.getContentText()); } catch (_) {}
  if (res.getResponseCode() >= 300 || (body.http_code && body.http_code >= 300)) throw new Error('Freedcamp ' + res.getResponseCode() + ': ' + (body.msg || res.getContentText().slice(0, 150)));
  return whole ? body : body.data || {};
}

/**
 * Every task of the project by id, read 200 at a time: one or two calls instead of one per ticket, which keeps
 * a whole-sheet sync under Freedcamp's request limit. A task missing from it is read on its own (rqaFcTask_).
 */
function rqaFcProjectTasks_() {
  var project = encodeURIComponent(rqaSetting_('Freedcamp project ID')), map = {};
  for (var offset = 0, page = 0; page < 25; page++, offset += 200) {
    var body = rqaFc_('get', 'tasks/?project_id=' + project + '&limit=200&offset=' + offset + '&status%5B%5D=0&status%5B%5D=1&status%5B%5D=2', null, true);
    var list = (body.data && body.data.tasks) || [];
    list.forEach(function (t) { if (t && t.id) map[String(t.id)] = t; });
    if (!list.length || !(body.meta && body.meta.has_more)) break;
  }
  return map;
}

/**
 * A reader of tasks by id that loads the whole project once, on first use, and reads any task missing from it alone.
 * When Freedcamp is refusing requests (429), it stops calling at all: reader.limited is set and every read throws,
 * since more calls only keep the limit going.
 */
function rqaFcTaskReader_(notes) {
  var bulk = null;
  var read = function (id) {
    if (read.limited) throw new Error(RQA_FC_LIMITED);
    if (bulk === null) {
      try { bulk = rqaFcProjectTasks_(); } catch (err) {
        bulk = {};
        if (/ 429/.test(err.message)) { read.limited = true; throw new Error(RQA_FC_LIMITED); }
        if (notes) notes.push('Could not read the whole task list at once (' + err.message + '), so tasks were read one by one');
      }
    }
    try { return bulk[String(id)] || (rqaFc_('get', 'tasks/' + id).tasks || [])[0]; } catch (err) {
      if (/ 429/.test(err.message)) { read.limited = true; throw new Error(RQA_FC_LIMITED); }
      throw err;
    }
  };
  read.limited = false;
  read.all = function () {
    if (read.limited) throw new Error(RQA_FC_LIMITED);
    if (bulk === null || !Object.keys(bulk).length) bulk = rqaFcProjectTasks_();
    return bulk;
  };
  return read;
}
var RQA_FC_LIMITED = 'Freedcamp is refusing requests right now (too many requests in a short time). Nothing more was read; try again in 15 to 30 minutes';

/** Freedcamp's users as { id, first, last, full }. Cached 6 h. */
function rqaFcUsers_() {
  // Freedcamp's user objects carry "user_id" (not "id"). The cache key changed with that fix,
  // so a list cached without ids is never reused.
  var cache = CacheService.getScriptCache(), users = JSON.parse(cache.get('fcUsers2') || 'null');
  if (!users) {
    var d = rqaFc_('get', 'users');
    users = (d.users || []).map(function (u) { return { id: u.user_id || u.id, first: String(u.first_name || ''), last: String(u.last_name || ''), full: String(u.full_name || '') }; })
      .filter(function (u) { return u.id; });
    if (!users.length) throw new Error('Freedcamp returned no users with an id');
    cache.put('fcUsers2', JSON.stringify(users), 21600);
  }
  return users;
}

/** Freedcamp user ids by display name ("Meldz A." matches first name Meldz, last name starting with A). */
function rqaFcUserId_(name) {
  if (!name) return null;
  var users = rqaFcUsers_();
  var want = String(name).trim().toLowerCase().replace(/\.$/, '');
  var parts = want.split(/\s+/), lastInitial = parts.length > 1 ? parts[parts.length - 1] : '', first = parts.slice(0, Math.max(parts.length - 1, 1)).join(' ');
  var hit = users.filter(function (u) {
    var full = (u.full || (u.first + ' ' + u.last)).toLowerCase();
    if (full === want) return true;
    return u.first.toLowerCase().indexOf(first) === 0 && (!lastInitial || u.last.toLowerCase().indexOf(lastInitial) === 0);
  })[0];
  return hit ? hit.id : null;
}

/**
 * Installable onEdit. Every connected dev has one; each acts only on its own dev's tickets
 * (the old shared key covers devs who have not connected), so a tick makes exactly one task.
 */
function rqaOnEditFreedcamp(e) {
  if (!e || !e.range || e.range.getNumRows() > 1) return;
  var sh = e.range.getSheet(), name = sh.getName(), r = e.range.getRow(), c = e.range.getColumn();
  if (name === RQA_PARENTS) return rqaParentsEdit_(sh, r, c);
  if (name !== RQA_TICKETS || r < RQA_T.first) return;
  var h = rqaHeaders_(sh, RQA_T.head);
  if (h[RQA_TK.parent] != null && c === h[RQA_TK.parent] + 1) return rqaParentEdited_(sh, h, r);
  if (h[RQA_TK.newSubs] != null && c === h[RQA_TK.newSubs] + 1) return rqaSubtasksEdit_(sh, r, c, false);
  if (e.value !== 'TRUE' || c !== h[RQA_TK.fc] + 1) return;
  var keys = rqaFcKeys_();
  if (!rqaFcHandles_(keys, String(sh.getRange(r, h[RQA_TK.dev] + 1).getValue() || ''))) return;
  var lock = LockService.getDocumentLock();
  lock.waitLock(20000);
  try {
    var title = sh.getRange(r, h[RQA_TK.ticket] + 1).getDisplayValue().trim();
    var task = rqaFcSendRow_(sh, h, r);
    if (!task) return;
    SpreadsheetApp.getActive().toast('Freedcamp task created for ticket ' + title.split('|')[0].trim() + '.' +
      (task.warnings.length ? ' Check: ' + task.warnings.join('; ') + '.' : ''), 'Freedcamp', task.warnings.length ? 12 : 5);
    // Subtasks typed before the ticket had a task.
    var subs = h[RQA_TK.newSubs] != null ? sh.getRange(r, h[RQA_TK.newSubs] + 1) : null;
    if (subs && String(subs.getValue() || '').trim()) { rqaMakeSubtasks_(sh, r, subs, String(subs.getValue()).trim(), false); rqaFcDrainQueue_(keys); }
  } catch (err) {
    sh.getRange(r, h[RQA_TK.fc] + 1).setValue(false);
    SpreadsheetApp.getActive().toast(String(err.message || err), 'Freedcamp failed', 10);
  } finally {
    lock.releaseLock();
  }
}

/** Creates the Freedcamp task of ticket row r and links its Freedcamp cell. Null when it already has one. The caller holds the lock. */
function rqaFcSendRow_(sh, h, r) {
  var g = function (k) { return sh.getRange(r, h[RQA_TK[k]] + 1); }, cell = g('fc'), link = cell.getRichTextValue();
  if (rqaFcTaskId_(link && link.getLinkUrl())) return null;
  var title = g('ticket').getDisplayValue().trim();
  if (!rqaParseTicket_(title)) throw new Error('Type the ticket title first.');
  var task = rqaCreateFreedcampTask_(title, String(g('desc').getValue() || ''), String(g('dev').getValue() || ''), rqaParentId_(sh, h, r));
  cell.clearDataValidations();
  cell.setRichTextValue(SpreadsheetApp.newRichTextValue().setText('Task ' + task.id).setLinkUrl(task.url).build());
  return task;
}

/**
 * The team's fixed recipe: assigned to the ticket's dev (or whoever connected Freedcamp), In Progress,
 * start and due date today, priority High, followers from Settings (Meldz A.).
 */
/** A task's description: the ticket's Description, then the sheet ticket and its branch (HTML, as Freedcamp shows it). */
function rqaFcDescription_(title, description) {
  var esc = function (s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); };
  return (description ? esc(description).replace(/\n/g, '<br>') + '<br><br>' : '') +
    'Sheet ticket: ' + esc(title) + '<br>Branch: ' + BRANCH_NAME(title);
}

function rqaCreateFreedcampTask_(title, description, dev, parentId, opts) {
  var open = opts && opts.open; // unassigned, no dates, status No Progress: for a dev to pick up later
  var project = rqaSetting_('Freedcamp project ID');
  var today = Utilities.formatDate(new Date(), RQA_TZ, 'yyyy-MM-dd');
  var people = open ? rqaFcPeople_('') : rqaFcPeople_(dev);
  if (open) people.warnings = people.warnings.filter(function (w) { return w.indexOf('assigned to you') < 0; });
  var fields = { title: title, description: opts && opts.plain ? String(description || '') : rqaFcDescription_(title, description), project_id: project, priority: Number(rqaSetting_('Freedcamp priority (0-3)')) || 3 };
  if (open) fields.assigned_to_id = '0';
  else { fields.assigned_to_id = people.assignee; fields.start_date = today; fields.due_date = today; }
  if (parentId) fields.h_parent_id = parentId;
  var data = rqaFc_('post', 'tasks', fields);
  var task = (data.tasks || [])[0] || {};
  if (!task.id) throw new Error('Freedcamp did not return the new task');
  if (!open) rqaFc_('post', 'tasks/' + task.id, { status: 2 });
  if (parentId && String(task.h_parent_id || '') !== String(parentId)) {
    var set = rqaFcSetParent_(task.id, parentId);
    if (set !== true) people.warnings.push(set);
  }
  if (people.followers.length) rqaFc_('post', 'tasks/batch', { batch_ids: [Number(task.id)], followers_operation: 'subscribe', follower_ids: people.followers });
  return { id: task.id, url: task.url || ('https://freedcamp.com/view/' + project + '/tasks/' + task.id), warnings: people.warnings };
}

/**
 * Who a ticket's task goes to: the ticket's Dev (by the Freedcamp Name beside it in Settings), else whoever
 * connected Freedcamp; followers from Settings. Names that match no Freedcamp user are listed in warnings.
 */
function rqaFcPeople_(dev) {
  var st = SpreadsheetApp.getActive().getSheetByName(RQA_SETTINGS);
  var devs = rqaListValues_(st, 'Dev'), names = st.getRange(2, RQA_LIST_KEYS.indexOf('Freedcamp Name') + 1, Math.max(devs.length, 1), 1).getValues();
  var fcName = dev && devs.indexOf(dev) >= 0 ? String(names[devs.indexOf(dev)][0] || '') : '';
  var warnings = [];
  var assignee = rqaFcUserId_(fcName);
  if (!assignee) {
    warnings.push(!dev ? 'no Dev on the ticket, assigned to you' : !fcName ? dev + ' has no Freedcamp Name in Settings, assigned to you' : '"' + fcName + '" not found in Freedcamp, assigned to you');
    assignee = rqaFcMe_();
  }
  var followers = [];
  rqaSetting_('Freedcamp followers').split(',').map(function (n) { return n.trim(); }).filter(String).forEach(function (n) {
    var id = rqaFcUserId_(n);
    if (id) followers.push(Number(id)); else warnings.push('follower "' + n + '" not found in Freedcamp');
  });
  return { assignee: String(assignee || 0), followers: followers, warnings: warnings };
}

/** The Freedcamp user id of the key's owner (the running person, or the old shared key's owner). */
function rqaFcMe_() {
  var keys = rqaFcKeys_();
  if (!keys) throw new Error('Freedcamp is not connected for you (RDC QA > Connect Freedcamp)');
  var props = keys.props, me = props.getProperty('FREEDCAMP_ME');
  if (me) return me;
  var d = rqaFc_('get', 'users/current');
  var u = (d.users || [d.user || d])[0] || {};
  me = String(u.user_id || u.id || '');
  if (me) props.setProperty('FREEDCAMP_ME', me);
  return me;
}

/** The Freedcamp task number in a link ("…/tasks/73924306", "…/panel/task/73924306"), a label ending "Task 73924306" or a bare number; '' if none. */
function rqaFcTaskId_(v) {
  var m = String(v || '').match(/\bTask\s+(\d{5,})\s*$/) || String(v || '').match(/tasks?\/(\d+)/) || String(v || '').match(/^\s*(?:Task\s*)?(\d{5,})\s*$/i);
  return m ? m[1] : '';
}

/** The parent task of a ticket's task: its Parent Task cell (link or number), else the task of the ticket it fixes. */
function rqaParentId_(sh, h, r) {
  if (h[RQA_TK.parent] != null) {
    var cell = sh.getRange(r, h[RQA_TK.parent] + 1), rt = cell.getRichTextValue();
    var id = rqaFcTaskId_(rt && rt.getLinkUrl()) || rqaFcTaskId_(cell.getDisplayValue());
    if (id) return id;
  }
  var fixOf = String(sh.getRange(r, h[RQA_TK.fixOf] + 1).getValue() || '').replace(/\D/g, '');
  if (!fixOf) return '';
  var last = rqaLastTicketRow_(sh, h);
  var names = sh.getRange(RQA_T.first, h[RQA_TK.ticket] + 1, last - RQA_T.first + 1, 1).getDisplayValues();
  for (var i = 0; i < names.length; i++) {
    var p = rqaParseTicket_(names[i][0]);
    if (p && String(p.num) === fixOf) {
      var link = sh.getRange(RQA_T.first + i, h[RQA_TK.fc] + 1).getRichTextValue();
      return rqaFcTaskId_(link && link.getLinkUrl());
    }
  }
  return '';
}

/** Makes task `id` a subtask of `parentId`. Returns true, or a warning to show. */
function rqaFcSetParent_(id, parentId) {
  try {
    var d = rqaFc_('post', 'tasks/' + id, { h_parent_id: parentId });
    var t = (d.tasks || [])[0] || {};
    if (t.h_parent_id != null && String(t.h_parent_id) !== String(parentId)) return 'Freedcamp did not make task ' + id + ' a subtask of ' + parentId + ' (are subtasks enabled in the project?)';
    return true;
  } catch (err) { return 'could not make it a subtask of ' + parentId + ': ' + err.message; }
}

/** Parent Task typed or pasted on a ticket whose task already exists: move that task under the new parent. */
function rqaParentEdited_(sh, h, r) {
  var link = sh.getRange(r, h[RQA_TK.fc] + 1).getRichTextValue(), id = rqaFcTaskId_(link && link.getLinkUrl());
  var parentId = rqaParentId_(sh, h, r);
  if (!id || !parentId) return;
  if (!rqaFcHandles_(rqaFcKeys_(), String(sh.getRange(r, h[RQA_TK.dev] + 1).getValue() || ''))) return;
  var res = rqaFcSetParent_(id, parentId);
  SpreadsheetApp.getActive().toast(res === true ? 'Task ' + id + ' is now a subtask of task ' + parentId + '.' : res, 'Freedcamp', res === true ? 5 : 10);
}

/**
 * The 15-minute status sync between Dev Tickets and Freedcamp. `all` = every ticket with a task (with the
 * runner's key); otherwise only the tickets this person's trigger handles.
 *   Passed / Closed ticket -> its task is marked complete.
 *   Task completed in Freedcamp (once per completion) -> No Progress or In Dev becomes Ready for QA, Fixing or
 *   Reworked becomes Ready for Re-test; every other status (Ready for QA, Failed, Ready for Re-test, Passed, Closed)
 *   stays. Closed is only ever set by hand. Reopening the task in Freedcamp lets it happen again next time.
 *   A task this sync completed is reopened when its ticket stops being Passed / Closed.
 */
/** Where a ticket goes when its Freedcamp task is completed; statuses not listed stay as they are. */
var RQA_FC_PULL = {};
RQA_FC_PULL[RQA_S.noProgress] = RQA_S.ready;
RQA_FC_PULL[RQA_S.inDev] = RQA_S.ready;
RQA_FC_PULL[RQA_S.fixing] = RQA_S.retest;
RQA_FC_PULL[RQA_S.reworked] = RQA_S.retest;

function rqaFcTwoWay_(all) {
  var keys = rqaFcKeys_(), sh = SpreadsheetApp.getActive().getSheetByName(RQA_TICKETS);
  var out = { completed: [], ready: [], reopened: [], errors: [] };
  if (!keys || !sh) return out;
  var h = rqaHeaders_(sh, RQA_T.head), n = rqaLastTicketRow_(sh, h) - RQA_T.first + 1;
  if (n < 1) return out;
  var links = sh.getRange(RQA_T.first, h[RQA_TK.fc] + 1, n, 1).getRichTextValues();
  var status = sh.getRange(RQA_T.first, h[RQA_TK.status] + 1, n, 1).getValues();
  var devCol = sh.getRange(RQA_T.first, h[RQA_TK.dev] + 1, n, 1).getValues();
  var names = sh.getRange(RQA_T.first, h[RQA_TK.ticket] + 1, n, 1).getDisplayValues();
  var props = keys.props, done = JSON.parse(props.getProperty('FREEDCAMP_SYNCED') || '{}');
  var sp = PropertiesService.getScriptProperties(), pulled = JSON.parse(sp.getProperty('FREEDCAMP_PULLED') || '{}');
  var completeOn = /^y/i.test(rqaSetting_('Freedcamp: complete task when ticket Passed/Closed'));
  var changed = false, read = rqaFcTaskReader_(null);
  links.forEach(function (row, i) {
    if (read.limited) return; // Freedcamp is refusing requests: try again next run
    var id = rqaFcTaskId_(row[0] && row[0].getLinkUrl());
    if (!id || (!all && !rqaFcHandles_(keys, String(devCol[i][0] || '')))) return;
    var num = String(names[i][0]).split('|')[0].trim(), st = String(status[i][0] || '');
    var finished = st === RQA_S.passed || st === RQA_S.closed;
    try {
      if (finished) {
        if (completeOn && !done[id]) { rqaFc_('post', 'tasks/' + id, { status: 1 }); done[id] = 1; out.completed.push(num); }
        return;
      }
      if (done[id]) { rqaFc_('post', 'tasks/' + id, { status: 2 }); delete done[id]; out.reopened.push(num); return; }
      var next = RQA_FC_PULL[st];
      if (!next && !pulled[id]) return;
      var t = read(id) || {};
      if (String(t.status) === '1') {
        if (!pulled[id] && next) {
          sh.getRange(RQA_T.first + i, h[RQA_TK.status] + 1).setValue(next);
          sh.getRange(RQA_T.first + i, h[RQA_TK.readyAt] + 1).setValue(new Date());
          out.ready.push(num); changed = true;
        }
        pulled[id] = 1;
      } else if (pulled[id]) delete pulled[id];
    } catch (err) { out.errors.push(read.limited ? RQA_FC_LIMITED : num + ': ' + err.message); }
  });
  props.setProperty('FREEDCAMP_SYNCED', JSON.stringify(done));
  sp.setProperty('FREEDCAMP_PULLED', JSON.stringify(pulled));
  if (changed) rqaRefresh();
  if (!all && !read.limited) {
    var cache = CacheService.getScriptCache();
    if (!cache.get('fcParentsAt')) {
      cache.put('fcParentsAt', '1', 840);
      try { rqaRefreshParents_(read.all()); } catch (err) { out.errors.push('Parent Tasks: ' + err.message); }
    }
  }
  return out;
}

/** Every 15 min, per connected dev: the status rules above, for their own tickets. */
function rqaSyncFreedcamp() {
  var lock = LockService.getDocumentLock();
  if (lock.tryLock(30000)) { try { rqaFcDrainQueue_(rqaFcKeys_()); } catch (_) {} finally { lock.releaseLock(); } }
  rqaFcTwoWay_(false);
}

// ================================================================ Sheet -> Freedcamp and Freedcamp -> Sheet

/*
 * The two buttons on Dev Tickets (and the same two menu items). Each asks: only the selected ticket rows, or every
 * ticket; then lists every change it would make and saves nothing until OK. Only tickets with a task link take part.
 *
 *   Sheet -> Freedcamp: the task takes the ticket's name, Description (plus the sheet ticket and branch lines),
 *     Dev (assignee), Date (start and due), Parent Task and status, and the followers from Settings.
 *     Status: Passed / Closed -> Completed (when the Settings switch is Yes), In Dev -> In Progress,
 *     No Progress -> Not Started; Ready for QA, Ready for Re-test, Failed, Fixing and Reworked leave the task's.
 *   Freedcamp -> Sheet: the ticket takes the task's name (only when it is still "<this number> | ..."),
 *     description (without the sheet ticket and branch lines), assignee (as Dev), start date (as Date),
 *     parent task and status.
 *     Status: a completed task moves No Progress / In Dev to Ready for QA and Fixing / Reworked to Ready for
 *     Re-test (once per completion, as the 15-minute sync); a task In Progress moves No Progress to In Dev.
 *     QA's statuses (Failed, Passed, Closed, ...) never change.
 *   An empty value never wipes a filled one: no Dev or Date on the ticket keeps the task's, an unassigned task or
 *   one without dates keeps the ticket's.
 */

var RQA_FC_STATUS_NAMES = { '0': 'Not Started', '1': 'Completed', '2': 'In Progress', '3': 'Invalid', '4': 'Review' };

/** The button and menu item "Sheet -> Freedcamp". */
function rqaFcPushClick() { rqaFcSyncRun_('push'); }
/** The button and menu item "Freedcamp -> Sheet". */
function rqaFcPullClick() { rqaFcSyncRun_('pull'); }
/** The old "Sync Freedcamp" button and menu item, kept so a sheet that still has them works: Freedcamp -> Sheet. */
function rqaSyncFreedcampNow() { rqaFcPullClick(); }
/** The old "Fix Freedcamp task" menu item: Sheet -> Freedcamp. */
function rqaFixFreedcampPeople() { rqaFcPushClick(); }

/** Task status a ticket's status asks for when pushing ('1', '2', '0'), or null to leave the task's. */
function rqaFcPushStatus_(st) {
  if (st === RQA_S.passed || st === RQA_S.closed) return /^y/i.test(rqaSetting_('Freedcamp: complete task when ticket Passed/Closed')) ? '1' : null;
  if (st === RQA_S.inDev) return '2';
  if (st === RQA_S.noProgress) return '0';
  return null;
}

/** A task description as plain text, without the "Sheet ticket: ... Branch: ..." lines this script adds. */
function rqaFcCleanDesc_(html) {
  var s = String(html || '').replace(/\r/g, '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h\d)>/gi, '\n').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&amp;/g, '&');
  return s.replace(/\s*Sheet ticket:[\s\S]*$/, '').replace(/[ \t]+\n/g, '\n').trim();
}
/** Same text, ignoring spacing and line breaks (Freedcamp's editor reflows them). */
function rqaFcSameText_(a, b) { var n = function (s) { return String(s || '').replace(/\s+/g, ' ').trim(); }; return n(a) === n(b); }

/** A task description (HTML) with its "Sheet ticket / Branch" lines replaced by the ones for `title`. */
function rqaFcRefooter_(html, title) {
  var esc = function (s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); };
  var body = String(html || '').replace(/(\s|<br\s*\/?>|<p>\s*<\/p>)*(<p>)?\s*Sheet ticket:[\s\S]*$/i, '');
  return (body ? body + '<br><br>' : '') + 'Sheet ticket: ' + esc(title) + '<br>Branch: ' + BRANCH_NAME(title);
}

/** A Freedcamp timestamp (seconds) as yyyy-MM-dd in Manila time; '' when unset. */
function rqaFcDay_(ts) { return Number(ts) > 0 ? Utilities.formatDate(new Date(Number(ts) * 1000), RQA_TZ, 'yyyy-MM-dd') : ''; }

/** Freedcamp user id -> Dev, from the Dev list and the Freedcamp Name beside each dev in Settings. */
function rqaFcDevByUser_() {
  var st = SpreadsheetApp.getActive().getSheetByName(RQA_SETTINGS);
  var devs = rqaListValues_(st, 'Dev'), names = st.getRange(2, RQA_LIST_KEYS.indexOf('Freedcamp Name') + 1, Math.max(devs.length, 1), 1).getValues();
  var map = {};
  devs.forEach(function (dev, i) { var id = rqaFcUserId_(String(names[i] && names[i][0] || '')); if (id) map[String(id)] = dev; });
  return map;
}

/** The ticket rows (sheet row numbers) in the selection on Dev Tickets. */
function rqaFcSelectedRows_(ss, last) {
  if (ss.getActiveSheet().getName() !== RQA_TICKETS) return [];
  var list = ss.getActiveRangeList(), seen = {}, rows = [];
  if (!list) return rows;
  list.getRanges().forEach(function (rg) {
    for (var r = Math.max(rg.getRow(), RQA_T.first); r <= Math.min(rg.getLastRow(), last); r++) if (!seen[r]) { seen[r] = 1; rows.push(r); }
  });
  return rows;
}

function rqaFcSyncRun_(dir) {
  var ss = SpreadsheetApp.getActive(), ui = SpreadsheetApp.getUi(), sh = ss.getSheetByName(RQA_TICKETS);
  var label = dir === 'push' ? 'Sheet → Freedcamp' : 'Freedcamp → Sheet';
  if (!rqaFcKeys_()) return ui.alert(label, 'Connect Freedcamp first: RDC QA > Connect Freedcamp.', ui.ButtonSet.OK);
  var h = rqaHeaders_(sh, RQA_T.head), last = rqaLastTicketRow_(sh, h);
  if (last < RQA_T.first) return ui.alert(label, 'There are no tickets yet.', ui.ButtonSet.OK);
  var what = dir === 'push' ? 'make the Freedcamp tasks match the sheet' : 'update the sheet from the Freedcamp tasks';
  var rows = rqaFcSelectedRows_(ss, last), all = false;
  if (rows.length) {
    var nums = rows.map(function (r) { return String(sh.getRange(r, h[RQA_TK.ticket] + 1).getDisplayValue()).split('|')[0].trim(); });
    var shown = nums.length > 12 ? nums.slice(0, 12).join(', ') + ' and ' + (nums.length - 12) + ' more' : nums.join(', ');
    var a = ui.alert(label, 'This will ' + what + '.\n\nYes: only the selected ticket(s): ' + shown + '\nNo: every ticket\n\n' +
      'You will see every change before anything is saved.', ui.ButtonSet.YES_NO_CANCEL);
    if (a === ui.Button.NO) all = true; else if (a !== ui.Button.YES) return;
  } else {
    if (ui.alert(label, 'No ticket row is selected. This will ' + what + ' for every ticket.\n\nYou will see every change before anything is saved.',
      ui.ButtonSet.OK_CANCEL) !== ui.Button.OK) return;
    all = true;
  }
  if (all) { rows = []; for (var r = RQA_T.first; r <= last; r++) rows.push(r); }

  ss.toast('Reading ' + rows.length + ' ticket(s) and their Freedcamp tasks…', label, 120);
  var plan = rqaFcPlan_(dir, sh, h, rows, !all);
  if (plan.limited) return ui.alert(label, RQA_FC_LIMITED + '.\n\nNothing was changed.', ui.ButtonSet.OK);
  var changes = plan.items.filter(function (it) { return it.changes.length; });
  var foot = (plan.notes.length ? '\n\nNotes:\n' + plan.notes.slice(0, 15).join('\n') + (plan.notes.length > 15 ? '\n… and ' + (plan.notes.length - 15) + ' more' : '') : '') +
    (plan.stopped ? '\n\nStopped early (time limit) after ticket ' + plan.stopped + ': select the rest and run it again.' : '');
  if (!changes.length) { plan.apply(); return ui.alert(label, 'Everything already matches (' + plan.items.length + ' ticket(s) with a task checked).' + foot, ui.ButtonSet.OK); }
  var lines = changes.map(function (it) { return '#' + it.num + ': ' + it.changes.join('; '); });
  var body = (lines.length > 30 ? lines.slice(0, 30).concat(['… and ' + (lines.length - 30) + ' more ticket(s)']) : lines).join('\n');
  var ok = ui.alert(label + ': ' + changes.length + ' ticket(s) to change', body + foot + '\n\nSave these changes?', ui.ButtonSet.OK_CANCEL);
  if (ok !== ui.Button.OK) return;
  ss.toast('Saving…', label, 120);
  var errors = plan.apply();
  ui.alert(label, 'Done: ' + (changes.length - errors.length) + ' ticket(s) changed.' + (errors.length ? '\n\nCould not save:\n' + errors.join('\n') : ''), ui.ButtonSet.OK);
}

/**
 * Reads each row's ticket and task and works out the changes. Returns { items: [{ num, changes }], notes, stopped,
 * apply() } where apply() saves them and returns the errors. `explain` adds a note for rows without a task.
 */
function rqaFcPlan_(dir, sh, h, rows, explain) {
  var keys = rqaFcKeys_(), tz = SpreadsheetApp.getActive().getSpreadsheetTimeZone(), started = Date.now();
  var done = JSON.parse(keys.props.getProperty('FREEDCAMP_SYNCED') || '{}');
  var sp = PropertiesService.getScriptProperties(), pulled = JSON.parse(sp.getProperty('FREEDCAMP_PULLED') || '{}');
  var devBy = dir === 'pull' ? rqaFcDevByUser_() : null;
  var followers = dir === 'push' ? rqaFcPeople_('').followers : [];
  var items = [], notes = [], stopped = '';
  var get = function (r, k) { return sh.getRange(r, h[RQA_TK[k]] + 1); };
  var read = rqaFcTaskReader_(notes);

  for (var n = 0; n < rows.length; n++) {
    var r = rows[n], title = String(get(r, 'ticket').getDisplayValue()).trim(), num = title.split('|')[0].trim();
    if (!title) continue;
    var link = get(r, 'fc').getRichTextValue(), id = rqaFcTaskId_(link && link.getLinkUrl());
    if (!id) { if (explain) notes.push('#' + num + ': no Freedcamp task yet (tick its Freedcamp box)'); continue; }
    if (Date.now() - started > 4 * 60 * 1000) { stopped = items.length ? items[items.length - 1].num : num; break; }
    var t;
    try { t = read(id); } catch (err) {
      if (read.limited) { notes.push(RQA_FC_LIMITED + '.'); stopped = ''; items.length = 0; break; }
      notes.push('#' + num + ': could not read task ' + id + ' (' + err.message + ')'); continue;
    }
    if (!t) { notes.push('#' + num + ': task ' + id + ' was not found in Freedcamp'); continue; }
    var item = dir === 'push' ? rqaFcPushItem_(sh, h, r, num, title, id, t, tz, notes) : rqaFcPullItem_(sh, h, r, num, title, id, t, tz, notes, devBy, pulled);
    items.push(item);
  }

  return {
    items: items, notes: notes, stopped: stopped, limited: read.limited,
    apply: function () {
      var errors = [], changedSheet = false;
      items.forEach(function (it) {
        try {
          if (it.push) {
            if (Object.keys(it.push.edit).length) rqaFc_('post', 'tasks/' + it.id, it.push.edit);
            if (it.push.parent) { var res = rqaFcSetParent_(it.id, it.push.parent); if (res !== true) errors.push('#' + it.num + ': ' + res); }
            if (it.push.status != null) {
              rqaFc_('post', 'tasks/' + it.id, { status: Number(it.push.status) });
              if (it.push.status === '1') done[it.id] = 1; else delete done[it.id];
            }
            if (it.changes.length && followers.length) rqaFc_('post', 'tasks/batch', { batch_ids: [Number(it.id)], followers_operation: 'subscribe', follower_ids: followers });
          }
          if (it.pull) {
            it.pull.forEach(function (set) { set(); changedSheet = true; });
            if (it.completed) pulled[it.id] = 1; else delete pulled[it.id];
          }
        } catch (err) { errors.push('#' + it.num + ': ' + err.message); }
      });
      keys.props.setProperty('FREEDCAMP_SYNCED', JSON.stringify(done));
      sp.setProperty('FREEDCAMP_PULLED', JSON.stringify(pulled));
      if (changedSheet) rqaRefresh();
      return errors;
    },
  };
}

/** Sheet -> Freedcamp for one ticket: what would change on its task. */
function rqaFcPushItem_(sh, h, r, num, title, id, t, tz, notes) {
  var get = function (k) { return sh.getRange(r, h[RQA_TK[k]] + 1); };
  var item = { num: num, id: id, changes: [], push: { edit: {}, parent: '', status: null } }, edit = item.push.edit;
  var desc = String(get('desc').getValue() || '');
  if (rqaParseTicket_(title)) {
    if (String(t.title || '').trim() !== title) { edit.title = title; item.changes.push('name'); }
    // A description fills an empty task only: the task's own text (often the original request) is never replaced.
    var fcDesc = rqaFcCleanDesc_(t.description);
    if (desc.trim() && !fcDesc) { edit.description = rqaFcDescription_(title, desc); item.changes.push('description'); }
    else {
      if (desc.trim() && !rqaFcSameText_(fcDesc, desc)) notes.push('#' + num + ': the descriptions differ, so the task keeps its own');
      // A renamed ticket: only the "Sheet ticket / Branch" lines at the end of the task's description follow it.
      if (edit.title) edit.description = rqaFcRefooter_(t.description, title);
    }
  } else notes.push('#' + num + ': the ticket has no title, so the task name is left as it is');
  var dev = String(get('dev').getValue() || '');
  if (dev) {
    var people = rqaFcPeople_(dev);
    if (people.warnings.some(function (w) { return w.indexOf('assigned to you') >= 0; })) notes.push('#' + num + ': ' + dev + ' has no Freedcamp user (Settings, Freedcamp Name), assignee left as it is');
    else if (String(t.assigned_to_id) !== String(people.assignee)) { edit.assigned_to_id = people.assignee; item.changes.push('assignee → ' + dev); }
  }
  var date = get('date').getValue();
  if (date instanceof Date) {
    var day = Utilities.formatDate(date, tz, 'yyyy-MM-dd');
    if (rqaFcDay_(t.start_ts) !== day || rqaFcDay_(t.due_ts) !== day) { edit.start_date = edit.due_date = day; item.changes.push('start & due → ' + day); }
  }
  var parent = rqaParentId_(sh, h, r);
  if (parent && String(t.h_parent_id || '') !== parent) { item.push.parent = parent; item.changes.push('subtask of task ' + parent); }
  var want = rqaFcPushStatus_(String(get('status').getValue() || ''));
  if (want != null && String(t.status) !== want) { item.push.status = want; item.changes.push('status → ' + RQA_FC_STATUS_NAMES[want]); }
  return item;
}

/** Freedcamp -> Sheet for one ticket: what would change on its row. */
function rqaFcPullItem_(sh, h, r, num, title, id, t, tz, notes, devBy, pulled) {
  var get = function (k) { return sh.getRange(r, h[RQA_TK[k]] + 1); };
  var item = { num: num, id: id, changes: [], pull: [], completed: String(t.status) === '1' };
  var add = function (text, set) { item.changes.push(text); item.pull.push(set); };
  var fcTitle = String(t.title || '').trim(), p = rqaParseTicket_(fcTitle);
  if (fcTitle && fcTitle !== title) {
    if (p && p.num === num) add('name', function () { get('ticket').setValue(fcTitle); });
    else notes.push('#' + num + ': the task is named "' + fcTitle.slice(0, 60) + '", not "' + num + ' | ...", so the ticket name is left as it is');
  }
  // A description fills an empty ticket only: the ticket's own text (often the dev's notes) is never replaced.
  var fcDesc = rqaFcCleanDesc_(t.description), sheetDesc = String(get('desc').getValue() || '');
  if (fcDesc && !sheetDesc.trim()) add('description', function () { get('desc').setValue(fcDesc); });
  else if (fcDesc && !rqaFcSameText_(fcDesc, sheetDesc)) notes.push('#' + num + ': the descriptions differ, so the ticket keeps its own');
  var who = String(t.assigned_to_id || '0');
  if (who !== '0' && who !== '-1') {
    var dev = devBy[who];
    if (!dev) notes.push('#' + num + ': the task is assigned to ' + (t.assigned_to_fullname || 'user ' + who) + ', who is not in the Dev list, so Dev is left as it is');
    else if (String(get('dev').getValue() || '') !== dev) add('Dev → ' + dev, function () { get('dev').setValue(dev); });
  }
  var day = rqaFcDay_(t.start_ts) || rqaFcDay_(t.due_ts), cur = get('date').getValue();
  if (day && (!(cur instanceof Date) || Utilities.formatDate(cur, tz, 'yyyy-MM-dd') !== day)) {
    add('Date → ' + day, function () { get('date').setValue(new Date(day.replace(/-/g, '/'))); });
  }
  if (h[RQA_TK.parent] != null && 'h_parent_id' in t) {
    var cell = get('parent'), rt = cell.getRichTextValue();
    var had = rqaFcTaskId_(rt && rt.getLinkUrl()) || rqaFcTaskId_(cell.getDisplayValue()), now = String(t.h_parent_id || '').replace(/^0$/, '');
    if (now && now !== had) {
      add('Parent Task → task ' + now, function () { cell.setRichTextValue(rqaParentRich_(now)); });
    } else if (!now && had) add('Parent Task cleared (no longer a subtask)', function () { cell.clearContent(); });
  }
  var st = String(get('status').getValue() || ''), next = '';
  if (item.completed && !pulled[id]) next = RQA_FC_PULL[st] || '';
  else if (String(t.status) === '2' && st === RQA_S.noProgress) next = RQA_S.inDev;
  if (next) add('Status → ' + next, function () {
    get('status').setValue(next);
    if (next === RQA_S.ready || next === RQA_S.retest) get('readyAt').setValue(new Date());
  });
  return item;
}

/** Puts the "Sheet -> Freedcamp" and "Freedcamp -> Sheet" buttons over row 1 of Dev Tickets (above the Freedcamp column), replacing old ones. */
function rqaAddSyncButton_(sh, h) {
  var mine = ['rqaSyncFreedcampNow', 'rqaFcPushClick', 'rqaFcPullClick'];
  sh.getImages().forEach(function (img) { if (mine.indexOf(img.getScript()) >= 0) img.remove(); });
  var col = (h[RQA_TK.fc] != null ? h[RQA_TK.fc] : 7) + 1;
  [[RQA_PUSH_BUTTON_PNG, 'rqaFcPushClick', 'Sheet to Freedcamp', 0], [RQA_PULL_BUTTON_PNG, 'rqaFcPullClick', 'Freedcamp to Sheet', 156]].forEach(function (b) {
    var blob = Utilities.newBlob(Utilities.base64Decode(b[0]), 'image/png', b[1] + '.png');
    sh.insertImage(blob, col, 1, b[3], 0).setWidth(150).setHeight(23).assignScript(b[1]).setAltTextTitle(b[2]);
  });
}

/** Menu: just (re)place the buttons. */
function rqaPlaceSyncButton() { var sh = SpreadsheetApp.getActive().getSheetByName(RQA_TICKETS); rqaAddSyncButton_(sh, rqaHeaders_(sh, RQA_T.head)); }

// ================================================================ subtasks and the Parent Tasks tab

/*
 * Parent Tasks lists every open Freedcamp task of the project that is not a ticket (its title does not start with
 * "12 | "), e.g. a day's "11-07 Daily tasks", plus completed ones a ticket still has as its Parent Task. It refreshes itself from the 15-minute sync (one project read per
 * 15 minutes for everyone), and from RDC QA > Refresh Parent Tasks list.
 *   - Typing a Title on an empty row creates that task in Freedcamp (assigned to the row's Dev, else to you).
 *   - Its hidden "Pick list" column feeds the Parent Task dropdown on Dev Tickets: these tasks and every ticket
 *     with a task, as "<title> — Task <id>".
 *   - New Subtasks (here and on Dev Tickets): one subtask per line. Each line becomes a new ticket under that
 *     parent (Parent Task set, Dev copied, In Dev) and its Freedcamp subtask is created.
 * The New Subtasks edit runs in every connected dev's trigger. Under the document lock, the first one makes the
 * ticket rows and queues their tasks (Script Property FREEDCAMP_QUEUE); each one then creates the queued tasks of
 * its own dev, so "Created by" is that dev. A dev who has not connected is handled by whichever trigger runs.
 */

/** Whether this trigger creates the Freedcamp task of a row owned by `dev`: its own dev's, else anyone's. */
function rqaFcMine_(keys, dev) {
  if (!keys) return false;
  return rqaFreedcampReady_(dev) ? !!rqaFcHandles_(keys, dev) : true;
}

/**
 * A subtask line under a parent of `type` and `page`, as a ticket title without its number:
 *   ('FEAT', 'Settings - Fund Sources', 'Add date filter')        -> 'FEAT: Settings - Fund Sources - Add date filter'
 *   ('FEAT', 'Settings - Fund Sources', 'BUG: Export ignores it') -> 'BUG: Settings - Fund Sources - Export ignores it'
 *   ('', '', 'Check the maps page')                               -> 'TASK: Check the maps page'
 * A line that already names its page ("Main - Sub - Task") keeps it; bullets and "1." are dropped.
 */
function rqaSubtaskTitle_(type, page, line) {
  var s = String(line || '').replace(/^\s*(?:[-*•]+|\d+[.)])\s+/, '').replace(/^\s*\d+\s*\|\s*/, '').trim();
  var m = s.match(/^([A-Z]+(?:\s*\/\s*[A-Z]+)?)\s*:\s*(.+)$/), t = type || 'TASK';
  if (m && m[1].length <= 12) { t = m[1].replace(/\s+/g, ''); s = m[2].trim(); }
  if (page && !/\s-\s/.test(s)) s = page + ' - ' + s;
  return t + ': ' + s;
}

/** The lines of a New Subtasks cell. */
function rqaSubtaskLines_(text) {
  return String(text || '').split(/\r?\n/).map(function (l) { return l.trim(); }).filter(function (l) { return l && !/^[-*•]+$/.test(l); });
}

/** Freedcamp task id -> its Pick list label ("<title> — Task <id>"), read once per run. */
var RQA_PICK_CACHE = null;
function rqaParentChoices_() {
  if (RQA_PICK_CACHE) return RQA_PICK_CACHE;
  var map = {}, ss = SpreadsheetApp.getActive(), sh = ss && ss.getSheetByName(RQA_PARENTS);
  if (sh) {
    var ph = rqaHeaders_(sh, 1);
    if (ph[RQA_PT.pick] != null && sh.getLastRow() > 1) {
      sh.getRange(2, ph[RQA_PT.pick] + 1, sh.getLastRow() - 1, 1).getDisplayValues().forEach(function (r) {
        var m = String(r[0]).match(/\bTask\s+(\d{5,})\s*$/);
        if (m && !map[m[1]]) map[m[1]] = String(r[0]);
      });
    }
  }
  return (RQA_PICK_CACHE = map);
}
/** The text a Parent Task cell shows for a task: its Pick list label, else "Task <id>". */
function rqaParentLabel_(id) { return rqaParentChoices_()[String(id)] || 'Task ' + id; }
function rqaParentRich_(id) {
  return SpreadsheetApp.newRichTextValue().setText(rqaParentLabel_(id))
    .setLinkUrl('https://freedcamp.com/view/' + rqaSetting_('Freedcamp project ID') + '/tasks/' + id).build();
}

/** The Parent Tasks tab: headers, Dev dropdown, the hidden Pick list (formula) and notes. Never deletes rows. */
function rqaSetupParents_(ss, st, tk, th) {
  var sh = rqaTab_(ss, RQA_PARENTS), headers = RQA_PT_ORDER.map(function (k) { return RQA_PT[k]; });
  rqaEnsureHeaders_(sh, headers, 1);
  var ph = rqaHeaders_(sh, 1);
  rqaHeaderStyle_(sh.getRange(1, 1, 1, headers.length));
  ['task', 'assignee', 'status', 'subs'].forEach(function (k) { sh.getRange(1, ph[RQA_PT[k]] + 1).setBackground(RQA_GREY); });
  sh.getRange(1, ph[RQA_PT.title] + 1).setNote('Freedcamp tasks that are not tickets (filled in automatically). Type a title on an empty row to create a new one in Freedcamp, assigned to the Dev on that row (or to you). Rename existing ones in Freedcamp.');
  sh.getRange(1, ph[RQA_PT.newSubs] + 1).setNote('Type subtasks here, one per line (Alt+Enter between lines), then leave the cell. Each line becomes a ticket on Dev Tickets under this task, for the Dev on this row, and its Freedcamp subtask is created. Start a line with BUG: (or another type) to change its type; it is TASK otherwise.');
  sh.getRange(1, ph[RQA_PT.dev] + 1).setNote('Who the new subtasks go to. Filled from the Freedcamp assignee; change it if needed.');
  var widths = { task: 95, title: 320, assignee: 110, status: 95, subs: 95, newSubs: 300, dev: 90 };
  Object.keys(widths).forEach(function (k) { sh.setColumnWidth(ph[RQA_PT[k]] + 1, widths[k]); });
  sh.setFrozenRows(1);
  var rows = Math.max(sh.getMaxRows() - 1, 1);
  sh.getRange(2, ph[RQA_PT.dev] + 1, rows, 1).setDataValidation(rqaListRule_(st, 'Dev'));
  sh.getRange(2, ph[RQA_PT.newSubs] + 1, rows, 1).setWrap(true);
  sh.getRange(2, 1, rows, headers.length).setVerticalAlignment('top');
  // Pick list: this tab's tasks, then every ticket that has a task.
  var L = function (k) { return rqaLetter_(ph[RQA_PT[k]] + 1); };
  var T = "'" + RQA_TICKETS + "'!", tl = rqaLetter_(th[RQA_TK.ticket] + 1), fl = rqaLetter_(th[RQA_TK.fc] + 1), f = RQA_T.first;
  var own = L('title') + '2:' + L('title') + '&" — "&' + L('task') + '2:' + L('task');
  var tix = T + tl + f + ':' + tl + '&" — "&' + T + fl + f + ':' + fl;
  sh.getRange(2, ph[RQA_PT.pick] + 1, rows, 1).clearContent();
  sh.getRange(2, ph[RQA_PT.pick] + 1).setFormula('={IFERROR(FILTER(' + own + ',REGEXMATCH(' + L('task') + '2:' + L('task') + '&"","^Task \\d+$")),"");' +
    'IFERROR(FILTER(' + tix + ',REGEXMATCH(' + T + fl + f + ':' + fl + '&"","^Task \\d+$")),"")}');
  sh.hideColumns(ph[RQA_PT.pick] + 1);
  return { sh: sh, h: ph };
}

/** Rewrites the Parent Tasks list from the project's tasks (id -> task). Keeps typed Dev and New Subtasks, and rows still being created. */
function rqaRefreshParents_(tasks) {
  var ss = SpreadsheetApp.getActive(), sh = ss.getSheetByName(RQA_PARENTS);
  if (!sh || !tasks) return 0;
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(30000)) return 0;
  try {
    var ph = rqaHeaders_(sh, 1), P = {};
    Object.keys(RQA_PT).forEach(function (k) { P[k] = ph[RQA_PT[k]]; });
    var W = Math.max.apply(null, RQA_PT_ORDER.filter(function (k) { return k !== 'pick'; }).map(function (k) { return P[k]; })) + 1;
    var n = Math.max(sh.getLastRow() - 1, 0);
    var old = n ? sh.getRange(2, 1, n, W).getValues() : [], links = n ? sh.getRange(2, P.task + 1, n, 1).getRichTextValues() : [];
    var keep = {}, pending = [];
    old.forEach(function (row, i) {
      var id = rqaFcTaskId_(links[i][0] && links[i][0].getLinkUrl()) || rqaFcTaskId_(row[P.task]);
      if (id) keep[id] = row; else if (String(row[P.title]).trim()) pending.push(row);
    });
    var users = {}, devBy = {};
    try { rqaFcUsers_().forEach(function (u) { users[String(u.id)] = u.full || (u.first + ' ' + u.last).trim(); }); devBy = rqaFcDevByUser_(); } catch (_) {}
    var total = {}, open = {};
    Object.keys(tasks).forEach(function (id) {
      var t = tasks[id], p = String(t.h_parent_id || '').replace(/^0$/, '');
      if (p) { total[p] = (total[p] || 0) + 1; if (String(t.status) !== '1') open[p] = (open[p] || 0) + 1; }
    });
    // Tasks that tickets point to stay listed when completed, so their Parent Task cells still match the dropdown.
    var used = {}, tk = ss.getSheetByName(RQA_TICKETS), th = tk ? rqaHeaders_(tk, RQA_T.head) : {};
    var tn = tk ? rqaLastTicketRow_(tk, th) - RQA_T.first + 1 : 0;
    if (tn > 0 && th[RQA_TK.parent] != null) {
      var pr = tk.getRange(RQA_T.first, th[RQA_TK.parent] + 1, tn, 1), prt = pr.getRichTextValues(), prd = pr.getDisplayValues();
      prt.forEach(function (x, i) { var id = rqaFcTaskId_(x[0] && x[0].getLinkUrl()) || rqaFcTaskId_(prd[i][0]); if (id) used[id] = 1; });
    }
    var list = Object.keys(tasks).map(function (id) { return tasks[id]; }).filter(function (t) {
      return !/^\s*\d+\s*\|/.test(String(t.title || '')) && (String(t.status) !== '1' || open[String(t.id)] || used[String(t.id)]);
    }).sort(function (a, b) { return Number(b.id) - Number(a.id); });
    var rows = list.map(function (t) {
      var id = String(t.id), was = keep[id], a = String(t.assigned_to_id || ''), row = [];
      for (var i = 0; i < W; i++) row.push('');
      row[P.task] = 'Task ' + id; row[P.title] = String(t.title || ''); row[P.assignee] = devBy[a] || users[a] || '';
      row[P.status] = RQA_FC_STATUS_NAMES[String(t.status)] || ''; row[P.subs] = total[id] ? (open[id] || 0) + ' open of ' + total[id] : '';
      row[P.newSubs] = was ? was[P.newSubs] : ''; row[P.dev] = (was && was[P.dev]) || devBy[a] || '';
      return row;
    }).concat(pending);
    if (n) sh.getRange(2, 1, n, W).clearContent();
    if (rows.length) {
      sh.getRange(2, 1, rows.length, W).setValues(rows);
      var project = rqaSetting_('Freedcamp project ID');
      sh.getRange(2, P.task + 1, rows.length, 1).setRichTextValues(rows.map(function (r) {
        var id = rqaFcTaskId_(r[P.task]), b = SpreadsheetApp.newRichTextValue().setText(String(r[P.task]));
        return [(id ? b.setLinkUrl('https://freedcamp.com/view/' + project + '/tasks/' + id) : b).build()];
      }));
    }
    sh.getRange(1, P.task + 1).setNote('Refreshed ' + Utilities.formatDate(new Date(), RQA_TZ, 'MMM d, h:mm a'));
    SpreadsheetApp.flush();
    RQA_PICK_CACHE = null;
    rqaNormalizeParentCells_();
    return list.length;
  } finally {
    lock.releaseLock();
  }
}

/** Every Parent Task cell on Dev Tickets shows its Pick list label and links to its task. */
function rqaNormalizeParentCells_() {
  var sh = SpreadsheetApp.getActive().getSheetByName(RQA_TICKETS), h = rqaHeaders_(sh, RQA_T.head);
  if (h[RQA_TK.parent] == null) return;
  var n = rqaLastTicketRow_(sh, h) - RQA_T.first + 1;
  if (n < 1) return;
  var rg = sh.getRange(RQA_T.first, h[RQA_TK.parent] + 1, n, 1), rts = rg.getRichTextValues(), shown = rg.getDisplayValues();
  rts.forEach(function (r, i) {
    var id = rqaFcTaskId_(r[0] && r[0].getLinkUrl()) || rqaFcTaskId_(shown[i][0]);
    if (id && (shown[i][0] !== rqaParentLabel_(id) || !(r[0] && r[0].getLinkUrl()))) sh.getRange(RQA_T.first + i, h[RQA_TK.parent] + 1).setRichTextValue(rqaParentRich_(id));
  });
}

/** Menu: re-read the project and rewrite the Parent Tasks list. */
function rqaRefreshParentTasks() {
  var ui = SpreadsheetApp.getUi();
  if (!rqaFcKeys_()) return ui.alert('Parent Tasks', 'Connect Freedcamp first: RDC QA > Connect Freedcamp.', ui.ButtonSet.OK);
  try {
    var n = rqaRefreshParents_(rqaFcProjectTasks_());
    SpreadsheetApp.getActive().toast(n + ' parent task(s) listed.', 'Parent Tasks', 5);
  } catch (err) {
    ui.alert('Parent Tasks', / 429/.test(err.message) ? RQA_FC_LIMITED + '.' : err.message, ui.ButtonSet.OK);
  }
}

/** Installable onEdit on Parent Tasks: a new Title creates its Freedcamp task; New Subtasks makes subtask tickets. */
function rqaParentsEdit_(sh, r, c) {
  if (r < 2) return;
  var ph = rqaHeaders_(sh, 1);
  if (c === ph[RQA_PT.newSubs] + 1) return rqaSubtasksEdit_(sh, r, c, true);
  if (c !== ph[RQA_PT.title] + 1) return;
  var keys = rqaFcKeys_(), get = function (k) { return sh.getRange(r, ph[RQA_PT[k]] + 1); };
  var dev = String(get('dev').getValue() || '');
  if (!rqaFcMine_(keys, dev)) return;
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(60000)) return;
  var cell = get('task');
  try {
    var title = String(get('title').getValue() || '').trim();
    if (!title || String(cell.getDisplayValue()).trim()) return; // has (or is getting) a task: renames are done in Freedcamp
    if (/^\s*\d+\s*\|/.test(title)) return SpreadsheetApp.getActive().toast('Tickets go on Dev Tickets; this tab is for tasks that are not tickets.', 'Parent Tasks', 8);
    cell.setValue('Creating…');
    if (!dev && keys.dev) { dev = keys.dev; get('dev').setValue(dev); }
    var task = rqaCreateFreedcampTask_(title, '', dev, null, { plain: true });
    cell.setRichTextValue(SpreadsheetApp.newRichTextValue().setText('Task ' + task.id).setLinkUrl(task.url).build());
    get('status').setValue(RQA_FC_STATUS_NAMES['2']); get('assignee').setValue(dev);
    SpreadsheetApp.getActive().toast('Freedcamp task created: ' + title + '. Type its subtasks in New Subtasks.' +
      (task.warnings.length ? ' Check: ' + task.warnings.join('; ') + '.' : ''), 'Parent Tasks', task.warnings.length ? 12 : 6);
  } catch (err) {
    cell.clearContent();
    SpreadsheetApp.getActive().toast(String(err.message || err), 'Freedcamp failed', 10);
  } finally {
    lock.releaseLock();
  }
}

/** New Subtasks typed on a Dev Tickets row (onParents false) or a Parent Tasks row. Runs in every connected dev's trigger. */
function rqaSubtasksEdit_(sh, r, c, onParents) {
  var keys = rqaFcKeys_();
  if (!keys) return;
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(120000)) return; // the 15-minute sync sends anything left in the queue
  try {
    var cell = sh.getRange(r, c), text = String(cell.getValue() || '').trim();
    if (text) rqaMakeSubtasks_(sh, r, cell, text, onParents);
    rqaFcDrainQueue_(keys);
  } catch (err) {
    SpreadsheetApp.getActive().toast(String(err.message || err), 'Subtasks failed', 10);
  } finally {
    lock.releaseLock();
  }
}

/** Makes one ticket per line under the row's task and queues their Freedcamp tasks. The caller holds the lock. */
function rqaMakeSubtasks_(sh, r, cell, text, onParents) {
  var ss = SpreadsheetApp.getActive(), tk = ss.getSheetByName(RQA_TICKETS), th = rqaHeaders_(tk, RQA_T.head);
  var type = '', page = '', dev, link, label;
  if (onParents) {
    var ph = rqaHeaders_(sh, 1);
    link = sh.getRange(r, ph[RQA_PT.task] + 1).getRichTextValue();
    dev = String(sh.getRange(r, ph[RQA_PT.dev] + 1).getValue() || '');
    label = '"' + String(sh.getRange(r, ph[RQA_PT.title] + 1).getValue()) + '"';
  } else {
    var p = rqaParseTicket_(tk.getRange(r, th[RQA_TK.ticket] + 1).getDisplayValue());
    if (!p) return ss.toast('Type the ticket title first, then the subtasks.', 'Subtasks', 6);
    type = p.type; page = rqaPageOf_(p.title) || p.title; label = '#' + p.num;
    link = tk.getRange(r, th[RQA_TK.fc] + 1).getRichTextValue();
    dev = String(tk.getRange(r, th[RQA_TK.dev] + 1).getValue() || '');
  }
  var url = link && link.getLinkUrl();
  if (!rqaFcTaskId_(url)) {
    return ss.toast(onParents ? 'This row has no Freedcamp task yet. Wait until its Task cell shows a link, then type the subtasks again.'
      : 'Ticket ' + label + ' has no Freedcamp task yet: tick its Freedcamp box and these subtasks are made right after.', 'Subtasks', 10);
  }
  var sp = PropertiesService.getScriptProperties(), q = JSON.parse(sp.getProperty('FREEDCAMP_QUEUE') || '[]'), nums = [];
  rqaSubtaskLines_(text).forEach(function (line) {
    var num = rqaNewTicket_(tk, { title: rqaSubtaskTitle_(type, page, line), dev: dev, parentUrl: url, noLock: true });
    if (!num) return;
    nums.push(num);
    if (dev) q.push({ num: String(num), dev: dev });
  });
  sp.setProperty('FREEDCAMP_QUEUE', JSON.stringify(q));
  cell.clearContent();
  rqaRefresh();
  ss.toast(nums.length + ' subtask ticket(s) made under ' + label + ': #' + nums.join(', #') + '.' +
    (dev ? ' Their Freedcamp subtasks are being created.' : ' Pick their Dev and tick Freedcamp to send them.'), 'Subtasks', 8);
}

/** Creates the queued subtask tasks this trigger owns. The caller holds the lock. */
function rqaFcDrainQueue_(keys) {
  var sp = PropertiesService.getScriptProperties(), q = JSON.parse(sp.getProperty('FREEDCAMP_QUEUE') || '[]');
  if (!q.length || !keys) return;
  var sh = SpreadsheetApp.getActive().getSheetByName(RQA_TICKETS), h = rqaHeaders_(sh, RQA_T.head);
  var n = rqaLastTicketRow_(sh, h) - RQA_T.first + 1;
  var nums = n > 0 ? sh.getRange(RQA_T.first, h[RQA_TK.ticket] + 1, n, 1).getDisplayValues().map(function (v) { return String(v[0]).split('|')[0].trim(); }) : [];
  var left = [], made = [], errors = [], limited = false;
  q.forEach(function (it) {
    if (limited || !rqaFcMine_(keys, it.dev)) return left.push(it);
    var i = nums.indexOf(String(it.num));
    if (i < 0) return;
    try {
      var task = rqaFcSendRow_(sh, h, RQA_T.first + i);
      if (task) made.push('#' + it.num + (task.warnings.length ? ' (' + task.warnings.join('; ') + ')' : ''));
    } catch (err) {
      if (/ 429/.test(err.message)) { limited = true; left.push(it); } else errors.push('#' + it.num + ': ' + err.message);
    }
  });
  sp.setProperty('FREEDCAMP_QUEUE', JSON.stringify(left));
  if (made.length || errors.length) {
    SpreadsheetApp.getActive().toast((made.length ? 'Freedcamp subtasks created: ' + made.join(', ') + '.' : '') +
      (errors.length ? ' Not sent (tick Freedcamp to retry): ' + errors.join('; ') : ''), 'Subtasks', errors.length ? 12 : 6);
  }
}

// The two button images (PNG, 3x), placed by rqaAddSyncButton_.
var RQA_PUSH_BUTTON_PNG = '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';
var RQA_PULL_BUTTON_PNG = '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';
