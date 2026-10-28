/**
 * RDC8 IMS - QA & Dev Tickets spreadsheet script (project "RDC QA").
 *
 * Paste this whole file over Code.gs (Extensions > Apps Script), save, pick rqaSetupSheet and Run once.
 * See docs/SHEET-SETUP.md and docs/WORKFLOW.md in the rdc-tester repo.
 *
 * Tabs: Dashboard | Dev Tickets | Test Cases | QA Dashboard | Dev Dashboard | Check Log | Settings
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
 *   GET  ?token=..&action=tests -> { rows: [ { id, module, title, kind, reference, caseStatus, devTicket, latest } ] }
 *   POST { token, action: 'results', rows: [ { tcId, checker, env, result, notes, screenshot } ] }
 *   POST { token, action: 'sync', tests: [ { id, module, title, kind, steps, expected, reference, pending } ], update }
 *
 * Freedcamp (menu: RDC QA > Connect Freedcamp): ticking a ticket's Freedcamp box creates the task with
 * the team's fixed settings. Parent Task (a Freedcamp task link) makes it a subtask of that task; a fix ticket
 * gets its main ticket's task there automatically. Two-way sync (every 15 min, and the "Sync Freedcamp" button
 * on Dev Tickets): Passed / Closed tickets complete their task; a task completed in Freedcamp sets its ticket to
 * Ready for QA, unless the ticket is already Passed or Closed.
 */

var RQA_DASH = 'Dashboard', RQA_TICKETS = 'Dev Tickets', RQA_CASES = 'Test Cases', RQA_QA = 'QA Dashboard',
  RQA_DEV = 'Dev Dashboard', RQA_LOG = 'Check Log', RQA_SETTINGS = 'Settings';
var RQA_ORDER = [RQA_DASH, RQA_TICKETS, RQA_CASES, RQA_QA, RQA_DEV, RQA_LOG, RQA_SETTINGS];
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
};
var RQA_TK_ORDER = ['ticket', 'branch', 'time', 'date', 'dev', 'status', 'desc', 'fc', 'fix', 'fixOf', 'reworkedBy', 'fixes', 'type', 'page',
  'cases', 'qa', 'lastTested', 'readyAt', 'notes', 'parent'];
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

var RQA_S = { inDev: 'In Dev', ready: 'Ready for QA', passed: 'Passed', failed: 'Failed', fixing: 'Fixing',
  retest: 'Ready for Re-test', reworked: 'Reworked', closed: 'Closed' };
var RQA_LISTS = {
  'Case Status': ['Active', 'Reworked', 'Closed'],
  'Ticket Status': [RQA_S.inDev, RQA_S.ready, RQA_S.failed, RQA_S.fixing, RQA_S.retest, RQA_S.passed, RQA_S.reworked, RQA_S.closed],
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
  'In Dev': '#e8eefc', 'Ready for QA': '#fff3cd', 'Failed': '#f8d7da', 'Fixing': '#fde2c8', 'Ready for Re-test': '#ffe08a',
  'Passed': '#d4edda', 'Reworked': '#e6dcf5', 'Closed': '#e0e0e0',
};
var RQA_RESULT_COLOURS = { 'Pass': '#d4edda', 'Fail': '#f8d7da', 'Blocked': '#fff3cd', 'Not Implemented': '#d6d8f5' };

// ================================================================ menu + simple onEdit

function onOpen() {
  SpreadsheetApp.getUi().createMenu('RDC QA')
    .addItem('Set up / repair spreadsheet', 'rqaSetupSheet')
    .addItem('Refresh statuses', 'rqaRefresh')
    .addItem('Sync test cases from rdc-tester', 'rqaSyncTestsFromRepo')
    .addSeparator()
    .addItem('Connect Freedcamp…', 'rqaConnectFreedcamp')
    .addItem('Fix Freedcamp task: name, assignee, followers & dates (selected tickets)', 'rqaFixFreedcampPeople')
    .addItem('Sync with Freedcamp now (all tickets)', 'rqaSyncFreedcampNow')
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
  var lock = LockService.getDocumentLock();
  lock.waitLock(10000);
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
    set('status', RQA_S.inDev);
    if (opts && opts.dev) set('dev', opts.dev);
    if (opts && opts.fixOf) set('fixOf', Number(opts.fixOf));
    if (opts && opts.parentUrl && h[RQA_TK.parent] != null) {
      sh.getRange(row, h[RQA_TK.parent] + 1).setRichTextValue(SpreadsheetApp.newRichTextValue().setText('Task ' + rqaFcTaskId_(opts.parentUrl)).setLinkUrl(opts.parentUrl).build());
    }
    brain.setValue(num + 1);
    sh.getRange(RQA_T.counter).setValue((num + 1) + ' | ');
    return num;
  } finally {
    lock.releaseLock();
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
  var tabColours = ['#1f2a44', '#2f6fec', '#1e8e3e', '#b7791f', '#c62828', '#5f6b7a', '#9aa3b2'];
  RQA_ORDER.forEach(function (n, i) { ss.getSheetByName(n).setTabColor(tabColours[i]); });
  var blank = ss.getSheetByName('Sheet1');
  if (blank && blank.getLastRow() === 0 && blank.getLastColumn() === 0) ss.deleteSheet(blank);
  rqaRefresh();
  ss.setActiveSheet(ss.getSheetByName(RQA_DASH));
  ss.toast('All tabs are ready.', 'RDC QA', 5);
}

/** Only the Dev Tickets tab: new columns (Parent Task), notes, widths and the Sync Freedcamp button. Dashboards untouched. */
function rqaRepairTickets() {
  var ss = SpreadsheetApp.getActive();
  rqaSetupTickets_(ss, ss.getSheetByName(RQA_SETTINGS));
  rqaRefresh();
  ss.toast('Dev Tickets repaired.', 'RDC QA', 5);
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
  sh.getRange(RQA_T.head, h[RQA_TK.parent] + 1).setNote('Paste a Freedcamp task link (or its number) to make this ticket\'s task a subtask of it. ' +
    'Fix tickets get their main ticket\'s task here automatically. Works before or after the task is sent.');
  rqaAddSyncButton_(sh, h);
  sh.getRange(RQA_T.head, h[RQA_TK.status] + 1).setNote('Dev sets In Dev / Ready for QA. Failed, Fixing, Ready for Re-test and Passed follow the test cases. Reworked / Closed stay as set.');
  sh.setFrozenRows(RQA_T.head); sh.setFrozenColumns(1);
  var widths = { ticket: 380, time: 70, date: 75, dev: 85, status: 120, desc: 240, fc: 85, branch: 300, fix: 45, fixOf: 60, reworkedBy: 85, fixes: 85,
    type: 70, page: 170, cases: 160, qa: 300, lastTested: 130, readyAt: 130, notes: 220, parent: 110 };
  Object.keys(widths).forEach(function (k) { sh.setColumnWidth(h[RQA_TK[k]] + 1, widths[k]); });
  var rows = Math.max(sh.getMaxRows() - RQA_T.first + 1, 1);
  var col = function (k) { return sh.getRange(RQA_T.first, h[RQA_TK[k]] + 1, rows, 1); };
  col('dev').setDataValidation(rqaListRule_(st, 'Dev'));
  col('status').setDataValidation(rqaListRule_(st, 'Ticket Status'));
  // A Freedcamp cell turns into a link once sent, so its checkbox must accept that text.
  col('fc').setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().setAllowInvalid(true).build());
  col('fix').insertCheckboxes();
  col('fixOf').setNumberFormat('0'); col('reworkedBy').setNumberFormat('@');
  col('date').setNumberFormat('mm/dd/yy');
  col('lastTested').setNumberFormat('mmm d, h:mm am/pm'); col('readyAt').setNumberFormat('mmm d, h:mm am/pm');
  ['ticket', 'desc', 'qa', 'cases', 'notes'].forEach(function (k) { col(k).setWrap(true); });
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
      reference: g(r, 'reference'), caseStatus: String(g(r, 'caseStatus') || 'Active'), devTicket: String(g(r, 'devTicket')), latest: g(r, 'result') });
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
  var now = new Date(), folder = null, out = [], skipped = [], unknown = [];
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
    out.push({ it: it, row: row, link: link });
  });
  rqaAppendLog_(out.map(function (o) {
    return { id: o.it.tcId, ticket: o.row.devTicket, who: o.it.checker || 'RDC QA Bot', at: now, env: o.it.env || 'Vercel', result: o.it.result, notes: o.it.notes || '', link: o.link };
  }));
  out.forEach(function (o) {
    var set = function (k, v) { if (C.h[RQA_TC[k]] != null) C.sh.getRange(o.row.row, C.h[RQA_TC[k]] + 1).setValue(v); };
    set('result', o.it.result); set('checkedAt', now); set('testedBy', o.it.checker || 'RDC QA Bot');
    set('notes', o.it.notes || ''); set('shot', o.link);
    if (o.it.result !== 'Blocked') set('implemented', o.it.result === 'Not Implemented' ? 'No' : 'Yes');
  });
  return { ok: true, written: out.length, skippedCancelled: skipped, unknown: unknown };
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

/** One Freedcamp API call with a secured key (HMAC-SHA1 of key + timestamp). Returns the response's data. */
function rqaFc_(method, path, payload) {
  var keys = rqaFcKeys_();
  if (!keys) throw new Error('Freedcamp is not connected for you (RDC QA > Connect Freedcamp)');
  var key = keys.props.getProperty('FREEDCAMP_API_KEY'), secret = keys.props.getProperty('FREEDCAMP_API_SECRET');
  var ts = String(Math.floor(Date.now() / 1000));
  var hash = Utilities.computeHmacSignature(Utilities.MacAlgorithm.HMAC_SHA_1, key + ts, secret)
    .map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
  var url = 'https://freedcamp.com/api/v1/' + path + (path.indexOf('?') >= 0 ? '&' : '?') + 'api_key=' + encodeURIComponent(key) + '&timestamp=' + ts + '&hash=' + hash;
  var opts = { method: method, muteHttpExceptions: true };
  if (payload) { opts.contentType = 'application/json'; opts.payload = JSON.stringify(payload); }
  var res = UrlFetchApp.fetch(url, opts);
  var body = {};
  try { body = JSON.parse(res.getContentText()); } catch (_) {}
  if (res.getResponseCode() >= 300 || (body.http_code && body.http_code >= 300)) throw new Error('Freedcamp ' + res.getResponseCode() + ': ' + (body.msg || res.getContentText().slice(0, 150)));
  return body.data || {};
}

/** Freedcamp user ids by display name ("Meldz A." matches first name Meldz, last name starting with A). Cached 6 h. */
function rqaFcUserId_(name) {
  if (!name) return null;
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
  if (!e || !e.range || e.range.getSheet().getName() !== RQA_TICKETS || e.range.getRow() < RQA_T.first || e.range.getNumRows() > 1) return;
  var sh = e.range.getSheet(), h = rqaHeaders_(sh, RQA_T.head), r = e.range.getRow();
  if (h[RQA_TK.parent] != null && e.range.getColumn() === h[RQA_TK.parent] + 1) return rqaParentEdited_(sh, h, r);
  if (e.value !== 'TRUE' || e.range.getColumn() !== h[RQA_TK.fc] + 1) return;
  if (!rqaFcHandles_(rqaFcKeys_(), String(sh.getRange(r, h[RQA_TK.dev] + 1).getValue() || ''))) return;
  var lock = LockService.getDocumentLock();
  lock.waitLock(20000);
  try {
    var cell = sh.getRange(r, h[RQA_TK.fc] + 1);
    var g = function (k) { return sh.getRange(r, h[RQA_TK[k]] + 1); };
    var title = g('ticket').getDisplayValue().trim();
    if (!rqaParseTicket_(title)) { cell.setValue(false); return SpreadsheetApp.getActive().toast('Type the ticket title first.', 'Freedcamp', 5); }
    var task = rqaCreateFreedcampTask_(title, String(g('desc').getValue() || ''), String(g('dev').getValue() || ''), rqaParentId_(sh, h, r));
    cell.clearDataValidations();
    cell.setRichTextValue(SpreadsheetApp.newRichTextValue().setText('Task ' + task.id).setLinkUrl(task.url).build());
    SpreadsheetApp.getActive().toast('Freedcamp task created for ticket ' + title.split('|')[0].trim() + '.' +
      (task.warnings.length ? ' Check: ' + task.warnings.join('; ') + '.' : ''), 'Freedcamp', task.warnings.length ? 12 : 5);
  } catch (err) {
    sh.getRange(r, h[RQA_TK.fc] + 1).setValue(false);
    SpreadsheetApp.getActive().toast(String(err.message || err), 'Freedcamp failed', 10);
  } finally {
    lock.releaseLock();
  }
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

function rqaCreateFreedcampTask_(title, description, dev, parentId) {
  var project = rqaSetting_('Freedcamp project ID');
  var today = Utilities.formatDate(new Date(), RQA_TZ, 'yyyy-MM-dd');
  var people = rqaFcPeople_(dev);
  var fields = { title: title, description: rqaFcDescription_(title, description), project_id: project, priority: Number(rqaSetting_('Freedcamp priority (0-3)')) || 3,
    assigned_to_id: people.assignee, start_date: today, due_date: today };
  if (parentId) fields.h_parent_id = parentId;
  var data = rqaFc_('post', 'tasks', fields);
  var task = (data.tasks || [])[0] || {};
  if (!task.id) throw new Error('Freedcamp did not return the new task');
  rqaFc_('post', 'tasks/' + task.id, { status: 2 });
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

/**
 * Menu: on the Freedcamp tasks of the selected Dev Tickets rows, set again the name and description (from the ticket),
 * the assignee, the followers,
 * and the start + due date = the ticket's Date cell (the date picked in the sheet).
 */
function rqaFixFreedcampPeople() {
  var ss = SpreadsheetApp.getActive(), sh = ss.getActiveSheet();
  if (sh.getName() !== RQA_TICKETS) return SpreadsheetApp.getUi().alert('Select the ticket rows on the "' + RQA_TICKETS + '" tab first.');
  var h = rqaHeaders_(sh, RQA_T.head), done = [], notes = [], tz = ss.getSpreadsheetTimeZone();
  sh.getActiveRangeList().getRanges().forEach(function (rg) {
    for (var r = Math.max(rg.getRow(), RQA_T.first); r <= rg.getLastRow(); r++) {
      var link = sh.getRange(r, h[RQA_TK.fc] + 1).getRichTextValue(), url = link && link.getLinkUrl(), m = url && url.match(/tasks\/(\d+)/);
      if (!m) continue;
      var people = rqaFcPeople_(String(sh.getRange(r, h[RQA_TK.dev] + 1).getValue() || ''));
      var edit = { assigned_to_id: people.assignee }, date = sh.getRange(r, h[RQA_TK.date] + 1).getValue();
      var title = String(sh.getRange(r, h[RQA_TK.ticket] + 1).getDisplayValue()).trim(), num = title.split('|')[0].trim();
      // A ticket renamed in the sheet: the task takes the new name, and its description the new name and branch.
      if (rqaParseTicket_(title)) {
        edit.title = title;
        edit.description = rqaFcDescription_(title, String(sh.getRange(r, h[RQA_TK.desc] + 1).getValue() || ''));
      } else notes.push('ticket ' + num + ' has no title, so its task name was left as it was');
      if (date instanceof Date) edit.start_date = edit.due_date = Utilities.formatDate(date, tz, 'yyyy-MM-dd');
      else notes.push('ticket ' + num + ' has no Date, so its dates were left as they were');
      rqaFc_('post', 'tasks/' + m[1], edit);
      if (people.followers.length) rqaFc_('post', 'tasks/batch', { batch_ids: [Number(m[1])], followers_operation: 'subscribe', follower_ids: people.followers });
      done.push(m[1]); notes = notes.concat(people.warnings);
    }
  });
  SpreadsheetApp.getUi().alert(done.length ? 'Updated task(s) ' + done.join(', ') + '.' + (notes.length ? '\n\nNote: ' + notes.join('; ') : '') : 'No selected row has a Freedcamp task link.');
}

/** The Freedcamp task number in a link ("…/tasks/73924306", "…/panel/task/73924306") or a bare number; '' if none. */
function rqaFcTaskId_(v) {
  var m = String(v || '').match(/tasks?\/(\d+)/) || String(v || '').match(/^\s*(?:Task\s*)?(\d{5,})\s*$/i);
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
 * Two-way status sync between Dev Tickets and Freedcamp. `all` = every ticket with a task (the button / menu,
 * with the clicker's key); otherwise only the tickets this person's trigger handles.
 *   Passed / Closed ticket -> its task is marked complete.
 *   Task completed in Freedcamp -> the ticket is set to Ready for QA (once per completion), unless it is
 *   already Passed, Closed or Reworked. Reopening the task in Freedcamp lets it happen again next time.
 *   A task this sync completed is reopened when its ticket stops being Passed / Closed.
 */
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
  var changed = false;
  links.forEach(function (row, i) {
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
      if (st === RQA_S.reworked) return;
      var t = (rqaFc_('get', 'tasks/' + id).tasks || [])[0] || {};
      if (String(t.status) === '1') {
        if (!pulled[id] && st !== RQA_S.ready && st !== RQA_S.retest) {
          sh.getRange(RQA_T.first + i, h[RQA_TK.status] + 1).setValue(RQA_S.ready);
          sh.getRange(RQA_T.first + i, h[RQA_TK.readyAt] + 1).setValue(new Date());
          out.ready.push(num); changed = true;
        }
        pulled[id] = 1;
      } else if (pulled[id]) delete pulled[id];
    } catch (err) { out.errors.push(num + ': ' + err.message); }
  });
  props.setProperty('FREEDCAMP_SYNCED', JSON.stringify(done));
  sp.setProperty('FREEDCAMP_PULLED', JSON.stringify(pulled));
  if (changed) rqaRefresh();
  return out;
}

/** Every 15 min, per connected dev: two-way sync of their own tickets. */
function rqaSyncFreedcamp() { rqaFcTwoWay_(false); }

/** The "Sync Freedcamp" button on Dev Tickets and the menu item: two-way sync of every ticket, now. */
function rqaSyncFreedcampNow() {
  var ss = SpreadsheetApp.getActive(), ui = SpreadsheetApp.getUi();
  if (!rqaFcKeys_()) return ui.alert('Connect Freedcamp first: RDC QA > Connect Freedcamp.');
  ss.toast('Checking every ticket\'s Freedcamp task…', 'Freedcamp', 30);
  var o = rqaFcTwoWay_(true);
  var lines = [];
  if (o.completed.length) lines.push('Completed in Freedcamp (ticket Passed/Closed): ' + o.completed.join(', '));
  if (o.ready.length) lines.push('Set to Ready for QA (task completed in Freedcamp): ' + o.ready.join(', '));
  if (o.reopened.length) lines.push('Reopened in Freedcamp (ticket no longer Passed/Closed): ' + o.reopened.join(', '));
  if (o.errors.length) lines.push('Could not check: ' + o.errors.join('; '));
  ui.alert('Freedcamp sync', lines.length ? lines.join('\n\n') : 'Everything already matches.', ui.ButtonSet.OK);
}

/** Puts the "Sync Freedcamp" button over row 1 of Dev Tickets (above the Freedcamp column), replacing an old one. */
function rqaAddSyncButton_(sh, h) {
  sh.getImages().forEach(function (img) { if (img.getScript() === 'rqaSyncFreedcampNow') img.remove(); });
  var blob = Utilities.newBlob(Utilities.base64Decode(RQA_SYNC_BUTTON_PNG), 'image/png', 'sync-freedcamp.png');
  var img = sh.insertImage(blob, (h[RQA_TK.fc] != null ? h[RQA_TK.fc] : 7) + 1, 1);
  img.setWidth(137).setHeight(23).assignScript('rqaSyncFreedcampNow').setAltTextTitle('Sync Freedcamp');
}

/** Menu: just (re)place the button. */
function rqaPlaceSyncButton() { var sh = SpreadsheetApp.getActive().getSheetByName(RQA_TICKETS); rqaAddSyncButton_(sh, rqaHeaders_(sh, RQA_T.head)); }

// The "Sync Freedcamp" button image (PNG, 2x), placed by rqaAddSyncButton_.
var RQA_SYNC_BUTTON_PNG = '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';
