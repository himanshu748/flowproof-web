-- Operator setup for a NEW, dedicated Tiger service only.
-- Verify its funding boundary and TLS chain/hostname first. Never run this on
-- FieldIssue or another shared service. Inspect PUBLIC metadata privileges and
-- existing objects before provisioning; SQL alone cannot prove cloud isolation.
-- Use psql -X with sslmode=verify-full and a private password environment value.
-- This migration is not executed by the application and never changes billing.
\set ON_ERROR_STOP on
\getenv briefstamp_runtime_password BRIEFSTAMP_NEW_TIGER_PASSWORD
BEGIN;
CREATE ROLE briefstamp_demo_runtime LOGIN
  PASSWORD :'briefstamp_runtime_password'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS
  CONNECTION LIMIT 2 VALID UNTIL '2026-10-20 00:00:00+00';
ALTER ROLE briefstamp_demo_runtime SET statement_timeout = '5s';
ALTER ROLE briefstamp_demo_runtime SET lock_timeout = '2s';
ALTER ROLE briefstamp_demo_runtime SET idle_in_transaction_session_timeout = '5s';
ALTER ROLE briefstamp_demo_runtime SET search_path = pg_catalog, briefstamp_demo_v1;
CREATE SCHEMA briefstamp_demo_v1;
REVOKE ALL ON SCHEMA briefstamp_demo_v1 FROM PUBLIC;
CREATE TABLE briefstamp_demo_v1.audits (
  session_hash text NOT NULL CHECK (session_hash ~ '^[a-f0-9]{64}$'),
  audit_id uuid NOT NULL,
  project_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  payload jsonb NOT NULL,
  failure_text text NOT NULL,
  search tsvector GENERATED ALWAYS AS (to_tsvector('simple', failure_text)) STORED,
  PRIMARY KEY (session_hash, audit_id),
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '30 minutes'),
  CHECK (octet_length(payload::text) <= 2097152),
  CHECK (octet_length(failure_text) <= 262144),
  CHECK ((payload->>'id') IS NOT DISTINCT FROM audit_id::text),
  CHECK ((payload->>'projectId') IS NOT DISTINCT FROM project_id::text),
  CHECK ((payload->>'status') IS NOT DISTINCT FROM 'completed'),
  CHECK ((payload->'source'->>'target') IS NOT DISTINCT FROM 'sample'),
  CHECK (jsonb_array_length(payload->'results') BETWEEN 1 AND 24)
);
CREATE INDEX briefstamp_demo_scope_expiry
  ON briefstamp_demo_v1.audits (session_hash, project_id, expires_at);
CREATE INDEX briefstamp_demo_lexical
  ON briefstamp_demo_v1.audits USING gin (search);
REVOKE ALL ON briefstamp_demo_v1.audits FROM PUBLIC;
GRANT USAGE ON SCHEMA briefstamp_demo_v1 TO briefstamp_demo_runtime;
GRANT SELECT, INSERT ON briefstamp_demo_v1.audits TO briefstamp_demo_runtime;
SELECT format('GRANT CONNECT ON DATABASE %I TO briefstamp_demo_runtime', current_database()) \gexec
COMMIT;
\unset briefstamp_runtime_password
-- Application reads expire logically after 30 minutes; this is not automatic
-- physical deletion. The runtime role deliberately has no DELETE or DDL grant.
-- The demo login expires on October 20; the service itself does not auto-pause.
