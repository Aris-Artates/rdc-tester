/**
 * The comparison report: results/compare-<time>/index.html, one self-contained page (screenshots are files
 * next to it) with a summary grid (pages x roles), then every page per role with the original and Vercel
 * screenshots side by side and each difference listed. Open it in any browser.
 */
import fs from 'node:fs';
import path from 'node:path';

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const id = (role, menu) => 'p-' + (role + '-' + menu).toLowerCase().replace(/[^a-z0-9]+/g, '-');
const CELL = { Pass: 'P', Fail: 'F', Blocked: 'B' };

export function writeReport(dir, { results, writes, pages, started, originalUrl, vercelUrl }) {
  const all = results.flatMap(r => r.pages);
  const count = s => all.filter(x => x.status === s).length;
  const byRole = Object.fromEntries(results.map(r => [r.role, Object.fromEntries(r.pages.map(p => [p.menu, p]))]));

  const grid = `<table class="grid"><thead><tr><th>Page (original menu)</th>${results.map(r => `<th title="${esc(r.name)}"><span>${esc(r.role)}</span></th>`).join('')}</tr></thead><tbody>
${pages.map(p => `<tr><td>${esc(p.menu)}${p.vercel ? '' : ' <em>(no Vercel page)</em>'}</td>${results.map(r => {
    if (r.blocked) return '<td class="Blocked" title="Role could not sign in">–</td>';
    const x = byRole[r.role][p.menu];
    return x ? `<td class="${x.status}"><a href="#${id(r.role, p.menu)}" title="${esc(x.problems[0] || x.status)}">${CELL[x.status]}</a></td>` : '<td></td>';
  }).join('')}</tr>`).join('\n')}</tbody></table>`;

  const roleBlocks = results.map(r => {
    if (r.blocked) return `<section><h2>${esc(r.name)} <small>${esc(r.role)}</small></h2><p class="Blocked pad">Not checked: ${esc(r.blocked)}</p></section>`;
    const items = r.pages.map(x => `<article id="${id(r.role, x.menu)}" class="page">
<h3><span class="tag ${x.status}">${x.status}</span> ${esc(x.menu)}</h3>
<p class="paths">Original <code>${esc(x.legacyPath)}</code> (${esc(x.legacyAccess?.state || '')}${x.legacyAccess?.detail && x.legacyAccess.state !== 'allowed' ? ': ' + esc(x.legacyAccess.detail) : ''})
 · Vercel <code>${esc(x.vercelPath || 'none')}</code>${x.vercelAccess ? ` (${esc(x.vercelAccess.state)}${x.vercelAccess.state !== 'allowed' ? ': ' + esc(x.vercelAccess.detail) : ''})` : ''}
 ${x.data?.legacy || x.data?.vercel ? ` · Rows: original ${x.data.legacy?.total ?? '–'}, Vercel ${x.data.vercel?.total ?? '–'}` : ''}</p>
${x.problems.length ? `<ul class="problems">${x.problems.map(l => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}
${x.notes.length ? `<ul class="notes">${x.notes.map(l => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}
${x.clicks?.length ? `<table class="clicks"><tr><th>Button</th><th>Original</th><th>Vercel</th></tr>${x.clicks.map(c => `<tr class="${c.same ? 'Pass' : 'Fail'}"><td>${esc(c.label)}</td><td>${esc(outcome(c.legacy))}</td><td>${esc(outcome(c.vercel))}</td></tr>`).join('')}</table>` : ''}
${x.shots.legacy || x.shots.vercel ? `<div class="shots">${shotBox('Original (baseline)', x.shots.legacy)}${shotBox('Vercel', x.shots.vercel)}</div>` : ''}
</article>`).join('\n');
    const rc = s => r.pages.filter(x => x.status === s).length;
    return `<section><h2>${esc(r.name)} <small>${esc(r.role)} · ${rc('Pass')} Pass, ${rc('Fail')} Fail, ${rc('Blocked')} Blocked</small></h2>${items}</section>`;
  }).join('\n');

  const writeBlock = writes ? `<section><h2>Write round-trips <small>create a TEST- record, check it, delete it</small></h2>
<table class="clicks"><tr><th>Page</th><th>Original</th><th>Vercel</th><th>Same?</th></tr>${writes.map(w => `<tr class="${w.status}"><td>${esc(w.menu)}</td><td>${esc(w.legacy)}</td><td>${esc(w.vercel)}</td><td>${esc(w.status)}</td></tr>`).join('')}</table></section>` : '';

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>RDC Compare ${esc(started)}</title><style>
body{font:14px/1.45 Segoe UI,Arial,sans-serif;margin:0;color:#1d2433;background:#f6f7fb}
header{background:#1f2a44;color:#fff;padding:16px 24px}header h1{margin:0;font-size:20px}header p{margin:4px 0 0;opacity:.85}
main{padding:16px 24px}section{background:#fff;border:1px solid #dde1ea;border-radius:8px;padding:12px 16px;margin:16px 0}
h2 small,h3 small{font-weight:400;color:#667}.tot span{display:inline-block;margin-right:14px;font-weight:600}
.grid{border-collapse:collapse;font-size:12px}.grid th,.grid td{border:1px solid #dde1ea;padding:2px 5px;text-align:center}
.grid td:first-child{text-align:left;white-space:nowrap}.grid thead th{position:sticky;top:0;background:#1f2a44;color:#fff}
.grid th span{writing-mode:vertical-rl;transform:rotate(180deg);white-space:nowrap}.grid a{color:inherit;text-decoration:none;display:block}
.Pass{background:#d9f2df}.Fail{background:#f9d6d9}.Blocked{background:#fff1c2}.pad{padding:8px}
.page{border-top:1px solid #e4e7ee;padding:10px 0}.page h3{margin:0 0 4px;font-size:15px}.tag{font-size:11px;padding:1px 6px;border-radius:4px}
.paths{margin:0 0 6px;color:#556;font-size:12px}.problems li{color:#a3121f}.notes li{color:#556;font-size:12px}
.clicks{border-collapse:collapse;font-size:12px;margin:6px 0}.clicks td,.clicks th{border:1px solid #dde1ea;padding:3px 6px;text-align:left}
.shots{display:grid;grid-template-columns:1fr 1fr;gap:10px}.shots figure{margin:0}.shots img{width:100%;border:1px solid #ccd;cursor:zoom-in}
.shots figcaption{font-size:12px;font-weight:600;margin-bottom:2px}@media (max-width:800px){.shots{grid-template-columns:1fr}}
</style></head><body><header><h1>RDC8 IMS · original vs Vercel</h1>
<p>Baseline: ${esc(originalUrl)} · Tested: ${esc(vercelUrl)} · Run ${esc(started)}</p></header><main>
<section><h2>Summary</h2><p class="tot"><span class="Pass pad">${count('Pass')} Pass</span><span class="Fail pad">${count('Fail')} Fail</span><span class="Blocked pad">${count('Blocked')} Blocked</span>
${results.filter(r => r.blocked).length ? `<span>${results.filter(r => r.blocked).length} roles not signed in</span>` : ''}</p>
<p>P = same as the original, F = differs (hover for the first difference, click for details), B = could not be checked. Rows: pages of the original menus; columns: roles.</p>${grid}</section>
${writeBlock}${roleBlocks}</main>
<script>document.addEventListener('click',e=>{if(e.target.matches('.shots img'))window.open(e.target.src)})</script></body></html>`;
  const file = path.join(dir, 'index.html');
  fs.writeFileSync(file, html);
  return file;
}

const outcome = o => !o ? '' : o.kind === 'dialog' ? `dialog "${o.detail || ''}"${o.fields?.length ? ` (${o.fields.length} fields)` : ''}` : o.kind + (o.detail ? ` ${o.detail}` : '');
const shotBox = (label, src) => (src ? `<figure><figcaption>${label}</figcaption><img loading="lazy" src="${esc(src)}" alt="${esc(label)}"></figure>` : `<figure><figcaption>${label}</figcaption><p class="notes">No screenshot (page not open for this role)</p></figure>`);
