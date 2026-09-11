import pg from 'pg';

export interface Database {
  query<T extends Record<string, unknown> = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

// Single statements perform all security-sensitive transitions atomically.
export const migration = `
CREATE TABLE IF NOT EXISTS wallet_challenges (
 id uuid PRIMARY KEY, address text NOT NULL, origin text NOT NULL,
 network text NOT NULL, message text NOT NULL, expires_at timestamptz NOT NULL,
 consumed_at timestamptz
);
CREATE TABLE IF NOT EXISTS wallet_sessions (
 token_hash text PRIMARY KEY, address text NOT NULL, origin text NOT NULL,
 expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS wallet_sessions_expiry ON wallet_sessions(expires_at);
CREATE INDEX IF NOT EXISTS wallet_challenges_expiry ON wallet_challenges(expires_at);
CREATE TABLE IF NOT EXISTS ai_requests (
 actor text NOT NULL, request_id uuid NOT NULL, input_hash text NOT NULL,
 status text NOT NULL CHECK (status IN ('running','completed','unknown')),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(actor, request_id)
);
CREATE TABLE IF NOT EXISTS ai_daily_budget (
 actor text NOT NULL, day date NOT NULL DEFAULT CURRENT_DATE, used integer NOT NULL,
 PRIMARY KEY(actor,day)
);
CREATE TABLE IF NOT EXISTS market_catalog (
 listing_id text PRIMARY KEY, creator text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS relationship_memory (
 owner text NOT NULL, listing_id text NOT NULL, provider text NOT NULL CHECK(provider IN ('seal-walrus','memwal')),
 space_id text NOT NULL, revision integer NOT NULL CHECK(revision>0), consented_at timestamptz NOT NULL,
 PRIMARY KEY(owner,listing_id)
);
CREATE TABLE IF NOT EXISTS market_preview_budget (
 owner text NOT NULL, listing_id text NOT NULL, used integer NOT NULL CHECK(used>0), PRIMARY KEY(owner,listing_id)
);
CREATE TABLE IF NOT EXISTS memory_accounts (
 owner text PRIMARY KEY, account_id text NOT NULL UNIQUE, enabled boolean NOT NULL DEFAULT true
);
CREATE TABLE IF NOT EXISTS memory_jobs (
 owner text NOT NULL, request_id uuid NOT NULL, listing_id text NOT NULL, account_id text NOT NULL,
 input_hash text NOT NULL, job_id text, status text NOT NULL CHECK(status IN ('running','accepted','unknown')),
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(owner,request_id)
);
CREATE TABLE IF NOT EXISTS agent_gifts (
 intent text PRIMARY KEY, owner text NOT NULL, listing_id text NOT NULL, product_id text,
 status text NOT NULL CHECK(status IN ('evaluating','declined','prepared','unknown','confirmed','failed')),
 tx_bytes text, signature text, digest text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS package_uploads (
 owner text NOT NULL, request_id uuid NOT NULL, listing_id text NOT NULL, input_hash text NOT NULL,
 status text NOT NULL CHECK(status IN ('running','ready','unknown')), blob_id text, content_hash text, end_epoch text,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(owner,request_id)
);
`;

export function connectDatabase(url: string) {
  return new pg.Pool({ connectionString: url, max: 10, connectionTimeoutMillis: 5000,
    statement_timeout: 10000 });
}
