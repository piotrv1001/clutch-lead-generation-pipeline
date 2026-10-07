# Clutch Lead Generation Pipeline — Node.js, Postgres and Claude

![Clutch lead generation pipeline](docs/banner.png)

A B2B lead generation pipeline for anyone selling to agencies: pull companies from any
[Clutch.co](https://clutch.co) directory page, let Claude qualify each one against **your ideal customer profile**,
find the decision makers at the best fits on LinkedIn, and export a CSV ready to import into your CRM.

Scraping runs on Apify with two Actors, the
[Clutch.co Listings Scraper](https://apify.com/piotrv1001/clutch-listings-scraper) and the
[LinkedIn Decision Maker Finder](https://apify.com/piotrv1001/linkedin-decision-maker-finder), so there are no
proxies, logins or browsers to manage. Postgres runs in Docker.

![Qualified leads with fit scores, reasons, outreach angles and decision makers](docs/report.png)

## How it works

```mermaid
flowchart LR
    S[searches.txt] --> I
    P[icp.md] --> Q
    subgraph pipeline [npm start]
        I[ingest<br/>Clutch Actor] --> DB[(Postgres)]
        DB --> Q[qualify<br/>Claude]
        Q --> DB
        DB --> C[contacts<br/>LinkedIn Actor]
        C --> DB
        DB --> R[report]
    end
    R --> CSV[reports/leads.csv]
    R --> H[reports/index.html]
```

| Step | Command | What it does |
| --- | --- | --- |
| Ingest | `npm run ingest` | Scrapes every Clutch directory page in `searches.txt` and upserts each company: website, location, team size, hourly rate, minimum project size, service mix, rating, reviews and the Clutch summary. |
| Qualify | `npm run qualify` | Claude scores every company that has no score for the current `icp.md`: 0–100, tier A/B/C, the reason and a one-sentence outreach angle. Skipped if `ANTHROPIC_API_KEY` isn't set. |
| Contacts | `npm run contacts` | Finds decision makers (CEO, founder, CTO, ...) on LinkedIn for companies scoring `MIN_SCORE` or more, best first, at most `MAX_COMPANIES` per run. Companies are looked up by their website, which pins the exact LinkedIn company. A company is never searched twice. |
| Report | `npm run report` | Writes `reports/leads.csv` with one row per contact and `reports/index.html` with tier A and B companies. |

The AI step runs **before** the paid contact search, so you only pay to find people at companies worth contacting.

## Quick start

You need [Node.js](https://nodejs.org/) 22 or newer, [Docker](https://docs.docker.com/get-docker/), an
[Apify account](https://console.apify.com/sign-up) and an [Anthropic API key](https://console.anthropic.com/).

```bash
git clone https://github.com/piotrv1001/clutch-lead-generation-pipeline.git
cd clutch-lead-generation-pipeline
docker compose up -d          # Postgres 17, schema created on first start
npm install
cp .env.example .env          # add APIFY_TOKEN and ANTHROPIC_API_KEY
```

Then make it yours:

1. Describe who you sell to in `icp.md`: the services, team size, rates and locations that make a good customer, and
   what rules a company out. The example sells white-label QA to software agencies.
2. Find your segment on [clutch.co](https://clutch.co) (a category plus a city, e.g. *Web Developers in Austin*) and
   paste the directory URLs into `searches.txt`.
3. Run `npm start`, then open `reports/index.html` or import `reports/leads.csv`.

## Configuration

| Variable | Default | |
| --- | --- | --- |
| `APIFY_TOKEN` | – | [Apify API token](https://console.apify.com/settings/integrations) |
| `DATABASE_URL` | `postgres://leads:leads@localhost:5432/leads` | Any Postgres 13+ works |
| `MAX_PER_SEARCH` | `30` | Companies per Clutch directory page |
| `ANTHROPIC_API_KEY` | – | Required for qualification |
| `CLAUDE_MODEL` | `claude-opus-5-5` | Any Claude model, e.g. `claude-haiku-4-5` for a cheaper run |
| `MIN_SCORE` | `75` | Lowest score that gets a contact search |
| `MAX_COMPANIES` | `10` | Contact searches per run |
| `TITLES` | `CEO,Founder,CTO,VP Engineering` | Titles to look for |
| `PERSONS_PER_COMPANY` | `2` | Decision makers per company |
| `LOCATION` | `United States` | Only decision makers based here; tells apart companies that share a name. A country or state is safer than a city, since founders often live away from the office Clutch lists |

## The CSV

`reports/leads.csv` has one row per decision maker (or one row per company if none were found yet), with the columns
`company, website, location, employees, hourly_rate, score, tier, reason, angle, contact_name, contact_title,
contact_linkedin, contact_confidence, clutch_profile`. HubSpot, Pipedrive and most CRMs import it as is.

`contact_confidence` comes from the LinkedIn Actor: it is lower when the person's title doesn't match one of `TITLES`
or their current company doesn't look like the target. Companies are looked up by website, and `LOCATION` keeps out
people based elsewhere, but a generic name (say, two US firms called "Eureka Software") can still mix. Check contacts
before reaching out, especially `medium` and `low` ones.

## Query the leads

```sql
-- Tier A companies without contacts yet (raise MAX_COMPANIES or lower MIN_SCORE to reach them)
SELECT c.name, s.score, c.website
FROM companies c JOIN lead_scores s USING (profile_url)
WHERE s.tier = 'A'
  AND NOT EXISTS (SELECT 1 FROM contacts x WHERE x.profile_url = c.profile_url)
ORDER BY s.score DESC;

-- Average fit by team size
SELECT c.employees, round(avg(s.score)) AS avg_score, count(*)
FROM companies c JOIN lead_scores s USING (profile_url)
GROUP BY 1 ORDER BY 2 DESC;
```

Connect with `docker compose exec db psql -U leads`.

## Cost

Pricing as of October 7, 2026:

- **Clutch.co Listings Scraper:** $0.0015 per company, so $0.09 for 60 companies.
  [Current pricing](https://apify.com/piotrv1001/clutch-listings-scraper/pricing).
- **LinkedIn Decision Maker Finder:** $0.025 per decision maker, so $0.50 for 10 companies × 2 people.
  [Current pricing](https://apify.com/piotrv1001/linkedin-decision-maker-finder/pricing).
- **Claude:** one short request per new company. Our test run qualified 60 companies for $0.31 with the default
  `claude-opus-5-5` (about $0.005 per company).

The Apify free plan includes $5 of monthly usage.

## Project structure

```
db/schema.sql      tables: companies, lead_scores, contacts, contact_searches
src/ingest.js      runs the Clutch Actor and upserts companies
src/qualify.js     Claude fit score per company and profile version
src/contacts.js    runs the LinkedIn Actor for the best leads
src/report.js      leads.csv and HTML report
searches.txt       Clutch directory pages to scrape
icp.md             your ideal customer profile (an example is included)
```

## Related

- [Clutch.co Listings Scraper](https://apify.com/piotrv1001/clutch-listings-scraper) and
  [LinkedIn Decision Maker Finder](https://apify.com/piotrv1001/linkedin-decision-maker-finder) — the Actors this
  pipeline runs
- [LinkedIn jobs AI matcher](https://github.com/piotrv1001/linkedin-jobs-ai-matcher) — the same pipeline pattern for
  job hunting
- [AliExpress price tracker](https://github.com/piotrv1001/aliexpress-price-tracker) — the same pattern for price
  monitoring
- [Mercado Libre price tracker](https://github.com/piotrv1001/mercado-libre-price-tracker) and [brand mention monitor](https://github.com/piotrv1001/brand-mention-monitor) — the same pattern for marketplace
  prices and social listening
