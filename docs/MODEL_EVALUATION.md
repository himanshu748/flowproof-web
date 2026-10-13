# Model work and evidence boundaries

The application works without a model. Its default generator is a disclosed deterministic parser. Every proposed check starts unapproved; uncertain, subjective, destructive and unsupported requirements become manual checks. Local AI proposals use the same finite schema and require approval. Generated JavaScript is never accepted.

## Local inference

The server supports an operator-configured, loopback-only Ollama service. Enable it explicitly:

```sh
FLOWPROOF_AI_ENABLED=true
FLOWPROOF_OLLAMA_MODEL=gemma3:4b
FLOWPROOF_OLLAMA_URL=http://127.0.0.1:11434
FLOWPROOF_GEMMA_ENABLED=true
FLOWPROOF_GEMMA_MODEL=gemma3:4b
```

These values are examples for an already installed model. FlowProof does not download a model, purchase inference, or start a provider automatically. The app records the actual generation provider and model on each project. Unreachable service, invalid JSON, missing requirement indices, unsupported fields and a 60-second timeout produce a clearly labelled deterministic fallback. Gemini and Gemma are different model families; the optional local adapter uses Gemma, not Gemini. AI repair suggestions are separately labelled commentary and cannot change observed statuses. The server binds proposals to the original requirement by index and enforces explicit page paths, viewport limits and abstention on unsupported regions or subjective quality. For example, nonempty alt text is executable; descriptive alt quality requires human review.

A real local `gemma3:4b` smoke check produced one safe, unapproved proposal in 8,951 ms. A second request produced suggestions from the actual broken-sample browser audit in 25,761 ms. These are single adapter checks, not accuracy benchmarks. Receipts are `work/gemma-generation-receipt.json` and `work/gemma-summary-receipt.json`. Multi-requirement requests also hit validation and timeout fallbacks during development; those failures must not be described as successful AI generation.

Reproduce after the real sample audit exists and local inference is explicitly enabled:

```sh
npm run audit:sample
FLOWPROOF_AI_ENABLED=true FLOWPROOF_OLLAMA_MODEL=gemma3:4b FLOWPROOF_GEMMA_ENABLED=true node --import tsx eval/smoke-local.ts
```

## Candidate dataset

`eval/candidates.jsonl` contains 360 synthetic candidates: 216 training, 72 validation, 72 test. It covers six assertion kinds across 20 synthetic website groups. Website identities and wording-family identities are disjoint across splits. The same six assertion categories occur in each split. Wording templates within a family are highly related; this is a small synthetic benchmark, not evidence of generalization to real client briefs.

**No candidate has been human reviewed. Validated examples: zero.** Generated reference answers are proposals, not ground truth. Do not claim manual validation or model improvement from this file.

Review workflow:

1. A human reads each requirement and its proposed reference. Fix the definition if necessary. Reject examples that are ambiguous or cannot be completely represented by the supported assertion.
2. Record `review.status: "approved"`, the reviewer's identity and an ISO timestamp only after that person actually reviewed that example. Remove rejected rows from the frozen experiment dataset.
3. Keep website and wording-family groups in their original split. Avoid moving near duplicates across groups. Freeze the reviewed JSONL and retain its hash.
4. Run the validation command below. Training and evaluation refuse any unreviewed row. Do not bulk-mark generated rows as reviewed to bypass this gate.

```sh
python3 scripts/model-dataset.py --validate eval/candidates.jsonl
python3 scripts/model-dataset.py --validate eval/reviewed.jsonl --require-reviewed
```

The generator will not overwrite an existing candidate file. Use `--output` to create a fresh draft, preserving any reviews.

## Tinker experiment commands

Scripts follow the official [Tinker supervised fine-tuning workflow](https://tinker-docs.thinkingmachines.ai/tutorials/basics/first-sft/), [SDK client API](https://tinker-docs.thinkingmachines.ai/tinker/sdk-cheatsheet/) and [Qwen renderer documentation](https://tinker-docs.thinkingmachines.ai/cookbook/api-reference/renderers/get_renderer/). The documented base model is `Qwen/Qwen3.5-4B`; scripts verify its availability or checkpoint identity and never silently substitute another model.

The Python commands have been syntax checked and their offline refusal paths exercised. Remote SDK training and inference have not been executed for this project. An SDK/API compatibility adjustment may be necessary after installing the optional dependencies. No checkpoint or improvement is claimed.

Install optional dependencies in an isolated environment with `pip install -r eval/requirements.txt`. Freeze the resolved package versions alongside any real experiment. Then run offline validation:

```sh
python3 scripts/model-train.py --dataset eval/reviewed.jsonl
python3 scripts/model-evaluate.py --dataset eval/reviewed.jsonl --configuration zero-shot
```

No provider work occurs without `--run`. For a real run, the operator must first establish that sufficient free credits cover all operations, including any provider-specific charges. The [provider pricing and billing terms](https://tinker-docs.thinkingmachines.ai/tinker/models/models_and_pricing/) are authoritative; a token count in this code is not a financial guarantee.

A provider run additionally requires `TINKER_API_KEY`, `FLOWPROOF_ALLOW_TINKER=1`, a positive `FLOWPROOF_FREE_TOKEN_ALLOWANCE`, `--credits-confirmed`, and `--max-tokens` within that allowance. Those controls are off by default. Credentials must remain in the environment and never be committed.

```sh
# Only after free allowance and the reviewed dataset are confirmed:
python3 scripts/model-train.py --dataset eval/reviewed.jsonl --run --credits-confirmed --max-tokens 100000
python3 scripts/model-evaluate.py --dataset eval/reviewed.jsonl --configuration zero-shot --run --credits-confirmed --max-tokens 100000
python3 scripts/model-evaluate.py --dataset eval/reviewed.jsonl --configuration few-shot --run --credits-confirmed --max-tokens 200000
python3 scripts/model-evaluate.py --dataset eval/reviewed.jsonl --configuration fine-tuned --checkpoint 'tinker://ACTUAL_SAMPLER_PATH' --run --credits-confirmed --max-tokens 100000
```

The numbers above are explicit maximum budgets, not estimates, measured usage, authorization, or a claim that any allowance exists. A run refuses work if its token upper bound exceeds the provided cap. Provider billing must be independently constrained to keep the ₹0 requirement.

Training uses LoRA rank 16, seed 42, one epoch by default, assistant-only loss and the no-thinking Qwen3.5 renderer. It saves real sampler and training-state paths in a local receipt. Few-shot examples come exclusively from reviewed training rows. All three comparisons use the same heldout test split and temperature zero.

## What the dashboard measures

Completed `eval/results/*.json` receipts are accepted only when their version, model identity, dataset hash, human-review fields, group separation and unique heldout IDs validate. The server recomputes metrics from the original responses and reference rows; it does not trust saved aggregate percentages.

- Structured-output rate: valid supported JSON divided by all sampled examples.
- Interpretation: exact agreement on kind, path, viewport and literal expected text, where applicable. This is a narrow reference-agreement metric, not a human judgement of meaning.
- Abstention: manual responses on expected-manual examples divided by expected-manual examples. Check reference agreement too, since abstaining on everything must not be rewarded as success.
- Latency: wall-clock request duration averaged over samples. Token usage: actual input and generated token IDs counted by the SDK.
- Executable correctness and false-pass rate: **not evaluated** by these commands. They require running proposed checks against known healthy and broken pages. A valid schema is not proof of either metric.

Without a real experiment, every model metric is `null`. The local parser and any one-off Gemma adapter smoke check are excluded from the Qwen/Tinker comparison. Before claiming improvement, run all three configurations on the identical reviewed holdout, complete browser execution evaluation, inspect failure cases, and report sample sizes and uncertainty. Remove the Tinker category if that evidence cannot be produced.
