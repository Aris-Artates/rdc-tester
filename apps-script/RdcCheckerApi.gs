/**
 * RDC QA Checker - Google Sheet side.
 *
 * Lives as its OWN FILE next to the sheet's existing script (UsableTickets.gs with onEdit):
 * Extensions > Apps Script > Files "+" > Script, name it "RdcChecker", paste this file, save,
 * reload the sheet, then menu  RDC QA > Set up / repair sheet  once. See docs/SHEET-SETUP.md.
 * Every global here starts with RQA_ / rqa so it never collides with the other file.
 * It never writes to the dev ticket tab ("Usable Tickets - Leyeco"); it only reads it.
 *
 * Web app (Deploy > New deployment > Web app, Execute as: Me, Who has access: Anyone).
 * Every request must carry the token stored in Script Property QA_TOKEN.
 *
 *   GET  ?token=..&action=tests   -> { rows: [ { id, module, title, kind, role, reference, ticketStatus, devTicket, latest } ] }
 *   POST { token, action: 'results', rows: [ { tcId, checker, env, result, notes, screenshot } ] }
 *        -> appends to the Check Log, updates the test's Latest columns and the Dev Tickets tab.
 *           Cancelled tests are refused.
 *   POST { token, action: 'sync', tests: [ { id, module, title, kind, role, steps, expected, reference, pending } ], update }
 *        -> adds tests missing from the Tests tab; refreshes descriptions of active ones. Cancelled rows are left alone.
 */

var RQA_TESTS = 'RDC QA - Tests';
var RQA_LOG = 'RDC QA - Check Log';
var RQA_SUMMARY = 'RDC QA - Summary';
var RQA_TICKETS = 'RDC QA - Dev Tickets';
var RQA_SETTINGS = 'RDC QA - Settings';
var RQA_CANCELLED = 'Cancelled';

// Tests tab columns, by header text. Found by name, so they can be moved.
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
var RQA_TICKET_HEADERS = ['Ticket #', 'Dev Ticket', 'Dev', 'Logged', 'QA Status', 'Linked Tests', 'Active', 'Pass', 'Fail', 'Blocked', 'Not Implemented', 'Not Run', 'Last Checked'];
var RQA_LISTS = {
  'Ticket Status': ['Active', 'On Hold', RQA_CANCELLED],
  'Result': ['Pass', 'Fail', 'Blocked', 'Not Implemented', 'Not Started'],
  'Kind': ['Functional', 'Logic', 'Data', 'Access', 'Pending'],
  'Role': ['public', 'admin', 'member'],
};
var RQA_DEFAULT_SETTINGS = [
  ['Setting', 'Value'],
  ['App under test (Vercel)', 'https://rdc8ims.vercel.app'],
  ['Original site (reference only)', 'https://evims.rdc8ims.online'],
  ['Dev ticket tab', 'Usable Tickets - Leyeco'],
  ['Dev ticket first row', '4'],
  ['Also list dev tickets matching (regex)', ''],
  ['Screenshot folder (Drive)', 'RDC QA Screenshots'],
  ['Ticket Status that the checker skips', RQA_CANCELLED],
  ['Token', 'Stored in Apps Script > Project Settings > Script Properties > QA_TOKEN (never here)'],
];

// ---------------------------------------------------------------- menu + setup

function onOpen() {
  SpreadsheetApp.getUi().createMenu('RDC QA')
    .addItem('Set up / repair sheet', 'rqaSetupSheet')
    .addItem('Refresh dev ticket links', 'rqaRefreshDevTickets')
    .addSeparator()
    .addItem('Cancel selected tests', 'rqaCancelSelected')
    .addItem('Re-activate selected tests', 'rqaActivateSelected')
    .addToUi();
}

/** Creates any missing RDC QA tab, header, dropdown and colour rule. Safe to run again: data is kept. */
function rqaSetupSheet() {
  var ss = SpreadsheetApp.getActive();

  // Settings: dropdown lists (A:D) + settings (F:G). Missing settings rows are appended, never overwritten.
  var st = rqaTab_(ss, RQA_SETTINGS);
  if (st.getLastRow() === 0) {
    var names = Object.keys(RQA_LISTS);
    st.getRange(1, 1, 1, names.length).setValues([names]).setFontWeight('bold');
    names.forEach(function (n, i) { st.getRange(2, i + 1, RQA_LISTS[n].length, 1).setValues(RQA_LISTS[n].map(function (v) { return [v]; })); });
  }
  var have = st.getRange(1, 6, Math.max(st.getLastRow(), 1), 1).getValues().map(function (r) { return r[0]; });
  RQA_DEFAULT_SETTINGS.forEach(function (pair) {
    if (have.indexOf(pair[0]) >= 0) return;
    var r = 1;
    while (have[r - 1] !== undefined && have[r - 1] !== '') r++;
    st.getRange(r, 6, 1, 2).setValues([pair]);
    have[r - 1] = pair[0];
  });
  st.getRange(1, 6, 1, 2).setFontWeight('bold');
  st.setColumnWidth(6, 280); st.setColumnWidth(7, 420);

  // Tests
  var t = rqaTab_(ss, RQA_TESTS);
  rqaEnsureHeaders_(t, RQA_TEST_HEADERS);
  t.setFrozenRows(1); t.setFrozenColumns(1);
  var h = rqaHeaderIndex_(t);
  var rows = Math.max(t.getMaxRows() - 1, 1);
  var list = function (name) { return SpreadsheetApp.newDataValidation().requireValueInRange(st.getRange(rqaListRange_(st, name)), true).setAllowInvalid(false).build(); };
  t.getRange(2, h[RQA_COLS.ticket] + 1, rows, 1).setDataValidation(list('Ticket Status'));
  t.getRange(2, h[RQA_COLS.kind] + 1, rows, 1).setDataValidation(list('Kind'));
  t.getRange(2, h[RQA_COLS.role] + 1, rows, 1).setDataValidation(list('Role'));
  t.getRange(2, h[RQA_COLS.devTicket] + 1, rows, 1).setNumberFormat('@').setNote(null);
  t.getRange(1, h[RQA_COLS.devTicket] + 1).setNote('Ticket number(s) from "' + rqaSetting_('Dev ticket tab') + '", e.g. 2151 or 2151, 2160. Use RDC QA > Refresh dev ticket links after editing.');
  [['id', 90], ['module', 150], ['title', 320], ['steps', 320], ['expected', 320], ['reference', 150], ['ticket', 110], ['devTicket', 100], ['devTitle', 320],
    ['implemented', 110], ['latest', 120], ['checkedAt', 140], ['notes', 380], ['remarks', 220]]
    .forEach(function (p) { t.setColumnWidth(h[RQA_COLS[p[0]]] + 1, p[1]); });
  t.getRange(1, 1, 1, t.getLastColumn()).setFontWeight('bold').setBackground('#1f2a44').setFontColor('#ffffff').setWrap(true);
  // People-owned columns get a gold header so it is clear which cells QA fills in.
  ['reference', 'ticket', 'devTicket', 'remarks'].forEach(function (k) { t.getRange(1, h[RQA_COLS[k]] + 1).setBackground('#8a6d1d'); });
  t.getRange(2, 1, rows, t.getLastColumn()).setVerticalAlignment('top');
  t.getRange(2, h[RQA_COLS.steps] + 1, rows, 2).setWrap(true);
  t.getRange(2, h[RQA_COLS.notes] + 1, rows, 1).setWrap(true);
  t.getRange(2, h[RQA_COLS.devTitle] + 1, rows, 1).setWrap(true);
  rqaColourRules_(t, h, rows);

  // Check Log
  var log = rqaTab_(ss, RQA_LOG);
  rqaEnsureHeaders_(log, RQA_LOG_HEADERS);
  log.setFrozenRows(1);
  log.getRange(1, 1, 1, log.getLastColumn()).setFontWeight('bold').setBackground('#1f2a44').setFontColor('#ffffff');
  log.setColumnWidth(rqaHeaderIndex_(log)['Notes'] + 1, 480);

  rqaBuildSummary_(ss, h);
  rqaRefreshDevTickets();
  ss.toast('RDC QA tabs are ready.', 'Set up', 5);
}

function rqaTab_(ss, name) { return ss.getSheetByName(name) || ss.insertSheet(name); }

function rqaEnsureHeaders_(sh, headers) {
  var have = sh.getLastColumn() ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String) : [];
  if (!have.filter(String).length) { sh.getRange(1, 1, 1, headers.length).setValues([headers]); return; }
  var missing = headers.filter(function (x) { return have.indexOf(x) < 0; });
  if (missing.length) sh.getRange(1, have.length + 1, 1, missing.length).setValues([missing]);
}

function rqaHeaderIndex_(sh) {
  var out = {};
  if (!sh.getLastColumn()) return out;
  sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].forEach(function (v, i) { if (v) out[String(v)] = i; });
  return out;
}

function rqaLetter_(n) { var s = ''; while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }

function rqaListRange_(st, name) {
  var c = st.getRange(1, 1, 1, 4).getValues()[0].indexOf(name) + 1;
  return rqaLetter_(c) + '2:' + rqaLetter_(c);
}

function rqaColourRules_(t, h, rows) {
  var col = function (k) { return rqaLetter_(h[RQA_COLS[k]] + 1); };
  var all = t.getRange(2, 1, rows, t.getLastColumn());
  var latest = t.getRange(2, h[RQA_COLS.latest] + 1, rows, 1);
  var B = SpreadsheetApp.newConditionalFormatRule;
  t.setConditionalFormatRules([
    // A cancelled test greys out the whole row.
    B().whenFormulaSatisfied('=$' + col('ticket') + '2="' + RQA_CANCELLED + '"').setBackground('#e0e0e0').setFontColor('#888888').setStrikethrough(true).setRanges([all]).build(),
    B().whenTextEqualTo('Pass').setBackground('#d4edda').setRanges([latest]).build(),
    B().whenTextEqualTo('Fail').setBackground('#f8d7da').setRanges([latest]).build(),
    B().whenTextEqualTo('Blocked').setBackground('#fff3cd').setRanges([latest]).build(),
    B().whenTextEqualTo('Not Implemented').setBackground('#d6d8f5').setRanges([latest]).build(),
  ]);
}

function rqaBuildSummary_(ss, h) {
  var s = rqaTab_(ss, RQA_SUMMARY);
  s.clear();
  var L = function (k) { var c = rqaLetter_(h[RQA_COLS[k]] + 1); return "'" + RQA_TESTS + "'!" + c + ':' + c; };
  var res = ['Pass', 'Fail', 'Blocked', 'Not Implemented'];
  s.getRange(1, 1, 1, 8).setValues([['Module', 'Active tests'].concat(res).concat(['Not Started', 'Cancelled'])]).setFontWeight('bold');
  s.getRange(2, 1).setFormula('=SORT(UNIQUE(FILTER(' + L('module') + ',ROW(' + L('module') + ')>1,' + L('module') + '<>"")))');
  var active = L('ticket') + ',"<>' + RQA_CANCELLED + '"';
  var cnt = function (m, extra) { return '=IF(' + m + '="","",COUNTIFS(' + L('module') + ',' + m + ',' + active + (extra || '') + '))'; };
  for (var r = 2; r <= 60; r++) {
    var m = 'A' + r;
    s.getRange(r, 2, 1, 7).setFormulas([[
      cnt(m),
      cnt(m, ',' + L('latest') + ',"Pass"'), cnt(m, ',' + L('latest') + ',"Fail"'),
      cnt(m, ',' + L('latest') + ',"Blocked"'), cnt(m, ',' + L('latest') + ',"Not Implemented"'),
      cnt(m, ',' + L('latest') + ',""'),
      '=IF(' + m + '="","",COUNTIFS(' + L('module') + ',' + m + ',' + L('ticket') + ',"' + RQA_CANCELLED + '"))',
    ]]);
  }
  s.setFrozenRows(1); s.setColumnWidth(1, 220);
}

/** Menu: set Ticket Status on the selected Tests rows. */
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

// ---------------------------------------------------------------- dev tickets (read-only)

/** "2151, 2160" / "2151 2160" / "#2151" -> ['2151', '2160'] */
function rqaTicketNums_(v) { return String(v || '').split(/[^0-9]+/).filter(String); }

/**
 * Every ticket on the dev ticket tab: { '2151': { num, title, dev, logged } }.
 * Rows look like "2151 | FEAT: Page - Sub-page - Task" | time | date | dev.
 */
function rqaReadDevTickets_() {
  var name = rqaSetting_('Dev ticket tab') || 'Usable Tickets - Leyeco';
  var sh = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sh) return {};
  var first = Number(rqaSetting_('Dev ticket first row')) || 4;
  var last = sh.getLastRow();
  if (last < first) return {};
  var vals = sh.getRange(first, 1, last - first + 1, 4).getDisplayValues();
  var out = {};
  vals.forEach(function (r) {
    var m = String(r[0]).match(/^\s*(\d+)\s*\|\s*(.*)$/);
    if (m && m[2].trim()) out[m[1]] = { num: m[1], title: m[2].trim(), dev: r[3], logged: (r[2] + ' ' + r[1]).trim() };
  });
  return out;
}

/**
 * Fills "Dev Ticket Title" on the Tests tab and rebuilds the Dev Tickets tab:
 * one row per dev ticket that has QA tests linked (plus, optionally, unlinked tickets
 * matching the "Also list dev tickets matching (regex)" setting), with its QA status.
 */
function rqaRefreshDevTickets() {
  var ss = SpreadsheetApp.getActive();
  var dev = rqaReadDevTickets_();
  var T = rqaReadTests_();
  var tc = T.h[RQA_COLS.devTitle];
  var per = {};
  if (tc != null && T.lastRow > 1) {
    // One write for the whole column; rows without a TC ID keep whatever they had.
    var cell = T.sh.getRange(2, tc + 1, T.lastRow - 1, 1);
    var titles = cell.getValues();
    T.rows.forEach(function (r) {
      var nums = rqaTicketNums_(r.devTicket);
      nums.forEach(function (n) { (per[n] = per[n] || []).push(r); });
      titles[r.row - 2][0] = nums.map(function (n) { return dev[n] ? n + ' | ' + dev[n].title : n + ' | (not found on the ticket tab)'; }).join('\n');
    });
    cell.setValues(titles);
  }
  var re = rqaSetting_('Also list dev tickets matching (regex)');
  if (re) {
    var rx = new RegExp(re, 'i');
    Object.keys(dev).forEach(function (n) { if (!per[n] && rx.test(dev[n].title)) per[n] = []; });
  }
  var out = Object.keys(per).sort(function (a, b) { return Number(b) - Number(a); }).map(function (n) {
    var tests = per[n], active = tests.filter(function (r) { return !rqaIsCancelled_(r); });
    var c = { Pass: 0, Fail: 0, Blocked: 0, 'Not Implemented': 0, '': 0 };
    var last = '';
    active.forEach(function (r) { var k = c.hasOwnProperty(r.latest) ? r.latest : ''; c[k]++; if (r.checkedAt && (!last || r.checkedAt > last)) last = r.checkedAt; });
    var status = !active.length ? 'No QA test yet'
      : c.Fail ? 'Failing'
      : c.Pass === active.length ? 'Verified'
      : c['Not Implemented'] ? 'Not on Vercel yet'
      : c[''] === active.length ? 'Not run yet' : 'Partly checked';
    var d = dev[n] || { title: '(not found on the ticket tab)', dev: '', logged: '' };
    return [Number(n), d.title, d.dev, d.logged, status, tests.map(function (r) { return r.id; }).join(', '),
      active.length, c.Pass, c.Fail, c.Blocked, c['Not Implemented'], c[''], last || ''];
  });
  var s = rqaTab_(ss, RQA_TICKETS);
  s.clear();
  s.getRange(1, 1, 1, RQA_TICKET_HEADERS.length).setValues([RQA_TICKET_HEADERS]).setFontWeight('bold').setBackground('#1f2a44').setFontColor('#ffffff');
  if (out.length) s.getRange(2, 1, out.length, RQA_TICKET_HEADERS.length).setValues(out);
  s.setFrozenRows(1); s.setColumnWidth(2, 420); s.setColumnWidth(6, 220);
  var st = s.getRange(2, 5, Math.max(out.length, 1), 1), B = SpreadsheetApp.newConditionalFormatRule;
  s.setConditionalFormatRules([
    B().whenTextEqualTo('Verified').setBackground('#d4edda').setRanges([st]).build(),
    B().whenTextEqualTo('Failing').setBackground('#f8d7da').setRanges([st]).build(),
    B().whenTextEqualTo('Not on Vercel yet').setBackground('#d6d8f5').setRanges([st]).build(),
    B().whenTextEqualTo('No QA test yet').setBackground('#fff3cd').setRanges([st]).build(),
  ]);
  return out.length;
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

/** The Tests tab as objects, plus each row's sheet row number. */
function rqaReadTests_() {
  var sh = SpreadsheetApp.getActive().getSheetByName(RQA_TESTS);
  if (!sh) throw new Error('No "' + RQA_TESTS + '" tab: run RDC QA > Set up / repair sheet');
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
  if (!log) throw new Error('No "' + RQA_LOG + '" tab: run RDC QA > Set up / repair sheet');
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

function rqaSetting_(name) {
  var st = SpreadsheetApp.getActive().getSheetByName(RQA_SETTINGS);
  if (!st || st.getLastRow() < 2) {
    for (var i = 0; i < RQA_DEFAULT_SETTINGS.length; i++) if (RQA_DEFAULT_SETTINGS[i][0] === name) return RQA_DEFAULT_SETTINGS[i][1];
    return '';
  }
  var v = st.getRange(1, 6, st.getLastRow(), 2).getValues();
  for (var j = 0; j < v.length; j++) if (v[j][0] === name) return String(v[j][1]);
  return '';
}
