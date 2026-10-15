import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import { isDeepStrictEqual } from "node:util";
import type { Audit, Bootstrap, Check, Project } from "../shared/types.js";
import {
  HOSTED_WEBSITE_URL,
  HOSTED_WEBSITE_BRIEF,
} from "../shared/hosted-target.js";

// One Gemma generation (at most three native attempts), then two read-only audits
// of the explicitly authorized production homepage. No arbitrary URL or purchase.
const mode = process.argv.slice(2).join(" ");
if (!["--run", "--run-deterministic"].includes(mode)) {
  console.log(
    "Use --run for one live Gemma request and two owned-site audits, or explicitly --run-deterministic for labelled rules with zero model calls. No call made.",
  );
  if (process.argv.length > 2) process.exitCode = 1;
} else await verify(mode === "--run");

async function verify(useGemma: boolean) {
  const startedAt = new Date().toISOString();
  const directory = path.resolve(
    "work/hosted-website",
    startedAt.replace(/[:.]/g, "-"),
  );
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const origin = new URL(HOSTED_WEBSITE_URL).origin;
  const deadline = Date.now() + 6 * 60_000;
  let cookie = "";
  let otherVisitorCookie = "";
  const receipt = {
    startedAt,
    completedAt: "",
    status: "running",
    origin,
    modelRequests: 0,
    provider: useGemma ? "Google Gemini API" : null,
    model: useGemma ? "gemma-4-26b-a4b-it" : null,
    modelAttempts: [] as unknown[],
    reportedUsage: null as Project["generator"]["usage"] | null,
    sentry: null as Project["generator"]["orchestration"] | null,
    generationMode: useGemma ? "live-gemma" : "explicit-deterministic-no-ai",
    scope:
      "Agent verification of the real owner-authorized Briefstamp homepage, not a client website or customer validation. The negative control changes only its approved expectation, never the deployed website.",
    approval: { actor: "agent verification harness", humanApproval: false },
    billingChanges: 0,
    otherWebsiteTargets: 0,
    calls: [] as { route: string; method: string; status: number }[],
    audits: [] as Record<string, unknown>[],
    artifacts: [] as { path: string; bytes: number; sha256: string }[],
    error: "",
  };
  const sha = (bytes: Buffer | string) =>
    createHash("sha256").update(bytes).digest("hex");
  const artifact = async (name: string, value: unknown) => {
    assert(/^[a-z0-9-]+\.(json|png|html)$/.test(name));
    const bytes = Buffer.isBuffer(value)
      ? value
      : Buffer.from(JSON.stringify(value, null, 2) + "\n");
    await writeFile(path.join(directory, name), bytes, { mode: 0o600 });
    receipt.artifacts.push({
      path: name,
      bytes: bytes.length,
      sha256: sha(bytes),
    });
  };
  async function request<T>(
    route: string,
    options: {
      method?: string;
      body?: unknown;
      expected?: number;
      binary?: boolean;
      otherVisitor?: boolean;
    } = {},
  ): Promise<{ value: T; storage: string | null }> {
    assert(Date.now() < deadline, "Verification deadline expired");
    assert(
      /^\/(?:api\/(?:bootstrap|target-presets|projects(?:\/[a-f0-9-]+(?:\/(?:generate-gemma|checks|audits))?|\/preset)?|audits\/[a-f0-9-]+(?:\/(?:persistence|report))?|failures)|evidence\/[a-f0-9-]+\/[A-Za-z0-9_-]+\.png)(?:\?q=heading&projectId=[a-f0-9-]+)?$/.test(
        route,
      ),
      "Unexpected verification route",
    );
    const response = await fetch(origin + route, {
      method: options.method ?? "GET",
      redirect: "error",
      signal: AbortSignal.timeout(Math.min(55_000, deadline - Date.now())),
      headers: {
        ...((options.otherVisitor ? otherVisitorCookie : cookie)
          ? { cookie: options.otherVisitor ? otherVisitorCookie : cookie }
          : {}),
        ...(options.body === undefined
          ? {}
          : { "content-type": "application/json", origin }),
      },
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    receipt.calls.push({
      route,
      method: options.method ?? "GET",
      status: response.status,
    });
    const received = response.headers.get("set-cookie");
    if (received) {
      assert(/;\s*Secure(?:;|$)/i.test(received));
      assert(/;\s*HttpOnly(?:;|$)/i.test(received));
      if (options.otherVisitor) otherVisitorCookie = received.split(";")[0];
      else cookie = received.split(";")[0];
    }
    const chunks: Buffer[] = [];
    let total = 0;
    const reader = response.body!.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;
        assert(total <= 4 * 1024 * 1024, "Response exceeds proof limit");
        chunks.push(Buffer.from(value));
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    const bytes = Buffer.concat(chunks);
    if (route.endsWith("/generate-gemma") && response.status !== 200) {
      const failed = JSON.parse(bytes.toString("utf8"));
      await artifact("gemma-failure.json", failed);
      receipt.modelAttempts = failed.failure?.attempts ?? [];
    }
    assert.equal(
      response.status,
      options.expected ?? 200,
      `Unexpected status from ${route}`,
    );
    return {
      value: (options.binary ? bytes : JSON.parse(bytes.toString("utf8"))) as T,
      storage: response.headers.get("x-briefstamp-storage"),
    };
  }
  async function audit(
    project: Project,
    name: string,
    expected: { passed: number; failed: number },
  ) {
    const { value: started } = await request<Audit>(
      `/api/projects/${project.id}/audits`,
      { method: "POST", body: {}, expected: 202 },
    );
    let current = started;
    while (current.status === "running" || current.status === "queued") {
      await pause(1200);
      current = (await request<Audit>(`/api/audits/${started.id}`)).value;
    }
    assert.equal(current.status, "completed");
    assert.equal(current.source?.target, "website");
    assert.equal(current.source?.url, HOSTED_WEBSITE_URL);
    assert.equal(current.checks.length, 6);
    assert.equal(
      current.results.filter((x) => x.status === "passed").length,
      expected.passed,
    );
    assert.equal(
      current.results.filter((x) => x.status === "failed").length,
      expected.failed,
    );
    assert.equal(
      current.results.filter((x) => x.status === "blocked").length,
      0,
    );
    assert.equal(
      current.results.filter((x) => x.status === "unverified").length,
      1,
    );
    for (let attempt = 0; attempt < 12; attempt++) {
      const { value: state } = await request<{ status: string }>(
        `/api/audits/${current.id}/persistence`,
      );
      if (state.status === "saved") break;
      assert.equal(state.status, "saving");
      await pause(1000);
    }
    const stored = await request<Audit>(`/api/audits/${current.id}`);
    assert.equal(stored.storage, "tiger");
    assert(
      isDeepStrictEqual(current, stored.value),
      "Tiger read differs from completed audit",
    );
    await artifact(name + "-audit.json", stored.value);
    for (const [index, result] of current.results.entries()) {
      assert.equal(result.evidence.url, HOSTED_WEBSITE_URL);
      if (result.kind === "manual") {
        assert.equal(result.status, "unverified");
        continue;
      }
      assert(
        result.evidence.screenshot?.startsWith(`/evidence/${current.id}/`),
      );
      const { value: png } = await request<Buffer>(
        result.evidence.screenshot!,
        { binary: true },
      );
      assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
      await artifact(`${name}-${index + 1}-screenshot.png`, png);
    }
    const { value: report } = await request<Buffer>(
      `/api/audits/${current.id}/report`,
      { binary: true },
    );
    assert(report.toString("utf8").includes("data:image/png;base64,"));
    await artifact(name + "-report.html", report);
    await request(`/api/audits/${current.id}`, {
      otherVisitor: true,
      expected: 404,
    });
    await request(`/api/audits/${current.id}/report`, {
      otherVisitor: true,
      expected: 404,
    });
    receipt.audits.push({
      id: current.id,
      variant: name,
      ...expected,
      blocked: 0,
      unverified: 1,
      tigerRead: "verified",
      jsonRoundTripEqual: true,
      screenshots: 5,
    });
    return current;
  }
  try {
    const { value: bootstrap } = await request<Bootstrap>("/api/bootstrap");
    await request<Bootstrap>("/api/bootstrap", { otherVisitor: true });
    assert(
      otherVisitorCookie && otherVisitorCookie !== cookie,
      "Distinct visitor scope required",
    );
    if (useGemma)
      assert(
        bootstrap.demo?.gemma?.available,
        "The free live Gemma gate is unavailable",
      );
    const { value: presets } = await request<{
      presets: { id: string; url: string }[];
    }>("/api/target-presets");
    assert(
      presets.presets.some(
        (x) => x.id === "briefstamp-live" && x.url === HOSTED_WEBSITE_URL,
      ),
    );
    const { value: project } = await request<Project>("/api/projects/preset", {
      method: "POST",
      body: { preset: "briefstamp-live" },
      expected: 201,
    });
    assert.equal(project.target, "website");
    assert.equal(project.url, HOSTED_WEBSITE_URL);
    assert.equal(project.brief, HOSTED_WEBSITE_BRIEF);
    assert(project.checks.every((x) => !x.approved && x.path === "/"));
    let generated = project;
    if (useGemma) {
      receipt.modelRequests++;
      generated = (
        await request<Project>(`/api/projects/${project.id}/generate-gemma`, {
          method: "POST",
          body: { modelConsent: true },
        })
      ).value;
      assert.equal(generated.generator.provider, "Google Gemma (live API)");
      assert.equal(generated.generator.model, "gemma-4-26b-a4b-it");
      receipt.modelAttempts = generated.generator.attempts ?? [];
      receipt.reportedUsage = generated.generator.usage ?? null;
      receipt.sentry = generated.generator.orchestration ?? null;
      assert(
        receipt.modelAttempts.length > 0,
        "Native provider attempt receipt missing",
      );
    } else {
      assert.equal(generated.generator.provider, "Deterministic parser");
      assert.equal(generated.generator.model, null);
    }
    assert.equal(generated.checks.length, 6);
    assert(generated.checks.every((x) => !x.approved && x.path === "/"));
    assert.equal(new Set(generated.checks.map((x) => x.kind)).size, 6);
    await artifact(
      useGemma ? "gemma-project.json" : "deterministic-project.json",
      generated,
    );
    await request(`/api/projects/${project.id}/audits`, {
      method: "POST",
      body: {},
      expected: 409,
    });
    const checks: Check[] = generated.checks.map((x) => ({
      ...x,
      approved: x.kind !== "manual",
    }));
    const { value: approved } = await request<Project>(
      `/api/projects/${project.id}/checks`,
      { method: "PUT", body: { checks } },
    );
    assert.deepEqual(approved.checks, checks);
    await audit(approved, "live", { passed: 5, failed: 0 });
    const missing =
      "Briefstamp negative control: this heading is intentionally absent";
    const negative = checks.map((x) =>
      x.kind === "heading"
        ? {
            ...x,
            expected: missing,
            requirement: `Negative control: the homepage heading must say "${missing}".`,
          }
        : x,
    );
    const { value: negativeProject } = await request<Project>(
      `/api/projects/${project.id}/checks`,
      { method: "PUT", body: { checks: negative } },
    );
    const failed = await audit(negativeProject, "negative-control", {
      passed: 4,
      failed: 1,
    });
    const { value: search } = await request<{
      mode: string;
      results: { auditId: string; status: string }[];
    }>(`/api/failures?q=heading&projectId=${project.id}`);
    assert.equal(search.mode, "tiger-lexical");
    assert(
      search.results.some(
        (x) => x.auditId === failed.id && x.status === "failed",
      ),
    );
    await artifact("tiger-lexical.json", search);
    await request(`/api/failures?q=heading&projectId=${project.id}`, {
      otherVisitor: true,
      expected: 404,
    });
    // Leave the test plan in its original approved state for subsequent review.
    await request(`/api/projects/${project.id}/checks`, {
      method: "PUT",
      body: { checks },
    });
    receipt.status = "verified";
  } catch (error) {
    receipt.status = "failed";
    receipt.error =
      error instanceof Error
        ? error.message.slice(0, 500)
        : "Verification failed";
    process.exitCode = 1;
  } finally {
    receipt.completedAt = new Date().toISOString();
    await writeFile(
      path.join(directory, "receipt.json"),
      JSON.stringify(receipt, null, 2) + "\n",
      { mode: 0o600 },
    );
    console.log(
      JSON.stringify({
        directory,
        status: receipt.status,
        modelRequests: receipt.modelRequests,
        audits: receipt.audits,
        error: receipt.error,
      }),
    );
  }
}
