-- Additive migration prepared for the existing dedicated Briefstamp Tiger trial.
-- Run only after operator verification of trial funding, service identity, the
-- vector extension's availability and strict TLS (sslmode=verify-full).
-- Never run on FieldIssue. This file does not change runtime grants, public
-- allowance/reservation records, source audits, old array values or role expiry.
-- Runtime deployment using embedding_vector must follow successful migration.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '2s';

-- pgvector is installed by the operator, never by the restricted runtime role.
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;
DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_extension e
    JOIN pg_namespace n ON n.oid = e.extnamespace
    WHERE e.extname = 'vector' AND n.nspname = 'public'
  ) THEN
    RAISE EXCEPTION 'Expected pgvector in the public schema; migration refused';
  END IF;
END
$migration$;

-- A stored generated vector materializes every existing embedding and maintains
-- new INSERTs atomically. Retaining immutable float64 arrays preserves earlier
-- evidence receipts and compatibility with the old application during rollout.
-- The runtime cannot supply or overwrite the generated vector independently.
-- Explicit dimensionality and nonzero near-unit norm protect cosine distance.
-- Deliberately no IF NOT EXISTS: a pre-existing column needs operator inspection,
-- rather than silently accepting a different type or generation expression.
ALTER TABLE briefstamp_demo_v1.failure_embeddings
  ADD COLUMN embedding_vector public.vector(384)
  GENERATED ALWAYS AS (embedding::public.vector(384)) STORED NOT NULL,
  ADD CONSTRAINT briefstamp_demo_embeddings_vector_norm
    CHECK (public.vector_norm(embedding_vector) BETWEEN 0.99999 AND 1.00001);

COMMIT;

-- Read-only postflight. The operator should retain row counts, old row/audit
-- hashes, extension version and this result with the actual migration receipt.
SELECT count(*) AS embedding_rows,
       count(embedding_vector) AS stored_vector_rows,
       min(public.vector_dims(embedding_vector)) AS minimum_dimensions,
       max(public.vector_dims(embedding_vector)) AS maximum_dimensions
FROM briefstamp_demo_v1.failure_embeddings;

-- No approximate index is requested: the bounded catalog uses an exact scan.
-- DiskANN is optional and is not claimed or installed by this migration.
-- Any failed cast/norm check rolls the complete migration transaction back.
-- Runtime must already have schema/type USAGE and cast/operator EXECUTE access;
-- verify that separately under its existing restricted role before deployment.
