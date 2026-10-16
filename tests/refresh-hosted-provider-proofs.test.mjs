import { afterEach, describe, expect, it } from "vitest";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { execFileSync, spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  prepareRefresh,
  sha256,
} from "../scripts/refresh-hosted-provider-proofs.mjs";
import { hostTinkerEnabled } from "../server/hosted-tinker.js";
import { hostBackboardEnabled } from "../server/hosted-backboard.js";
import { hostOptionalEnabled } from "../server/hosted-optional.js";
import { hostedSentryAvailable } from "../server/sentry-configuration.js";
import { hostedTigerEnabled } from "../server/hosted-tiger.js";
import { googleGemmaConfiguration } from "../server/providers/gemma-google.js";

const NOW = Date.parse("2026-10-16T09:00:00Z");
const CHECKED = "2026-10-16T08:23:00Z";
const cli = fileURLToPath(
  new URL("../scripts/refresh-hosted-provider-proofs.mjs", import.meta.url),
);
const directories = [];

function fixture() {
  const envSnapshot = {
    FLOWPROOF_TOKEN: [
      "synthetic",
      "operator",
      "token",
      "for",
      "preparation",
      "only",
    ].join("-"),
    TINKER_API_KEY: ["synthetic", "tinker", "key", "not", "live"].join("-"),
    TINKER_MODEL_PATH: "tinker://synthetic-training/sampler_weights/test",
    BACKBOARD_API_KEY: ["synthetic", "backboard", "key", "not", "live"].join(
      "-",
    ),
    BACKBOARD_ASSISTANT_ID: "00000000-0000-4000-8000-000000000000",
    SENTRY_DSN: "https://synthetic-public-key@o0.ingest.sentry.io/1234",
    BRIEFSTAMP_TIGER_DATABASE_URL:
      "postgres://briefstamp_demo_runtime:synthetic-password@service.region.tsdb.cloud.timescale.com/tsdb",
    GOOGLE_GEMMA_API_KEY: ["synthetic", "google", "key", "not", "live"].join(
      "-",
    ),
    SERPAPI_API_KEY: ["synthetic", "search", "key", "not", "live"].join("-"),
    ELEVENLABS_API_KEY: ["synthetic", "speech", "key", "not", "live"].join("-"),
    UNRELATED_CONFIG: "preserved",
  };
  const oldCommon = {
    checkedAt: "2026-10-15T10:00:00Z",
    expiresAt: "2026-10-16T10:00:00Z",
    evidence: "Synthetic previous allowance for offline tests only",
    usedUnits: 0,
    usedCalls: 0,
  };
  envSnapshot.BRIEFSTAMP_HOSTED_TINKER_PROOF_JSON = JSON.stringify({
    ...oldCommon,
    credentialSha256: sha256(envSnapshot.TINKER_API_KEY),
    freeOnly: true,
    paidOverageDisabled: true,
    unit: "tokens",
    operations: ["generate-checks"],
    confirmedFreeUnits: 50000,
    maxUnits: 50000,
    maxCalls: 2,
  });
  envSnapshot.BRIEFSTAMP_BACKBOARD_ALLOWANCE_JSON = JSON.stringify({
    ...oldCommon,
    credentialSha256: sha256(envSnapshot.BACKBOARD_API_KEY),
    freeOnly: false,
    existingCreditOnly: true,
    existingCreditsApproved: true,
    autoReloadEnabled: false,
    paymentMethodConfigured: false,
    confirmedExistingCreditsUsd: 0.03,
    maxCreditSpendUsd: 0.03,
    usedCreditSpendUsd: 0,
    unit: "requests",
    operations: ["memory-write", "memory-search"],
    usedOperations: [],
    maxUnits: 2,
    maxCalls: 2,
  });
  const accountProof = {
    version: 1,
    checkedAt: CHECKED,
    providers: {
      tinker: {
        credentialSha256: sha256(envSnapshot.TINKER_API_KEY),
        freeCreditsConfirmed: true,
        paidOverageDisabled: true,
        autoReloadEnabled: false,
        paymentMethodConfigured: false,
        confirmedFreeUnits: 41088,
        fundingValidUntil: "2027-10-08T00:00:00Z",
        checkpointSha256: sha256(envSnapshot.TINKER_MODEL_PATH),
        checkpointExpiresAt: "2026-10-19T23:59:30Z",
      },
      backboard: {
        credentialSha256: sha256(envSnapshot.BACKBOARD_API_KEY),
        newTrancheAuthorized: true,
        trancheId: "hosted-2026-10-16",
        existingCreditsApproved: true,
        autoReloadEnabled: false,
        paymentMethodConfigured: false,
        confirmedCreditAllowanceUsd: 0.03,
        maxCreditSpendUsd: 0.03,
      },
      sentry: {
        dsnSha256: sha256(envSnapshot.SENTRY_DSN),
        sponsoredPlanConfirmed: true,
        paidOverageDisabled: true,
        payAsYouGoUsd: 0,
      },
      tiger: {
        serviceHostname: "service.region.tsdb.cloud.timescale.com",
        freeTrialConfirmed: true,
        paidOverageDisabled: true,
        paymentMethodConfigured: false,
        freeUntil: "2026-11-05T00:00:00Z",
      },
      gemma: {
        credentialSha256: sha256(envSnapshot.GOOGLE_GEMMA_API_KEY),
        freePricingConfirmed: true,
        paidTierUnavailable: true,
        freeUntil: "2026-10-25T00:00:00Z",
      },
      serpapi: {
        credentialSha256: sha256(envSnapshot.SERPAPI_API_KEY),
        freePlanConfirmed: true,
        paidOverageDisabled: true,
        extraCredits: 0,
        remainingSearches: 10,
        allowedDomain: "flowproof-demo.onrender.com",
      },
      elevenlabs: {
        credentialSha256: sha256(envSnapshot.ELEVENLABS_API_KEY),
        zeroCostEntitlementConfirmed: true,
        renewalInvoiceUsd: 0,
        paidOverageDisabled: true,
        canExtendCharacterLimit: false,
        allowedToExtendCharacterLimit: false,
        remainingCharacters: 1500,
        maxCharacters: 1000,
        noncommercialDemoOnly: true,
        stockVoiceConfirmed: true,
        voiceId: "JBFqnCBsd6RMkjVDRZzb",
      },
    },
  };
  const priorReceipt = {
    version: 1,
    confirmedAt: CHECKED,
    providers: {
      tinker: {
        proofSha256: sha256(envSnapshot.BRIEFSTAMP_HOSTED_TINKER_PROOF_JSON),
        usedUnits: 8912,
        usedCalls: 1,
        evidenceSha256: sha256("synthetic tinker reservation"),
      },
      backboard: {
        proofSha256: sha256(envSnapshot.BRIEFSTAMP_BACKBOARD_ALLOWANCE_JSON),
        trancheId: "hosted-2026-10-15",
        usedUnits: 2,
        usedCalls: 2,
        usedCreditSpendUsd: 0.02,
        usedOperations: ["memory-write", "memory-search"],
        evidenceSha256: sha256("synthetic backboard reservation"),
      },
    },
  };
  return { accountProof, envSnapshot, priorReceipt, now: NOW };
}

afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

describe("private provider-proof preparation", () => {
  it("generates application-valid hosted proofs while conserving the Tinker remainder", () => {
    const input = fixture();
    const before = JSON.stringify(input);
    const result = prepareRefresh(input);
    const env = result.renderEnv;
    expect(hostTinkerEnabled(env, NOW)).toBe(true);
    expect(hostBackboardEnabled(env, NOW)).toBe(true);
    expect(hostOptionalEnabled("serpapi", env, NOW)).toBe(true);
    expect(hostOptionalEnabled("elevenlabs", env, NOW)).toBe(true);
    expect(hostedSentryAvailable(env, NOW)).toBe(true);
    expect(hostedTigerEnabled(env, NOW)).toBe(true);
    expect(googleGemmaConfiguration(env, () => NOW).enabled).toBe(true);
    const tinker = JSON.parse(env.BRIEFSTAMP_HOSTED_TINKER_PROOF_JSON);
    expect(tinker).toMatchObject({
      maxCalls: 1,
      maxUnits: 41088,
      usedCalls: 0,
      usedUnits: 0,
    });
    expect(
      tinker.maxUnits + input.priorReceipt.providers.tinker.usedUnits,
    ).toBe(50000);
    expect(
      tinker.maxCalls + input.priorReceipt.providers.tinker.usedCalls,
    ).toBe(2);
    expect(result.receipt.previousReservations).toEqual(input.priorReceipt);
    expect(JSON.stringify(input)).toBe(before);
    expect(env.UNRELATED_CONFIG).toBe("preserved");
    expect(env.BRIEFSTAMP_TIGER_CONFIRMED_FREE_UNTIL).toBe(
      "2026-10-20T00:00:00.000Z",
    );
    expect(env.BRIEFSTAMP_GEMMA_FREE_UNTIL).toBe("2026-10-20T00:00:00.000Z");
    expect(env.BRIEFSTAMP_SERPAPI_ENABLED).toBe("false");
    expect(env.BRIEFSTAMP_ELEVENLABS_ENABLED).toBe("false");
    expect(result).not.toHaveProperty("optionalLedger");
  });

  it("records Backboard as an additional authorized tranche, never recovered free use", () => {
    const result = prepareRefresh(fixture());
    const proof = JSON.parse(
      result.renderEnv.BRIEFSTAMP_BACKBOARD_ALLOWANCE_JSON,
    );
    expect(proof.freeOnly).toBe(false);
    expect(proof.maxCreditSpendUsd).toBe(0.03);
    expect(proof.evidence).toContain("prior tranche exhausted, not reset");
    expect(
      result.plan.providers.backboard.cumulativeReservedPlusNewCap,
    ).toEqual({ calls: 4, creditUsd: 0.05 });
    expect(result.receipt.automaticRenewalAuthorized).toBe(false);
    expect(result.plan.limitation).toContain("cannot guarantee availability");
  });

  it.each([
    [
      "future proof",
      (x) => {
        x.accountProof.checkedAt = "2026-10-16T10:00:00Z";
      },
    ],
    [
      "stale proof",
      (x) => {
        x.accountProof.checkedAt = "2026-10-15T08:59:59Z";
      },
    ],
    [
      "stale cumulative use",
      (x) => {
        x.priorReceipt.confirmedAt = "2026-10-15T08:00:00Z";
      },
    ],
    [
      "future cumulative use",
      (x) => {
        x.priorReceipt.confirmedAt = "2026-10-16T10:00:00Z";
      },
    ],
    [
      "refunded Tinker reservation",
      (x) => {
        x.priorReceipt.providers.tinker.usedUnits = 8000;
      },
    ],
    [
      "forgotten prior call",
      (x) => {
        x.priorReceipt.providers.tinker.usedCalls = 0;
      },
    ],
    [
      "unbound prior proof",
      (x) => {
        x.priorReceipt.providers.tinker.proofSha256 = "a".repeat(64);
      },
    ],
    [
      "wrong key",
      (x) => {
        x.envSnapshot.TINKER_API_KEY = ["different", "test", "key"].join("-");
      },
    ],
    [
      "expired sampler",
      (x) => {
        x.accountProof.providers.tinker.checkpointExpiresAt =
          "2026-10-16T08:00:00Z";
      },
    ],
    [
      "paid Tinker reload",
      (x) => {
        x.accountProof.providers.tinker.autoReloadEnabled = true;
      },
    ],
    [
      "unauthorized new memory tranche",
      (x) => {
        x.accountProof.providers.backboard.newTrancheAuthorized = false;
      },
    ],
    [
      "reused memory tranche",
      (x) => {
        x.accountProof.providers.backboard.trancheId = "hosted-2026-10-15";
      },
    ],
    [
      "widened memory cap",
      (x) => {
        x.accountProof.providers.backboard.maxCreditSpendUsd = 0.04;
      },
    ],
    [
      "truthy string funding",
      (x) => {
        x.accountProof.providers.sentry.paidOverageDisabled = "true";
      },
    ],
    [
      "Sentry paid allowance",
      (x) => {
        x.accountProof.providers.sentry.payAsYouGoUsd = 1;
      },
    ],
    [
      "TLS bypass",
      (x) => {
        x.envSnapshot.NODE_TLS_REJECT_UNAUTHORIZED = "0";
      },
    ],
    [
      "extra paid searches",
      (x) => {
        x.accountProof.providers.serpapi.extraCredits = 1;
      },
    ],
    [
      "speech overage",
      (x) => {
        x.accountProof.providers.elevenlabs.allowedToExtendCharacterLimit = true;
      },
    ],
    [
      "unconfirmed stock voice",
      (x) => {
        x.accountProof.providers.elevenlabs.stockVoiceConfirmed = false;
      },
    ],
    [
      "different voice",
      (x) => {
        x.accountProof.providers.elevenlabs.voiceId = "aaaaaaaaaaaaaaaaaaaa";
      },
    ],
    [
      "speech cap widening",
      (x) => {
        x.accountProof.providers.elevenlabs.maxCharacters = 1001;
      },
    ],
    [
      "unknown provider",
      (x) => {
        x.accountProof.providers.other = {};
      },
    ],
    [
      "unknown proof field",
      (x) => {
        x.accountProof.providers.tinker.skipConfirmation = true;
      },
    ],
    [
      "invalid existing flag",
      (x) => {
        x.envSnapshot.BRIEFSTAMP_HOSTED_TINKER_ENABLED = "TRUE";
      },
    ],
  ])("rejects %s without modifying inputs", (_name, change) => {
    const input = fixture();
    change(input);
    const before = JSON.stringify(input);
    expect(() => prepareRefresh(input)).toThrow();
    expect(JSON.stringify(input)).toBe(before);
  });

  it("does not expose credentials or account balances in its printable plan", () => {
    const input = fixture();
    const plan = JSON.stringify(prepareRefresh(input).plan);
    for (const key of [
      "TINKER_API_KEY",
      "BACKBOARD_API_KEY",
      "SERPAPI_API_KEY",
      "ELEVENLABS_API_KEY",
      "GOOGLE_GEMMA_API_KEY",
      "SENTRY_DSN",
      "BRIEFSTAMP_TIGER_DATABASE_URL",
      "FLOWPROOF_TOKEN",
      "TINKER_MODEL_PATH",
    ]) {
      expect(plan).not.toContain(input.envSnapshot[key]);
    }
    expect(plan).not.toContain("remainingCharacters");
    expect(plan).not.toContain("remainingSearches");
  });

  it.each(["serpapi", "elevenlabs"])(
    "rejects a changed-timestamp repeat of %s setup even with an unused prior allowance",
    (provider) => {
      const input = fixture();
      input.accountProof.providers = {
        [provider]: input.accountProof.providers[provider],
      };
      const prepared = prepareRefresh(input);
      const proofName = `BRIEFSTAMP_HOSTED_${provider.toUpperCase()}_PROOF_JSON`;
      expect(JSON.parse(prepared.renderEnv[proofName]).usedCalls).toBe(0);
      input.envSnapshot = prepared.renderEnv;
      input.accountProof.checkedAt = "2026-10-16T10:00:00Z";
      input.priorReceipt.confirmedAt = "2026-10-16T10:00:00Z";
      input.now = Date.parse("2026-10-16T10:01:00Z");
      const before = JSON.stringify(input);
      expect(() => prepareRefresh(input)).toThrow(
        `${provider}_existing_hosted_allowance_cannot_be_renewed`,
      );
      expect(JSON.stringify(input)).toBe(before);
    },
  );

  it.each(["serpapi", "elevenlabs"])(
    "does not replace malformed or disabled existing %s proofs",
    (provider) => {
      const input = fixture();
      input.accountProof.providers = {
        [provider]: input.accountProof.providers[provider],
      };
      const prefix = `BRIEFSTAMP_HOSTED_${provider.toUpperCase()}`;
      input.envSnapshot[`${prefix}_ENABLED`] = "false";
      for (const existing of ["not-json", " ", '{"usedCalls":1}']) {
        input.envSnapshot[`${prefix}_PROOF_JSON`] = existing;
        expect(() => prepareRefresh(input)).toThrow(
          `${provider}_existing_hosted_allowance_cannot_be_renewed`,
        );
        expect(input.envSnapshot[`${prefix}_PROOF_JSON`]).toBe(existing);
      }
    },
  );

  it.each(["serpapi", "elevenlabs"])(
    "disables an omitted %s provider while retaining its existing proof unchanged",
    (provider) => {
      const input = fixture();
      const prepared = prepareRefresh(input);
      input.envSnapshot = prepared.renderEnv;
      input.accountProof.providers = {
        sentry: input.accountProof.providers.sentry,
      };
      const prefix = `BRIEFSTAMP_HOSTED_${provider.toUpperCase()}`;
      const result = prepareRefresh(input);
      expect(result.renderEnv[`${prefix}_ENABLED`]).toBe("false");
      expect(result.renderEnv[`${prefix}_PROOF_JSON`]).toBe(
        prepared.renderEnv[`${prefix}_PROOF_JSON`],
      );
      expect(result.plan.disabledWithoutFreshProof).toContain(provider);
      expect(result.plan.providers).not.toHaveProperty(provider);
    },
  );

  it("accepts explicit Render rows and disables providers lacking fresh observations", () => {
    const input = fixture();
    input.accountProof.providers = {
      sentry: input.accountProof.providers.sentry,
    };
    input.envSnapshot = Object.entries(input.envSnapshot).map(
      ([key, value]) => ({ envVar: { key, value } }),
    );
    const result = prepareRefresh(input);
    expect(result.renderEnv.FLOWPROOF_SENTRY_ENABLED).toBe("true");
    expect(result.renderEnv.BRIEFSTAMP_HOSTED_TINKER_ENABLED).toBe("false");
    expect(result.renderEnv.BRIEFSTAMP_HOSTED_SERPAPI_ENABLED).toBe("false");
    expect(result.plan.disabledWithoutFreshProof).toContain("tinker");
  });

  it("writes private files once, preserves inputs and refuses existing output directories", async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "briefstamp-proof-preparation-"),
    );
    directories.push(directory);
    const input = fixture();
    const checked = new Date().toISOString();
    input.accountProof = {
      version: 1,
      checkedAt: checked,
      providers: { sentry: input.accountProof.providers.sentry },
    };
    input.priorReceipt = { version: 1, confirmedAt: checked, providers: {} };
    const args = [];
    for (const [flag, data] of [
      ["account-proof", input.accountProof],
      ["env-snapshot", input.envSnapshot],
      ["prior-receipt", input.priorReceipt],
    ]) {
      const filename = path.join(directory, `${flag}.json`);
      await writeFile(filename, JSON.stringify(data), { mode: 0o600 });
      args.push(`--${flag}`, filename);
    }
    const output = path.join(directory, "prepared");
    args.push("--output-dir", output);
    const stdout = execFileSync(process.execPath, [cli, ...args], {
      encoding: "utf8",
    });
    expect(JSON.parse(stdout).status).toBe("prepared_not_applied");
    expect(stdout).not.toContain(input.envSnapshot.TINKER_API_KEY);
    expect((await stat(output)).mode & 0o777).toBe(0o700);
    expect((await readdir(output)).sort()).toEqual([
      "next-render-env.json",
      "plan.json",
      "prior-receipt.json",
      "refresh-receipt.json",
    ]);
    for (const filename of await readdir(output))
      expect((await stat(path.join(output, filename))).mode & 0o777).toBe(
        0o600,
      );
    expect(
      JSON.parse(
        await readFile(path.join(output, "prior-receipt.json"), "utf8"),
      ),
    ).toEqual(input.priorReceipt);
    expect(
      JSON.parse(
        await readFile(path.join(directory, "env-snapshot.json"), "utf8"),
      ),
    ).toEqual(input.envSnapshot);
    const before = await readFile(
      path.join(output, "next-render-env.json"),
      "utf8",
    );
    const second = spawnSync(process.execPath, [cli, ...args], {
      encoding: "utf8",
    });
    expect(second.status).toBe(1);
    expect(second.stderr).toContain("output_directory_must_be_new");
    expect(
      await readFile(path.join(output, "next-render-env.json"), "utf8"),
    ).toBe(before);
  });
});
