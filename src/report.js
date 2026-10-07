// Write reports/leads.csv (one row per contact, ready for a CRM import) and reports/index.html.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { db } from './db.js';

const icp = await readFile('icp.md', 'utf8');
const icpHash = createHash('sha256').update(icp).digest('hex').slice(0, 12);

const { rows: leads } = await db.query(
    `SELECT c.*, s.score, s.tier, s.reason, s.angle,
            coalesce(json_agg(x ORDER BY x.found_at) FILTER (WHERE x.name IS NOT NULL), '[]') AS contacts
     FROM companies c
     JOIN lead_scores s ON s.profile_url = c.profile_url AND s.icp_hash = $1
     LEFT JOIN contacts x ON x.profile_url = c.profile_url
     GROUP BY c.profile_url, s.score, s.tier, s.reason, s.angle
     ORDER BY s.score DESC, c.reviews DESC NULLS LAST`,
    [icpHash],
);
await db.end();

// CSV: one row per contact; companies without contacts get one row with empty contact columns.
const COLUMNS = ['company', 'website', 'location', 'employees', 'hourly_rate', 'score', 'tier', 'reason', 'angle',
    'contact_name', 'contact_title', 'contact_linkedin', 'contact_confidence', 'clutch_profile'];
const cell = (v) => (/[",\n]/.test(String(v ?? '')) ? `"${String(v).replaceAll('"', '""')}"` : String(v ?? ''));
const csv = [COLUMNS.join(',')];
for (const l of leads.filter((lead) => lead.tier !== 'C')) {
    for (const p of l.contacts.length ? l.contacts : [{}]) {
        csv.push([l.name, l.website, l.location, l.employees, l.hourly_rate, l.score, l.tier, l.reason, l.angle,
            p.name, p.title, p.linkedin_url, p.confidence, l.profile_url].map(cell).join(','));
    }
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const rows = leads.filter((l) => l.tier !== 'C').map((l) => `<tr>
    <td><a href="${esc(l.website ?? l.profile_url)}"><b>${esc(l.name)}</b></a>
        <div class="muted">${[l.location, l.employees && `${l.employees} people`, l.hourly_rate].filter(Boolean).map(esc).join(' · ')}</div></td>
    <td><span class="score t${l.tier}">${l.score}</span></td>
    <td>${esc(l.reason)}<div class="angle">${esc(l.angle)}</div></td>
    <td>${l.contacts.map((p) => `<div><a href="${esc(p.linkedin_url)}">${esc(p.name)}</a>${p.confidence === 'high' ? '' : ' <span class="muted">(check)</span>'}<div class="muted">${esc(p.title ?? '')}</div></div>`).join('') || '<span class="muted">–</span>'}</td>
</tr>`).join('\n');

const counts = Object.fromEntries(['A', 'B', 'C'].map((t) => [t, leads.filter((l) => l.tier === t).length]));
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Qualified leads</title>
<style>
    body { font: 14px/1.45 system-ui, -apple-system, sans-serif; color: #111827; background: #f8fafc; margin: 0; padding: 32px; }
    main { max-width: 1180px; margin: auto; }
    h1 { font-size: 22px; margin: 0 0 4px; }
    a { color: inherit; }
    .muted { color: #6b7280; font-size: 12px; }
    table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px #0000001a; margin-top: 20px; }
    th { text-align: left; font-size: 12px; font-weight: 600; color: #6b7280; text-transform: uppercase; letter-spacing: .04em; padding: 12px 14px; background: #f9fafb; }
    td { padding: 14px; border-top: 1px solid #f1f5f9; vertical-align: top; }
    td:first-child { width: 250px; }
    td:last-child { width: 230px; }
    td:last-child > div + div { margin-top: 8px; }
    .score { display: inline-block; min-width: 34px; text-align: center; font-weight: 700; border-radius: 8px; padding: 3px 6px; }
    .tA { background: #dcfce7; color: #15803d; }
    .tB { background: #fef3c7; color: #92400e; }
    .angle { margin-top: 6px; padding-left: 10px; border-left: 3px solid #c7d2fe; color: #3730a3; }
</style></head>
<body><main>
    <h1>Qualified leads</h1>
    <div class="muted">${leads.length} companies scored against icp.md · ${counts.A} tier A · ${counts.B} tier B · ${counts.C} not a fit (hidden) · exported to reports/leads.csv</div>
    <table>
        <thead><tr><th>Company</th><th>Fit</th><th>Why, and the outreach angle</th><th>Decision makers</th></tr></thead>
        <tbody>${rows}</tbody>
    </table>
</main></body></html>`;

await mkdir('reports', { recursive: true });
await writeFile('reports/leads.csv', csv.join('\n') + '\n');
await writeFile('reports/index.html', html);
console.log(`Wrote reports/leads.csv (${csv.length - 1} rows) and reports/index.html`);
