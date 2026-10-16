-- OPTIONAL, separate operator migration after hosted-tiger-pgvector.sql.
-- Run only on the confirmed existing Briefstamp Tiger trial with verified TLS,
-- fresh funding and a confirmed available vectorscale extension. Never FieldIssue.
-- This prepares an optional index; installation alone does not prove index use,
-- improved latency/recall or execution of a DiskANN path in the current app.
-- Current bounded, full-candidate hybrid RRF intentionally keeps exact rankings.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '2s';

-- pgvector must already be installed; do not create other dependency extensions.
CREATE EXTENSION IF NOT EXISTS vectorscale WITH SCHEMA public;
DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_extension e
    JOIN pg_namespace n ON n.oid = e.extnamespace
    WHERE e.extname = 'vector' AND n.nspname = 'public'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_extension e
    JOIN pg_namespace n ON n.oid = e.extnamespace
    WHERE e.extname = 'vectorscale' AND n.nspname = 'public'
  ) THEN
    RAISE EXCEPTION 'Expected vector and vectorscale in public; migration refused';
  END IF;
END
$migration$;

CREATE INDEX briefstamp_demo_embeddings_diskann
  ON briefstamp_demo_v1.failure_embeddings
  USING diskann (embedding_vector public.vector_cosine_ops);
COMMIT;

-- Read-only postflight; retain actual index definition, validity and query plan
-- separately. Do not infer performance from this tiny fixed catalog.
SELECT indexrelid::regclass AS index_name, indisvalid, indisready,
       pg_get_indexdef(indexrelid) AS definition
FROM pg_index
WHERE indexrelid = 'briefstamp_demo_v1.briefstamp_demo_embeddings_diskann'::regclass;

-- No runtime permissions, audits, embedding source arrays, grants, reservations,
-- expiry boundaries, provider allowances or application query semantics change.
