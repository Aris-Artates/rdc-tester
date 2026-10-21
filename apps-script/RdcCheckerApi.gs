/**
 * RDC Checker - Google Sheet side.
 *
 * Paste this whole file into the sheet's Apps Script (Extensions > Apps Script), save, reload the
 * sheet, then use the menu  RDC Checker > Set up / repair sheet  once. See docs/SHEET-SETUP.md.
 *
 * Web app (Deploy > New deployment > Web app, Execute as: Me, Who has access: Anyone).
 * Every request must carry the token stored in Script Property QA_TOKEN.
 *
 *   GET  ?token=..&action=tests   -> { rows: [ { id, module, title, kind, role, reference, ticketStatus, latest } ] }
 *   POST { token, action: 'results', rows: [ { tcId, checker, env, result, notes, screenshot } ] }
 *        -> appends to Check Log and updates the test's Latest columns. Cancelled tickets are refused.
 *   POST { token, action: 'sync', tests: [ { id, module, title, kind, role, steps, expected, reference, pending } ], update }
 *        -> adds tests missing from the Tests tab; refreshes descriptions of active ones. Cancelled rows are left alone.
 */

var TESTS = 'Tests';
var LOG = 'Check Log';
var TEAM = 'Team';
var SETTINGS = 'Settings';
var SUMMARY = 'Summary';
var CANCELLED = 'Cancelled';

// Tests tab columns, by header text. The code finds them by name, so they can be moved.
var COLS = {
  id: 'TC ID', module: 'Module', title: 'Test', kind: 'Kind', role: 'Role',
  steps: 'Steps to Test', expected: 'Expected Result', reference: 'Reference (original)',
  ticket: 'Ticket Status', implemented: 'Implemented on Vercel', latest: 'Latest Result',
  checkedAt: 'Last Checked', notes: 'Last Notes', shot: 'Screenshot', remarks: 'Remarks',
};
var TEST_HEADERS = ['id', 'module', 'title', 'kind', 'role', 'steps', 'expected', 'reference', 'ticket', 'implemented', 'latest', 'checkedAt', 'notes', 'shot', 'remarks'].map(function (k) { return COLS[k]; });
var LOG_HEADERS = ['TC ID', 'Checker', 'Checked At', 'Environment', 'Result', 'Notes', 'Screenshot'];
var LISTS = {
  'Ticket Status': ['Active', 'On Hold', CANCELLED],
  'Result': ['Pass', 'Fail', 'Blocked', 'Not Implemented', 'Not Started'],
  'Kind': ['Functional', 'Logic', 'Data', 'Access', 'Pending'],
  'Role': ['public', 'admin', 'member'],
};

// ---------------------------------------------------------------- menu + setup

function onOpen() {
  SpreadsheetApp.getUi().createMenu('RDC Checker')
    .addItem('Set up / repair sheet', 'setupSheet')
    .addItem('Cancel selected tickets', 'cancelSelected')
    .addItem('Re-activate selected tickets', 'activateSelected')
    .addToUi();
}

/** Creates any missing tab, header, dropdown and colour rule. Safe to run again: data is kept. */
function setupSheet() {
  var ss = SpreadsheetApp.getActive();

  // Settings: dropdown lists (edit them here) + reference info.
  var st = tab_(ss, SETTINGS);
  if (st.getLastRow() === 0) {
    var names = Object.keys(LISTS);
    st.getRange(1, 1, 1, names.length).setValues([names]).setFontWeight('bold');
    names.forEach(function (n, i) { st.getRange(2, i + 1, LISTS[n].length, 1).setValues(LISTS[n].map(function (v) { return [v]; })); });
    st.getRange(1, 6, 6, 2).setValues([
      ['Setting', 'Value'],
      ['App under test (Vercel)', 'https://rdc8ims.vercel.app'],
      ['Original site (reference only)', 'https://evims.rdc8ims.online'],
      ['Screenshot folder (Drive)', 'RDC QA Screenshots'],
      ['Ticket Status that the checker skips', CANCELLED],
      ['Token', 'Stored in Apps Script > Project Settings > Script Properties > QA_TOKEN (never here)'],
    ]);
    st.getRange(1, 6, 1, 2).setFontWeight('bold');
    st.setColumnWidth(6, 260); st.setColumnWidth(7, 420);
  }

  // Tests
  var t = tab_(ss, TESTS);
  ensureHeaders_(t, TEST_HEADERS);
  t.setFrozenRows(1); t.setFrozenColumns(1);
  var h = headerIndex_(t);
  var rows = Math.max(t.getMaxRows() - 1, 1);
  var list = function (name) { return SpreadsheetApp.newDataValidation().requireValueInRange(st.getRange(listRange_(st, name)), true).setAllowInvalid(false).build(); };
  t.getRange(2, h[COLS.ticket] + 1, rows, 1).setDataValidation(list('Ticket Status'));
  t.getRange(2, h[COLS.kind] + 1, rows, 1).setDataValidation(list('Kind'));
  t.getRange(2, h[COLS.role] + 1, rows, 1).setDataValidation(list('Role'));
  [['id', 90], ['module', 150], ['title', 320], ['steps', 320], ['expected', 320], ['reference', 150], ['ticket', 110], ['implemented', 110], ['latest', 120], ['checkedAt', 140], ['notes', 380], ['remarks', 220]]
    .forEach(function (p) { t.setColumnWidth(h[COLS[p[0]]] + 1, p[1]); });
  t.getRange(1, 1, 1, TEST_HEADERS.length).setFontWeight('bold').setBackground('#1f2a44').setFontColor('#ffffff').setWrap(true);
  // QA-owned columns get a light yellow header so it is clear which cells people fill in.
  ['reference', 'ticket', 'remarks'].forEach(function (k) { t.getRange(1, h[COLS[k]] + 1).setBackground('#8a6d1d'); });
  t.getRange(2, 1, rows, TEST_HEADERS.length).setVerticalAlignment('top');
  t.getRange(2, h[COLS.steps] + 1, rows, 2).setWrap(true);
  t.getRange(2, h[COLS.notes] + 1, rows, 1).setWrap(true);
  colourRules_(t, h, rows);

  // Check Log
  var log = tab_(ss, LOG);
  ensureHeaders_(log, LOG_HEADERS);
  log.setFrozenRows(1);
  log.getRange(1, 1, 1, LOG_HEADERS.length).setFontWeight('bold').setBackground('#1f2a44').setFontColor('#ffffff');
  log.setColumnWidth(6, 480);

  // Team
  var team = tab_(ss, TEAM);
  if (team.getLastRow() === 0) {
    team.getRange(1, 1, 2, 3).setValues([['Name', 'Email', 'Role'], ['RDC QA Bot', '', 'Automated checker (CHECKER_NAME in .env)']]);
    team.getRange(1, 1, 1, 3).setFontWeight('bold');
  }

  buildSummary_(ss, h);
  SpreadsheetApp.getActive().toast('RDC Checker sheet is ready.', 'Set up', 5);
}

function tab_(ss, name) { return ss.getSheetByName(name) || ss.insertSheet(name); }

function ensureHeaders_(sh, headers) {
  var have = sh.getLastColumn() ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String) : [];
  var missing = headers.filter(function (x) { return have.indexOf(x) < 0; });
  if (!have.filter(String).length) { sh.getRange(1, 1, 1, headers.length).setValues([headers]); return; }
  if (missing.length) sh.getRange(1, have.length + 1, 1, missing.length).setValues([missing]);
}

function headerIndex_(sh) {
  var out = {};
  sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].forEach(function (v, i) { if (v) out[String(v)] = i; });
  return out;
}

function listRange_(st, name) {
  var head = st.getRange(1, 1, 1, 4).getValues()[0];
  var c = head.indexOf(name) + 1;
  var col = String.fromCharCode(64 + c);
  return col + '2:' + col;
}

function colourRules_(t, h, rows) {
  var letter = function (k) { var n = h[COLS[k]] + 1, s = ''; while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
  var all = t.getRange(2, 1, rows, TEST_HEADERS.length);
  var latest = t.getRange(2, h[COLS.latest] + 1, rows, 1);
  var B = SpreadsheetApp.newConditionalFormatRule;
  t.setConditionalFormatRules([
    // A cancelled ticket greys out the whole row.
    B().whenFormulaSatisfied('=$' + letter('ticket') + '2="' + CANCELLED + '"').setBackground('#e0e0e0').setFontColor('#888888').setStrikethrough(true).setRanges([all]).build(),
    B().whenTextEqualTo('Pass').setBackground('#d4edda').setRanges([latest]).build(),
    B().whenTextEqualTo('Fail').setBackground('#f8d7da').setRanges([latest]).build(),
    B().whenTextEqualTo('Blocked').setBackground('#fff3cd').setRanges([latest]).build(),
    B().whenTextEqualTo('Not Implemented').setBackground('#d6d8f5').setRanges([latest]).build(),
  ]);
}

function buildSummary_(ss, h) {
  var s = tab_(ss, SUMMARY);
  s.clear();
  var L = function (k) { var n = h[COLS[k]] + 1, out = ''; while (n > 0) { var m = (n - 1) % 26; out = String.fromCharCode(65 + m) + out; n = Math.floor((n - 1) / 26); } return "Tests!" + out + ":" + out; };
  var res = ['Pass', 'Fail', 'Blocked', 'Not Implemented'];
  s.getRange(1, 1, 1, 8).setValues([['Module', 'Active tests'].concat(res).concat(['Not Started', 'Cancelled'])]).setFontWeight('bold');
  s.getRange(2, 1).setFormula('=SORT(UNIQUE(FILTER(' + L('module') + ',ROW(' + L('module') + ')>1,' + L('module') + '<>"")))');
  var active = L('ticket') + ',"<>' + CANCELLED + '"';
  for (var r = 2; r <= 60; r++) {
    var m = 'A' + r;
    s.getRange(r, 2, 1, 7).setFormulas([[
      '=IF(' + m + '="","",COUNTIFS(' + L('module') + ',' + m + ',' + active + '))',
      '=IF(' + m + '="","",COUNTIFS(' + L('module') + ',' + m + ',' + active + ',' + L('latest') + ',"Pass"))',
      '=IF(' + m + '="","",COUNTIFS(' + L('module') + ',' + m + ',' + active + ',' + L('latest') + ',"Fail"))',
      '=IF(' + m + '="","",COUNTIFS(' + L('module') + ',' + m + ',' + active + ',' + L('latest') + ',"Blocked"))',
      '=IF(' + m + '="","",COUNTIFS(' + L('module') + ',' + m + ',' + active + ',' + L('latest') + ',"Not Implemented"))',
      '=IF(' + m + '="","",COUNTIFS(' + L('module') + ',' + m + ',' + active + ',' + L('latest') + ',""))',
      '=IF(' + m + '="","",COUNTIFS(' + L('module') + ',' + m + ',' + L('ticket') + ',"' + CANCELLED + '"))',
    ]]);
  }
  s.setFrozenRows(1); s.setColumnWidth(1, 220);
}

/** Menu: set Ticket Status = Cancelled on the selected Tests rows. */
function cancelSelected() { setTicket_(CANCELLED); }
function activateSelected() { setTicket_('Active'); }
function setTicket_(value) {
  var sh = SpreadsheetApp.getActiveSheet();
  if (sh.getName() !== TESTS) { SpreadsheetApp.getUi().alert('Select rows on the "' + TESTS + '" tab first.'); return; }
  var c = headerIndex_(sh)[COLS.ticket] + 1;
  sh.getActiveRangeList().getRanges().forEach(function (r) {
    var first = Math.max(r.getRow(), 2), n = r.getLastRow() - first + 1;
    if (n > 0) sh.getRange(first, c, n, 1).setValue(value);
  });
}

// ---------------------------------------------------------------- web app

function auth_(token) {
  var want = PropertiesService.getScriptProperties().getProperty('QA_TOKEN');
  if (!want || token !== want) throw new Error('Bad or missing token');
}
function json_(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }
function gz_(obj) {
  var gz = Utilities.gzip(Utilities.newBlob(JSON.stringify(obj), 'application/json'));
  return json_({ ok: true, gz: Utilities.base64Encode(gz.getBytes()) });
}

/** The Tests tab as objects, plus each row's sheet row number. */
function readTests_() {
  var sh = SpreadsheetApp.getActive().getSheetByName(TESTS);
  if (!sh) throw new Error('No "' + TESTS + '" tab: run RDC Checker > Set up / repair sheet');
  var h = headerIndex_(sh);
  var last = sh.getLastRow();
  var vals = last > 1 ? sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues() : [];
  var get = function (r, k) { return h[COLS[k]] == null ? '' : r[h[COLS[k]]]; };
  var rows = [];
  vals.forEach(function (r, i) {
    var id = String(get(r, 'id')).trim();
    if (!id) return;
    rows.push({ row: i + 2, id: id, module: get(r, 'module'), title: get(r, 'title'), kind: get(r, 'kind'), role: get(r, 'role'),
      reference: get(r, 'reference'), ticketStatus: String(get(r, 'ticket') || 'Active'), latest: get(r, 'latest') });
  });
  return { sh: sh, h: h, rows: rows, lastRow: last };
}
var isCancelled_ = function (r) { return /^cancel+ed$/i.test(String(r.ticketStatus).trim()); };

function doGet(e) {
  try {
    auth_(e.parameter.token);
    if (e.parameter.action !== 'tests') throw new Error('Unknown action');
    return gz_({ rows: readTests_().rows.map(function (r) { delete r.row; return r; }) });
  } catch (err) {
    return json_({ ok: false, error: String(err.message || err) });
  }
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    var body = JSON.parse(e.postData.contents);
    auth_(body.token);
    lock.waitLock(30000);
    if (body.action === 'results') return json_(writeResults_(body.rows || []));
    if (body.action === 'sync') return json_(syncTests_(body.tests || [], body.update !== false));
    throw new Error('Unknown action');
  } catch (err) {
    return json_({ ok: false, error: String(err.message || err) });
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

function writeResults_(items) {
  var ss = SpreadsheetApp.getActive();
  var T = readTests_();
  var byId = {};
  T.rows.forEach(function (r) { byId[r.id] = r; });
  var log = ss.getSheetByName(LOG);
  if (!log) throw new Error('No "' + LOG + '" tab: run RDC Checker > Set up / repair sheet');
  var lh = headerIndex_(log);
  var now = new Date();
  var folder = null, out = [], skipped = [], unknown = [];
  items.forEach(function (it) {
    var row = byId[it.tcId];
    if (!row) { unknown.push(it.tcId); return; }
    // The cancel rule: a cancelled ticket is never updated, whatever the checker sends.
    if (isCancelled_(row)) { skipped.push(it.tcId); return; }
    var link = '';
    if (it.screenshot && it.screenshot.base64) {
      if (!folder) {
        var name = settingValue_('Screenshot folder (Drive)') || 'RDC QA Screenshots';
        var f = DriveApp.getFoldersByName(name);
        folder = f.hasNext() ? f.next() : DriveApp.createFolder(name);
      }
      link = folder.createFile(Utilities.newBlob(Utilities.base64Decode(it.screenshot.base64), 'image/png', it.screenshot.name)).getUrl();
    }
    out.push({ it: it, row: row, link: link });
  });
  if (out.length) {
    // Check Log: one write per column so helper columns next to them are left alone.
    var start = log.getLastRow() + 1;
    var col = function (name, fn) { if (lh[name] != null) log.getRange(start, lh[name] + 1, out.length, 1).setValues(out.map(function (o) { return [fn(o)]; })); };
    col('TC ID', function (o) { return o.it.tcId; });
    col('Checker', function (o) { return o.it.checker || 'RDC QA Bot'; });
    col('Checked At', function () { return now; });
    col('Environment', function (o) { return o.it.env || 'Vercel'; });
    col('Result', function (o) { return o.it.result; });
    col('Notes', function (o) { return o.it.notes || ''; });
    col('Screenshot', function (o) { return o.link; });
    // Tests tab: latest result per row.
    out.forEach(function (o) {
      var set = function (k, v) { if (T.h[COLS[k]] != null) T.sh.getRange(o.row.row, T.h[COLS[k]] + 1).setValue(v); };
      set('latest', o.it.result); set('checkedAt', now); set('notes', o.it.notes || ''); set('shot', o.link);
      // Blocked says nothing about the feature, so it leaves "Implemented on Vercel" as it was.
      if (o.it.result !== 'Blocked') set('implemented', o.it.result === 'Not Implemented' ? 'No' : 'Yes');
    });
  }
  return { ok: true, written: out.length, skippedCancelled: skipped, unknown: unknown };
}

function syncTests_(tests, update) {
  var T = readTests_();
  var byId = {};
  T.rows.forEach(function (r) { byId[r.id] = r; });
  var added = [], updated = [], skipped = [];
  var owned = ['module', 'title', 'kind', 'role', 'steps', 'expected'];
  var newRows = [];
  tests.forEach(function (t) {
    var row = byId[t.id];
    if (!row) {
      var r = TEST_HEADERS.map(function () { return ''; });
      var put = function (k, v) { r[TEST_HEADERS.indexOf(COLS[k])] = v; };
      owned.forEach(function (k) { put(k, t[k] || ''); });
      put('id', t.id); put('reference', t.reference || ''); put('ticket', 'Active');
      put('implemented', t.pending ? 'No' : ''); put('latest', '');
      newRows.push(r); added.push(t.id);
      return;
    }
    if (isCancelled_(row)) { skipped.push(t.id); return; }
    if (!update) return;
    var cur = T.sh.getRange(row.row, 1, 1, T.sh.getLastColumn()).getValues()[0];
    var changed = false;
    owned.forEach(function (k) {
      var c = T.h[COLS[k]];
      if (c != null && String(cur[c]) !== String(t[k] || '')) { T.sh.getRange(row.row, c + 1).setValue(t[k] || ''); changed = true; }
    });
    var rc = T.h[COLS.reference];
    if (rc != null && t.reference && String(cur[rc]) === '') { T.sh.getRange(row.row, rc + 1).setValue(t.reference); changed = true; }
    if (changed) updated.push(t.id);
  });
  if (newRows.length) {
    // New rows go in TEST_HEADERS order; map onto the sheet's actual column order.
    var width = T.sh.getLastColumn();
    var mapped = newRows.map(function (r) {
      var o = []; for (var i = 0; i < width; i++) o.push('');
      TEST_HEADERS.forEach(function (name, i) { if (T.h[name] != null) o[T.h[name]] = r[i]; });
      return o;
    });
    T.sh.getRange(T.lastRow + 1, 1, mapped.length, width).setValues(mapped);
  }
  return { ok: true, added: added, updated: updated, skippedCancelled: skipped };
}

function settingValue_(name) {
  var st = SpreadsheetApp.getActive().getSheetByName(SETTINGS);
  if (!st || st.getLastRow() < 2) return '';
  var v = st.getRange(1, 6, st.getLastRow(), 2).getValues();
  for (var i = 0; i < v.length; i++) if (v[i][0] === name) return String(v[i][1]);
  return '';
}
