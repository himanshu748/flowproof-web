import fs from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import type { Project, Audit } from "../shared/types";
import { embed } from "./embeddings";
import { databaseConfig } from "./database";

interface State {
  projects: Project[];
  audits: Audit[];
}
const dataRoot = path.resolve(process.env.FLOWPROOF_DATA_DIR || "data");
const stateFile = path.join(dataRoot, "state.json");
let state: State = { projects: [], audits: [] };
let writeQueue: Promise<void> = Promise.resolve();
const pool = process.env.DATABASE_URL
  ? new pg.Pool(databaseConfig(process.env.DATABASE_URL))
  : null;
export const storageMode = pool ? "PostgreSQL" : "Local JSON storage";
export async function initStore() {
  await fs.mkdir(dataRoot, { recursive: true, mode: 0o700 });
  if (pool) {
    await pool.query(
      "CREATE TABLE IF NOT EXISTS flowproof_state (id integer PRIMARY KEY CHECK (id=1), payload jsonb NOT NULL)",
    );
    await pool.query(
      `CREATE TABLE IF NOT EXISTS flowproof_failures (id text PRIMARY KEY, audit_id text NOT NULL, project_name text NOT NULL, requirement text NOT NULL, observed text NOT NULL, status text NOT NULL, created_at timestamptz NOT NULL, search tsvector GENERATED ALWAYS AS (to_tsvector('english', requirement || ' ' || observed)) STORED)`,
    );
    await pool.query(
      "CREATE INDEX IF NOT EXISTS flowproof_failure_search ON flowproof_failures USING GIN(search)",
    );
    await pool.query(
      "ALTER TABLE flowproof_failures ADD COLUMN IF NOT EXISTS embedding double precision[]",
    );
    await pool.query(
      "CREATE TABLE IF NOT EXISTS flowproof_evidence (path text PRIMARY KEY, content bytea NOT NULL)",
    );
    const row = await pool.query(
      "SELECT payload FROM flowproof_state WHERE id=1",
    );
    if (row.rows[0]) state = row.rows[0].payload;
  } else {
    try {
      state = JSON.parse(await fs.readFile(stateFile, "utf8"));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
  }
  await persist((candidate) => {
    for (const a of candidate.audits)
      if ((a.status === "running" || a.status === "queued") && !a.workflow) {
        a.status = "error";
        a.error =
          "The server restarted before the audit finished. Run a new audit.";
        a.completedAt = new Date().toISOString();
      }
  });
}
async function persist(mutate: (candidate: State) => void | Promise<void>) {
  const next = writeQueue.then(async () => {
    // Clone when this operation begins, after all preceding writes have settled.
    // Failed candidates never become the base of a later queued mutation.
    const candidate = structuredClone(state);
    await mutate(candidate);
    const snapshot = JSON.stringify(candidate);
    if (pool)
      await pool.query(
        "INSERT INTO flowproof_state(id,payload) VALUES(1,$1) ON CONFLICT(id) DO UPDATE SET payload=EXCLUDED.payload",
        [snapshot],
      );
    else {
      await fs.writeFile(stateFile + ".tmp", snapshot, { mode: 0o600 });
      await fs.rename(stateFile + ".tmp", stateFile);
    }
    state = candidate;
  });
  writeQueue = next.catch(() => {});
  await next;
}
export const allProjects = () => structuredClone(state.projects);
export const allAudits = () => structuredClone(state.audits);
export const getProject = (id: string) =>
  structuredClone(state.projects.find((p) => p.id === id));
export const getAudit = (id: string) =>
  structuredClone(state.audits.find((a) => a.id === id));
export async function saveProject(p: Project) {
  const project = structuredClone(p);
  await persist((candidate) => {
    const i = candidate.projects.findIndex((x) => x.id === project.id);
    if (i < 0) candidate.projects.unshift(project);
    else candidate.projects[i] = project;
  });
  return p;
}
export async function saveAudit(a: Audit) {
  const audit = structuredClone(a);
  await persist(async (candidate) => {
    if (pool && audit.status === "completed") {
      for (const r of audit.results.filter(
        (r) => r.status === "failed" || r.status === "blocked",
      )) {
        const vector = await embed(`${r.requirement} ${r.evidence.observed}`);
        await pool.query(
          "INSERT INTO flowproof_failures(id,audit_id,project_name,requirement,observed,status,created_at,embedding) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO UPDATE SET embedding=COALESCE(EXCLUDED.embedding,flowproof_failures.embedding)",
          [
            `${audit.id}:${r.checkId}`,
            audit.id,
            audit.projectName,
            r.requirement,
            r.evidence.observed,
            r.status,
            audit.createdAt,
            vector,
          ],
        );
      }
      for (const r of audit.results)
        if (r.evidence.screenshot) {
          const image = await readEvidence(r.evidence.screenshot);
          if (!image || image.length >= 5_000_000)
            throw new Error(
              "A referenced screenshot could not be saved within the database evidence limit.",
            );
          await pool.query(
            "INSERT INTO flowproof_evidence(path,content) VALUES($1,$2) ON CONFLICT(path) DO NOTHING",
            [r.evidence.screenshot, image],
          );
        }
    }
    const i = candidate.audits.findIndex((x) => x.id === audit.id);
    if (i < 0) candidate.audits.unshift(audit);
    else candidate.audits[i] = audit;
  });
  return a;
}
export async function readEvidence(
  evidencePath: string,
): Promise<Buffer | null> {
  if (!/^\/evidence\/[a-f0-9-]+\/[a-zA-Z0-9_.-]+\.png$/.test(evidencePath))
    return null;
  try {
    return await fs.readFile(path.join(dataRoot, evidencePath.slice(1)));
  } catch {
    if (pool) {
      const row = await pool.query(
        "SELECT content FROM flowproof_evidence WHERE path=$1",
        [evidencePath],
      );
      return row.rows[0]?.content || null;
    }
    return null;
  }
}
export async function searchFailures(query: string) {
  if (pool) {
    const vector = query ? await embed(query) : null;
    if (vector) {
      const result = await pool.query(
        `SELECT audit_id AS "auditId", project_name AS "projectName", requirement, observed, status, created_at AS "createdAt", COALESCE((SELECT sum(a*b) FROM unnest(embedding,$2::double precision[]) AS pair(a,b)),0) AS similarity FROM flowproof_failures WHERE search @@ websearch_to_tsquery('english',$1) OR embedding IS NOT NULL ORDER BY (COALESCE((SELECT sum(a*b) FROM unnest(embedding,$2::double precision[]) AS pair(a,b)),0) + ts_rank(search,websearch_to_tsquery('english',$1))) DESC, created_at DESC LIMIT 30`,
        [query, vector],
      );
      return {
        results: result.rows,
        mode: "PostgreSQL lexical + MiniLM vector retrieval",
      };
    }
    const result = await pool.query(
      `SELECT audit_id AS "auditId", project_name AS "projectName", requirement, observed, status, created_at AS "createdAt" FROM flowproof_failures WHERE ($1 = '' OR search @@ websearch_to_tsquery('english',$1)) ORDER BY ts_rank(search,websearch_to_tsquery('english',$1)) DESC,created_at DESC LIMIT 30`,
      [query],
    );
    return { results: result.rows, mode: "PostgreSQL full-text retrieval" };
  }
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  return {
    results: state.audits
      .flatMap((a) =>
        a.results
          .filter((r) => r.status === "failed" || r.status === "blocked")
          .map((r) => ({
            auditId: a.id,
            projectName: a.projectName,
            requirement: r.requirement,
            observed: r.evidence.observed,
            status: r.status,
            createdAt: a.createdAt,
          })),
      )
      .filter((r) =>
        terms.every((t) =>
          `${r.requirement} ${r.observed}`.toLowerCase().includes(t),
        ),
      )
      .slice(0, 30),
    mode: "Local lexical retrieval",
  };
}
export { dataRoot };

/** Finish pending persistence before a one-shot integration process exits. */
export async function closeStore() {
  await writeQueue;
  await pool?.end();
}
