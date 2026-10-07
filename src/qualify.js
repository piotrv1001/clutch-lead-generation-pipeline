// Score every company that has no score for the current icp.md with Claude.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { db } from './db.js';

const CONCURRENCY = 4;

if (!process.env.ANTHROPIC_API_KEY) {
    console.log('ANTHROPIC_API_KEY is not set, skipping qualification.');
    process.exit(0);
}

const Lead = z.object({
    score: z.number().int().min(0).max(100).describe('Fit with the ideal customer profile, 0-100'),
    tier: z.enum(['A', 'B', 'C']).describe('A: contact now, B: maybe later, C: not a fit'),
    reason: z.string().describe('One sentence citing the facts that drove the score'),
    angle: z.string().describe('One-sentence outreach hook specific to this company'),
});

const icp = await readFile('icp.md', 'utf8');
const icpHash = createHash('sha256').update(icp).digest('hex').slice(0, 12);

const { rows: companies } = await db.query(
    `SELECT * FROM companies c
     WHERE NOT EXISTS (SELECT 1 FROM lead_scores s WHERE s.profile_url = c.profile_url AND s.icp_hash = $1)`,
    [icpHash],
);
console.log(`Qualifying ${companies.length} companies against icp.md ${icpHash}...`);

const client = new Anthropic();
const system = [{
    type: 'text',
    // The profile is the same for every company, so it is cached after the first call.
    cache_control: { type: 'ephemeral' },
    text: `You qualify B2B leads. Score how well each company matches this ideal customer profile.
Judge only from the facts given; when a fact is missing, do not assume it in the company's favour.

<ideal_customer_profile>
${icp}
</ideal_customer_profile>`,
}];

async function qualify(c) {
    const response = await client.messages.parse({
        model: process.env.CLAUDE_MODEL ?? 'claude-opus-5-5',
        max_tokens: 16000,
        output_config: { effort: 'low', format: zodOutputFormat(Lead) },
        system,
        messages: [{
            role: 'user',
            content: JSON.stringify({
                name: c.name,
                website: c.website,
                location: c.location,
                employees: c.employees,
                hourlyRate: c.hourly_rate,
                minProjectSize: c.min_project,
                services: c.services,
                clutchRating: c.rating,
                clutchReviews: c.reviews,
                description: c.description,
            }),
        }],
    });
    const lead = response.parsed_output;
    if (!lead) {
        console.error(`  ${c.name}: no score (stop reason "${response.stop_reason}")`);
        return;
    }
    await db.query(
        `INSERT INTO lead_scores (profile_url, icp_hash, score, tier, reason, angle)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [c.profile_url, icpHash, lead.score, lead.tier, lead.reason, lead.angle],
    );
    console.log(`  ${String(lead.score).padStart(3)}  ${lead.tier}  ${c.name}`);
}

// Small batches keep us under the API rate limit.
for (let i = 0; i < companies.length; i += CONCURRENCY) {
    await Promise.all(companies.slice(i, i + CONCURRENCY).map(qualify));
}

await db.end();
