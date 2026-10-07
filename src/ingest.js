// Scrape every Clutch directory page in searches.txt and upsert the companies into Postgres.
import { readFile } from 'node:fs/promises';
import { ApifyClient } from 'apify-client';
import { db } from './db.js';

const ACTOR_ID = 'piotrv1001/clutch-listings-scraper';
const { MAX_PER_SEARCH = '30' } = process.env;

const searchUrls = (await readFile('searches.txt', 'utf8'))
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));

// Clutch links to websites through a click tracker; the real URL is in its "u" parameter.
function website(trackerUrl) {
    try {
        const url = new URL(trackerUrl);
        return new URL(url.searchParams.get('u') ?? url).origin;
    } catch {
        return null;
    }
}

console.log(`Scraping ${searchUrls.length} Clutch pages, up to ${MAX_PER_SEARCH} companies each...`);
const client = new ApifyClient({ token: process.env.APIFY_TOKEN });
const run = await client.actor(ACTOR_ID).call({
    searchUrls,
    maxItemsPerUrl: Number(MAX_PER_SEARCH),
}, { log: null });
console.log(`Run ${run.status}: https://console.apify.com/actors/runs/${run.id}`);

const { items } = await client.dataset(run.defaultDatasetId).listItems();
let added = 0;
for (const c of items) {
    const { rows: [row] } = await db.query(
        `INSERT INTO companies (profile_url, name, website, location, rating, reviews, min_project,
                                hourly_rate, employees, services, description, verified)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (profile_url) DO UPDATE
         SET rating = EXCLUDED.rating, reviews = EXCLUDED.reviews, description = EXCLUDED.description
         RETURNING (xmax = 0) AS inserted`,
        [
            c.profileLink, c.title, website(c.websiteUrl), c.location, c.rating || null, c.reviewCount || null,
            c.minProjectSize, c.hourlyRate, c.employeesCount, c.services, c.description,
            c.isVerified,
        ],
    );
    if (row.inserted) added++;
}
console.log(`Saved ${items.length} companies, ${added} of them new.`);

await db.end();
