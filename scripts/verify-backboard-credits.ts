/** Explicit operator proof: existing credits only, no model calls or payment changes. */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { Audit } from "../shared/types.js";
import {
  rememberAudit,
  recallProjectMemory,
} from "../server/providers/backboard.js";
import {
  providerJson,
  ProviderError,
} from "../server/providers/free-resource-policy.js";

const sha256 = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
const sourcePath =
  "outputs/integration-release-hosted-2026-10-15/render-broken-audit.json";
const privateDirectory = path.resolve("work/backboard-credits-proof");
const statePath = path.join(privateDirectory, "state.json");
const allowancePath = path.join(privateDirectory, "allowance.json");
const stamp = new Date().toISOString();
const directory = path.resolve(
  "docs/evidence/backboard",
  stamp.replace(/[:.]/g, "-"),
);
const calls: Array<Record<string, unknown>> = [];
const receipt: Record<string, unknown> = {
  provider: "Backboard",
  startedAt: stamp,
  status: "not_completed",
  scope:
    "Operator-run synthetic project memory through the actual app adapter; not a public deployment or client-data test",
  funding:
    "Explicitly authorized existing credits, not a claim that mixed credits are a free grant",
  maxCreditSpendUsd: 0.03,
  modelInferenceCalls: 0,
  settingsOrPaymentChanges: 0,
  sourceAuditPath: sourcePath,
  calls,
};

async function privateJson(
  filename: string,
  value: unknown,
  exclusive = false,
) {
  await writeFile(filename, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
    flag: exclusive ? "wx" : "w",
  });
}

const balanceSchema = z.object({
  balance_usd: z.number().finite().nonnegative(),
  free_credit_usd: z.number().finite().nonnegative(),
  paid_credit_usd: z.number().finite().nonnegative(),
  subscription_credits_usd: z.number().finite().nonnegative(),
  auto_reload_enabled: z.literal(false),
  stripe_payment_method_id: z.null(),
});

async function balance(key: string) {
  const response = await fetch("https://app.backboard.io/api/billing/balance", {
    headers: { "X-API-Key": key, Accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
  });
  calls.push({
    operation: "read-balance",
    method: "GET",
    httpStatus: response.status,
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new ProviderError(
      "balance_unavailable",
      `Balance returned HTTP ${response.status}.`,
    );
  }
  const result = balanceSchema.safeParse(await providerJson(response));
  if (!result.success)
    throw new ProviderError(
      "credit_boundary_unverified",
      "Balance, disabled auto-reload or absent payment method could not be verified.",
    );
  return {
    checkedAt: new Date().toISOString(),
    totalUsd: result.data.balance_usd,
    freeUsd: result.data.free_credit_usd,
    paidUsd: result.data.paid_credit_usd,
    subscriptionUsd: result.data.subscription_credits_usd,
    autoReloadEnabled: false,
    paymentMethodConfigured: false,
  };
}

async function run() {
  if (
    process.argv.slice(2).join(" ") !== "--run-existing-credits-proof" ||
    process.env.BRIEFSTAMP_BACKBOARD_EXISTING_CREDITS_APPROVED !== "true"
  ) {
    console.log(
      JSON.stringify({
        status: "not_run",
        providerCalls: 0,
        instructions:
          "This proof requires the explicit run flag and BRIEFSTAMP_BACKBOARD_EXISTING_CREDITS_APPROVED=true after operator approval to consume existing credits. It never adds funds.",
      }),
    );
    return;
  }
  await mkdir(privateDirectory, { recursive: true, mode: 0o700 });
  // An interrupted/unknown setup must be inspected, not automatically duplicated.
  try {
    await privateJson(
      statePath,
      { startedAt: stamp, status: "preflight", setupAttempted: false },
      true,
    );
  } catch {
    throw new ProviderError(
      "previous_proof_exists",
      "A private proof state already exists. No duplicate assistant will be created.",
    );
  }
  await mkdir(directory, { recursive: true });
  let key: string | undefined;
  let before: Awaited<ReturnType<typeof balance>> | undefined;
  try {
    const source = await readFile(sourcePath, "utf8");
    const audit = JSON.parse(source) as Audit;
    if (
      audit.source?.target !== "sample" ||
      audit.status !== "completed" ||
      !audit.results.some(
        (result) => result.kind === "heading" && result.status === "failed",
      )
    )
      throw new ProviderError(
        "invalid_source",
        "The known real synthetic audit must contain a completed failed heading.",
      );
    receipt.sourceAuditSha256 = sha256(source);
    receipt.sourceFacts = audit.results.map(({ kind, status }) => ({
      kind,
      status,
    }));
    const secrets = JSON.parse(
      await readFile(
        "work/check-optional-provider-accounts.secrets.json",
        "utf8",
      ),
    );
    key = z
      .string()
      .min(8)
      .max(500)
      .regex(/^[^\s\x00-\x1f]+$/)
      .parse(secrets.BACKBOARD_API_KEY);
    before = await balance(key);
    receipt.balanceBefore = before;
    if (before.totalUsd < 0.03)
      throw new ProviderError(
        "insufficient_existing_credit",
        "At least $0.03 existing credit is required; no top-up is allowed.",
      );
    await privateJson(allowancePath, {
      version: 1,
      providers: {
        backboard: {
          credentialSha256: sha256(key),
          checkedAt: before.checkedAt,
          expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
          evidence: `Explicit user existing-credit approval; fresh GET balance ${before.checkedAt}; ${path.relative(process.cwd(), directory)}/receipt.json`,
          freeOnly: false,
          existingCreditOnly: true,
          existingCreditsApproved: true,
          autoReloadEnabled: false,
          paymentMethodConfigured: false,
          confirmedExistingCreditsUsd: before.totalUsd,
          maxCreditSpendUsd: 0.03,
          // Reserve conservative setup overhead before the single assistant-create request.
          usedCreditSpendUsd: 0.01,
          unit: "requests",
          operations: ["memory-write", "memory-search"],
          usedOperations: [],
          maxUnits: 2,
          usedUnits: 0,
          maxCalls: 2,
          usedCalls: 0,
        },
      },
    });
    const assistantName = `Briefstamp synthetic proof ${stamp} ${randomUUID().slice(0, 8)}`;
    await privateJson(statePath, {
      startedAt: stamp,
      status: "setup_reserved",
      setupAttempted: true,
      reservedSetupCreditUsd: 0.01,
      assistantName,
    });
    const created = await fetch("https://app.backboard.io/api/assistants", {
      method: "POST",
      headers: { "X-API-Key": key, "content-type": "application/json" },
      body: JSON.stringify({
        name: assistantName,
        system_prompt:
          "Dedicated Briefstamp synthetic audit-memory verification only. No chat, tools or model inference.",
        tools: [],
      }),
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
    calls.push({
      operation: "create-dedicated-assistant",
      method: "POST",
      httpStatus: created.status,
      reservedCreditUsd: 0.01,
    });
    if (!created.ok) {
      await created.body?.cancel();
      throw new ProviderError(
        "setup_rejected",
        `Assistant creation returned HTTP ${created.status}; it will not be retried.`,
      );
    }
    const setup = z
      .object({ assistant_id: z.string().uuid() })
      .safeParse(await providerJson(created));
    if (!setup.success)
      throw new ProviderError(
        "setup_response_invalid",
        "Assistant response did not provide a valid identifier; setup will not be retried.",
      );
    await privateJson(statePath, {
      startedAt: stamp,
      status: "assistant_created",
      setupAttempted: true,
      assistantId: setup.data.assistant_id,
      assistantName,
    });
    receipt.dedicatedAssistantCreated = true;
    receipt.assistantIdentifierPublic = false;
    const env: NodeJS.ProcessEnv = {
      BRIEFSTAMP_BACKBOARD_ENABLED: "true",
      BRIEFSTAMP_BACKBOARD_EXISTING_CREDITS_APPROVED: "true",
      BACKBOARD_API_KEY: key,
      BACKBOARD_ASSISTANT_ID: setup.data.assistant_id,
      BRIEFSTAMP_PROVIDER_ALLOWANCE_FILE: allowancePath,
    };
    const fetcher: typeof fetch = async (url, init) => {
      const operation = String(url).endsWith("/search")
        ? "memory-search"
        : "memory-write";
      const start = Date.now();
      const response = await fetch(url, init);
      calls.push({
        operation,
        method: "POST",
        httpStatus: response.status,
        elapsedMs: Date.now() - start,
        reservedCreditUsd: 0.01,
      });
      return response;
    };
    const accepted = await rememberAudit(audit, { env, fetcher });
    receipt.memoryWriteAccepted = accepted.status === "accepted";
    // One bounded indexing wait, followed by exactly one search. No retry loop.
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    const recalled = await recallProjectMemory(audit.projectId, "heading", {
      env,
      fetcher,
    });
    const matching = recalled.memories.filter(
      (memory) =>
        memory.audit === accepted.auditScope &&
        memory.facts.some(
          (fact) => fact.kind === "heading" && fact.status === "failed",
        ),
    );
    receipt.matchingMemoryCount = matching.length;
    receipt.retrievedFailedHeading = matching.length > 0;
    receipt.retrieved = matching.map(
      ({ format, observedAt, facts, score }) => ({
        format,
        observedAt,
        facts,
        score,
      }),
    );
    receipt.status = matching.length ? "verified" : "accepted_not_retrieved";
    if (!matching.length) process.exitCode = 1;
  } catch (error) {
    receipt.status = "failed_or_blocked";
    receipt.error =
      error instanceof ProviderError
        ? { code: error.code, message: error.message }
        : {
            code: "local_or_transport_failure",
            message:
              "The bounded proof did not complete; no raw error or private data retained.",
          };
    process.exitCode = 1;
  } finally {
    if (key && before) {
      try {
        const after = await balance(key);
        receipt.balanceAfter = after;
        receipt.observedCreditDeductionsUsd = Object.fromEntries(
          (["totalUsd", "freeUsd", "paidUsd", "subscriptionUsd"] as const).map(
            (field) => [
              field,
              Number((before![field] - after[field]).toFixed(12)),
            ],
          ),
        );
        receipt.balanceScope =
          "Immediate account-wide difference, not a guarantee of final billing or exclusive attribution; no free-first rule inferred.";
      } catch {
        receipt.balanceAfterStatus = "unverified";
        process.exitCode = 1;
      }
    }
    try {
      const proof = JSON.parse(await readFile(allowancePath, "utf8")).providers
        .backboard;
      receipt.reservation = {
        usedCalls: proof.usedCalls,
        usedUnits: proof.usedUnits,
        usedCreditSpendUsd: proof.usedCreditSpendUsd,
        maxCreditSpendUsd: proof.maxCreditSpendUsd,
        usedOperations: proof.usedOperations,
      };
    } catch {
      /* No allowance exists if preflight failed. */
    }
    receipt.sourceHashes = Object.fromEntries(
      await Promise.all(
        [
          "server/providers/backboard.ts",
          "server/providers/free-resource-policy.ts",
          "scripts/verify-backboard-credits.ts",
        ].map(async (filename) => [filename, sha256(await readFile(filename))]),
      ),
    );
    receipt.completedAt = new Date().toISOString();
    await writeFile(
      path.join(directory, "receipt.json"),
      `${JSON.stringify(receipt, null, 2)}\n`,
      { flag: "wx" },
    );
    console.log(
      JSON.stringify({
        status: receipt.status,
        receipt: path.relative(
          process.cwd(),
          path.join(directory, "receipt.json"),
        ),
      }),
    );
  }
}

run().catch(() => {
  console.error(
    "Backboard proof stopped before provider use; inspect private proof state locally. No raw error retained.",
  );
  process.exitCode = 1;
});
