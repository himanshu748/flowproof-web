import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  authorizeHostedTinker,
  generateHostedTinkerProposal,
  hostTinkerEnabled,
  hostedTinkerOptions,
} from "../server/hosted-tinker.js";
import { validateChecks } from "../server/schema.js";

const now = Date.parse("2026-10-15T10:00:00Z");
const key = ["hosted", "tinker", "test", "key", "not", "real"].join("-");
const token = ["hosted", "tinker", "operator", "test", "token", "not", "real"].join("-");
const model = "tinker://test-training:train:0/sampler_weights/test";
const directories: string[] = [];
const requirement = 'The homepage heading must say "Hello".';
const heading = {
  requirement,
  kind: "heading",
  path: "/",
  expected: "Hello",
  viewport: "desktop",
};
const response = (checks: unknown[], finish = "stop") => ({
  choices: [{ finish_reason: finish, text: JSON.stringify({ checks }) }],
  usage: { prompt_tokens: 100, completion_tokens: 40 },
});

async function environment(): Promise<NodeJS.ProcessEnv> {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "briefstamp-hosted-tinker-"),
  );
  directories.push(directory);
  return {
    FLOWPROOF_DATA_DIR: directory,
    FLOWPROOF_TOKEN: token,
    TINKER_API_KEY: key,
    TINKER_MODEL_PATH: model,
    BRIEFSTAMP_HOSTED_TINKER_ENABLED: "true",
    BRIEFSTAMP_HOSTED_TINKER_PROOF_JSON: JSON.stringify({
      credentialSha256: createHash("sha256").update(key).digest("hex"),
      checkedAt: "2026-10-15T09:00:00Z",
      expiresAt: "2026-10-16T09:00:00Z",
      evidence: "Synthetic test proof; no live account or credit used",
      freeOnly: true,
      paidOverageDisabled: true,
      unit: "tokens",
      operations: ["generate-checks"],
      confirmedFreeUnits: 100000,
      maxUnits: 50000,
      usedUnits: 0,
      maxCalls: 2,
      usedCalls: 0,
    }),
  };
}

function amendProof(env: NodeJS.ProcessEnv, values: Record<string, unknown>) {
  env.BRIEFSTAMP_HOSTED_TINKER_PROOF_JSON = JSON.stringify({
    ...JSON.parse(env.BRIEFSTAMP_HOSTED_TINKER_PROOF_JSON!),
    ...values,
  });
}

async function ledger(filename: string) {
  return JSON.parse(await readFile(filename, "utf8")).providers.tinker;
}

afterEach(async () => {
  vi.unstubAllEnvs();
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

describe("hosted Tinker operator boundary", () => {
  it("checks availability and exact operator authorization without creating a ledger", async () => {
    const env = await environment();
    expect(hostTinkerEnabled(env, now)).toBe(true);
    expect(authorizeHostedTinker({}, env, now)).toBe(false);
    expect(
      authorizeHostedTinker({ "x-flowproof-token": `${token}wrong` }, env, now),
    ).toBe(false);
    expect(
      authorizeHostedTinker({ "x-flowproof-token": [token, token] }, env, now),
    ).toBe(false);
    expect(
      authorizeHostedTinker({ "x-flowproof-token": token }, env, now),
    ).toBe(true);
    expect(
      authorizeHostedTinker(
        new Headers({ "X-FlowProof-Token": token }),
        env,
        now,
      ),
    ).toBe(true);
    expect(
      authorizeHostedTinker(
        { "x-flowproof-token": token },
        { ...env, FLOWPROOF_TOKEN: "short" },
        now,
      ),
    ).toBe(false);
    expect(await readdir(env.FLOWPROOF_DATA_DIR!)).toEqual([]);
  });

  it.each([
    { freeOnly: false },
    { paidOverageDisabled: false },
    { credentialSha256: "0".repeat(64) },
    { checkedAt: "2026-10-13T09:00:00Z" },
    { checkedAt: "2026-10-15T10:01:00Z" },
    { expiresAt: "2026-10-15T10:00:00Z" },
    { expiresAt: "2026-10-17T09:00:00Z" },
    { confirmedFreeUnits: 49999 },
    { maxUnits: 50001 },
    { maxUnits: 0 },
    { maxCalls: 3 },
    { maxCalls: 0 },
    { usedCalls: 1 },
    { usedUnits: 1 },
    { unit: "requests" },
    { operations: ["generate-checks", "memory-write"] },
    { evidence: "" },
    { unexpected: true },
  ])(
    "rejects unsafe bootstrap proof before files or transport: %j",
    async (change) => {
      const env = await environment();
      amendProof(env, change);
      const fetcher = vi.fn<typeof fetch>();
      expect(hostTinkerEnabled(env, now)).toBe(false);
      expect(
        authorizeHostedTinker({ "x-flowproof-token": token }, env, now),
      ).toBe(false);
      await expect(
        generateHostedTinkerProposal([requirement], {
          env,
          now: () => now,
          fetcher,
        }),
      ).rejects.toMatchObject({ code: "disabled" });
      expect(fetcher).not.toHaveBeenCalled();
      expect(await readdir(env.FLOWPROOF_DATA_DIR!)).toEqual([]);
    },
  );

  it.each([
    { BRIEFSTAMP_HOSTED_TINKER_ENABLED: "false" },
    { BRIEFSTAMP_HOSTED_TINKER_PROOF_JSON: "not-json" },
    { BRIEFSTAMP_HOSTED_TINKER_PROOF_JSON: "x".repeat(16385) },
    { TINKER_API_KEY: "short" },
    { TINKER_MODEL_PATH: "https://attacker.invalid/model" },
    { FLOWPROOF_TOKEN: "short" },
  ])("fails closed on invalid configuration %j", async (change) => {
    const env: NodeJS.ProcessEnv = { ...(await environment()), ...change };
    const fetcher = vi.fn<typeof fetch>();
    expect(hostTinkerEnabled(env, now)).toBe(false);
    await expect(
      hostedTinkerOptions({ env, now: () => now, fetcher }),
    ).rejects.toMatchObject({ code: "disabled" });
    expect(fetcher).not.toHaveBeenCalled();
    expect(await readdir(env.FLOWPROOF_DATA_DIR!)).toEqual([]);
  });

  it("enforces the absolute October 20 expiry even for a fresh proof", async () => {
    const env = await environment();
    amendProof(env, {
      checkedAt: "2026-10-19T12:00:00Z",
      expiresAt: "2026-10-20T01:00:00Z",
    });
    expect(hostTinkerEnabled(env, Date.parse("2026-10-19T13:00:00Z"))).toBe(
      false,
    );
    expect(await readdir(env.FLOWPROOF_DATA_DIR!)).toEqual([]);
  });

  it("passes only restricted provider configuration to the native request", async () => {
    const env = await environment();
    env.DATABASE_URL = "excluded-database-secret";
    env.AWS_SECRET_ACCESS_KEY = "excluded-aws-secret";
    env.NODE_OPTIONS = "--excluded-test-option";
    env.BRIEFSTAMP_PROVIDER_ALLOWANCE_FILE =
      "/tmp/untrusted-ambient-ledger.json";
    const fetcher = vi.fn<typeof fetch>();
    const clock = () => now;
    const options = await hostedTinkerOptions({ env, now: clock, fetcher });
    expect(options.fetcher).toBe(fetcher);
    expect(options.now).toBe(clock);
    expect(options.env).toMatchObject({
      BRIEFSTAMP_TINKER_ENABLED: "true",
      TINKER_API_KEY: key,
      TINKER_MODEL_PATH: model,
    });
    for (const name of [
      "DATABASE_URL",
      "AWS_SECRET_ACCESS_KEY",
      "NODE_OPTIONS",
      "FLOWPROOF_TOKEN",
      "BRIEFSTAMP_HOSTED_TINKER_PROOF_JSON",
    ])
      expect(options.env).not.toHaveProperty(name);
    const filename = options.env!.BRIEFSTAMP_PROVIDER_ALLOWANCE_FILE!;
    expect(path.isAbsolute(filename)).toBe(true);
    expect(filename.startsWith(env.FLOWPROOF_DATA_DIR! + path.sep)).toBe(true);
    expect(await ledger(filename)).toMatchObject({
      usedCalls: 0,
      usedUnits: 0,
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    [],
    [""],
    [" leading whitespace"],
    ["trailing whitespace "],
    ["One requirement\nAnother requirement"],
    ["1. Numbered requirement"],
    ["- List item requirement"],
    ["x".repeat(2001)],
    Array(7).fill(requirement),
    ['Show "private-client@example.com".'],
  ])(
    "rejects unsupported inputs before creating or spending a ledger: %j",
    async (...requirements) => {
      const env = await environment();
      const fetcher = vi.fn<typeof fetch>();
      await expect(
        generateHostedTinkerProposal(requirements, {
          env,
          now: () => now,
          fetcher,
        }),
      ).rejects.toMatchObject({ code: "invalid_input" });
      expect(fetcher).not.toHaveBeenCalled();
      expect(await readdir(env.FLOWPROOF_DATA_DIR!)).toEqual([]);
    },
  );

  it("reserves before transport and returns schema-valid unapproved checks with native metadata", async () => {
    const env = await environment();
    const setup = await hostedTinkerOptions({ env, now: () => now });
    const filename = setup.env!.BRIEFSTAMP_PROVIDER_ALLOWANCE_FILE!;
    const subjective = "The website must feel welcoming.";
    let reservedUnits = 0;
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      const stored = await ledger(filename);
      expect(stored.usedCalls).toBe(1);
      expect(stored.usedUnits).toBeGreaterThan(2048);
      reservedUnits = stored.usedUnits;
      expect(String(url)).toBe(
        "https://tinker.thinkingmachines.dev/services/tinker-prod/oai/api/v1/completions",
      );
      expect(init?.redirect).toBe("error");
      expect(new Headers(init?.headers).get("authorization")).toBe(
        `Bearer ${key}`,
      );
      const body = JSON.parse(String(init?.body));
      expect(body.model).toBe(model);
      expect(body.max_tokens).toBe(2048);
      expect(body.stream).toBe(false);
      expect(body.prompt).toContain(requirement.replaceAll('"', '\\"'));
      return Response.json(
        response([
          heading,
          {
            requirement: subjective,
            kind: "text_visible",
            path: "/",
            expected: "Human review required",
            viewport: "desktop",
          },
        ]),
      );
    });
    const result = await generateHostedTinkerProposal(
      [requirement, subjective],
      {
        env,
        now: () => now,
        fetcher,
      },
    );
    expect(result.model).toBe(model);
    expect(result.usage).toEqual({ prompt_tokens: 100, completion_tokens: 40 });
    expect(result.reservedTokens).toBe(reservedUnits);
    expect(result.sourcePunctuationRestored).toEqual([false, false]);
    expect(result.redacted).toEqual([false, false]);
    expect(validateChecks(result.checks)).toEqual(result.checks);
    expect(new Set(result.checks.map((check) => check.id)).size).toBe(2);
    expect(result.checks.every((check) => check.approved === false)).toBe(true);
    expect(result.checks[0]).toMatchObject(heading);
    expect(result.checks[1]).toMatchObject({
      requirement: subjective,
      kind: "manual",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("never resets reservations for reordered proof JSON or a different checkpoint", async () => {
    const env = await environment();
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json(response([heading])),
    );
    const firstOptions = await hostedTinkerOptions({
      env,
      now: () => now,
      fetcher,
    });
    const first = await generateHostedTinkerProposal([requirement], {
      env,
      now: () => now,
      fetcher,
    });
    const filename = firstOptions.env!.BRIEFSTAMP_PROVIDER_ALLOWANCE_FILE!;
    const reserved = await readFile(filename, "utf8");
    env.BRIEFSTAMP_HOSTED_TINKER_PROOF_JSON = JSON.stringify(
      Object.fromEntries(
        Object.entries(
          JSON.parse(env.BRIEFSTAMP_HOSTED_TINKER_PROOF_JSON!),
        ).reverse(),
      ),
    );
    env.TINKER_MODEL_PATH =
      "tinker://other-training:train:0/sampler_weights/other";
    const restarted = await hostedTinkerOptions({
      env,
      now: () => now,
      fetcher,
    });
    expect(restarted.env!.BRIEFSTAMP_PROVIDER_ALLOWANCE_FILE).toBe(filename);
    expect(await readFile(filename, "utf8")).toBe(reserved);
    const second = await generateHostedTinkerProposal([requirement], {
      env,
      now: () => now,
      fetcher,
    });
    expect(second.checks[0]!.id).not.toBe(first.checks[0]!.id);
    await expect(
      generateHostedTinkerProposal([requirement], {
        env,
        now: () => now,
        fetcher,
      }),
    ).rejects.toMatchObject({ code: "budget_exhausted" });
    expect(await ledger(filename)).toMatchObject({
      usedCalls: 2,
      usedUnits: first.reservedTokens + second.reservedTokens,
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("does not repair an existing corrupt ledger", async () => {
    const env = await environment();
    const fetcher = vi.fn<typeof fetch>();
    const setup = await hostedTinkerOptions({ env, now: () => now, fetcher });
    const filename = setup.env!.BRIEFSTAMP_PROVIDER_ALLOWANCE_FILE!;
    await writeFile(filename, "invalid-ledger");
    await expect(
      generateHostedTinkerProposal([requirement], {
        env,
        now: () => now,
        fetcher,
      }),
    ).rejects.toMatchObject({ code: "free_confirmation_required" });
    expect(await readFile(filename, "utf8")).toBe("invalid-ledger");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([{ maxCalls: 3 }, { maxUnits: 50001 }])(
    "rejects an existing ledger that widens the confirmed hosted budget: %j",
    async (change) => {
      const env = await environment();
      const fetcher = vi.fn<typeof fetch>();
      const setup = await hostedTinkerOptions({ env, now: () => now, fetcher });
      const filename = setup.env!.BRIEFSTAMP_PROVIDER_ALLOWANCE_FILE!;
      const stored = JSON.parse(await readFile(filename, "utf8"));
      Object.assign(stored.providers.tinker, change);
      const modified = JSON.stringify(stored);
      await writeFile(filename, modified);
      await expect(
        generateHostedTinkerProposal([requirement], {
          env,
          now: () => now,
          fetcher,
        }),
      ).rejects.toMatchObject({ code: "free_confirmation_required" });
      expect(await readFile(filename, "utf8")).toBe(modified);
      expect(fetcher).not.toHaveBeenCalled();
    },
  );

  it("consumes a failed request once and never retries or refunds it", async () => {
    const env = await environment();
    amendProof(env, { maxCalls: 1 });
    const fetcher = vi.fn<typeof fetch>(async () => {
      throw new Error("synthetic transport failure");
    });
    const setup = await hostedTinkerOptions({ env, now: () => now, fetcher });
    const filename = setup.env!.BRIEFSTAMP_PROVIDER_ALLOWANCE_FILE!;
    await expect(
      generateHostedTinkerProposal([requirement], {
        env,
        now: () => now,
        fetcher,
      }),
    ).rejects.toMatchObject({ code: "request_failed" });
    const failed = await ledger(filename);
    expect(failed.usedCalls).toBe(1);
    expect(failed.usedUnits).toBeGreaterThan(2048);
    await expect(
      generateHostedTinkerProposal([requirement], {
        env,
        now: () => now,
        fetcher,
      }),
    ).rejects.toMatchObject({ code: "budget_exhausted" });
    expect(await ledger(filename)).toEqual(failed);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("rejects a changed source literal without replacing the original requirement", async () => {
    const env = await environment();
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json(
        response([
          { ...heading, requirement: requirement.replace("Hello", "Goodbye") },
        ]),
      ),
    );
    await expect(
      generateHostedTinkerProposal([requirement], {
        env,
        now: () => now,
        fetcher,
      }),
    ).rejects.toMatchObject({ code: "invalid_plan" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([
    { path: "https://attacker.invalid/" },
    { path: "//attacker.invalid/" },
    { approved: true },
    { script: "danger()" },
  ])("rejects unsafe model-generated check fields %j", async (change) => {
    const env = await environment();
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json(response([{ ...heading, ...change }])),
    );
    await expect(
      generateHostedTinkerProposal([requirement], {
        env,
        now: () => now,
        fetcher,
      }),
    ).rejects.toBeInstanceOf(Error);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("binds the path to the source requirement so a model traversal path cannot survive", async () => {
    const env = await environment();
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json(response([{ ...heading, path: "/%2e%2e/admin" }])),
    );
    const result = await generateHostedTinkerProposal([requirement], {
      env,
      now: () => now,
      fetcher,
    });
    expect(result.checks[0]).toMatchObject({ path: "/", approved: false });
    expect(validateChecks(result.checks)).toEqual(result.checks);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("does not pull model or orchestration SDKs into the hosted dependency graph", async () => {
    const visited = new Set<string>();
    const external = new Set<string>();
    async function visit(filename: string) {
      if (visited.has(filename)) return;
      visited.add(filename);
      const source = await readFile(filename, "utf8");
      const imports = source.matchAll(
        /(?:from\s*|import\s*\()(["'])([^"']+)\1/g,
      );
      for (const match of imports) {
        const specifier = match[2]!;
        if (specifier.startsWith(".")) {
          const dependency = path.resolve(
            path.dirname(filename),
            specifier.replace(/\.js$/, ".ts"),
          );
          await visit(dependency);
        } else external.add(specifier);
      }
    }
    await visit(path.resolve("server/hosted-tinker.ts"));
    expect(
      [...external].filter((name) =>
        /^(?:@mastra\/|@temporalio\/|tinker(?:\/|$))/.test(name),
      ),
    ).toEqual([]);
  });
});
