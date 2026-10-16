#!/usr/bin/env node
/**
 * Prepare private configuration only. No provider SDKs, network calls or apply step.
 * Tinker supports this initial carry-forward only: the original 2-call/50,000-token
 * proof with 1 call/8,912 tokens already reserved. An already refreshed 1-call/
 * 41,088-token proof is rejected. Later funding rechecks require a separate review
 * of cumulative reservations; this helper does not roll allowances forward again.
 * SerpApi and ElevenLabs support initial hosted setup only. Any existing nonempty
 * hosted proof, including an unused or malformed proof, prevents a new allowance.
 * Read-only funding rechecks never replenish their one-call budgets.
 */
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DAY = 86_400_000;
const CUTOFF = Date.parse("2026-10-20T00:00:00Z");
const PROVIDERS = [
  "gemma",
  "tinker",
  "sentry",
  "tiger",
  "backboard",
  "serpapi",
  "elevenlabs",
];
const FLAGS = [
  "BRIEFSTAMP_PUBLIC_GEMMA_ENABLED",
  "BRIEFSTAMP_GEMMA_CONFIRMED_FREE",
  "BRIEFSTAMP_HOSTED_TINKER_ENABLED",
  "BRIEFSTAMP_TINKER_ENABLED",
  "FLOWPROOF_SENTRY_ENABLED",
  "FLOWPROOF_SENTRY_FREE_CONFIRMED",
  "BRIEFSTAMP_TIGER_ENABLED",
  "BRIEFSTAMP_BACKBOARD_ENABLED",
  "BRIEFSTAMP_BACKBOARD_EXISTING_CREDITS_APPROVED",
  "BRIEFSTAMP_SERPAPI_ENABLED",
  "BRIEFSTAMP_ELEVENLABS_ENABLED",
  "BRIEFSTAMP_ELEVENLABS_NONCOMMERCIAL_DEMO",
  "BRIEFSTAMP_HOSTED_SERPAPI_ENABLED",
  "BRIEFSTAMP_HOSTED_ELEVENLABS_ENABLED",
  "BRIEFSTAMP_ELEVENLABS_STOCK_VOICE_CONFIRMED",
];
export const sha256 = (text) => createHash("sha256").update(text).digest("hex");
class PreparationError extends Error {}
function requireThat(condition, code) {
  if (!condition) throw new PreparationError(code);
}
function record(value, code) {
  requireThat(
    value !== null && typeof value === "object" && !Array.isArray(value),
    code,
  );
  return value;
}
function exact(value, fields, code) {
  record(value, code);
  requireThat(
    Object.keys(value).every((key) => fields.includes(key)) &&
      fields.every((key) => Object.hasOwn(value, key)),
    code,
  );
  return value;
}
function text(value, code, min = 1, max = 500) {
  requireThat(
    typeof value === "string" &&
      value.length >= min &&
      value.length <= max &&
      !/[\x00-\x1f]/.test(value),
    code,
  );
  return value;
}
function integer(value, min, max, code) {
  requireThat(
    Number.isSafeInteger(value) && value >= min && value <= max,
    code,
  );
  return value;
}
function instant(value, code) {
  requireThat(
    typeof value === "string" &&
      /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(
        value,
      ),
    code,
  );
  const result = Date.parse(value);
  requireThat(Number.isFinite(result), code);
  return result;
}
function digest(value, code) {
  requireThat(typeof value === "string" && /^[a-f0-9]{64}$/.test(value), code);
  return value;
}
function key(env, name) {
  const value = text(env[name], "missing_or_invalid_credential", 8, 500);
  requireThat(!/\s/.test(value), "missing_or_invalid_credential");
  return value;
}
function json(value, code) {
  try {
    return JSON.parse(value);
  } catch {
    throw new PreparationError(code);
  }
}
function trueFlags(value, names, code) {
  requireThat(
    names.every((name) => value[name] === true),
    code,
  );
}
function falseFlags(value, names, code) {
  requireThat(
    names.every((name) => value[name] === false),
    code,
  );
}
function matchingKey(proof, env, name) {
  requireThat(
    digest(proof.credentialSha256, "invalid_credential_binding") ===
      sha256(key(env, name)),
    "credential_binding_mismatch",
  );
}
function operatorToken(env) {
  const value = text(env.FLOWPROOF_TOKEN, "operator_token_required", 32, 512);
  requireThat(!/\s/.test(value), "operator_token_required");
}
function date(value) {
  return new Date(value).toISOString();
}

/** Accept a plain env map or Render's explicit key/value response rows. */
function environment(snapshot) {
  const entries = Array.isArray(snapshot)
    ? snapshot.map((row) => {
        record(row, "invalid_env_snapshot");
        const item = Object.hasOwn(row, "envVar") ? row.envVar : row;
        exact(item, ["key", "value"], "invalid_env_snapshot");
        return [item.key, item.value];
      })
    : Object.entries(record(snapshot, "invalid_env_snapshot"));
  requireThat(entries.length <= 250, "invalid_env_snapshot");
  const result = {};
  for (const [name, value] of entries) {
    requireThat(
      typeof name === "string" &&
        /^[A-Z][A-Z0-9_]{0,100}$/.test(name) &&
        !Object.hasOwn(result, name) &&
        typeof value === "string" &&
        value.length <= 32768,
      "invalid_env_snapshot",
    );
    result[name] = value;
  }
  for (const name of FLAGS) {
    requireThat(
      result[name] === undefined || ["true", "false"].includes(result[name]),
      "invalid_provider_flag",
    );
  }
  return result;
}

/**
 * Pure preparation: operator observations are attestations, not live verification.
 * Existing reservations are never refunded. A new proof is not durable quota storage.
 */
export function prepareRefresh({
  accountProof,
  envSnapshot,
  priorReceipt,
  now = Date.now(),
}) {
  requireThat(Number.isFinite(now), "invalid_clock");
  exact(
    accountProof,
    ["version", "checkedAt", "providers"],
    "invalid_account_proof",
  );
  requireThat(accountProof.version === 1, "invalid_account_proof");
  const checked = instant(accountProof.checkedAt, "invalid_checked_at");
  requireThat(
    checked <= now && now - checked <= DAY,
    "account_proof_future_or_stale",
  );
  const providers = record(accountProof.providers, "invalid_providers");
  requireThat(
    Object.keys(providers).length > 0 &&
      Object.keys(providers).every((name) => PROVIDERS.includes(name)),
    "invalid_providers",
  );
  exact(
    priorReceipt,
    ["version", "confirmedAt", "providers"],
    "invalid_prior_receipt",
  );
  requireThat(priorReceipt.version === 1, "invalid_prior_receipt");
  const confirmed = instant(
    priorReceipt.confirmedAt,
    "invalid_prior_confirmation",
  );
  requireThat(
    confirmed <= now && now - confirmed <= DAY && confirmed >= checked,
    "prior_use_not_freshly_confirmed",
  );
  record(priorReceipt.providers, "invalid_prior_receipt");
  requireThat(
    Object.keys(priorReceipt.providers).every((name) =>
      ["tinker", "backboard"].includes(name),
    ),
    "invalid_prior_receipt",
  );
  const previous = environment(envSnapshot);
  const renderEnv = { ...previous };
  for (const name of FLAGS) renderEnv[name] = "false";
  const plans = {};
  const accountHash = sha256(JSON.stringify(accountProof));
  const priorHash = sha256(JSON.stringify(priorReceipt));
  const evidence = (name) =>
    `Operator-confirmed account evidence ${accountHash}; prior-use receipt ${priorHash}; ${name}; prepared only, not live verification.`;
  const expiry = Math.min(checked + DAY, CUTOFF);
  const freshWindow = () =>
    requireThat(expiry > now, "confirmation_window_expired");
  const common = (name, apiKey, unit, operations, maxUnits, maxCalls) => ({
    credentialSha256: sha256(apiKey),
    checkedAt: date(checked),
    expiresAt: date(expiry),
    evidence: evidence(name),
    freeOnly: true,
    paidOverageDisabled: true,
    unit,
    operations,
    confirmedFreeUnits: maxUnits,
    maxUnits,
    usedUnits: 0,
    maxCalls,
    usedCalls: 0,
  });
  const bindPrior = (name, envName, fields) => {
    const prior = exact(
      priorReceipt.providers[name],
      fields,
      `${name}_prior_receipt_required`,
    );
    const literal = previous[envName];
    requireThat(
      typeof literal === "string" &&
        literal.length >= 8 &&
        literal.length <= 16384,
      `${name}_previous_proof_required`,
    );
    requireThat(
      digest(prior.proofSha256, "invalid_prior_proof_hash") === sha256(literal),
      `${name}_previous_proof_mismatch`,
    );
    digest(prior.evidenceSha256, "prior_evidence_hash_required");
    return {
      prior,
      old: record(
        json(literal, "invalid_previous_proof"),
        "invalid_previous_proof",
      ),
    };
  };

  if (providers.tinker) {
    freshWindow();
    const p = exact(
      providers.tinker,
      [
        "credentialSha256",
        "freeCreditsConfirmed",
        "paidOverageDisabled",
        "autoReloadEnabled",
        "paymentMethodConfigured",
        "confirmedFreeUnits",
        "fundingValidUntil",
        "checkpointSha256",
        "checkpointExpiresAt",
      ],
      "invalid_tinker_proof",
    );
    trueFlags(
      p,
      ["freeCreditsConfirmed", "paidOverageDisabled"],
      "tinker_free_funding_not_confirmed",
    );
    falseFlags(
      p,
      ["autoReloadEnabled", "paymentMethodConfigured"],
      "tinker_paid_boundary_not_confirmed",
    );
    matchingKey(p, previous, "TINKER_API_KEY");
    operatorToken(previous);
    integer(
      p.confirmedFreeUnits,
      41088,
      1000000,
      "tinker_free_remainder_unfunded",
    );
    const model = text(
      previous.TINKER_MODEL_PATH,
      "invalid_tinker_checkpoint",
      10,
      300,
    );
    requireThat(
      /^tinker:\/\/[A-Za-z0-9:_-]{1,150}\/sampler_weights\/[A-Za-z0-9_.-]{1,100}$/.test(
        model,
      ) &&
        digest(p.checkpointSha256, "invalid_checkpoint_binding") ===
          sha256(model),
      "invalid_checkpoint_binding",
    );
    const until = Math.min(
      expiry,
      instant(p.fundingValidUntil, "invalid_tinker_funding_expiry"),
      instant(p.checkpointExpiresAt, "invalid_checkpoint_expiry"),
    );
    requireThat(until > now, "tinker_funding_or_checkpoint_expired");
    const { prior, old } = bindPrior(
      "tinker",
      "BRIEFSTAMP_HOSTED_TINKER_PROOF_JSON",
      ["proofSha256", "usedUnits", "usedCalls", "evidenceSha256"],
    );
    requireThat(
      old.credentialSha256 === p.credentialSha256 &&
        old.freeOnly === true &&
        old.paidOverageDisabled === true &&
        old.maxUnits === 50000 &&
        old.maxCalls === 2 &&
        old.usedUnits === 0 &&
        old.usedCalls === 0 &&
        prior.usedUnits === 8912 &&
        prior.usedCalls === 1,
      "tinker_original_reservations_mismatch",
    );
    const proof = common(
      "tinker remainder only",
      previous.TINKER_API_KEY,
      "tokens",
      ["generate-checks"],
      41088,
      1,
    );
    proof.expiresAt = date(until);
    renderEnv.BRIEFSTAMP_HOSTED_TINKER_ENABLED = "true";
    renderEnv.BRIEFSTAMP_HOSTED_TINKER_PROOF_JSON = JSON.stringify(proof);
    plans.tinker = {
      status: "prepared_remainder_only",
      reservedPreviously: { calls: 1, tokens: 8912 },
      remainingCap: { calls: 1, tokens: 41088 },
      originalCap: { calls: 2, tokens: 50000 },
      expiresAt: proof.expiresAt,
    };
  }

  if (providers.backboard) {
    freshWindow();
    const p = exact(
      providers.backboard,
      [
        "credentialSha256",
        "newTrancheAuthorized",
        "trancheId",
        "existingCreditsApproved",
        "autoReloadEnabled",
        "paymentMethodConfigured",
        "confirmedCreditAllowanceUsd",
        "maxCreditSpendUsd",
      ],
      "invalid_backboard_proof",
    );
    trueFlags(
      p,
      ["newTrancheAuthorized", "existingCreditsApproved"],
      "backboard_new_tranche_not_authorized",
    );
    falseFlags(
      p,
      ["autoReloadEnabled", "paymentMethodConfigured"],
      "backboard_paid_boundary_not_confirmed",
    );
    matchingKey(p, previous, "BACKBOARD_API_KEY");
    operatorToken(previous);
    requireThat(
      typeof previous.BACKBOARD_ASSISTANT_ID === "string" &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          previous.BACKBOARD_ASSISTANT_ID,
        ),
      "existing_backboard_assistant_required",
    );
    const tranche = text(p.trancheId, "invalid_backboard_tranche_id", 8, 100);
    requireThat(
      /^[a-z0-9][a-z0-9_-]+$/.test(tranche) &&
        [0.02, 0.03].includes(p.maxCreditSpendUsd) &&
        Number.isFinite(p.confirmedCreditAllowanceUsd) &&
        p.confirmedCreditAllowanceUsd >= p.maxCreditSpendUsd &&
        p.confirmedCreditAllowanceUsd <= 0.03,
      "invalid_backboard_tranche_cap",
    );
    const { prior, old } = bindPrior(
      "backboard",
      "BRIEFSTAMP_BACKBOARD_ALLOWANCE_JSON",
      [
        "proofSha256",
        "trancheId",
        "usedUnits",
        "usedCalls",
        "usedCreditSpendUsd",
        "usedOperations",
        "evidenceSha256",
      ],
    );
    requireThat(
      old.credentialSha256 === p.credentialSha256 &&
        old.existingCreditOnly === true &&
        old.maxCalls === 2 &&
        old.maxUnits === 2 &&
        prior.usedCalls === 2 &&
        prior.usedUnits === 2 &&
        [0.02, 0.03].includes(prior.usedCreditSpendUsd) &&
        JSON.stringify(prior.usedOperations) ===
          JSON.stringify(["memory-write", "memory-search"]) &&
        text(prior.trancheId, "invalid_prior_tranche_id", 8, 100) !== tranche,
      "backboard_prior_tranche_not_preserved",
    );
    const proof = {
      credentialSha256: p.credentialSha256,
      checkedAt: date(checked),
      expiresAt: date(expiry),
      evidence: evidence(
        `new approved existing-credit tranche ${tranche}; prior tranche exhausted, not reset`,
      ),
      freeOnly: false,
      existingCreditOnly: true,
      existingCreditsApproved: true,
      autoReloadEnabled: false,
      paymentMethodConfigured: false,
      confirmedExistingCreditsUsd: p.confirmedCreditAllowanceUsd,
      maxCreditSpendUsd: p.maxCreditSpendUsd,
      usedCreditSpendUsd: 0,
      unit: "requests",
      operations: ["memory-write", "memory-search"],
      usedOperations: [],
      maxUnits: 2,
      usedUnits: 0,
      maxCalls: 2,
      usedCalls: 0,
    };
    renderEnv.BRIEFSTAMP_BACKBOARD_ENABLED = "true";
    renderEnv.BRIEFSTAMP_BACKBOARD_EXISTING_CREDITS_APPROVED = "true";
    renderEnv.BRIEFSTAMP_BACKBOARD_ALLOWANCE_JSON = JSON.stringify(proof);
    plans.backboard = {
      status: "prepared_new_authorized_tranche",
      funding: "approved existing credits; not claimed free-credit-only",
      priorReserved: { calls: 2, creditUsd: prior.usedCreditSpendUsd },
      newCap: { calls: 2, creditUsd: p.maxCreditSpendUsd },
      cumulativeReservedPlusNewCap: {
        calls: 4,
        creditUsd: Number(
          (prior.usedCreditSpendUsd + p.maxCreditSpendUsd).toFixed(2),
        ),
      },
      expiresAt: proof.expiresAt,
    };
  }

  if (providers.sentry) {
    const p = exact(
      providers.sentry,
      [
        "dsnSha256",
        "sponsoredPlanConfirmed",
        "paidOverageDisabled",
        "payAsYouGoUsd",
      ],
      "invalid_sentry_proof",
    );
    trueFlags(
      p,
      ["sponsoredPlanConfirmed", "paidOverageDisabled"],
      "sentry_free_plan_not_confirmed",
    );
    requireThat(
      p.payAsYouGoUsd === 0 &&
        digest(p.dsnSha256, "invalid_sentry_binding") ===
          sha256(text(previous.SENTRY_DSN, "invalid_sentry_dsn", 10, 1000)),
      "sentry_funding_or_binding_invalid",
    );
    let url;
    try {
      url = new URL(previous.SENTRY_DSN);
    } catch {
      throw new PreparationError("invalid_sentry_dsn");
    }
    requireThat(
      url.protocol === "https:" &&
        /(?:^|\.)ingest(?:\.[a-z]+)?\.sentry\.io$/.test(url.hostname) &&
        url.username &&
        !url.password &&
        !url.search &&
        !url.hash,
      "invalid_sentry_dsn",
    );
    renderEnv.FLOWPROOF_SENTRY_ENABLED = "true";
    renderEnv.FLOWPROOF_SENTRY_FREE_CONFIRMED = "true";
    renderEnv.FLOWPROOF_SENTRY_FREE_CONFIRMED_AT = date(checked);
    plans.sentry = {
      status: "prepared_sponsored_confirmation",
      expiresAt: date(checked + DAY),
      hostedIngestion: "requires independent new trace verification",
    };
  }

  if (providers.tiger) {
    const p = exact(
      providers.tiger,
      [
        "serviceHostname",
        "freeTrialConfirmed",
        "paidOverageDisabled",
        "paymentMethodConfigured",
        "freeUntil",
      ],
      "invalid_tiger_proof",
    );
    trueFlags(
      p,
      ["freeTrialConfirmed", "paidOverageDisabled"],
      "tiger_free_trial_not_confirmed",
    );
    falseFlags(
      p,
      ["paymentMethodConfigured"],
      "tiger_paid_boundary_not_confirmed",
    );
    let url;
    try {
      url = new URL(previous.BRIEFSTAMP_TIGER_DATABASE_URL);
    } catch {
      throw new PreparationError("invalid_tiger_connection");
    }
    requireThat(
      /^postgres(?:ql)?:$/.test(url.protocol) &&
        /^[a-z0-9-]+\.[a-z0-9-]+\.tsdb\.cloud\.timescale\.com$/.test(
          url.hostname,
        ) &&
        url.hostname === p.serviceHostname &&
        url.username === "briefstamp_demo_runtime" &&
        url.password &&
        url.pathname.length > 1 &&
        !url.search &&
        !url.hash,
      "invalid_tiger_connection",
    );
    requireThat(
      previous.DATABASE_SSL !== "false" &&
        previous.NODE_TLS_REJECT_UNAUTHORIZED !== "0" &&
        !previous.PGSSLMODE &&
        !previous.PGSSLROOTCERT &&
        !previous.NODE_EXTRA_CA_CERTS,
      "tiger_tls_override_forbidden",
    );
    const until = Math.min(
      instant(p.freeUntil, "invalid_tiger_trial_expiry"),
      CUTOFF,
      checked + 7 * DAY,
    );
    requireThat(until > now, "tiger_trial_window_expired");
    renderEnv.BRIEFSTAMP_TIGER_ENABLED = "true";
    renderEnv.BRIEFSTAMP_TIGER_CONFIRMED_FREE_UNTIL = date(until);
    plans.tiger = {
      status: "prepared_temporary_trial_confirmation",
      expiresAt: date(until),
      databaseRoleExpiry: "must independently remain valid",
    };
  }

  if (providers.gemma) {
    const p = exact(
      providers.gemma,
      [
        "credentialSha256",
        "freePricingConfirmed",
        "paidTierUnavailable",
        "freeUntil",
      ],
      "invalid_gemma_proof",
    );
    trueFlags(
      p,
      ["freePricingConfirmed", "paidTierUnavailable"],
      "gemma_free_pricing_not_confirmed",
    );
    matchingKey(p, previous, "GOOGLE_GEMMA_API_KEY");
    const until = Math.min(
      instant(p.freeUntil, "invalid_gemma_free_expiry"),
      CUTOFF,
      checked + 7 * DAY,
    );
    requireThat(until > now, "gemma_free_window_expired");
    renderEnv.BRIEFSTAMP_PUBLIC_GEMMA_ENABLED = "true";
    renderEnv.BRIEFSTAMP_GEMMA_CONFIRMED_FREE = "true";
    renderEnv.BRIEFSTAMP_GEMMA_FREE_UNTIL = date(until);
    plans.gemma = {
      status: "prepared_free_native_model_confirmation",
      expiresAt: date(until),
      livePricingCheck: "still required by runtime",
    };
  }

  for (const name of ["serpapi", "elevenlabs"]) {
    if (!providers[name]) continue;
    const existingProof =
      previous[`BRIEFSTAMP_HOSTED_${name.toUpperCase()}_PROOF_JSON`];
    requireThat(
      existingProof === undefined || existingProof.length === 0,
      `${name}_existing_hosted_allowance_cannot_be_renewed`,
    );
    freshWindow();
    operatorToken(previous);
    const p = providers[name];
    if (name === "serpapi") {
      exact(
        p,
        [
          "credentialSha256",
          "freePlanConfirmed",
          "paidOverageDisabled",
          "extraCredits",
          "remainingSearches",
          "allowedDomain",
        ],
        "invalid_serpapi_proof",
      );
      trueFlags(
        p,
        ["freePlanConfirmed", "paidOverageDisabled"],
        "serpapi_free_plan_not_confirmed",
      );
      requireThat(
        p.extraCredits === 0 &&
          p.allowedDomain === "flowproof-demo.onrender.com",
        "serpapi_paid_or_target_scope_invalid",
      );
      integer(
        p.remainingSearches,
        1,
        1000000,
        "serpapi_free_quota_unavailable",
      );
      matchingKey(p, previous, "SERPAPI_API_KEY");
      renderEnv.BRIEFSTAMP_HOSTED_SERPAPI_ENABLED = "true";
      renderEnv.BRIEFSTAMP_HOSTED_SERPAPI_PROOF_JSON = JSON.stringify(
        common(
          "new one-search hosted operator allowance",
          previous.SERPAPI_API_KEY,
          "requests",
          ["search-visibility"],
          1,
          1,
        ),
      );
      plans.serpapi = {
        status: "prepared_hosted_operator_allowance",
        maxCalls: 1,
        maxRequests: 1,
        expiresAt: date(expiry),
        credentialTransferApproval: "not granted by this preparation",
        liveVerification: "not performed",
      };
    } else {
      exact(
        p,
        [
          "credentialSha256",
          "zeroCostEntitlementConfirmed",
          "renewalInvoiceUsd",
          "paidOverageDisabled",
          "canExtendCharacterLimit",
          "allowedToExtendCharacterLimit",
          "remainingCharacters",
          "maxCharacters",
          "noncommercialDemoOnly",
          "stockVoiceConfirmed",
          "voiceId",
        ],
        "invalid_elevenlabs_proof",
      );
      trueFlags(
        p,
        [
          "zeroCostEntitlementConfirmed",
          "paidOverageDisabled",
          "noncommercialDemoOnly",
          "stockVoiceConfirmed",
        ],
        "elevenlabs_zero_cost_entitlement_or_stock_voice_not_confirmed",
      );
      falseFlags(
        p,
        ["canExtendCharacterLimit", "allowedToExtendCharacterLimit"],
        "elevenlabs_paid_extension_not_disabled",
      );
      requireThat(
        p.renewalInvoiceUsd === 0 && p.voiceId === "JBFqnCBsd6RMkjVDRZzb",
        "elevenlabs_invoice_or_voice_invalid",
      );
      const cap = integer(
        p.maxCharacters,
        1,
        1000,
        "elevenlabs_character_cap_invalid",
      );
      integer(
        p.remainingCharacters,
        cap,
        1000000,
        "elevenlabs_free_quota_unavailable",
      );
      matchingKey(p, previous, "ELEVENLABS_API_KEY");
      Object.assign(renderEnv, {
        ELEVENLABS_VOICE_ID: p.voiceId,
        BRIEFSTAMP_HOSTED_ELEVENLABS_ENABLED: "true",
        BRIEFSTAMP_ELEVENLABS_STOCK_VOICE_CONFIRMED: "true",
        BRIEFSTAMP_ELEVENLABS_NONCOMMERCIAL_DEMO: "true",
      });
      renderEnv.BRIEFSTAMP_HOSTED_ELEVENLABS_PROOF_JSON = JSON.stringify(
        common(
          "new synthetic speech hosted operator allowance",
          previous.ELEVENLABS_API_KEY,
          "characters",
          ["sample-speech"],
          cap,
          1,
        ),
      );
      plans.elevenlabs = {
        status: "prepared_hosted_operator_allowance",
        funding:
          "zero-invoice Creator entitlement; paid overage disabled; redemption origin unverified",
        maxCalls: 1,
        maxCharacters: cap,
        expiresAt: date(expiry),
        credentialTransferApproval: "not granted by this preparation",
        listeningVerification: "not performed",
      };
    }
  }
  const plan = {
    version: 1,
    status: "prepared_not_applied",
    preparedAt: date(now),
    accountCheckedAt: date(checked),
    providers: plans,
    disabledWithoutFreshProof: PROVIDERS.filter((name) => !providers[name]),
    providerCalls: 0,
    cloudChanges: 0,
    credentialsLogged: false,
    budgetContinuity:
      "Prior reservations retained. Tinker carries only its original remainder. Backboard is a separately authorized new tranche, never a reset. SerpApi and ElevenLabs support initial hosted setup only; existing nonempty proofs prevent replenishing their one-call budgets, even when unused.",
    limitation:
      "Local Render ledgers are ephemeral, not durable cross-deployment quotas. Preserve this cumulative receipt off-host; reduce or disable remaining caps before another deployment. Tinker preparation supports only the initial carry-forward from the original 2-call/50,000-token allowance after 1 call/8,912 reserved tokens. It rejects an already refreshed 1-call/41,088-token proof; later funding rechecks require separate cumulative-reservation review, never a reset. Fresh proofs and Sentry confirmation expire within 24 hours; this preparation cannot guarantee availability for the remaining judging days.",
  };
  return {
    renderEnv,
    plan,
    receipt: {
      version: 1,
      status: "prepared_not_applied",
      preparedAt: date(now),
      accountProofSha256: accountHash,
      envSnapshotSha256: sha256(JSON.stringify(envSnapshot)),
      priorReceiptSha256: priorHash,
      previousReservations: structuredClone(priorReceipt),
      providers: plans,
      deployOrSpendVerified: false,
      automaticRenewalAuthorized: false,
    },
  };
}

async function readPrivateJson(filename, label) {
  let handle;
  try {
    handle = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await handle.stat();
    requireThat(
      stat.isFile() && stat.size <= 2 * 1024 * 1024,
      `invalid_${label}_file`,
    );
    return json(await handle.readFile("utf8"), `invalid_${label}_json`);
  } catch (error) {
    if (error instanceof PreparationError) throw error;
    throw new PreparationError(`cannot_read_${label}_file`);
  } finally {
    await handle?.close();
  }
}
async function main(args) {
  if (args.length === 1 && args[0] === "--help") {
    console.log(
      "Prepare only; no network or apply.\nnode scripts/refresh-hosted-provider-proofs.mjs --account-proof <private.json> --env-snapshot <private.json> --prior-receipt <private.json> --output-dir <new-private-directory>\nInputs: explicit JSON files. Output files are private; an existing output directory is never reused. See the pure prepareRefresh function for the strict operator-attestation schema.",
    );
    return;
  }
  const values = {};
  const allowed = [
    "--account-proof",
    "--env-snapshot",
    "--prior-receipt",
    "--output-dir",
  ];
  requireThat(args.length === 8, "exactly_four_input_arguments_required");
  for (let i = 0; i < args.length; i += 2) {
    requireThat(
      allowed.includes(args[i]) &&
        !values[args[i]] &&
        typeof args[i + 1] === "string" &&
        args[i + 1].length > 0 &&
        !args[i + 1].startsWith("--"),
      "invalid_or_duplicate_argument",
    );
    values[args[i]] = path.resolve(args[i + 1]);
  }
  const accountProof = await readPrivateJson(
    values["--account-proof"],
    "account_proof",
  );
  const envSnapshot = await readPrivateJson(
    values["--env-snapshot"],
    "env_snapshot",
  );
  const priorReceipt = await readPrivateJson(
    values["--prior-receipt"],
    "prior_receipt",
  );
  const directory = values["--output-dir"];
  const result = prepareRefresh({ accountProof, envSnapshot, priorReceipt });
  try {
    await mkdir(directory, { mode: 0o700 });
  } catch {
    throw new PreparationError(
      "output_directory_must_be_new_with_existing_parent",
    );
  }
  const files = {
    "next-render-env.json": result.renderEnv,
    "prior-receipt.json": priorReceipt,
    "refresh-receipt.json": result.receipt,
    "plan.json": result.plan,
  };
  try {
    for (const [filename, contents] of Object.entries(files)) {
      await writeFile(
        path.join(directory, filename),
        `${JSON.stringify(contents, null, 2)}\n`,
        { mode: 0o600, flag: "wx" },
      );
    }
  } catch {
    throw new PreparationError("private_output_incomplete_do_not_apply");
  }
  console.log(JSON.stringify(result.plan, null, 2));
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(
      JSON.stringify({
        status: "not_prepared",
        error:
          error instanceof PreparationError
            ? error.message
            : "preparation_failed",
        providerCalls: 0,
        cloudChanges: 0,
      }),
    );
    process.exitCode = 1;
  });
}
