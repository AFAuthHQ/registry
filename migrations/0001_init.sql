CREATE TABLE IF NOT EXISTS listings (
  service_did       text PRIMARY KEY,
  discovery_url     text NOT NULL,
  discovery_host    text NOT NULL,
  discovery_doc     jsonb NOT NULL,
  fetched_at        timestamptz NOT NULL,
  first_listed_at   timestamptz NOT NULL,
  updated_at        timestamptz NOT NULL,
  status            text NOT NULL CHECK (status IN ('active','stale','deleted')),
  consecutive_fails int NOT NULL DEFAULT 0,
  first_failed_at   timestamptz,
  title             text,
  description       text,
  tags              text[] NOT NULL DEFAULT '{}',
  meta              jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS listings_updated_at_idx ON listings (updated_at);
CREATE INDEX IF NOT EXISTS listings_status_updated_idx ON listings (status, updated_at);
CREATE INDEX IF NOT EXISTS listings_tags_idx ON listings USING GIN (tags);
CREATE UNIQUE INDEX IF NOT EXISTS listings_host_idx ON listings (discovery_host);
