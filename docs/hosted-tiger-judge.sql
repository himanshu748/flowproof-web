-- REVIEWED PLAN ONLY. Execute only after explicit approval on Briefstamp's
-- dedicated existing Tiger trial, using authenticated strict-TLS admin access.
-- Additive tables only: no FieldIssue, billing, old rows, expiry or grants change.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout = '5s';
SET LOCAL lock_timeout = '2s';

CREATE TABLE briefstamp_demo_v1.judge_agent_grants (
  grant_id uuid PRIMARY KEY,
  proof_sha256 text NOT NULL CHECK (proof_sha256 ~ '^[a-f0-9]{64}$'),
  max_runs integer NOT NULL CHECK (max_runs = 12),
  expires_at timestamptz NOT NULL CHECK (expires_at <= '2026-10-20 00:00:00+00'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at),
  CHECK (created_at < '2026-10-20 00:00:00+00')
);
CREATE TABLE briefstamp_demo_v1.judge_agent_reservations (
  run_id uuid PRIMARY KEY,
  grant_id uuid NOT NULL REFERENCES briefstamp_demo_v1.judge_agent_grants (grant_id),
  slot integer NOT NULL CHECK (slot BETWEEN 1 AND 12),
  session_hash text NOT NULL CHECK (session_hash ~ '^[a-f0-9]{64}$'),
  project_id uuid NOT NULL,
  audit_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (grant_id, slot),
  UNIQUE (grant_id, session_hash),
  UNIQUE (run_id, session_hash, audit_id),
  FOREIGN KEY (session_hash, audit_id) REFERENCES briefstamp_demo_v1.audits (session_hash, audit_id),
  CHECK (created_at < '2026-10-20 00:00:00+00')
);
CREATE INDEX briefstamp_judge_agent_hourly
  ON briefstamp_demo_v1.judge_agent_reservations (grant_id, created_at);
CREATE TABLE briefstamp_demo_v1.judge_agent_results (
  run_id uuid PRIMARY KEY,
  session_hash text NOT NULL CHECK (session_hash ~ '^[a-f0-9]{64}$'),
  audit_id uuid NOT NULL,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  status text NOT NULL CHECK (status IN ('completed','completed_with_unavailable_tools','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (run_id, session_hash, audit_id)
    REFERENCES briefstamp_demo_v1.judge_agent_reservations (run_id, session_hash, audit_id),
  CHECK (octet_length(payload::text) <= 262144),
  CHECK (payload->>'status' = status),
  CHECK (created_at < '2026-10-20 00:00:00+00')
);
REVOKE ALL ON briefstamp_demo_v1.judge_agent_grants FROM PUBLIC;
REVOKE ALL ON briefstamp_demo_v1.judge_agent_reservations FROM PUBLIC;
REVOKE ALL ON briefstamp_demo_v1.judge_agent_results FROM PUBLIC;
GRANT SELECT, INSERT ON briefstamp_demo_v1.judge_agent_grants TO briefstamp_demo_runtime;
GRANT SELECT, INSERT ON briefstamp_demo_v1.judge_agent_reservations TO briefstamp_demo_runtime;
GRANT SELECT, INSERT ON briefstamp_demo_v1.judge_agent_results TO briefstamp_demo_runtime;
COMMIT;

-- Application transactions use one connection and a grant-scoped advisory lock,
-- not SELECT FOR UPDATE. Only confirmed COMMIT authorizes provider I/O.
-- UNIQUE slots enforce twelve reservations; the locked DB count enforces six
-- grant runs/hour. Failed/ambiguous outcomes never delete or refund a reservation.
