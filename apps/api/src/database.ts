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
CREATE TABLE IF NOT EXISTS ai_global_daily_budget (
 day date PRIMARY KEY DEFAULT CURRENT_DATE, used integer NOT NULL CHECK(used>=0)
);
-- One database transaction and fixed lock order cover every API replica/user.
-- A rejected owner/global limit increments neither counter.
CREATE OR REPLACE FUNCTION public.reserve_ai_budget(p_actor text,p_owner_limit integer,p_global_limit integer,p_preview_listing text,p_preview_limit integer)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE global_used integer; owner_used integer; preview_used integer;
BEGIN
 IF p_owner_limit<1 OR p_global_limit<1 THEN RAISE EXCEPTION 'Invalid AI request limits'; END IF;
 INSERT INTO public.ai_global_daily_budget(day,used) VALUES(CURRENT_DATE,0) ON CONFLICT DO NOTHING;
 SELECT used INTO global_used FROM public.ai_global_daily_budget WHERE day=CURRENT_DATE FOR UPDATE;
 IF global_used>=p_global_limit THEN RETURN 'global'; END IF;
 INSERT INTO public.ai_daily_budget(actor,day,used) VALUES(p_actor,CURRENT_DATE,0) ON CONFLICT DO NOTHING;
 SELECT used INTO owner_used FROM public.ai_daily_budget WHERE actor=p_actor AND day=CURRENT_DATE FOR UPDATE;
 IF owner_used>=p_owner_limit THEN RETURN 'owner'; END IF;
 IF p_preview_listing IS NOT NULL THEN
  IF p_preview_limit IS NULL OR p_preview_limit<1 THEN RAISE EXCEPTION 'Invalid preview limit'; END IF;
  SELECT used INTO preview_used FROM public.market_preview_budget WHERE owner=p_actor AND listing_id=p_preview_listing FOR UPDATE;
  IF coalesce(preview_used,0)>=p_preview_limit THEN RETURN 'preview'; END IF;
 END IF;
 UPDATE public.ai_global_daily_budget SET used=used+1 WHERE day=CURRENT_DATE;
 UPDATE public.ai_daily_budget SET used=used+1 WHERE actor=p_actor AND day=CURRENT_DATE;
 IF p_preview_listing IS NOT NULL THEN
  INSERT INTO public.market_preview_budget(owner,listing_id,used) VALUES(p_actor,p_preview_listing,1)
   ON CONFLICT(owner,listing_id) DO UPDATE SET used=public.market_preview_budget.used+1;
 END IF;
 RETURN 'ok';
END;
$$;
CREATE TABLE IF NOT EXISTS market_catalog (
 listing_id text PRIMARY KEY, creator text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), package_id text
);
-- Legacy rows have no verified package binding. Keep them for audit, but only a
-- fresh chain/package verification during registration makes them discoverable.
ALTER TABLE market_catalog ADD COLUMN IF NOT EXISTS package_id text;
CREATE INDEX IF NOT EXISTS market_catalog_package_listing ON market_catalog(package_id,listing_id);
CREATE TABLE IF NOT EXISTS market_previews (
 listing_id text PRIMARY KEY REFERENCES market_catalog(listing_id),
 content_hash text NOT NULL, summary text NOT NULL, image_url text
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
CREATE TABLE IF NOT EXISTS publications (
 id uuid PRIMARY KEY, owner text NOT NULL, package_id text NOT NULL, character_id bigint NOT NULL CHECK(character_id>0),
 fingerprint text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(owner,package_id,character_id,fingerprint)
);
CREATE TABLE IF NOT EXISTS publication_steps (
 publication_id uuid NOT NULL REFERENCES publications(id), step text NOT NULL CHECK(step IN ('creator','listing','publish')),
 tx_bytes text NOT NULL, signature text NOT NULL, digest text NOT NULL,
 PRIMARY KEY(publication_id,step)
);
`;

export function connectDatabase(url: string) {
  return new pg.Pool({ connectionString: url, max: 10, connectionTimeoutMillis: 5000,
    statement_timeout: 10000 });
}
