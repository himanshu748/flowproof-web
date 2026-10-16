import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import { isDeepStrictEqual } from "node:util";
import type { Audit, Bootstrap, Project } from "../shared/types.js";
import { loadAgentRetrievalCatalog } from "../server/agent-retrieval-catalog.js";

// Default mode performs no file/network/provider operation. No automatic rerun.
if (process.argv.slice(2).join(" ") !== "--run") {
  console.log(
    "Not run. --run requires the prepared one-shot allowance, existing operator access and the exact green deployed commit. No requests sent.",
  );
} else await verify();

async function verify() {
  const accessFile = process.env.BRIEFSTAMP_HOSTED_ACCESS_FILE;
  const expectedCommit = process.env.BRIEFSTAMP_EXPECTED_COMMIT;
  assert(accessFile && /^[a-f0-9]{40}$/.test(expectedCommit || ""));
  const access = JSON.parse(await readFile(accessFile, "utf8"));
  const token = access.FLOWPROOF_TOKEN;
  const proof = JSON.parse(access.BRIEFSTAMP_EVIDENCE_AGENT_PROOF_JSON);
  assert(typeof token === "string" && token.length >= 32);
  assert.equal(proof.usedRuns, 0);
  const startedAt = new Date().toISOString();
  const origin = "https://flowproof-demo.onrender.com";
  const directory = path.resolve(
    "work/hosted-evidence-agent",
    startedAt.replace(/[:.]/g, "-"),
  );
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const statePath = path.resolve(
    `work/evidence-agent-${proof.trancheId}.reservation.json`,
  );
  const state = {
    startedAt,
    trancheId: proof.trancheId,
    status: "reserved_no_retry",
    maxModelCalls: 2,
    maxSearchCalls: 1,
    routeAttempted: false,
  };
  // Persist an off-host one-shot reservation before even a health/bootstrap read.
  await writeFile(statePath, JSON.stringify(state, null, 2), {
    flag: "wx",
    mode: 0o600,
  });
  const receipt: Record<string, any> = {
    startedAt,
    status: "running",
    origin,
    sourceCommit: expectedCommit,
    trancheId: proof.trancheId,
    maxModelCalls: 2,
    maxSearchCalls: 1,
    retries: 0,
    billingChanges: 0,
    priorAllowancesReset: false,
    approval: { actor: "automated synthetic verifier", humanApproval: false },
    calls: [],
    artifacts: [],
    limitations: [
      "Fixed synthetic evidence and fixed owned homepage only.",
      "Precomputed exact-text MiniLM embeddings and three fixed query vectors; PostgreSQL arrays, not pgvector or arbitrary hosted embedding inference.",
      "Search results are observations, not proof of de-indexing or browser acceptance.",
    ],
  };
  let cookie = "",
    otherCookie = "";
  const deadline = Date.now() + 5 * 60_000;
  const hash = (value: Buffer | string) =>
    createHash("sha256").update(value).digest("hex");
  const safeJson = (value: unknown) => {
    const json = JSON.stringify(value, null, 2) + "\n";
    for (const secret of Object.entries(access)
      .filter(([key]) => /KEY|TOKEN|DATABASE_URL|DSN/.test(key))
      .map(([, v]) => v))
      assert(
        typeof secret !== "string" || !secret || !json.includes(secret),
        "Receipt contained a private credential",
      );
    return json;
  };
  const artifact = async (name: string, value: unknown) => {
    assert(/^[a-z0-9-]+\.json$/.test(name));
    const bytes = safeJson(value);
    await writeFile(path.join(directory, name), bytes, { mode: 0o600 });
    receipt.artifacts.push({
      file: name,
      bytes: Buffer.byteLength(bytes),
      sha256: hash(bytes),
    });
  };
  async function request<T>(
    route: string,
    options: {
      body?: unknown;
      method?: string;
      expected?: number;
      auth?: boolean;
      other?: boolean;
      fresh?: boolean;
    } = {},
  ) {
    assert(Date.now() < deadline);
    assert(
      (route === "/health" || route.startsWith("/api/")) &&
        !/[#\\]/.test(route),
    );
    const response = await fetch(origin + route, {
      method: options.method ?? (options.body === undefined ? "GET" : "POST"),
      redirect: "error",
      signal: AbortSignal.timeout(Math.min(100_000, deadline - Date.now())),
      headers: {
        ...((options.fresh ? "" : options.other ? otherCookie : cookie)
          ? { cookie: options.other ? otherCookie : cookie }
          : {}),
        ...(options.auth ? { "X-FlowProof-Token": token } : {}),
        ...(options.body === undefined
          ? {}
          : { origin, "content-type": "application/json" }),
      },
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    receipt.calls.push({
      route,
      method: options.method ?? (options.body === undefined ? "GET" : "POST"),
      status: response.status,
    });
    const received = response.headers.get("set-cookie");
    if (received) {
      assert(/HttpOnly/i.test(received) && /Secure/i.test(received));
      if (options.other) otherCookie = received.split(";")[0];
      else cookie = received.split(";")[0];
    }
    const bytes = await response.arrayBuffer();
    assert(bytes.byteLength < 2 * 1024 * 1024);
    const value = JSON.parse(Buffer.from(bytes).toString("utf8"));
    if (response.status !== (options.expected ?? 200)) {
      await artifact("unexpected-response.json", {
        route,
        status: response.status,
        response: value,
      });
    }
    assert.equal(
      response.status,
      options.expected ?? 200,
      `${route} HTTP ${response.status}`,
    );
    return {
      value: value as T,
      storage: response.headers.get("X-Briefstamp-Storage"),
    };
  }
  try {
    const status = await request<{ status: string }>("/health");
    assert.equal(status.value.status, "ok");
    const availability = (
      await request<{ evidenceAgent: boolean }>("/api/operator/status", {
        auth: true,
      })
    ).value;
    assert.equal(availability.evidenceAgent, true);
    const boot = (await request<Bootstrap>("/api/bootstrap")).value;
    const sample = boot.projects.find((p) => p.target === "sample")!;
    assert(sample);
    const website = (
      await request<Project>("/api/projects/preset", {
        body: { preset: "briefstamp-live" },
        expected: 201,
      })
    ).value;
    const selected = (
      await request<Project>(`/api/projects/${sample.id}/variant`, {
        body: { sampleVariant: "broken" },
      })
    ).value;
    await request(`/api/projects/${sample.id}/audits`, {
      body: {},
      expected: 409,
    });
    await request(`/api/projects/${sample.id}/checks`, {
      method: "PUT",
      body: {
        checks: selected.checks.map((c) => ({
          ...c,
          approved: c.kind !== "manual",
        })),
      },
    });
    let audit = (
      await request<Audit>(`/api/projects/${sample.id}/audits`, {
        body: {},
        expected: 202,
      })
    ).value;
    for (let i = 0; i < 100 && audit.status !== "completed"; i++) {
      await pause(500);
      audit = (await request<Audit>(`/api/audits/${audit.id}`)).value;
      assert.notEqual(audit.status, "error");
    }
    assert.equal(audit.status, "completed");
    receipt.browserCounts = Object.fromEntries(
      ["passed", "failed", "blocked", "unverified"].map((s) => [
        s,
        audit.results.filter((r) => r.status === s).length,
      ]),
    );
    assert.deepEqual(receipt.browserCounts, {
      passed: 2,
      failed: 3,
      blocked: 0,
      unverified: 1,
    });
    for (let i = 0; i < 25; i++) {
      const p = (
        await request<{ status: string }>(`/api/audits/${audit.id}/persistence`)
      ).value;
      if (p.status === "saved") break;
      await pause(200);
    }
    const roundtrip = await request<Audit>(`/api/audits/${audit.id}`);
    assert.equal(roundtrip.storage, "tiger");
    assert(isDeepStrictEqual(roundtrip.value, audit));
    await artifact("source-audit.json", audit);
    const mobile = audit.results.find(
      (row) => row.kind === "no_horizontal_overflow",
    )!;
    const screenshot = mobile.evidence.screenshot;
    assert(
      typeof screenshot === "string" &&
        /^\/evidence\/[a-f0-9-]{36}\/[A-Za-z0-9_-]+\.png$/.test(screenshot),
    );
    const imageResponse = await fetch(origin + screenshot, {
      redirect: "error",
      headers: { cookie },
      signal: AbortSignal.timeout(15_000),
    });
    assert.equal(imageResponse.status, 200);
    const imageBytes = Buffer.from(await imageResponse.arrayBuffer());
    assert(imageBytes.length > 1000 && imageBytes.length < 2 * 1024 * 1024);
    assert.equal(imageBytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    await writeFile(
      path.join(directory, "observed-mobile-failure.png"),
      imageBytes,
      { mode: 0o600 },
    );
    receipt.artifacts.push({
      file: "observed-mobile-failure.png",
      bytes: imageBytes.length,
      sha256: hash(imageBytes),
    });
    const route = `/api/audits/${audit.id}/agent-review`;
    const body = { websiteProjectId: website.id, modelConsent: true };
    await request(route, { body, expected: 404 });
    await request(route, {
      body: { ...body, modelConsent: false },
      auth: true,
      expected: 400,
    });
    await request("/api/bootstrap", { other: true, fresh: true });
    await request(route, { body, auth: true, other: true, expected: 404 });
    const lexical = (
      await request<{ results: unknown[]; mode: string }>(
        `/api/failures?projectId=${sample.id}&q=${encodeURIComponent("sideways panning on smartphones")}`,
      )
    ).value;
    assert.equal(lexical.mode, "tiger-lexical");
    assert.equal(lexical.results.length, 0);
    await artifact("lexical-control.json", lexical);
    state.routeAttempted = true;
    await writeFile(statePath, JSON.stringify(state, null, 2), { mode: 0o600 });
    const agent = (
      await request<Record<string, any>>(route, { body, auth: true })
    ).value;
    await artifact("agent-run.json", agent);
    assert.equal(agent.auditUnchanged, true);
    assert.equal(agent.reservation.consumed, true);
    const tools = agent.toolReceipts as Array<{ tool: string; result: any }>;
    const history = tools.find((x) => x.tool === "failure_history")?.result;
    const search = tools.find((x) => x.tool === "search_visibility")?.result;
    assert(
      history?.length > 0 && search?.status === "observed",
      "Both actual tools must be selected and consumed before a category claim",
    );
    assert.equal(agent.transport, "native_google_gemma");
    assert.equal(agent.status, "completed");
    assert.equal(agent.modelTurns.length, 2);
    assert(
      agent.modelTurns.every(
        (turn: any) =>
          turn.result?.attempts?.length === 1 &&
          turn.result.attempts[0].status === 200,
      ),
    );
    assert(
      agent.modelOutput.findings.some(
        (finding: any) =>
          finding.type === "historical_failure" &&
          history.some(
            (row: any) =>
              row.auditId === finding.auditId &&
              row.checkId === finding.checkId &&
              row.status === finding.status,
          ),
      ),
      "The second actual model turn must cite a returned Tiger failure",
    );
    assert(
      agent.modelOutput.findings.some(
        (finding: any) =>
          finding.type === "search_snapshot" &&
          finding.resultCount === search.results.length,
      ),
      "The second actual model turn must cite the live SerpApi observation",
    );
    assert.equal(history[0].queryId, "mobile_paraphrase");
    assert.equal(history[0].kind, "no_horizontal_overflow");
    assert(
      history.every((r: any) => r.lexicalRank === null && r.lexicalScore === 0),
    );
    const catalog = await loadAgentRetrievalCatalog();
    const q = catalog.queries.find((q) => q.id === "mobile_paraphrase")!;
    const independent = history.map((row: any) => {
      const d = catalog.documents.find((d) => d.textSha256 === row.textSha256)!;
      assert(d);
      const cosine = d.vector.reduce((s, x, i) => s + x * q.vector[i], 0);
      assert(Math.abs(cosine - row.cosine) < 1e-7);
      return {
        checkId: row.checkId,
        kind: row.kind,
        cosine,
        sqlCosine: row.cosine,
        rrf: row.rrf,
      };
    });
    await artifact("independent-cosine.json", {
      query: q.text,
      catalogSha256: catalog.catalogSha256,
      rows: independent,
    });
    await artifact("serpapi-search.json", search);
    // Duplicate hits Tiger's UNIQUE tranche reservation before either model/tool.
    await request(route, { body, auth: true, expected: 409 });
    const after = await request<Audit>(`/api/audits/${audit.id}`);
    assert.equal(after.storage, "tiger");
    assert(isDeepStrictEqual(after.value, audit));
    receipt.agent = agent;
    receipt.sourceAuditUnchanged = true;
    receipt.duplicateBlockedHttp = 409;
    receipt.crossVisitorBlockedHttp = 404;
    receipt.noConsentBlockedHttp = 400;
    receipt.tokenlessBlockedHttp = 404;
    receipt.lexicalControlMatches = 0;
    receipt.status = "verified";
  } catch (error) {
    receipt.status = "failed";
    receipt.error = error instanceof Error ? error.message : "Unknown failure";
    process.exitCode = 1;
  } finally {
    receipt.completedAt = new Date().toISOString();
    await writeFile(path.join(directory, "receipt.json"), safeJson(receipt), {
      mode: 0o600,
    });
    await writeFile(
      statePath,
      JSON.stringify(
        {
          ...state,
          status: "consumed_no_retry",
          receipt: path.relative(
            process.cwd(),
            path.join(directory, "receipt.json"),
          ),
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    console.log(
      JSON.stringify({
        status: receipt.status,
        receipt: path.relative(
          process.cwd(),
          path.join(directory, "receipt.json"),
        ),
        error: receipt.error ?? null,
      }),
    );
  }
}
