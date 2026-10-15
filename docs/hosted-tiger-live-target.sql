-- Follow-on migration for Briefstamp's existing dedicated trial service only.
-- Verify the service identity and strict TLS first. Do not run on FieldIssue.
-- The operator must substitute the catalog-confirmed original target constraint
-- name for ORIGINAL_SAMPLE_TARGET_CHECK. No credential or role grants change.
BEGIN;
SET LOCAL statement_timeout = '5s';
SET LOCAL lock_timeout = '2s';
ALTER TABLE briefstamp_demo_v1.audits
  DROP CONSTRAINT "ORIGINAL_SAMPLE_TARGET_CHECK";
ALTER TABLE briefstamp_demo_v1.audits
  ADD CONSTRAINT briefstamp_demo_authorized_target CHECK (
    (
      (payload->'source'->>'target') IS NOT DISTINCT FROM 'sample'
      AND (payload->'source'->>'url' LIKE 'https://sample.flowproof.test/%') IS TRUE
    ) OR (
      (payload->'source'->>'target') IS NOT DISTINCT FROM 'website'
      AND (payload->'source'->>'url') IS NOT DISTINCT FROM 'https://flowproof-demo.onrender.com/'
    )
  );
COMMIT;
-- Runtime validation additionally requires the exact public website brief,
-- homepage-only checks and matching evidence URLs before SQL insertion/read.
