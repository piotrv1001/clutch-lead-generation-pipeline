// Find decision makers on LinkedIn for the best-scoring companies that were not searched yet.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { ApifyClient } from 'apify-client';
import { db } from './db.js';

const ACTOR_ID = 'piotrv1001/linkedin-decision-maker-finder';
const {
    MIN_SCORE = '75',
    MAX_COMPANIES = '10',
    TITLES = 'CEO,Founder,CTO,VP Engineering',
    PERSONS_PER_COMPANY = '2',
    LOCATION = 'United States',
} = process.env;

const icp = await readFile('icp.md', 'utf8');
const icpHash = createHash('sha256').update(icp).digest('hex').slice(0, 12);

const { rows: companies } = await db.query(
    `SELECT c.profile_url, c.name, c.website
     FROM companies c JOIN lead_scores s ON s.profile_url = c.profile_url AND s.icp_hash = $1
     WHERE s.score >= $2
       AND NOT EXISTS (SELECT 1 FROM contact_searches cs WHERE cs.profile_url = c.profile_url)
     ORDER BY s.score DESC
     LIMIT $3`,
    [icpHash, Number(MIN_SCORE), Number(MAX_COMPANIES)],
);
if (!companies.length) {
    console.log(`No new companies with a score of ${MIN_SCORE} or more.`);
    await db.end();
    process.exit(0);
}

console.log(`Finding decision makers at ${companies.length} companies...`);
const client = new ApifyClient({ token: process.env.APIFY_TOKEN });
// The website pins the exact company on LinkedIn; a bare name can match same-name companies.
const inputOf = (c) => c.website ?? c.name;
const run = await client.actor(ACTOR_ID).call({
    companies: companies.map(inputOf),
    titles: TITLES.split(',').map((t) => t.trim()),
    maxPersonsPerCompany: Number(PERSONS_PER_COMPANY),
    // Many agency names are shared by companies elsewhere; only people based here are kept.
    location: LOCATION,
}, { log: null });
console.log(`Run ${run.status}: https://console.apify.com/actors/runs/${run.id}`);

// Each result carries the company entry exactly as it was sent.
const byInput = new Map(companies.map((c) => [inputOf(c), c.profile_url]));
const { items } = await client.dataset(run.defaultDatasetId).listItems();
let saved = 0;
for (const person of items) {
    const profileUrl = byInput.get(person.companyInput);
    if (!profileUrl || !person.personProfileUrl) continue;
    await db.query(
        `INSERT INTO contacts (profile_url, name, title, linkedin_url, confidence)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
        [profileUrl, person.personName, person.personTitle, person.personProfileUrl, person.confidence],
    );
    saved++;
}
for (const c of companies) {
    await db.query('INSERT INTO contact_searches (profile_url) VALUES ($1) ON CONFLICT DO NOTHING', [c.profile_url]);
}
console.log(`Saved ${saved} decision makers.`);

await db.end();
