-- Agencies found on Clutch directory pages. Upserted on each run.
CREATE TABLE companies (
    profile_url    text PRIMARY KEY,
    name           text NOT NULL,
    website        text,
    location       text,
    rating         numeric,
    reviews        int,
    min_project    text,
    hourly_rate    text,
    employees      text,
    services       text[],
    description    text,
    verified       boolean,
    first_seen     timestamptz NOT NULL DEFAULT now()
);

-- Claude's fit score for a company against one version of icp.md.
CREATE TABLE lead_scores (
    profile_url  text NOT NULL REFERENCES companies,
    icp_hash     text NOT NULL,
    score        int  NOT NULL CHECK (score BETWEEN 0 AND 100),
    tier         text NOT NULL CHECK (tier IN ('A', 'B', 'C')),
    reason       text NOT NULL,
    angle        text NOT NULL,
    scored_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (profile_url, icp_hash)
);

-- Decision makers found on LinkedIn for the best-scoring companies.
CREATE TABLE contacts (
    profile_url   text NOT NULL REFERENCES companies,
    name          text NOT NULL,
    title         text,
    linkedin_url  text NOT NULL,
    confidence    text,
    found_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (profile_url, linkedin_url)
);

-- Companies already sent to the decision-maker search, so they are never paid for twice.
CREATE TABLE contact_searches (
    profile_url   text PRIMARY KEY REFERENCES companies,
    searched_at   timestamptz NOT NULL DEFAULT now()
);
