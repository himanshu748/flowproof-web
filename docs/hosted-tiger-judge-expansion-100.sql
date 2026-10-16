-- Explicitly approved, one-time expansion on Briefstamp's existing Tiger trial.
-- Admin-only migration; the application receives SELECT on the new seal table.
-- 100 is the total allowance, including all existing spent reservations.
-- The original grant/proof, audits, reservations and results are never rewritten.
-- Apply after tests and review, with strict TLS and fresh confirmed-free funding.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout = '5s';
SET LOCAL lock_timeout = '2s';
SELECT pg_advisory_xact_lock(hashtextextended(
  'briefstamp-judge:69c1acd6-6a7c-44e1-bb82-e4d2544a62ea', 0
));

DO $$
DECLARE old_constraint text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM briefstamp_demo_v1.judge_agent_grants
    WHERE grant_id = '69c1acd6-6a7c-44e1-bb82-e4d2544a62ea'
      AND proof_sha256 = 'fbaef465b12db6c4b1571d61cb50b3347a6b4189cb39ff09efbd392f1ea64f5c'
      AND max_runs = 12
      AND expires_at = '2026-10-20 00:00:00+00'
      AND expires_at > now()
  ) THEN
    RAISE EXCEPTION 'The original immutable grant seal is missing or changed';
  END IF;
  SELECT pg_get_constraintdef(oid) INTO old_constraint
  FROM pg_constraint
  WHERE conrelid = 'briefstamp_demo_v1.judge_agent_reservations'::regclass
    AND conname = 'judge_agent_reservations_slot_check' AND contype = 'c';
  IF old_constraint IS NULL OR
    regexp_replace(old_constraint, '[[:space:]()]', '', 'g') <> 'CHECKslot>=1ANDslot<=12'
  THEN
    RAISE EXCEPTION 'The original twelve-slot constraint is missing or changed';
  END IF;
END $$;

CREATE TABLE briefstamp_demo_v1.judge_agent_expansions (
  grant_id uuid PRIMARY KEY
    REFERENCES briefstamp_demo_v1.judge_agent_grants (grant_id)
    CHECK (grant_id = '69c1acd6-6a7c-44e1-bb82-e4d2544a62ea'),
  expansion_id uuid NOT NULL UNIQUE
    CHECK (expansion_id = 'a3b8d32e-e7ec-4576-bbac-c0b9d74baaaa'),
  proof_sha256 text NOT NULL
    CHECK (proof_sha256 = 'cf9fa8a9367035b7226401f8c90b4e59a1072a8620e05ca6b411479704a8804a'),
  base_proof_sha256 text NOT NULL
    CHECK (base_proof_sha256 = 'fbaef465b12db6c4b1571d61cb50b3347a6b4189cb39ff09efbd392f1ea64f5c'),
  max_runs integer NOT NULL CHECK (max_runs = 100),
  expires_at timestamptz NOT NULL
    CHECK (expires_at = '2026-10-20 00:00:00+00'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (created_at < expires_at)
);
REVOKE ALL ON briefstamp_demo_v1.judge_agent_expansions FROM PUBLIC;
REVOKE ALL ON briefstamp_demo_v1.judge_agent_expansions FROM briefstamp_demo_runtime;
GRANT SELECT ON briefstamp_demo_v1.judge_agent_expansions TO briefstamp_demo_runtime;

INSERT INTO briefstamp_demo_v1.judge_agent_expansions
  (grant_id, expansion_id, proof_sha256, base_proof_sha256, max_runs, expires_at)
SELECT grant_id,
  'a3b8d32e-e7ec-4576-bbac-c0b9d74baaaa',
  'cf9fa8a9367035b7226401f8c90b4e59a1072a8620e05ca6b411479704a8804a',
  proof_sha256, 100, expires_at
FROM briefstamp_demo_v1.judge_agent_grants
WHERE grant_id = '69c1acd6-6a7c-44e1-bb82-e4d2544a62ea'
  AND proof_sha256 = 'fbaef465b12db6c4b1571d61cb50b3347a6b4189cb39ff09efbd392f1ea64f5c'
  AND max_runs = 12 AND expires_at > now();

ALTER TABLE briefstamp_demo_v1.judge_agent_reservations
  DROP CONSTRAINT judge_agent_reservations_slot_check,
  ADD CONSTRAINT briefstamp_judge_slots_expanded_100 CHECK (
    slot BETWEEN 1 AND 12 OR (
      grant_id = '69c1acd6-6a7c-44e1-bb82-e4d2544a62ea'
      AND slot BETWEEN 13 AND 100
    )
  );
COMMIT;

-- Before activation, read back both seals, runtime SELECT-only privileges,
-- original reservation/result identities and their unchanged hashes/counts.
-- Only then add BRIEFSTAMP_JUDGE_AGENT_EXPANSION_PROOF_JSON to Render.
-- Keep the original BRIEFSTAMP_JUDGE_AGENT_PROOF_JSON byte-for-byte unchanged.
-- The runtime keeps six runs/hour, one/session and two model calls + one search.
-- Ambiguous migration/COMMIT outcomes require read-only inspection, never reset.
