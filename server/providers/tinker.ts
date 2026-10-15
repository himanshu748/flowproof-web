import { z } from "zod";
import {
  providerRequest,
  providerJson,
  ProviderError,
  type ProviderOptions,
} from "./free-resource-policy.js";
import { redact } from "../../shared/redact.js";

const endpoint = new URL(
  "https://tinker.thinkingmachines.dev/services/tinker-prod/oai/api/v1/completions",
);
const proposal = z
  .object({
    requirement: z.string().max(3000),
    kind: z.enum([
      "heading",
      "text_visible",
      "link",
      "image_alt",
      "no_horizontal_overflow",
      "manual",
    ]),
    path: z.string().max(300),
    expected: z.string().max(1000),
    viewport: z.enum(["desktop", "mobile"]),
  })
  .strict();
const plan = z.object({ checks: z.array(proposal).min(1).max(6) }).strict();
const envelope = z.object({
  choices: z
    .array(
      z.object({
        finish_reason: z.literal("stop"),
        text: z.string().max(32_000),
      }),
    )
    .length(1),
  usage: z
    .object({
      prompt_tokens: z.number().int().nonnegative(),
      completion_tokens: z.number().int().nonnegative(),
    })
    .optional(),
});
const prompt = `Convert the numbered website requirements into JSON with exactly a checks array, one check per requirement in original order. Each check has exactly requirement (copy the complete input requirement), kind, path, expected, viewport. Allowed kinds: heading, text_visible, link, image_alt, no_horizontal_overflow, manual. Use site-relative path / unless explicitly specified, never a URL. viewport is desktop or mobile (390px). Text and heading checks require the exact literal requested text. Link checks its visible label only. image_alt checks nonempty alt presence, not quality. no_horizontal_overflow checks document width. Use manual for subjective claims, unknown expected text, negative assertions, payment, forms, authentication, destructive actions, timing, counts, styling, unsupported widths or any unsupported behavior. Do not return scripts, selectors, approval flags or commentary. Return JSON only.`;

/** Native HTTP integration with Tinker's official low-traffic operator API.
 * No calls occur without the independently confirmed free-resource gate.
 */
export async function generateTinkerProposal(
  originals: string[],
  options: ProviderOptions = {},
) {
  const env = options.env ?? process.env;
  const model = env.TINKER_MODEL_PATH;
  if (
    !model ||
    !/^tinker:\/\/[A-Za-z0-9:_-]{1,150}\/sampler_weights\/[A-Za-z0-9_.-]{1,100}$/.test(
      model,
    )
  )
    throw new ProviderError(
      "not_configured",
      "A current Tinker sampler checkpoint is required; expired experimental checkpoints are not reused.",
    );
  if (
    !originals.length ||
    originals.length > 6 ||
    originals.some((x) => !x.trim() || x.length > 2000)
  )
    throw new ProviderError(
      "input_budget",
      "Tinker operator generation allows at most six requirements of 2,000 characters each.",
    );
  const requirements = originals.map(redact);
  if (
    requirements.some((value) =>
      /<\|(?:im_start|im_end|endoftext)\|>/u.test(value),
    )
  )
    throw new ProviderError(
      "invalid_input",
      "Chat control tokens are not supported in requirements.",
    );
  // Exact text-only Qwen3.5 HF template, verified against the pinned tokenizer
  // with add_generation_prompt=True and enable_thinking=False. The raw endpoint
  // must not re-render it with the server's default thinking-enabled template.
  const renderedPrompt = `<|im_start|>system\n${prompt}<|im_end|>\n<|im_start|>user\n${JSON.stringify({ requirements })}<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n`;
  // Qwen uses byte-level BPE. Reserve two tokens per UTF-8 byte plus a generous
  // framing allowance and the entire completion cap; never assume actual usage.
  const outputCap = 2048;
  const reservedTokens =
    2 * Buffer.byteLength(renderedPrompt, "utf8") + 4096 + outputCap;
  const response = await providerRequest(
    "tinker",
    endpoint,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${env.TINKER_API_KEY ?? ""}`,
      },
      body: JSON.stringify({
        model,
        prompt: renderedPrompt,
        max_tokens: outputCap,
        temperature: 0,
        stream: false,
        stop: ["<|im_end|>"],
      }),
    },
    "generate-checks",
    reservedTokens,
    "tokens",
    options,
  );
  const parsed = envelope.safeParse(await providerJson(response));
  if (!parsed.success)
    throw new ProviderError(
      "invalid_response",
      "Tinker did not return one complete, bounded structured response.",
    );
  let checked: z.infer<typeof plan>;
  try {
    checked = plan.parse(JSON.parse(parsed.data.choices[0].text));
  } catch {
    throw new ProviderError(
      "invalid_plan",
      "Tinker returned an invalid plan. No generated code was executed.",
    );
  }
  // Attribution belongs to the input, never the model. Permit only a sentence
  // period outside the final quotation mark; text inside the quote stays exact.
  // This production binding rule does not change the frozen benchmark parser.
  const matchesSource = (returned: string, original: string) =>
    returned === original ||
    (returned === original + "." && /["'”’]$/u.test(original));
  if (
    checked.checks.length !== requirements.length ||
    checked.checks.some(
      (c, i) => !matchesSource(c.requirement, requirements[i]),
    )
  )
    throw new ProviderError(
      "invalid_plan",
      "Tinker omitted, changed or reordered a source requirement.",
    );
  const sourcePunctuationRestored = checked.checks.map(
    (check, i) => check.requirement !== requirements[i],
  );
  checked.checks = checked.checks.map((check, i) => ({
    ...check,
    requirement: requirements[i],
  }));
  const usage = parsed.data.usage;
  if (
    usage &&
    (usage.completion_tokens > outputCap ||
      usage.prompt_tokens + usage.completion_tokens > reservedTokens)
  )
    throw new ProviderError(
      "usage_bound",
      "Reported provider usage exceeded the reserved bound; disable this integration and recheck its allowance.",
    );
  return {
    checks: checked.checks,
    model,
    usage: usage ?? null,
    reservedTokens,
    sourcePunctuationRestored,
    redacted: originals.map((x, i) => x !== requirements[i]),
  };
}
