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

## Dataset and review provenance

`eval/candidates.jsonl` remains the original 360 synthetic candidates (216 training, 72 validation, 72 test). **Human-validated examples: zero.** No generated candidate has been relabelled as human-reviewed.

`eval/pilot.jsonl` is a separately authored, agent-reviewed pilot: 60 training, 12 validation, and 24 heldout examples across 16 disjoint synthetic website groups. Each row records `review.actorType: "agent"`, a reviewer, timestamp and assertion-specific rationale. The reviewer checked literal heading/link/text assertions, nonempty image-alt presence, a 390px overflow predicate and appropriate abstention on qualitative, state-changing and unsupported requirements. The 12 validation rows are reserved and unused; this pilot uses a single preselected training configuration with no holdout-driven tuning.

This is a small templated synthetic experiment. Website IDs describe synthetic fixture groups, not independent customer websites. Repeated templates within the training split and related wording across assertion kinds limit generalization. Agent review is **not** human validation, and these references are not independently human-scored ground truth. Any pilot results must retain this qualification.

The default `human-reviewed` experiment mode requires an explicit `review.actorType: "human"`, actual reviewer identity, an ISO timestamp with timezone, and review rationale on every row. The separately selected `agent-reviewed-pilot` mode requires agent provenance and cannot produce a human-validated count. Do not invent a reviewer or bulk-mark generated data as human-approved.

```sh
python3 scripts/model-dataset.py --validate eval/candidates.jsonl
python3 scripts/model-dataset.py --validate eval/pilot.jsonl --benchmark-mode agent-reviewed-pilot --require-reviewed
```

## Frozen comparison manifest

`eval/pilot.manifest.json` freezes the exact dataset SHA-256, ordered train/validation/heldout IDs, six training-only few-shot examples, system prompt hash, exact `Qwen/Qwen3.5-4B` model and renderer, generation cap and training settings. All three configurations must evaluate **the identical 24 heldout IDs in order**. Arbitrary per-run subset limits are unavailable.

A fresh human-reviewed experiment can be frozen with:

```sh
python3 scripts/model-dataset.py --validate eval/reviewed.jsonl --require-reviewed \
  --freeze-manifest eval/human.manifest.json --experiment-id flowproof-human-v1
```

Neither frozen manifests nor receipts are overwritten by experiment commands. Any dataset, prompt, few-shot selection or sampling change requires a new manifest and a complete new comparison. Fine-tuned evaluation additionally requires the SHA-linked, completed training receipt and its exact sampler path. Do not optimize against this pilot's heldout failures and then reuse its numbers as an untouched test set.

## Runtime and zero-spend controls

The experiment scripts use the Tinker SDK plus Hugging Face tokenizer assets. `eval/requirements.txt` pins the tested SDK/tokenizer versions. They do not load model weights, require PyTorch or depend on the cookbook. The tokenizer's original chat template is rendered with `enable_thinking=False`; the template and vocabulary hashes, package versions and EOS ID are saved with every run. SDK tokenizer identity must match before training or sampling.

Cache only the public tokenizer assets before the offline preflight:

```sh
python3 -m pip install -r eval/requirements.txt
python3 -c 'from transformers import AutoTokenizer; AutoTokenizer.from_pretrained("Qwen/Qwen3.5-4B", trust_remote_code=False)'
python3 scripts/model-train.py --manifest eval/pilot.manifest.json
python3 scripts/model-evaluate.py --manifest eval/pilot.manifest.json --configuration zero-shot
python3 scripts/model-evaluate.py --manifest eval/pilot.manifest.json --configuration few-shot
```

Offline commands use cached tokenizer assets, calculate actual input-token lengths and make no Tinker calls. The pilot preflight counted 15,910 training tokens; inference upper bounds are 17,385 zero-shot, 29,025 few-shot and 17,385 fine-tuned tokens, including the full 512-output-token cap on every example. These are bounded estimates for the frozen setup, **not** measured provider billing usage.

A real operation additionally requires `TINKER_API_KEY`, `FLOWPROOF_ALLOW_TINKER=1`, a positive `FLOWPROOF_FREE_TOKEN_ALLOWANCE`, `--credits-confirmed`, `--max-tokens` within that allowance, and a shared `--budget-ledger`. These explicit controls default off. A local guard is not a financial guarantee: sufficient free account credits and disabled paid overage must first be independently confirmed against the provider's account and [current pricing](https://tinker-docs.thinkingmachines.ai/tinker/models/models_and_pricing/).

The private ledger records currency/model, an aggregate token cap and USD cap, confirmed training/input/output prices, optional operation overhead and the source, check time, expiry, remaining free USD and disabled-overage status of the allowance. Confirmation older than 24 hours or past its expiry is rejected. Every operation atomically reserves the whole upper bound plus a 25% USD margin **before creating a provider client**. Concurrent processes share a lock. Reservations are never refunded, including after failures or partial results, so retries cannot silently reuse spent allowance. Provider-side free-credit restrictions remain necessary for independently enforcing zero out-of-pocket cost.

Example commands, only after those account conditions and the ledger are confirmed:

```sh
python3 scripts/model-train.py --manifest eval/pilot.manifest.json \
  --run --credits-confirmed --max-tokens 30000 \
  --budget-ledger work/tinker-budget-ledger.json --output eval/results/training.json
python3 scripts/model-evaluate.py --manifest eval/pilot.manifest.json --configuration zero-shot \
  --run --credits-confirmed --max-tokens 30000 \
  --budget-ledger work/tinker-budget-ledger.json --output eval/results/zero-shot.json
python3 scripts/model-evaluate.py --manifest eval/pilot.manifest.json --configuration few-shot \
  --run --credits-confirmed --max-tokens 30000 \
  --budget-ledger work/tinker-budget-ledger.json --output eval/results/few-shot.json
python3 scripts/model-evaluate.py --manifest eval/pilot.manifest.json --configuration fine-tuned \
  --training-receipt eval/results/training.json --checkpoint 'tinker://ACTUAL_SAMPLER_PATH' \
  --run --credits-confirmed --max-tokens 30000 \
  --budget-ledger work/tinker-budget-ledger.json --output eval/results/fine-tuned.json
```

Training uses rank 16, seed 42, one epoch, batch size 8, learning rate 0.0002 and assistant-only cross-entropy loss. Both real checkpoint types request a **24-hour TTL**. Expired checkpoints must not be described as currently reusable. Training state and raw inference responses are recorded incrementally, including pending operations, partial token counts and failed-run status. Failures do not become completed comparisons. Provider exception bodies and credentials are excluded from the receipts.

## What measured evidence means

Version 2 inference receipts record every original response, input/generated token count and wall-clock request duration. JSON output is neither extracted from prose nor repaired. Only a terminal protocol EOS token is removed before decoding. The original generated token IDs are retained. Schema checks reject unexpected fields, missing literal text, unsafe paths and unsupported assertions. Token-ID counts measure SDK work; they are not a provider billing receipt.

- Structured-output rate: valid finite-schema outputs divided by all heldout responses.
- Reference agreement: exact kind, path, viewport and literal expected text where applicable. This is a synthetic reference-agreement proxy, not human interpretation accuracy.
- Appropriate abstention: manual responses among expected-manual examples. Also report inappropriate abstention on executable requirements.
- Latency: mean wall-clock sampling request duration, including provider queueing.
- Browser correctness and false-pass rates require separately SHA-linked paired fixture execution; they cannot be inferred from valid JSON or reference agreement.

The browser evaluator derives healthy and deliberately broken pages from the frozen reference requirements, then executes the **actual model-proposed checks** through the production finite runner. Fixture ground-truth checks are evaluated independently. The model may not change fixtures, execute scripts, follow external links or approve a real customer audit. Raw response, reference, fixture and browser evidence hashes preserve traceability. A blocked/unavailable browser run cannot count as a pass. Metrics retain explicit denominators for valid, malformed, abstained, blocked and observed results.

The dashboard accepts a coherent manifest cohort and matching review provenance, dataset hash and exact heldout IDs; a fine-tuned result must link its completed training artifact. Without completed, compatible evidence, the corresponding metrics remain `null` or pending. The deterministic parser and one-off local Gemma smoke checks remain outside this Qwen/Tinker comparison. No improvement is implied by training completion; report the strongest measured baseline even when fine-tuning ties or performs worse.

Run the offline control tests with:

```sh
python3 -m unittest discover -s eval -p 'test_*.py' -v
```
