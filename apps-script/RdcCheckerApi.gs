/**
 * RDC8 IMS - QA & Dev Tickets spreadsheet script.
 *
 * Paste this whole file into the spreadsheet's Apps Script (Extensions > Apps Script), save,
 * reload the spreadsheet, then menu  RDC QA > Set up / repair spreadsheet  once.
 * See docs/SHEET-SETUP.md in the rdc-tester repo.
 *
 * Tabs (in this order):
 *   Dashboard    QA and dev ticket overview (formulas + charts, rebuilt by Set up)
 *   Dev Tickets  the RDC ticket log: clear A2 to log the next ticket; QA columns fill themselves
 *   QA Tests     one row per checker test; Ticket Status / Dev Ticket / Reference are filled by people
 *   Check Log    one row per check the checker made
 *   Settings     dropdown lists and settings
 *
 * Web app (Deploy > New deployment > Web app, Execute as: Me, Who has access: Anyone).
 * Every request must carry the token stored in Script Property QA_TOKEN.
 *
 *   GET  ?token=..&action=tests   -> { rows: [ { id, module, title, kind, role, reference, ticketStatus, devTicket, latest } ] }
 *   POST { token, action: 'results', rows: [ { tcId, checker, env, result, notes, screenshot } ] }
 *        -> appends to the Check Log, updates the test's Latest columns and the Dev Tickets QA columns.
 *           Cancelled tests are refused.
 *   POST { token, action: 'sync', tests: [ { id, module, title, kind, role, steps, expected, reference, pending } ], update }
 *        -> adds tests missing from QA Tests; refreshes descriptions of active ones. Cancelled rows are left alone.
 */

var RQA_DASH = 'Dashboard';
var RQA_TICKETS = 'Dev Tickets';
var RQA_TESTS = 'QA Tests';
var RQA_LOG = 'Check Log';
var RQA_SETTINGS = 'Settings';
var RQA_ORDER = [RQA_DASH, RQA_TICKETS, RQA_TESTS, RQA_LOG, RQA_SETTINGS];
var RQA_CANCELLED = 'Cancelled';
var RQA_NAVY = '#1f2a44', RQA_GOLD = '#8a6d1d', RQA_GREY = '#5f6b7a';

// ---- QA Tests columns, by header text (found by name, so they can be moved)
var RQA_COLS = {
  id: 'TC ID', module: 'Module', title: 'Test', kind: 'Kind', role: 'Role',
  steps: 'Steps to Test', expected: 'Expected Result', reference: 'Reference (original)',
  ticket: 'Ticket Status', devTicket: 'Dev Ticket', devTitle: 'Dev Ticket Title',
  implemented: 'Implemented on Vercel', latest: 'Latest Result',
  checkedAt: 'Last Checked', notes: 'Last Notes', shot: 'Screenshot', remarks: 'Remarks',
};
var RQA_TEST_HEADERS = ['id', 'module', 'title', 'kind', 'role', 'steps', 'expected', 'reference', 'ticket', 'devTicket', 'devTitle',
  'implemented', 'latest', 'checkedAt', 'notes', 'shot', 'remarks'].map(function (k) { return RQA_COLS[k]; });
var RQA_LOG_HEADERS = ['TC ID', 'Dev Ticket', 'Checker', 'Checked At', 'Environment', 'Result', 'Notes', 'Screenshot'];

// ---- Dev Tickets layout (same idea as the team's "Usable Tickets" tab)
//   A2 = "<next> | " (clear it to log a ticket), G2 = next number. Header row 3, tickets from row 4.
//   A: "123 | TYPE: Page - Sub-page - Task", B: time, C: date, D: dev, E..I: QA (auto), J: notes.
var RQA_T = { first: 4, counter: 'A2', brain: 'G2' };
var RQA_TICKET_HEADERS = ['Ticket', 'Time', 'Date', 'Dev', 'QA Status', 'Linked Tests', 'Pass', 'Fail', 'Last Checked', 'Notes'];
var RQA_TICKET_QA = 5; // first auto column (E); 5 auto columns E..I

var RQA_LISTS = {
  'Ticket Status': ['Active', 'On Hold', RQA_CANCELLED],
  'Result': ['Pass', 'Fail', 'Blocked', 'Not Implemented', 'Not Started'],
  'Kind': ['Functional', 'Logic', 'Data', 'Access', 'Pending'],
  'Role': ['public', 'admin', 'member'],
  'Dev': ['Aris', 'Jondie', 'Shean', 'Kurt'],
};
var RQA_DEFAULT_SETTINGS = [
  ['Setting', 'Value'],
  ['App under test (Vercel)', 'https://rdc8ims.vercel.app'],
  ['Original site (reference only)', 'https://evims.rdc8ims.online'],
  ['First ticket number', '1'],
  ['Screenshot folder (Drive)', 'RDC QA Screenshots'],
  ['Ticket Status that the checker skips', RQA_CANCELLED],
  ['Token', 'Stored in Apps Script > Project Settings > Script Properties > QA_TOKEN (never here)'],
];
var RQA_SET_COL = 7; // settings live in G:H, lists in A:E

// ---------------------------------------------------------------- menu, onEdit

function onOpen() {
  SpreadsheetApp.getUi().createMenu('RDC QA')
    .addItem('Set up / repair spreadsheet', 'rqaSetupSheet')
    .addItem('Refresh dev ticket QA status', 'rqaRefreshDevTickets')
    .addSeparator()
    .addItem('Cancel selected tests', 'rqaCancelSelected')
    .addItem('Re-activate selected tests', 'rqaActivateSelected')
    .addToUi();
}

/** Clearing Dev Tickets!A2 logs the next ticket number with the time and date, like the team's ticket tab. */
function onEdit(e) {
  if (!e || !e.range) return;
  var sh = e.range.getSheet();
  if (sh.getName() !== RQA_TICKETS || e.range.getA1Notation() !== RQA_T.counter) return;
  var v = e.range.getValue();
  if (v && String(v).trim() !== '') return;
  var lock = LockService.getDocumentLock();
  lock.waitLock(10000);
  try {
    var num = Number(sh.getRange(RQA_T.brain).getValue());
    if (!num) return;
    var row = Math.max(sh.getLastRow() + 1, RQA_T.first);
    var now = new Date();
    // The date is a real date (shown mm/dd/yy) so the Dashboard can count tickets per week.
    var today = new Date(Utilities.formatDate(now, 'GMT+8', 'yyyy/MM/dd'));
    sh.getRange(row, 1, 1, 3).setValues([[num + ' | ', Utilities.formatDate(now, 'GMT+8', 'hh:mm a'), today]]);
    sh.getRange(row, 3).setNumberFormat('mm/dd/yy');
    sh.getRange(RQA_T.brain).setValue(num + 1);
    sh.getRange(RQA_T.counter).setValue((num + 1) + ' | ');
  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------- setup

/** Creates or repairs every tab, header, dropdown, colour rule and the Dashboard. Data is never deleted. */
function rqaSetupSheet() {
  var ss = SpreadsheetApp.getActive();
  var st = rqaSetupSettings_(ss);
  var tests = rqaSetupTests_(ss, st);
  rqaSetupLog_(ss);
  rqaSetupTickets_(ss, st);
  rqaBuildDashboard_(ss, tests);
  // Tab order and colours; drop the blank "Sheet1" a new spreadsheet starts with.
  RQA_ORDER.forEach(function (name, i) { ss.setActiveSheet(ss.getSheetByName(name)); ss.moveActiveSheet(i + 1); });
  var colours = {}; colours[RQA_DASH] = RQA_NAVY; colours[RQA_TICKETS] = '#2f6fec'; colours[RQA_TESTS] = '#1e8e3e'; colours[RQA_LOG] = RQA_GREY; colours[RQA_SETTINGS] = '#9aa3b2';
  RQA_ORDER.forEach(function (n) { ss.getSheetByName(n).setTabColor(colours[n]); });
  var blank = ss.getSheetByName('Sheet1');
  if (blank && blank.getLastRow() === 0 && blank.getLastColumn() === 0) ss.deleteSheet(blank);
  rqaRefreshDevTickets();
  ss.setActiveSheet(ss.getSheetByName(RQA_DASH));
  ss.toast('Dashboard, Dev Tickets, QA Tests, Check Log and Settings are ready.', 'RDC QA', 6);
}

function rqaSetupSettings_(ss) {
  var st = rqaTab_(ss, RQA_SETTINGS);
  var names = Object.keys(RQA_LISTS);
  if (st.getRange(1, 1).getValue() === '') {
    st.getRange(1, 1, 1, names.length).setValues([names]);
    names.forEach(function (n, i) { st.getRange(2, i + 1, RQA_LISTS[n].length, 1).setValues(RQA_LISTS[n].map(function (v) { return [v]; })); });
  }
  var have = st.getRange(1, RQA_SET_COL, Math.max(st.getLastRow(), 1), 1).getValues().map(function (r) { return r[0]; });
  RQA_DEFAULT_SETTINGS.forEach(function (pair) {
    if (have.indexOf(pair[0]) >= 0) return;
    var r = 1;
    while (have[r - 1] !== undefined && have[r - 1] !== '') r++;
    st.getRange(r, RQA_SET_COL, 1, 2).setValues([pair]);
    have[r - 1] = pair[0];
  });
  st.getRange(1, 1, 1, names.length).setFontWeight('bold').setBackground(RQA_NAVY).setFontColor('#ffffff');
  st.getRange(1, RQA_SET_COL, 1, 2).setFontWeight('bold').setBackground(RQA_NAVY).setFontColor('#ffffff');
  st.setColumnWidths(1, names.length, 130);
  st.setColumnWidth(RQA_SET_COL, 280); st.setColumnWidth(RQA_SET_COL + 1, 440);
  st.setFrozenRows(1);
  st.getRange(1, RQA_SET_COL + 2).setValue('Edit the lists in columns A:E to change the dropdowns. Add new devs under "Dev".').setFontColor(RQA_GREY).setFontStyle('italic');
  return st;
}

function rqaSetupTests_(ss, st) {
  var t = rqaTab_(ss, RQA_TESTS);
  rqaEnsureHeaders_(t, RQA_TEST_HEADERS);
  t.setFrozenRows(1); t.setFrozenColumns(1);
  var h = rqaHeaderIndex_(t);
  var rows = Math.max(t.getMaxRows() - 1, 1);
  t.getRange(2, h[RQA_COLS.ticket] + 1, rows, 1).setDataValidation(rqaListRule_(st, 'Ticket Status'));
  t.getRange(2, h[RQA_COLS.kind] + 1, rows, 1).setDataValidation(rqaListRule_(st, 'Kind'));
  t.getRange(2, h[RQA_COLS.role] + 1, rows, 1).setDataValidation(rqaListRule_(st, 'Role'));
  t.getRange(2, h[RQA_COLS.devTicket] + 1, rows, 1).setNumberFormat('@');
  t.getRange(1, h[RQA_COLS.devTicket] + 1).setNote('Ticket number(s) from the Dev Tickets tab, e.g. 12 or 12, 15.');
  t.getRange(1, h[RQA_COLS.ticket] + 1).setNote('Cancelled = the checker never runs or updates this test. Active / On Hold = normal.');
  t.getRange(1, h[RQA_COLS.reference] + 1).setNote('Data tests: the value seen on the original site. The checker compares Vercel with it.');
  [['id', 90], ['module', 150], ['title', 320], ['kind', 95], ['role', 75], ['steps', 320], ['expected', 320], ['reference', 150], ['ticket', 110],
    ['devTicket', 95], ['devTitle', 300], ['implemented', 110], ['latest', 120], ['checkedAt', 140], ['notes', 380], ['shot', 110], ['remarks', 220]]
    .forEach(function (p) { t.setColumnWidth(h[RQA_COLS[p[0]]] + 1, p[1]); });
  rqaHeaderStyle_(t.getRange(1, 1, 1, t.getLastColumn()));
  t.setRowHeight(1, 42);
  // People-owned columns get a gold header; checker-owned ones grey.
  ['reference', 'ticket', 'devTicket', 'remarks'].forEach(function (k) { t.getRange(1, h[RQA_COLS[k]] + 1).setBackground(RQA_GOLD); });
  ['devTitle', 'implemented', 'latest', 'checkedAt', 'notes', 'shot'].forEach(function (k) { t.getRange(1, h[RQA_COLS[k]] + 1).setBackground(RQA_GREY); });
  t.getRange(2, 1, rows, t.getLastColumn()).setVerticalAlignment('top');
  ['steps', 'expected', 'notes', 'devTitle', 'title'].forEach(function (k) { t.getRange(2, h[RQA_COLS[k]] + 1, rows, 1).setWrap(true); });
  t.getRange(2, h[RQA_COLS.checkedAt] + 1, rows, 1).setNumberFormat('mmm d, yyyy h:mm am/pm');
  var col = function (k) { return rqaLetter_(h[RQA_COLS[k]] + 1); };
  var latest = t.getRange(2, h[RQA_COLS.latest] + 1, rows, 1), B = SpreadsheetApp.newConditionalFormatRule;
  t.setConditionalFormatRules([
    B().whenFormulaSatisfied('=$' + col('ticket') + '2="' + RQA_CANCELLED + '"').setBackground('#e0e0e0').setFontColor('#888888').setStrikethrough(true)
      .setRanges([t.getRange(2, 1, rows, t.getLastColumn())]).build(),
  ].concat(rqaResultRules_(latest)));
  if (!t.getFilter()) t.getRange(1, 1, t.getMaxRows(), t.getLastColumn()).createFilter();
  return { h: h, col: col };
}

function rqaSetupLog_(ss) {
  var log = rqaTab_(ss, RQA_LOG);
  rqaEnsureHeaders_(log, RQA_LOG_HEADERS);
  log.setFrozenRows(1);
  rqaHeaderStyle_(log.getRange(1, 1, 1, log.getLastColumn()));
  var lh = rqaHeaderIndex_(log);
  [['TC ID', 90], ['Dev Ticket', 95], ['Checker', 120], ['Checked At', 150], ['Environment', 100], ['Result', 120], ['Notes', 520], ['Screenshot', 120]]
    .forEach(function (p) { if (lh[p[0]] != null) log.setColumnWidth(lh[p[0]] + 1, p[1]); });
  var rows = Math.max(log.getMaxRows() - 1, 1);
  log.getRange(2, lh['Checked At'] + 1, rows, 1).setNumberFormat('mmm d, yyyy h:mm am/pm');
  log.getRange(2, lh['Notes'] + 1, rows, 1).setWrap(true);
  log.getRange(2, 1, rows, log.getLastColumn()).setVerticalAlignment('top');
  log.setConditionalFormatRules(rqaResultRules_(log.getRange(2, lh['Result'] + 1, rows, 1)));
}

function rqaSetupTickets_(ss, st) {
  var sh = rqaTab_(ss, RQA_TICKETS);
  if (sh.getRange(3, 1).getValue() === '') {
    var start = Number(rqaSetting_('First ticket number')) || 1;
    sh.getRange(1, 1).setValue('CURRENT USABLE TICKET:');
    sh.getRange(RQA_T.counter).setValue(start + ' | ');
    sh.getRange(2, 6).setValue('DO NOT TOUCH -->');
    sh.getRange(RQA_T.brain).setValue(start);
    sh.getRange(3, 1, 1, RQA_TICKET_HEADERS.length).setValues([RQA_TICKET_HEADERS]);
  }
  sh.getRange(1, 1).setFontWeight('bold').setFontColor(RQA_NAVY);
  sh.getRange(RQA_T.counter).setFontWeight('bold').setFontSize(13).setBackground('#fff3cd')
    .setNote('Clear this cell (Delete key) to log the next ticket. Then type the ticket after the "|" in the new row: "TYPE: Page - Sub-page - Task".');
  sh.getRange(2, 6, 1, 2).setFontColor(RQA_GREY).setFontStyle('italic');
  sh.getRange(1, 3, 1, 8).merge().setValue('FORMAT:  12 | FEAT: Main page - Sub-page - Task      (types: FEAT, BUG, HOTFIX, UI, UIFIX, UX, REF, PERF, CHORE, DOC)')
    .setFontColor(RQA_GREY).setFontStyle('italic');
  rqaHeaderStyle_(sh.getRange(3, 1, 1, RQA_TICKET_HEADERS.length));
  sh.getRange(3, RQA_TICKET_QA, 1, 5).setBackground(RQA_GREY);
  sh.getRange(3, RQA_TICKET_QA).setNote('Filled by the checker from the QA Tests linked to this ticket (column "Dev Ticket" there).');
  sh.setFrozenRows(3);
  [420, 80, 85, 90, 130, 200, 55, 55, 150, 260].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  var rows = Math.max(sh.getMaxRows() - RQA_T.first + 1, 1);
  sh.getRange(RQA_T.first, 4, rows, 1).setDataValidation(rqaListRule_(st, 'Dev'));
  sh.getRange(RQA_T.first, 1, rows, 1).setWrap(true);
  sh.getRange(RQA_T.first, 3, rows, 1).setNumberFormat('mm/dd/yy');
  sh.getRange(RQA_T.first, 9, rows, 1).setNumberFormat('mmm d, yyyy h:mm am/pm');
  sh.getRange(RQA_T.first, 1, rows, RQA_TICKET_HEADERS.length).setVerticalAlignment('top');
  var status = sh.getRange(RQA_T.first, RQA_TICKET_QA, rows, 1), B = SpreadsheetApp.newConditionalFormatRule;
  sh.setConditionalFormatRules([
    B().whenTextEqualTo('Verified').setBackground('#d4edda').setRanges([status]).build(),
    B().whenTextEqualTo('Failing').setBackground('#f8d7da').setRanges([status]).build(),
    B().whenTextEqualTo('Not on Vercel yet').setBackground('#d6d8f5').setRanges([status]).build(),
    B().whenTextEqualTo('No QA test yet').setBackground('#fff3cd').setRanges([status]).build(),
    B().whenTextEqualTo('Partly checked').setBackground('#e8eefc').setRanges([status]).build(),
  ]);
}

/** The Dashboard is formulas over the other tabs, rebuilt on every Set up. */
function rqaBuildDashboard_(ss, tests) {
  var d = rqaTab_(ss, RQA_DASH);
  d.getCharts().forEach(function (c) { d.removeChart(c); });
  d.clear(); d.clearConditionalFormatRules();
  d.setHiddenGridlines(true);
  var T = function (k) { var c = tests.col(k); return "'" + RQA_TESTS + "'!" + c + '2:' + c; };
  var TK = function (c) { return "'" + RQA_TICKETS + "'!" + c + RQA_T.first + ':' + c; };
  var active = T('id') + ',"<>",' + T('ticket') + ',"<>' + RQA_CANCELLED + '"';
  var res = function (r) { return '=COUNTIFS(' + active + ',' + T('latest') + ',"' + r + '")'; };
  var tickets = TK('A') + ',"<>"';

  d.setColumnWidths(1, 8, 112); d.setColumnWidth(9, 24); d.setColumnWidths(10, 5, 120);
  d.getRange('A1:N1').merge().setValue('RDC8 IMS — QA & Dev Tickets').setFontSize(20).setFontWeight('bold').setFontColor('#ffffff').setBackground(RQA_NAVY);
  d.setRowHeight(1, 46);
  d.getRange('A2:N2').merge().setFormula('="Vercel: ' + rqaSetting_('App under test (Vercel)') + '   ·   Original: ' + rqaSetting_('Original site (reference only)') +
    '   ·   Last check: "&IFERROR(TEXT(MAX(' + T('checkedAt') + '),"mmm d, yyyy h:mm am/pm"),"never")').setFontColor(RQA_GREY);

  // KPI cards: label row, then value row.
  var card = function (row, col, label, formula, bg, fmt) {
    d.getRange(row, col).setValue(label).setFontSize(9).setFontWeight('bold').setFontColor(RQA_GREY).setBackground(bg).setHorizontalAlignment('center');
    var v = d.getRange(row + 1, col).setFormula(formula).setFontSize(22).setFontWeight('bold').setBackground(bg).setHorizontalAlignment('center');
    if (fmt) v.setNumberFormat(fmt);
  };
  d.getRange('A4').setValue('QA TESTS').setFontWeight('bold').setFontColor(RQA_NAVY);
  card(5, 1, 'Active tests', '=COUNTIFS(' + active + ')', '#eef1f7');
  card(5, 2, 'Pass', res('Pass'), '#d4edda');
  card(5, 3, 'Fail', res('Fail'), '#f8d7da');
  card(5, 4, 'Blocked', res('Blocked'), '#fff3cd');
  card(5, 5, 'Not Implemented', res('Not Implemented'), '#d6d8f5');
  card(5, 6, 'Not run yet', '=COUNTIFS(' + active + ',' + T('latest') + ',"")', '#eef1f7');
  card(5, 7, 'Pass rate (run)', '=IFERROR(B6/(B6+C6),0)', '#eef1f7', '0%');
  card(5, 8, 'Cancelled', '=COUNTIFS(' + T('ticket') + ',"' + RQA_CANCELLED + '")', '#e0e0e0');

  d.getRange('A8').setValue('DEV TICKETS').setFontWeight('bold').setFontColor(RQA_NAVY);
  var tq = function (s) { return '=COUNTIFS(' + tickets + ',' + TK('E') + ',"' + s + '")'; };
  card(9, 1, 'Tickets logged', '=COUNTIFS(' + tickets + ')', '#eef1f7');
  card(9, 2, 'Verified', tq('Verified'), '#d4edda');
  card(9, 3, 'Failing', tq('Failing'), '#f8d7da');
  card(9, 4, 'Not on Vercel yet', tq('Not on Vercel yet'), '#d6d8f5');
  card(9, 5, 'Partly checked', tq('Partly checked'), '#e8eefc');
  card(9, 6, 'Not run yet', tq('Not run yet'), '#eef1f7');
  card(9, 7, 'No QA test yet', tq('No QA test yet'), '#fff3cd');
  card(9, 8, 'Logged this week', '=COUNTIFS(' + tickets + ',' + TK('C') + ',">="&(TODAY()-WEEKDAY(TODAY(),3)))', '#eef1f7');
  d.getRange('A5:H6').setBorder(true, true, true, true, true, false, '#ffffff', SpreadsheetApp.BorderStyle.SOLID_THICK);
  d.getRange('A9:H10').setBorder(true, true, true, true, true, false, '#ffffff', SpreadsheetApp.BorderStyle.SOLID_THICK);
  d.setRowHeights(6, 1, 40); d.setRowHeights(10, 1, 40);

  // Results by module.
  d.getRange('A12').setValue('RESULTS BY MODULE').setFontWeight('bold').setFontColor(RQA_NAVY);
  d.getRange('A13:H13').setValues([['Module', 'Active', 'Pass', 'Fail', 'Blocked', 'Not Impl.', 'Not run', 'Pass %']]);
  rqaHeaderStyle_(d.getRange('A13:H13'));
  d.getRange('A14').setFormula('=IFERROR(SORT(UNIQUE(FILTER(' + T('module') + ',' + T('module') + '<>""))),"")');
  var byMod = function (m, extra) { return '=IF(' + m + '="","",COUNTIFS(' + T('module') + ',' + m + ',' + active + (extra || '') + '))'; };
  var formulas = [];
  for (var r = 14; r <= 43; r++) {
    var m = '$A' + r, lr = ',' + T('latest') + ',';
    formulas.push([byMod(m), byMod(m, lr + '"Pass"'), byMod(m, lr + '"Fail"'), byMod(m, lr + '"Blocked"'), byMod(m, lr + '"Not Implemented"'),
      byMod(m, lr + '""'), '=IF(' + m + '="","",IFERROR(C' + r + '/(C' + r + '+D' + r + '),""))']);
  }
  d.getRange(14, 2, 30, 7).setFormulas(formulas);
  d.getRange('H14:H43').setNumberFormat('0%');
  d.getRange('B14:H43').setHorizontalAlignment('center');
  var modRows = d.getRange('A14:H43'), B = SpreadsheetApp.newConditionalFormatRule;
  d.setConditionalFormatRules([
    B().whenFormulaSatisfied('=AND($A14<>"",$D14>0)').setBackground('#fbe9eb').setRanges([modRows]).build(),
    B().whenFormulaSatisfied('=AND($A14<>"",$B14>0,$C14=$B14)').setBackground('#e9f6ec').setRanges([modRows]).build(),
  ]);

  // Right column: tickets by dev, then open failures.
  d.getRange('J4').setValue('TICKETS BY DEV').setFontWeight('bold').setFontColor(RQA_NAVY);
  d.getRange('J5:M5').setValues([['Dev', 'Tickets', 'Failing', 'Verified']]);
  rqaHeaderStyle_(d.getRange('J5:M5'));
  d.getRange('J6').setFormula("=IFERROR(FILTER('" + RQA_SETTINGS + "'!E2:E,'" + RQA_SETTINGS + "'!E2:E<>\"\"),\"\")");
  var devF = [];
  for (var dr = 6; dr <= 15; dr++) {
    var dv = '$J' + dr;
    devF.push(['=IF(' + dv + '="","",COUNTIFS(' + TK('D') + ',' + dv + '))', '=IF(' + dv + '="","",COUNTIFS(' + TK('D') + ',' + dv + ',' + TK('E') + ',"Failing"))',
      '=IF(' + dv + '="","",COUNTIFS(' + TK('D') + ',' + dv + ',' + TK('E') + ',"Verified"))']);
  }
  d.getRange(6, 11, 10, 3).setFormulas(devF).setHorizontalAlignment('center');

  d.getRange('J17').setValue('OPEN FAILURES').setFontWeight('bold').setFontColor('#c62828');
  d.getRange('J18:N18').setValues([['TC ID', 'Test', 'Dev Ticket', 'Checked', 'Notes']]);
  rqaHeaderStyle_(d.getRange('J18:N18'));
  d.getRange('J19').setFormula('=IFERROR(ARRAY_CONSTRAIN(SORT(FILTER({' + [T('id'), T('title'), T('devTicket'), T('checkedAt'), T('notes')].join(',') + '},' +
    T('latest') + '="Fail",' + T('ticket') + '<>"' + RQA_CANCELLED + '"),4,FALSE),25,5),"No failing tests")');
  d.getRange('M19:M43').setNumberFormat('mmm d h:mm am/pm');
  d.getRange('J19:N43').setWrap(true).setVerticalAlignment('top').setFontSize(9);

  // Charts: overall results (pie) and results by module (stacked bars).
  d.getRange('P5:Q5').setValues([['Result', 'Tests']]);
  d.getRange('P6:Q10').setFormulas([['="Pass"', '=B6'], ['="Fail"', '=C6'], ['="Blocked"', '=D6'], ['="Not Implemented"', '=E6'], ['="Not run yet"', '=F6']]);
  d.getRange('P5:Q10').setFontColor('#ffffff'); // chart data, kept out of sight
  d.insertChart(d.newChart().setChartType(Charts.ChartType.PIE).addRange(d.getRange('P5:Q10'))
    .setOption('title', 'All active tests').setOption('pieHole', 0.45).setOption('legend', { position: 'right' })
    .setOption('colors', ['#1e8e3e', '#c62828', '#b7791f', '#5b5bd6', '#b0b7c3'])
    .setPosition(45, 1, 0, 0).setOption('width', 440).setOption('height', 280).build());
  d.insertChart(d.newChart().setChartType(Charts.ChartType.BAR).addRange(d.getRange('A13:A14')).addRange(d.getRange('C13:G14'))
    .setOption('title', 'Results by module').setOption('isStacked', true).setOption('legend', { position: 'top' })
    .setOption('colors', ['#1e8e3e', '#c62828', '#b7791f', '#5b5bd6', '#b0b7c3'])
    .setPosition(45, 5, 0, 0).setOption('width', 700).setOption('height', 420).build());
  d.setFrozenRows(2);
  rqaFitModuleChart_();
}

/** The module chart covers exactly the modules listed, so it has no empty bars. Run after every refresh. */
function rqaFitModuleChart_() {
  var d = SpreadsheetApp.getActive().getSheetByName(RQA_DASH);
  if (!d) return;
  var n = d.getRange('A14:A43').getValues().filter(function (r) { return r[0] !== ''; }).length;
  var last = 13 + Math.max(n, 1);
  d.getCharts().forEach(function (c) {
    if (c.getOptions().get('title') !== 'Results by module') return;
    d.updateChart(c.modify().clearRanges().addRange(d.getRange('A13:A' + last)).addRange(d.getRange('C13:G' + last)).build());
  });
}

// ---------------------------------------------------------------- small helpers

function rqaTab_(ss, name) { return ss.getSheetByName(name) || ss.insertSheet(name); }

function rqaEnsureHeaders_(sh, headers) {
  var have = sh.getLastColumn() ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String) : [];
  if (!have.filter(String).length) { sh.getRange(1, 1, 1, headers.length).setValues([headers]); return; }
  var missing = headers.filter(function (x) { return have.indexOf(x) < 0; });
  if (missing.length) sh.getRange(1, have.length + 1, 1, missing.length).setValues([missing]);
}

function rqaHeaderIndex_(sh, row) {
  var out = {}, r = row || 1;
  if (!sh.getLastColumn()) return out;
  sh.getRange(r, 1, 1, sh.getLastColumn()).getValues()[0].forEach(function (v, i) { if (v) out[String(v)] = i; });
  return out;
}

function rqaHeaderStyle_(range) {
  return range.setFontWeight('bold').setBackground(RQA_NAVY).setFontColor('#ffffff').setWrap(true).setVerticalAlignment('middle');
}

function rqaResultRules_(range) {
  var B = SpreadsheetApp.newConditionalFormatRule;
  return [
    B().whenTextEqualTo('Pass').setBackground('#d4edda').setRanges([range]).build(),
    B().whenTextEqualTo('Fail').setBackground('#f8d7da').setRanges([range]).build(),
    B().whenTextEqualTo('Blocked').setBackground('#fff3cd').setRanges([range]).build(),
    B().whenTextEqualTo('Not Implemented').setBackground('#d6d8f5').setRanges([range]).build(),
  ];
}

function rqaLetter_(n) { var s = ''; while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }

function rqaListRule_(st, name) {
  var c = rqaLetter_(st.getRange(1, 1, 1, 5).getValues()[0].indexOf(name) + 1);
  return SpreadsheetApp.newDataValidation().requireValueInRange(st.getRange(c + '2:' + c), true).setAllowInvalid(false).build();
}

/** Menu: set Ticket Status on the selected QA Tests rows. */
function rqaCancelSelected() { rqaSetTicket_(RQA_CANCELLED); }
function rqaActivateSelected() { rqaSetTicket_('Active'); }
function rqaSetTicket_(value) {
  var sh = SpreadsheetApp.getActiveSheet();
  if (sh.getName() !== RQA_TESTS) { SpreadsheetApp.getUi().alert('Select rows on the "' + RQA_TESTS + '" tab first.'); return; }
  var c = rqaHeaderIndex_(sh)[RQA_COLS.ticket] + 1;
  sh.getActiveRangeList().getRanges().forEach(function (r) {
    var first = Math.max(r.getRow(), 2), n = r.getLastRow() - first + 1;
    if (n > 0) sh.getRange(first, c, n, 1).setValue(value);
  });
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

// ---------------------------------------------------------------- dev tickets <-> tests

/** "12, 15" / "12 15" / "#12" -> ['12', '15'] */
function rqaTicketNums_(v) { return String(v || '').split(/[^0-9]+/).filter(String); }

/** Every logged ticket: { '12': { row, title } }. Rows look like "12 | FEAT: Page - Sub-page - Task". */
function rqaReadDevTickets_() {
  var sh = SpreadsheetApp.getActive().getSheetByName(RQA_TICKETS);
  var out = {};
  if (!sh || sh.getLastRow() < RQA_T.first) return out;
  sh.getRange(RQA_T.first, 1, sh.getLastRow() - RQA_T.first + 1, 1).getDisplayValues().forEach(function (r, i) {
    var m = String(r[0]).match(/^\s*(\d+)\s*\|\s*(.*)$/);
    if (m) out[m[1]] = { row: RQA_T.first + i, title: m[2].trim() };
  });
  return out;
}

/**
 * Fills "Dev Ticket Title" on QA Tests and the QA columns (E..I) of every Dev Tickets row:
 * QA Status, Linked Tests, Pass, Fail, Last Checked. A ticket with no linked test says "No QA test yet".
 */
function rqaRefreshDevTickets() {
  var dev = rqaReadDevTickets_();
  var T = rqaReadTests_();
  var per = {};
  var tc = T.h[RQA_COLS.devTitle];
  if (tc != null && T.lastRow > 1) {
    var cell = T.sh.getRange(2, tc + 1, T.lastRow - 1, 1);
    var titles = cell.getValues();
    T.rows.forEach(function (r) {
      var nums = rqaTicketNums_(r.devTicket);
      nums.forEach(function (n) { (per[n] = per[n] || []).push(r); });
      titles[r.row - 2][0] = nums.map(function (n) { return dev[n] ? n + ' | ' + dev[n].title : n + ' | (not on the Dev Tickets tab)'; }).join('\n');
    });
    cell.setValues(titles);
  }
  var sh = SpreadsheetApp.getActive().getSheetByName(RQA_TICKETS);
  var last = sh ? sh.getLastRow() : 0;
  if (last < RQA_T.first) { rqaFitModuleChart_(); return 0; }
  var out = [];
  for (var row = RQA_T.first; row <= last; row++) out.push(['', '', '', '', '']);
  Object.keys(dev).forEach(function (n) {
    var tests = per[n] || [], act = tests.filter(function (r) { return !rqaIsCancelled_(r); });
    var c = { Pass: 0, Fail: 0, Blocked: 0, 'Not Implemented': 0, '': 0 }, at = '';
    act.forEach(function (r) { c[c.hasOwnProperty(r.latest) ? r.latest : '']++; if (r.checkedAt && (!at || r.checkedAt > at)) at = r.checkedAt; });
    var status = !act.length ? 'No QA test yet'
      : c.Fail ? 'Failing'
      : c.Pass === act.length ? 'Verified'
      : c['Not Implemented'] ? 'Not on Vercel yet'
      : c[''] === act.length ? 'Not run yet' : 'Partly checked';
    out[dev[n].row - RQA_T.first] = [status, tests.map(function (r) { return r.id; }).join(', '), act.length ? c.Pass : '', act.length ? c.Fail : '', at];
  });
  sh.getRange(RQA_T.first, RQA_TICKET_QA, out.length, 5).setValues(out);
  SpreadsheetApp.flush();
  rqaFitModuleChart_();
  return Object.keys(dev).length;
}

// ---------------------------------------------------------------- web app

function rqaAuth_(token) {
  var want = PropertiesService.getScriptProperties().getProperty('QA_TOKEN');
  if (!want || token !== want) throw new Error('Bad or missing token');
}
function rqaJson_(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }
function rqaGz_(obj) {
  var gz = Utilities.gzip(Utilities.newBlob(JSON.stringify(obj), 'application/json'));
  return rqaJson_({ ok: true, gz: Utilities.base64Encode(gz.getBytes()) });
}

/** The QA Tests tab as objects, plus each row's sheet row number. */
function rqaReadTests_() {
  var sh = SpreadsheetApp.getActive().getSheetByName(RQA_TESTS);
  if (!sh) throw new Error('No "' + RQA_TESTS + '" tab: run RDC QA > Set up / repair spreadsheet');
  var h = rqaHeaderIndex_(sh);
  var last = sh.getLastRow();
  var vals = last > 1 ? sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues() : [];
  var get = function (r, k) { return h[RQA_COLS[k]] == null ? '' : r[h[RQA_COLS[k]]]; };
  var rows = [];
  vals.forEach(function (r, i) {
    var id = String(get(r, 'id')).trim();
    if (!id) return;
    var at = get(r, 'checkedAt');
    rows.push({ row: i + 2, id: id, module: get(r, 'module'), title: get(r, 'title'), kind: get(r, 'kind'), role: get(r, 'role'),
      reference: get(r, 'reference'), ticketStatus: String(get(r, 'ticket') || 'Active'), devTicket: String(get(r, 'devTicket')),
      latest: get(r, 'latest'), checkedAt: at instanceof Date ? at : '' });
  });
  return { sh: sh, h: h, rows: rows, lastRow: last };
}
function rqaIsCancelled_(r) { return /^cancel+ed$/i.test(String(r.ticketStatus).trim()); }

function doGet(e) {
  try {
    rqaAuth_(e.parameter.token);
    if (e.parameter.action !== 'tests') throw new Error('Unknown action');
    return rqaGz_({ rows: rqaReadTests_().rows.map(function (r) { delete r.row; delete r.checkedAt; return r; }) });
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
    try { rqaRefreshDevTickets(); } catch (err) { out.ticketRefreshError = String(err.message || err); }
    return rqaJson_(out);
  } catch (err) {
    return rqaJson_({ ok: false, error: String(err.message || err) });
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

function rqaWriteResults_(items) {
  var ss = SpreadsheetApp.getActive();
  var T = rqaReadTests_();
  var byId = {};
  T.rows.forEach(function (r) { byId[r.id] = r; });
  var log = ss.getSheetByName(RQA_LOG);
  if (!log) throw new Error('No "' + RQA_LOG + '" tab: run RDC QA > Set up / repair spreadsheet');
  var lh = rqaHeaderIndex_(log);
  var now = new Date();
  var folder = null, out = [], skipped = [], unknown = [];
  items.forEach(function (it) {
    var row = byId[it.tcId];
    if (!row) { unknown.push(it.tcId); return; }
    // The cancel rule: a cancelled test is never updated, whatever the checker sends.
    if (rqaIsCancelled_(row)) { skipped.push(it.tcId); return; }
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
  if (out.length) {
    var start = log.getLastRow() + 1;
    var col = function (name, fn) { if (lh[name] != null) log.getRange(start, lh[name] + 1, out.length, 1).setValues(out.map(function (o) { return [fn(o)]; })); };
    col('TC ID', function (o) { return o.it.tcId; });
    col('Dev Ticket', function (o) { return o.row.devTicket; });
    col('Checker', function (o) { return o.it.checker || 'RDC QA Bot'; });
    col('Checked At', function () { return now; });
    col('Environment', function (o) { return o.it.env || 'Vercel'; });
    col('Result', function (o) { return o.it.result; });
    col('Notes', function (o) { return o.it.notes || ''; });
    col('Screenshot', function (o) { return o.link; });
    out.forEach(function (o) {
      var set = function (k, v) { if (T.h[RQA_COLS[k]] != null) T.sh.getRange(o.row.row, T.h[RQA_COLS[k]] + 1).setValue(v); };
      set('latest', o.it.result); set('checkedAt', now); set('notes', o.it.notes || ''); set('shot', o.link);
      // Blocked says nothing about the feature, so it leaves "Implemented on Vercel" as it was.
      if (o.it.result !== 'Blocked') set('implemented', o.it.result === 'Not Implemented' ? 'No' : 'Yes');
    });
  }
  return { ok: true, written: out.length, skippedCancelled: skipped, unknown: unknown };
}

function rqaSyncTests_(tests, update) {
  var T = rqaReadTests_();
  var byId = {};
  T.rows.forEach(function (r) { byId[r.id] = r; });
  var added = [], updated = [], skipped = [];
  var owned = ['module', 'title', 'kind', 'role', 'steps', 'expected'];
  var width = T.sh.getLastColumn(), newRows = [];
  tests.forEach(function (t) {
    var row = byId[t.id];
    if (!row) {
      var r = []; for (var i = 0; i < width; i++) r.push('');
      var put = function (k, v) { if (T.h[RQA_COLS[k]] != null) r[T.h[RQA_COLS[k]]] = v; };
      owned.forEach(function (k) { put(k, t[k] || ''); });
      put('id', t.id); put('reference', t.reference || ''); put('ticket', 'Active');
      put('implemented', t.pending ? 'No' : '');
      newRows.push(r); added.push(t.id);
      return;
    }
    if (rqaIsCancelled_(row)) { skipped.push(t.id); return; }
    if (!update) return;
    var cur = T.sh.getRange(row.row, 1, 1, width).getValues()[0];
    var changed = false;
    owned.forEach(function (k) {
      var c = T.h[RQA_COLS[k]];
      if (c != null && String(cur[c]) !== String(t[k] || '')) { T.sh.getRange(row.row, c + 1).setValue(t[k] || ''); changed = true; }
    });
    var rc = T.h[RQA_COLS.reference];
    if (rc != null && t.reference && String(cur[rc]) === '') { T.sh.getRange(row.row, rc + 1).setValue(t.reference); changed = true; }
    if (changed) updated.push(t.id);
  });
  if (newRows.length) T.sh.getRange(T.lastRow + 1, 1, newRows.length, width).setValues(newRows);
  return { ok: true, added: added, updated: updated, skippedCancelled: skipped };
}
