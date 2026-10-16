import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { databaseConfig } from "../server/database.js";
import { boundedBytes } from "../server/providers/free-resource-policy.js";
import {
  executeSearchPresence,
  SearchPresenceCheckSchema,
} from "../server/search-presence.js";
import { execFileSync } from "node:child_process";

const mode = process.argv.slice(2).join(" ");
const finalControl = mode.endsWith("-indexed-final");
const repair = finalControl || mode.endsWith("-indexed-repair");
if (
  ![
    "--prepare",
    "--run",
    "--prepare-indexed-repair",
    "--run-indexed-repair",
    "--prepare-indexed-final",
    "--run-indexed-final",
  ].includes(mode)
)
  console.log(
    "Not run. --prepare pins the current owner-authorized two-check plan and free allowance once; --run consumes it once. No default key reads or requests.",
  );
else await verify(mode.startsWith("--prepare"));
async function verify(prepare: boolean) {
  const parentDirectory = "work/search-presence-20261016";
  const directory = path.resolve(
    finalControl
      ? "work/search-presence-indexed-final-20261016"
      : repair
        ? "work/search-presence-indexed-repair-20261016"
        : parentDirectory,
  );
  const maximumRequests = repair ? 1 : 2;
  const approvedTargets = repair
    ? [
        [
          "https://github.com/himanshu748/langchain-rag-tutorial-2026",
          "langchain-rag-tutorial-2026",
        ],
      ]
    : [
        ["https://github.com/himanshu748", "himanshu748"],
        ["https://flowproof-demo.onrender.com/", "Briefstamp"],
      ];
  const sha = (x: string | Buffer) =>
    createHash("sha256").update(x).digest("hex");
  let parent: any;
  let parentReceiptSha256: string | undefined;
  if (repair) {
    const bytes = await readFile(path.join(parentDirectory, "receipt.json"));
    parentReceiptSha256 = sha(bytes);
    parent = JSON.parse(bytes.toString("utf8"));
    assert.equal(parent.status, "observed_different_control_outcomes");
    assert.equal(parent.observations[0].status, "no_match");
    assert.equal(parent.observations[0].organicResultCount, 9);
    assert.equal(parent.observations[0].scopedResultCount, 0);
    assert.equal(parent.observations[1].status, "empty");
    assert.equal(parent.observations[1].organicResultCount, 0);
    assert.equal(parent.dedicatedCallsReserved, 2);
    const spent = JSON.parse(
      await readFile(
        path.join(parentDirectory, "allowance.private.json"),
        "utf8",
      ),
    ).providers.serpapi;
    assert.equal(spent.usedCalls, 2);
    assert.equal(spent.usedUnits, 2);
    const retained = JSON.parse(
      await readFile(
        path.join(parentDirectory, "check-1-response.json"),
        "utf8",
      ),
    );
    assert(
      retained.organic_results.some(
        (r: any) => r.link === approvedTargets[0][0],
      ),
      "Repair target must come from the actual retained response",
    );
  }
  if (finalControl) {
    const priorRepair = JSON.parse(
      await readFile(
        "work/search-presence-indexed-repair-20261016/receipt.json",
        "utf8",
      ),
    );
    assert.equal(priorRepair.status, "completed_with_unavailable_check");
    assert.equal(priorRepair.observations[0].failureCode, "request_failed");
    assert.equal(priorRepair.dedicatedCallsReserved, 1);
    const spent = JSON.parse(
      await readFile(
        "work/search-presence-indexed-repair-20261016/allowance.private.json",
        "utf8",
      ),
    ).providers.serpapi;
    assert.equal(spent.usedCalls, 1);
    assert.equal(spent.usedUnits, 1);
  }
  const env = JSON.parse(
    await readFile("work/judge-100/active-render.private.json", "utf8"),
  );
  const key = env.SERPAPI_API_KEY;
  assert(typeof key === "string" && key.length > 8);
  const funding = JSON.parse(
    await readFile("work/serp-presence-funding.json", "utf8"),
  );
  assert(
    funding.plan === "Free Plan" &&
      funding.accountStatus === "Active" &&
      funding.monthlyPrice === 0 &&
      funding.extraCredits === 0 &&
      funding.remainingSearches >= 96 + maximumRequests,
  );
  assert(
    Date.now() >= Date.parse(funding.checkedAt) &&
      Date.now() - Date.parse(funding.checkedAt) < 86_400_000,
  );
  const save = (name: string, value: unknown) =>
    writeFile(
      path.join(directory, name),
      JSON.stringify(value, null, 2) + "\n",
      { flag: "wx", mode: 0o600 },
    );
  const allowanceFile = path.join(directory, "allowance.private.json");
  if (prepare) {
    await mkdir(directory, { recursive: false, mode: 0o700 });
    const checks = approvedTargets.map(([targetUrl, expectedText]) =>
      SearchPresenceCheckSchema.parse({
        id: randomUUID(),
        kind: "search_presence",
        targetUrl,
        expectedText,
        matchField: "title",
        authorized: true,
        approved: false,
      }),
    );
    await save("proposed-checks.json", checks);
    await save("approved-checks.json", {
      approvalActor: `Automated verifier under the owner instruction to run ${maximumRequests} controlled check(s); not customer approval`,
      approvedAt: new Date().toISOString(),
      checks: checks.map((c) => ({ ...c, approved: true })),
    });
    const old = new Set<string>(
      funding.oldReservationFiles.map((f: any) => f.path),
    );
    for (const f of await readdir("work"))
      if (/^evidence-agent-.*\.reservation\.json$/.test(f))
        old.add("work/" + f);
    if (repair)
      for (const name of await readdir(parentDirectory))
        old.add(path.join(parentDirectory, name));
    if (finalControl)
      for (const name of await readdir(
        "work/search-presence-indexed-repair-20261016",
      ))
        old.add(
          path.join("work/search-presence-indexed-repair-20261016", name),
        );
    const snapshot = [];
    for (const f of old)
      snapshot.push({ path: f, sha256: sha(await readFile(f)) });
    await save("prior-reservation-hashes.json", snapshot);
    await save("funding.json", funding);
    await save("allowance.private.json", {
      version: 1,
      providers: {
        serpapi: {
          credentialSha256: sha(key),
          checkedAt: funding.checkedAt,
          expiresAt: new Date(
            Math.min(
              Date.parse(funding.checkedAt) + 86_400_000,
              Date.parse("2026-10-20T00:00:00Z"),
            ),
          ).toISOString(),
          evidence: `Owner-authorized ${maximumRequests} search_presence check(s); authenticated Free Plan funding receipt 2026-10-16T16:36:30Z; all earlier reservations retained${repair ? "; separate additive indexed-target repair, original two calls remain spent" : ""}`,
          unit: "requests",
          operations: ["search-visibility"],
          maxUnits: maximumRequests,
          usedUnits: 0,
          maxCalls: maximumRequests,
          usedCalls: 0,
          freeOnly: true,
          paidOverageDisabled: true,
          confirmedFreeUnits: funding.remainingSearches,
        },
      },
    });
    console.log(
      JSON.stringify({
        status: "prepared_no_search",
        directory,
        maximumRequests,
      }),
    );
    return;
  }
  const expected = process.env.BRIEFSTAMP_EXPECTED_COMMIT;
  const ciId = process.env.BRIEFSTAMP_VERIFIED_CI_RUN_ID;
  assert(
    /^[a-f0-9]{40}$/.test(expected ?? "") && /^\d+$/.test(ciId ?? ""),
    "An exact green CI revision is required before provider calls",
  );
  assert.equal(
    execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    expected,
  );
  assert.equal(
    execFileSync(
      "git",
      [
        "status",
        "--porcelain",
        "--",
        "server/search-presence.ts",
        "scripts/verify-search-presence.ts",
      ],
      { encoding: "utf8" },
    ).trim(),
    "",
  );
  const ciResponse = await fetch(
    `https://api.github.com/repos/himanshu748/flowproof-web/actions/runs/${ciId}`,
    { redirect: "error", signal: AbortSignal.timeout(20000) },
  );
  assert(ciResponse.ok);
  const ci = await ciResponse.json();
  assert(
    ci.head_sha === expected && ci.conclusion === "success",
    "Exact source CI must pass",
  );
  const approval = JSON.parse(
    await readFile(path.join(directory, "approved-checks.json"), "utf8"),
  );
  const checks = approval.checks.map((c: unknown) =>
    SearchPresenceCheckSchema.parse(c),
  );
  assert.equal(checks.length, maximumRequests);
  assert(
    checks.every(
      (c: any) => c.approved && c.authorized && c.matchField === "title",
    ),
  );
  assert.deepEqual(
    checks.map((c: any) => [c.targetUrl, c.expectedText]),
    approvedTargets,
  );
  const allowance = JSON.parse(await readFile(allowanceFile, "utf8"));
  assert.equal(
    allowance.providers.serpapi.usedCalls,
    0,
    "This exact tranche is already used; it must not be reset",
  );
  await save("run-reservation.json", {
    reservedAt: new Date().toISOString(),
    maximumRequests,
    approvedPlanSha256: sha(JSON.stringify(approval)),
    sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim(),
    neverRefund: true,
  });
  const prior = JSON.parse(
    await readFile(
      path.join(directory, "prior-reservation-hashes.json"),
      "utf8",
    ),
  );
  const receipt: any = {
    startedAt: new Date().toISOString(),
    status: "running",
    sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim(),
    scope:
      "Real SerpApi Google title presence checks from the local protected verifier, not new Chromium acceptance or a public agent run",
    approvalActor: approval.approvalActor,
    maximumRequests,
    automaticRetries: 0,
    publicJudgeReservationsConsumed: 0,
    observations: [],
    ...(repair
      ? {
          parentReceipt: parentDirectory + "/receipt.json",
          parentReceiptSha256,
          repairScope:
            "One additive search for an exact owner-controlled repository discovered in the retained first response; not an independent benchmark",
          ...(finalControl
            ? {
                finalControl: true,
                previousTimeoutRetained:
                  "work/search-presence-indexed-repair-20261016/receipt.json",
              }
            : {}),
          retainedDemoEmpty: parent.observations[1],
          noNewEmptySearch: true,
        }
      : {}),
  };
  const pool = new pg.Pool({
    ...databaseConfig(env.BRIEFSTAMP_TIGER_DATABASE_URL, {}),
    max: 1,
    idleTimeoutMillis: 1,
    statement_timeout: 5000,
  });
  const publicCount = async () =>
    (
      await pool.query(
        "SELECT count(*)::integer AS spent FROM briefstamp_demo_v1.judge_agent_reservations",
      )
    ).rows[0].spent;
  const sanitize = (value: unknown): unknown =>
    typeof value === "string"
      ? value.split(key).join("[redacted SerpApi key]")
      : Array.isArray(value)
        ? value.map(sanitize)
        : value && typeof value === "object"
          ? Object.fromEntries(
              Object.entries(value).map(([k, v]) => [
                k,
                /^(?:api[_-]?key|authorization)$/i.test(k)
                  ? "[redacted]"
                  : sanitize(v),
              ]),
            )
          : value;
  try {
    for (const f of prior)
      assert.equal(
        sha(await readFile(f.path)),
        f.sha256,
        "An earlier reservation changed before execution",
      );
    receipt.ciUrl = ci.html_url;
    const preAccountUrl = new URL("https://serpapi.com/account.json");
    preAccountUrl.searchParams.set("api_key", key);
    const preAccountResponse = await fetch(preAccountUrl, {
      redirect: "error",
      signal: AbortSignal.timeout(20000),
    });
    assert(preAccountResponse.ok);
    const preAccount = await preAccountResponse.json();
    assert(
      preAccount.plan_name === "Free Plan" &&
        preAccount.account_status === "Active" &&
        preAccount.plan_monthly_price === 0 &&
        preAccount.extra_credits === 0 &&
        preAccount.total_searches_left >= 96 + maximumRequests,
      "Fresh free quota must cover the untouched judge grant plus this dedicated tranche",
    );
    receipt.preAccount = {
      checkedAt: new Date().toISOString(),
      plan: preAccount.plan_name,
      monthlyPrice: preAccount.plan_monthly_price,
      extraCredits: preAccount.extra_credits,
      remainingSearches: preAccount.total_searches_left,
    };
    receipt.judgeSpentBefore = await publicCount();
    for (const [index, check] of checks.entries()) {
      let physical = 0;
      const observation = await executeSearchPresence(check, {
        // Explicitly enable only this new local dedicated grant. The consumed
        // hosted provider flag and all old proofs stay byte-for-byte unchanged.
        env: {
          ...env,
          BRIEFSTAMP_SERPAPI_ENABLED: "true",
          BRIEFSTAMP_PROVIDER_ALLOWANCE_FILE: allowanceFile,
        },
        reserveCheck: async (c) => {
          assert.equal(sha(JSON.stringify(c)), sha(JSON.stringify(check)));
          try {
            await save(`check-${index + 1}-reservation.json`, {
              checkId: c.id,
              approvedCheckSha256: sha(JSON.stringify(c)),
              reservedAt: new Date().toISOString(),
              neverRefund: true,
            });
            return true;
          } catch {
            return false;
          }
        },
        fetcher: async (input, init) => {
          assert.equal(
            ++physical,
            1,
            "Only one provider request per approved check",
          );
          const url = new URL(String(input));
          assert(
            url.origin === "https://serpapi.com" &&
              url.pathname === "/search.json" &&
              url.searchParams.get("api_key") === key,
          );
          const start = Date.now();
          url.searchParams.set("api_key", "[redacted]");
          const attempt = {
            request: url.toString(),
            startedAt: new Date().toISOString(),
            physicalRequests: physical,
          };
          await save(`check-${index + 1}-attempt.json`, attempt);
          let response: Response;
          try {
            response = await fetch(input, init);
          } catch {
            await save(`check-${index + 1}-transport.json`, {
              ...attempt,
              status: null,
              durationMs: Date.now() - start,
              error: "transport_failed_unknown_upstream_completion",
            });
            throw Error("Provider transport failed; reservation remains spent");
          }
          let raw: Buffer;
          try {
            raw = await boundedBytes(response.clone(), 1_048_576);
          } catch {
            await save(`check-${index + 1}-transport.json`, {
              ...attempt,
              status: response.status,
              durationMs: Date.now() - start,
              error: "bounded_body_unavailable",
            });
            throw Error("Provider body unavailable; reservation remains spent");
          }
          await save(`check-${index + 1}-transport.json`, {
            ...attempt,
            status: response.status,
            durationMs: Date.now() - start,
            originalBodySha256: sha(raw),
            redactions: ["API key field and any exact key occurrence"],
          });
          let payload: unknown;
          try {
            payload = JSON.parse(raw.toString("utf8"));
          } catch {
            await writeFile(
              path.join(directory, `check-${index + 1}-non-json-response.txt`),
              raw.toString("utf8").split(key).join("[redacted SerpApi key]"),
              { flag: "wx", mode: 0o600 },
            );
            throw Error("Provider returned non-JSON; no result inferred");
          }
          await save(`check-${index + 1}-response.json`, sanitize(payload));
          return response;
        },
      });
      await save(`check-${index + 1}-observation.json`, observation);
      receipt.observations.push(observation);
      assert.equal(physical, 1);
    }
    receipt.judgeSpentAfter = await publicCount();
    assert.equal(receipt.judgeSpentAfter, receipt.judgeSpentBefore);
    for (const f of prior)
      assert.equal(
        sha(await readFile(f.path)),
        f.sha256,
        "An earlier private reservation changed",
      );
    receipt.earlierReservationFilesUnchanged = prior.length;
    const spent = JSON.parse(await readFile(allowanceFile, "utf8")).providers
      .serpapi;
    assert.equal(spent.usedCalls, maximumRequests);
    assert.equal(spent.usedUnits, maximumRequests);
    receipt.dedicatedCallsReserved = spent.usedCalls;
    const accountUrl = new URL("https://serpapi.com/account.json");
    accountUrl.searchParams.set("api_key", key);
    const accountResponse = await fetch(accountUrl, {
      redirect: "error",
      signal: AbortSignal.timeout(20000),
    });
    assert(accountResponse.ok);
    const account = await accountResponse.json();
    assert(
      account.plan_name === "Free Plan" &&
        account.plan_monthly_price === 0 &&
        account.extra_credits === 0 &&
        account.total_searches_left >= 96,
    );
    receipt.postAccount = {
      checkedAt: new Date().toISOString(),
      plan: account.plan_name,
      monthlyPrice: account.plan_monthly_price,
      extraCredits: account.extra_credits,
      remainingSearches: account.total_searches_left,
    };
    receipt.controls = {
      indexedTitleMatched: receipt.observations[0]?.status === "matched",
      demoReturnedEmpty:
        (repair ? parent.observations[1] : receipt.observations[1])?.status ===
        "empty",
    };
    receipt.status =
      receipt.controls.indexedTitleMatched && receipt.controls.demoReturnedEmpty
        ? "verified"
        : receipt.observations.some((x: any) => x.status === "unavailable")
          ? "completed_with_unavailable_check"
          : "observed_different_control_outcomes";
    receipt.completedAt = new Date().toISOString();
  } catch (e) {
    receipt.status = "failed";
    receipt.failure = {
      name: e instanceof Error ? e.name : "unknown",
      message: e instanceof Error ? e.message : "unknown",
    };
    throw e;
  } finally {
    await pool.end();
    await save("receipt.json", receipt);
    console.log(
      JSON.stringify({
        status: receipt.status,
        directory,
        observations: receipt.observations.map((x: any) => ({
          target: x.targetUrl,
          status: x.status,
          organic: x.organicResultCount,
          scoped: x.scopedResultCount,
        })),
        postAccount: receipt.postAccount,
      }),
    );
  }
}
