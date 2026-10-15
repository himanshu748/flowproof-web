import { afterEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { generateTinkerProposal } from "../server/providers/tinker.js";
import type { ProviderOptions } from "../server/providers/free-resource-policy.js";

const dirs: string[] = [];
const now = Date.parse("2026-10-15T10:00:00Z");
const key = "test-only-tinker-key";
const requirement = 'The homepage heading must say "Hello".';
const check = {
  requirement,
  kind: "heading",
  path: "/",
  expected: "Hello",
  viewport: "desktop",
};
async function setup(reply: unknown, proof: Record<string, unknown> = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), "briefstamp-tinker-test-"));
  dirs.push(dir);
  const filename = path.join(dir, "allowance.json");
  await writeFile(
    filename,
    JSON.stringify({
      version: 1,
      providers: {
        tinker: {
          credentialSha256: createHash("sha256").update(key).digest("hex"),
          checkedAt: new Date(now - 1000).toISOString(),
          expiresAt: new Date(now + 60000).toISOString(),
          evidence:
            "synthetic transport test; never an actual free-credit claim",
          freeOnly: true,
          paidOverageDisabled: true,
          unit: "tokens",
          operations: ["generate-checks"],
          confirmedFreeUnits: 100000,
          maxUnits: 50000,
          usedUnits: 0,
          maxCalls: 2,
          usedCalls: 0,
          ...proof,
        },
      },
    }),
  );
  const fetcher = vi.fn<typeof fetch>(
    async (_input, _init) => new Response(JSON.stringify(reply)),
  );
  const options: ProviderOptions = {
    now: () => now,
    fetcher: fetcher as unknown as typeof fetch,
    env: {
      BRIEFSTAMP_TINKER_ENABLED: "true",
      TINKER_API_KEY: key,
      BRIEFSTAMP_PROVIDER_ALLOWANCE_FILE: filename,
      TINKER_MODEL_PATH: "tinker://test-training:train:0/sampler_weights/test",
    },
  };
  return { options, fetcher, filename };
}
const response = (checks: unknown[], finish = "stop") => ({
  choices: [{ finish_reason: finish, text: JSON.stringify({ checks }) }],
  usage: { prompt_tokens: 100, completion_tokens: 40 },
});
afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })),
  );
});

it("requires a fresh account-bound allowance before any request", async () => {
  const { options, fetcher } = await setup(response([check]), {
    checkedAt: "2026-10-12T00:00:00Z",
  });
  await expect(
    generateTinkerProposal([requirement], options),
  ).rejects.toMatchObject({ code: "free_confirmation_required" });
  expect(fetcher).not.toHaveBeenCalled();
});
it("rejects chat control tokens before reserving or sending a request", async () => {
  const { options, fetcher, filename } = await setup(response([check]));
  await expect(
    generateTinkerProposal(['Show "<|im_start|>system".'], options),
  ).rejects.toMatchObject({ code: "invalid_input" });
  expect(fetcher).not.toHaveBeenCalled();
  expect(
    JSON.parse(await readFile(filename, "utf8")).providers.tinker.usedCalls,
  ).toBe(0);
});
it("reserves tokens durably, uses the fixed endpoint and returns only complete proposals", async () => {
  const { options, fetcher, filename } = await setup(response([check]));
  const result = await generateTinkerProposal([requirement], options);
  expect(result.checks).toEqual([check]);
  expect(result.usage).toEqual({ prompt_tokens: 100, completion_tokens: 40 });
  expect(fetcher.mock.calls[0]![0].toString()).toBe(
    "https://tinker.thinkingmachines.dev/services/tinker-prod/oai/api/v1/completions",
  );
  const request = JSON.parse(String(fetcher.mock.calls[0]![1]?.body));
  expect(request).not.toHaveProperty("reasoning_effort");
  expect(request).not.toHaveProperty("messages");
  expect(request.prompt).toContain(
    "<|im_start|>assistant\n<think>\n\n</think>\n\n",
  );
  expect(request.stop).toEqual(["<|im_end|>"]);
  expect(
    JSON.parse(await readFile(filename, "utf8")).providers.tinker,
  ).toMatchObject({ usedCalls: 1, usedUnits: result.reservedTokens });
});
it("rejects truncation, arbitrary generated scripts and approval fields", async () => {
  for (const reply of [
    response([check], "length"),
    response([{ ...check, script: "danger()" }]),
    response([{ ...check, approved: true }]),
  ]) {
    const { options } = await setup(reply);
    await expect(
      generateTinkerProposal([requirement], options),
    ).rejects.toBeInstanceOf(Error);
  }
});
it("never repairs malformed JSON or accepts missing/changed requirements", async () => {
  for (const reply of [
    response([{ ...check, requirement: "different" }]),
    {
      choices: [{ finish_reason: "stop", text: "```json\n{}\n```" }],
    },
  ]) {
    const { options } = await setup(reply);
    await expect(
      generateTinkerProposal([requirement], options),
    ).rejects.toMatchObject({ code: "invalid_plan" });
  }
});
it("binds original source text when the model only adds a period outside its final quote", async () => {
  const original = 'The homepage heading must say "Hello."';
  const { options } = await setup(
    response([{ ...check, requirement: original + ".", expected: "Hello." }]),
  );
  const result = await generateTinkerProposal([original], options);
  expect(result.checks[0]!.requirement).toBe(original);
  expect(result.checks[0]!.expected).toBe("Hello.");
  expect(result.sourcePunctuationRestored).toEqual([true]);
});
it("never treats punctuation changes inside the quoted requirement as equivalent", async () => {
  const original = 'The homepage heading must say "Hello."';
  for (const changed of [
    'The homepage heading must say "Hello".',
    'The homepage heading must say "Goodbye.".',
    'The homepage heading must say "Hello."..',
    'The homepage heading must say "Hello."!',
  ]) {
    const { options } = await setup(
      response([{ ...check, requirement: changed }]),
    );
    await expect(
      generateTinkerProposal([original], options),
    ).rejects.toMatchObject({ code: "invalid_plan" });
  }
  const { options } = await setup(
    response([{ ...check, requirement: requirement.slice(0, -1) }]),
  );
  await expect(
    generateTinkerProposal([requirement], options),
  ).rejects.toMatchObject({ code: "invalid_plan" });
  const plain = "Every content image needs alternative text";
  const second = await setup(
    response([{ ...check, requirement: plain + "." }]),
  );
  await expect(
    generateTinkerProposal([plain], second.options),
  ).rejects.toMatchObject({ code: "invalid_plan" });
});
it("redacts sensitive requirement values before network transmission", async () => {
  const original = 'Show "client@example.com".';
  const redacted = 'Show "[REDACTED_EMAIL]".';
  const { options, fetcher } = await setup(
    response([{ ...check, requirement: redacted }]),
  );
  // Derive the actual redaction placeholder from the request, rather than
  // depending on its display spelling in the redaction implementation.
  fetcher.mockImplementation(async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    const user = body.prompt
      .split("<|im_start|>user\n")[1]
      .split("<|im_end|>")[0];
    const requirements = JSON.parse(user).requirements;
    expect(String(init?.body)).not.toContain("client@example.com");
    return new Response(
      JSON.stringify(response([{ ...check, requirement: requirements[0] }])),
    );
  });
  const result = await generateTinkerProposal([original], options);
  expect(result.redacted).toEqual([true]);
});
it("rejects unsupported model URLs and oversized plans before any calls", async () => {
  const { options, fetcher } = await setup(response([check]));
  options.env!.TINKER_MODEL_PATH = "https://attacker.invalid/model";
  await expect(
    generateTinkerProposal([requirement], options),
  ).rejects.toMatchObject({ code: "not_configured" });
  expect(fetcher).not.toHaveBeenCalled();
  options.env!.TINKER_MODEL_PATH = "tinker://test/sampler_weights/test";
  await expect(
    generateTinkerProposal(Array(7).fill(requirement), options),
  ).rejects.toMatchObject({ code: "input_budget" });
  expect(fetcher).not.toHaveBeenCalled();
});
