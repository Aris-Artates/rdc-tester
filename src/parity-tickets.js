#!/usr/bin/env node
/**
 * npm run parity-tickets -- results/compare-<time>
 * Turns <run>/evidence/tickets.json (from `npm run evidence`) into apps-script/parity-tickets.json: one Dev Ticket per
 * page that still differs from the original, titled "TYPE: Module - Page - Task" with the differences as its
 * description. Commit and push it, then in the sheet: RDC QA > Import parity tickets from rdc-tester (rows get
 * No Progress and no Dev; their Freedcamp tasks are unassigned).
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, config } from './config.js';

const dir = process.argv.slice(2).find(a => !a.startsWith('--'));
const file = dir && path.resolve(ROOT, dir, 'evidence', 'tickets.json');
if (!file || !fs.existsSync(file)) { console.error('Run npm run evidence first, then: npm run parity-tickets -- results/compare-<time>'); process.exit(1); }
const found = JSON.parse(fs.readFileSync(file, 'utf8')).filter(t => !t.error);

const page = menu => menu.split(' > ').join(' - ');
// What a feature ticket has to fix, from the kinds of differences it lists.
const KINDS = [[/^Columns missing/, 'columns'], [/^Filters/, 'filters'], [/^Buttons missing/, 'buttons'], [/^Data:/, 'row count'],
  [/^Layout:/, 'layout'], [/^"[^"]+" form lacks/, 'form fields'], [/^"[^"]+": the original gives/, 'button actions']];
const task = t => {
  const kinds = KINDS.filter(([re]) => t.problems.some(p => re.test(p))).map(([, k]) => k);
  return 'Match the original' + (kinds.length ? ': ' + kinds.join(', ') : '');
};

const tickets = found.map(t => {
  let title, lines;
  if (t.kind === 'not-built') {
    title = t.pages.length === 1 ? `FEAT: ${page(t.pages[0].menu)} - Build the page (not on Vercel yet)` : `FEAT: ${t.menu} - Build the ${t.pages.length} pages not on Vercel yet`;
    lines = t.pages.map(p => `- ${p.menu}: ${config.originalUrl}${p.legacyPath}` + (p.vercelPath ? ` (Vercel ${p.vercelPath} is a placeholder)` : ' (no Vercel page)'));
  } else if (t.kind === 'access') {
    title = `BUG: ${page(t.menu)} - Access differs from the original`;
    lines = t.problems.map(p => '- ' + p);
  } else {
    title = `BUG: ${page(t.menu)} - ${task(t)}`;
    lines = t.problems.map(p => '- ' + p);
  }
  const where = t.kind === 'not-built' ? [] : [`Original: ${config.originalUrl}${t.legacyPath}`, `Vercel: ${config.appUrl}${t.vercelPath}`];
  const description = [
    `Vercel differs from the original site (the baseline) here, checked as ${t.role === 'admin' ? 'RDC Admin' : t.role}:`,
    ...lines, '', ...where,
    'Found by rdc-tester (npm run compare, then npm run evidence). Screenshots with each difference boxed in red are in the Freedcamp task comments.',
  ].join('\n');
  return { title, description, shots: t.shots };
});

const out = path.join(ROOT, 'apps-script', 'parity-tickets.json');
fs.writeFileSync(out, JSON.stringify({ exported: new Date().toISOString(), from: path.relative(ROOT, path.dirname(path.dirname(file))).replace(/\\/g, '/'),
  tickets: tickets.map(({ title, description }) => ({ title, description })) }, null, 1) + '\n');
// The screenshots stay on this PC (they show real project data): the list of which pictures go with which ticket.
fs.writeFileSync(path.join(path.dirname(file), 'shots-by-ticket.json'), JSON.stringify(tickets.map(({ title, shots }) => ({ title, shots })), null, 1));
console.log(`${tickets.length} tickets written to ${path.relative(ROOT, out)}. Commit and push it, then in the sheet: RDC QA > Import parity tickets from rdc-tester.`);
for (const t of tickets) console.log('  ' + t.title);
