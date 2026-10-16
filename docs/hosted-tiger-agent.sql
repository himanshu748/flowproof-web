-- REVIEWED PLAN ONLY: an operator must approve and execute this additive migration.
-- Use only Briefstamp's existing dedicated Tiger trial service, with verified
-- funding and sslmode=verify-full. Never run on FieldIssue or Shared Free.
-- No extension, service, billing setting, existing audit, or role expiry changes.
-- These are portable PostgreSQL float arrays, NOT a pgvector integration.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout = '5s';
SET LOCAL lock_timeout = '2s';

CREATE TABLE briefstamp_demo_v1.failure_embeddings (
  session_hash text NOT NULL CHECK (session_hash ~ '^[a-f0-9]{64}$'),
  audit_id uuid NOT NULL,
  project_id uuid NOT NULL,
  check_id text NOT NULL CHECK (length(check_id) BETWEEN 1 AND 80),
  text_sha256 text NOT NULL CHECK (text_sha256 ~ '^[a-f0-9]{64}$'),
  model text NOT NULL CHECK (model = 'all-minilm:22m'),
  model_digest text NOT NULL CHECK (model_digest ~ '^[a-f0-9]{64}$'),
  catalog_sha256 text NOT NULL CHECK (catalog_sha256 ~ '^[a-f0-9]{64}$'),
  embedding double precision[] NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_hash, audit_id, check_id),
  FOREIGN KEY (session_hash, audit_id)
    REFERENCES briefstamp_demo_v1.audits (session_hash, audit_id),
  CHECK (array_ndims(embedding) = 1),
  CHECK (array_lower(embedding, 1) = 1),
  CHECK (cardinality(embedding) = 384),
  CHECK (array_position(embedding, NULL) IS NULL),
  CHECK (1::double precision >= ALL(embedding) AND -1::double precision <= ALL(embedding)),
  CHECK (created_at < '2026-10-20 00:00:00+00')
);
CREATE INDEX briefstamp_demo_embeddings_scope
  ON briefstamp_demo_v1.failure_embeddings (session_hash, project_id, audit_id);

-- An allowance is global, not per visitor or server process. Insertion happens
-- before external model/search I/O. Failure and process restart do not refund it.
-- Keep consumed rows across deployments. A new tranche requires fresh explicit
-- allowance approval; never manufacture one automatically or delete a used row.
CREATE TABLE briefstamp_demo_v1.agent_reservations (
  tranche_id text PRIMARY KEY CHECK (tranche_id ~ '^[a-z0-9][a-z0-9_-]{0,79}$'),
  session_hash text NOT NULL CHECK (session_hash ~ '^[a-f0-9]{64}$'),
  project_id uuid NOT NULL,
  audit_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (session_hash, audit_id)
    REFERENCES briefstamp_demo_v1.audits (session_hash, audit_id),
  CHECK (created_at < '2026-10-20 00:00:00+00')
);
REVOKE ALL ON briefstamp_demo_v1.failure_embeddings FROM PUBLIC;
REVOKE ALL ON briefstamp_demo_v1.agent_reservations FROM PUBLIC;
GRANT SELECT, INSERT ON briefstamp_demo_v1.failure_embeddings TO briefstamp_demo_runtime;
GRANT SELECT, INSERT ON briefstamp_demo_v1.agent_reservations TO briefstamp_demo_runtime;
COMMIT;

-- Existing connection cap, strict TLS, session ownership, 30-minute audit reads,
-- and October 20 login/funding cutoff remain in force. Runtime gets no UPDATE,
-- DELETE, CREATE or extension privileges. Logical expiry is not physical deletion.
