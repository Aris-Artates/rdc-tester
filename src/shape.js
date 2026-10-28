/**
 * What a page offers the user, read the same way on the original WordPress site and on Vercel, so parity
 * tests can compare the two even though the HTML is completely different:
 *   tables   leaf column headers of each visible table (grouped header rows are skipped)
 *   selects  every dropdown's options
 *   buttons  visible action buttons outside tables, menus and dialogs
 *   dialogs  titles of dialogs / modals the page can open (WordPress keeps them in the DOM)
 * Runs inside the page (page.evaluate), so it must stay self-contained.
 */
export function readShape() {
  const clean = s => String(s || '').replace(/\s+/g, ' ').trim();
  // "Total<br>No. of Projects" must read "Total No. of Projects", not "TotalNo. of Projects".
  const text = e => { const c = e.cloneNode(true); c.querySelectorAll('br').forEach(b => b.replaceWith(' ')); return clean(c.textContent); };
  const shown = e => !!(e.offsetParent || e.getClientRects().length);
  const inChrome = e => !!e.closest('nav, header, footer, [role="dialog"], .modal, table, [data-sonner-toaster]');
  const tables = [...document.querySelectorAll('table')]
    .filter(t => shown(t) && !t.closest('.modal, [role="dialog"]'))
    .map(t => [...t.querySelectorAll('thead th')].filter(th => (th.colSpan || 1) <= 1).map(text).filter(Boolean))
    .filter(h => h.length);
  const selects = [...document.querySelectorAll('select')]
    .filter(s => !s.closest('.modal, [role="dialog"]') && s.options.length > 1)
    .map(s => ({ id: s.id || s.name || '', options: [...s.options].map(o => clean(o.text)) }));
  const buttons = [...new Set([...document.querySelectorAll('button, a.btn, .btn')]
    .filter(b => shown(b) && !inChrome(b))
    .map(b => clean(b.textContent))
    .filter(t => t && t.length < 40 && !/^[«‹›»…\d\s]+$|^(Previous|Next|First|Last)$/i.test(t)))]; // pagers differ by data
  const dialogs = [...document.querySelectorAll('.modal .modal-title, [role="dialog"] h2')].map(h => clean(h.textContent)).filter(Boolean);
  return { tables, selects, buttons, dialogs };
}
