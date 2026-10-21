/** Small helpers shared by test files. */
import { readTable, showingEntries } from '../app.js';

/** The page's main heading (first h1). */
export const heading = page => page.locator('main h1, h1').first().innerText({ timeout: 8000 }).catch(() => '');

/**
 * How many records a list page has: the "Showing X to Y of N entries" total when the page
 * shows one, otherwise the number of rows in the first table (empty-state rows not counted).
 */
export async function countEntries(page) {
  const s = await showingEntries(page);
  if (s) return s.of;
  const table = page.locator('table').first();
  if (!(await table.count())) return null;
  const { rows } = await readTable(table);
  return rows.filter(r => r.length > 1 || !/^no\b/i.test(r[0] || '')).length;
}

/** First table on the page, as text. Fails the test when there is none. */
export async function firstTable(t) {
  const table = t.page.locator('table').first();
  t.check(await table.count(), 'No table on the page');
  return readTable(table);
}

/** Column index by (partial, case-insensitive) header text; -1 when missing. */
export const col = (head, name) => head.findIndex(h => h.toLowerCase().includes(name.toLowerCase()));

/** A unique, recognisable name for records that write tests create (and then delete). */
export const qaName = label => `QA-AUTO ${label} ${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}`;
