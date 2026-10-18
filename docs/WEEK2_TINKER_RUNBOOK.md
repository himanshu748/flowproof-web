# Tinker Week 2 follow-up: prepared, not executed

Prepared October 18, 2026. **No new training, provider evaluation or hosted Tinker request has been executed by this preparation.** The October 13 comparison in [MODEL_RESULTS.md](MODEL_RESULTS.md) and all its receipts remain unchanged. Current promotional-grant funding has not been verified in this environment. The older October 17 account observation is not reused as current permission.

## Prerequisites and current blocker

The central operator must first inspect the existing account through its supported secure sign-in and verify a **positive Tinker x MLH promotional balance**, no card, auto-reload off and paid overage disabled. A current, attributable account receipt must cover the full conservative reservation, including checkpoint storage and the separate remaining hosted reservation. Stop if funding is not positive or any cost could fall outside the verified promotional grant. Never paste credentials into chat or committed files. Reuse only an existing authorized environment key and private ledger; obtaining/transferring new credentials or expanding persistent access needs specific user confirmation.

The pinned dependencies were installed successfully in `/tmp/briefstamp-tinker-venv`: `tinker==0.32.0`, `transformers==5.18.0`, `tokenizers==0.23.2`, `jinja2==3.1.6`. Import/signature inspection confirmed the SDK supports the existing training, sampling and TTL calls without contacting the provider. Temporary environment paths are session-local and are not deployment configuration.

**Blocked action:** `huggingface_hub.snapshot_download('Qwen/Qwen3.5-4B', allow_patterns=[tokenizer assets only])` to `huggingface.co` returned `httpx.ProxyError: 403 Forbidden` at preparation time on October 18. The action stopped; no alternate route or proxy bypass was attempted. No existing tokenizer cache was found under the inspected workspace, temporary directory or default Hugging Face cache. The provider-free exact tokenizer dry run cannot complete until the same approved access is available or an existing verified cache is supplied. Model weights are unnecessary. Do not retry the denied route without materially new relevant authorization/access evidence.

The public [official pricing page](https://tinker-docs.thinkingmachines.ai/tinker/models/models_and_pricing/) was checked October 18: Qwen/Qwen3.5-4B remains $0.737/M training, $0.33/M uncached input and $1.005/M generated tokens; checkpoint storage is $0.10/GB-month. The [TrainingClient reference](https://tinker-docs.thinkingmachines.ai/tinker/api-reference/trainingclient/) documents `forward_backward`, `optim_step`, `save_weights_for_sampler` and `save_state`; the [SamplingClient reference](https://tinker-docs.thinkingmachines.ai/tinker/api-reference/samplingclient/) documents the frozen sampling operation. The existing pinned SDK signatures are compatible. No caching discount is assumed.

## Frozen experiment and limits

- [New manifest](../eval/week2-alt-v2.manifest.json), [dataset](../eval/week2-alt-v2.jsonl): 108 training examples (original 60 plus 48 independently authored synthetic examples), original 12 reserved validation examples and original 24 heldout examples. Zero human validation.
- Added examples: 24 nonblank image-alt-presence requirements, 12 manual boundary requirements, and 12 other supported deterministic requirements to discourage inappropriate abstention. Synthesis used the public assertion contract, training examples and aggregate historical category counts. No heldout requirement wording was used for synthesis. Automated integrity/duplicate checks inspect reserved data only to verify separation.
- The complete original dataset is a byte-identical prefix of the new one. Ordered raw heldout lines SHA-256: `649e3e59734ca4b83d24ad4aec9ef6a596b1ae48991c9849816285c9e112a423`.
- Prompt, tokenizer renderer, heldout order, few-shot demonstrations, max output 512, temperature 0, rank 16, one epoch, batch 8, seed 42 and learning rate 0.0002 are unchanged. One new LoRA only; no sweep or retraining after observing the follow-up scores.
- The shared ledger now refuses a second training reservation for the same experiment even after failure. Reservations are retained before network work and never refunded. Do not create another ledger or experiment ID to retry around this restriction.
- The reused holdout is development feedback because aggregate failures motivated this augmentation. It is not an independent confirmatory test, a real-client benchmark or proof of general accuracy.

Before exact tokenization, the script's per-example 2,048-token ceiling gives an absolute training bound of `108 × 2,048 = 221,184` submitted tokens. Unchanged evaluation input is 5,097 tokens according to the prior tokenizer-bound receipt, plus `24 × 512 = 12,288` generated tokens maximum. The training script still computes and checks actual tokenization before reservation; it does not trust this prose bound. At the verified rates, the conservative training/evaluation token subtotal is $0.177044058. With 25% ledger margin and $0.01 overhead per operation it is $0.2463050725. A **maximum $0.30 experiment ledger cap** leaves $0.0536949275 beyond that already conservative bound. The $0.01 per-operation overhead must independently cover measured/upper-bounded checkpoint storage; it is not a claim of actual storage cost. Stop rather than run if storage/retry uncertainty cannot fit the confirmed reservation. The hosted request has its own existing reservation and must also fit the verified remaining grant.

## Private guard proof schema

Do not run the following schema as an account verification. It describes the existing private Python ledger accepted by `reserve_budget`; replace placeholders only from newly observed account evidence. Keep its path outside version control. Keep the complete preexisting `reservations` array when rechecking funding; a recheck does not replenish spent or uncertain operations.

```json
{
  "schemaVersion": 1,
  "currency": "USD",
  "model": "Qwen/Qwen3.5-4B",
  "maxTokens": 250000,
  "maxCostUsd": "0.30",
  "usdPerMillionTokens": {"training":"0.737","input":"0.33","output":"1.005"},
  "operationOverheadUsd": "0.01",
  "freeAllowanceConfirmation": {
    "source": "PRIVATE_CURRENT_ACCOUNT_EVIDENCE_REFERENCE",
    "checkedAt": "CURRENT_VERIFIED_UTC_INSTANT",
    "expiresAt": "VERIFIED_EXPIRY_NO_LATER_THAN_24_HOURS_AFTER_CHECK",
    "remainingFreeUsd": "ACTUAL_POSITIVE_PROMOTIONAL_GRANT_BALANCE",
    "overageDisabled": true
  },
  "reservations": []
}
```

`reservations: []` above describes only an unused initial ledger, never an instruction to erase existing reservations. A grant recheck alone does not authorize raising existing token/dollar limits. `maxCostUsd` must be at most $0.30 and at most the verified grant remainder after all other outstanding reservations. The ledger requires a source, positive balance, fresh timestamps, supported prices, sufficient aggregate tokens/dollars and overage disabled. It is a local accounting guard, not a provider billing cap. The additional no-card/auto-reload facts must be independently checked and retained privately; the ledger's `overageDisabled` boolean alone does not prove them.

## Execute only after prerequisites are genuinely satisfied

Run from the repository root with the **existing** `TINKER_API_KEY` securely inherited in the environment. The commands do not create, print or move credentials. `BRIEFSTAMP_TINKER_BUDGET_LEDGER` must point to the existing private, freshly verified ledger. Never set it to a new empty ledger to circumvent earlier reservations. Use the installed Python path below or an equivalent environment with the exact pinned versions and verified tokenizer cache.

Offline validation first (the checked-in augmentation is already frozen; do not rerun `model-augment.py` against these existing output files):

```sh
python3 -m unittest discover -s eval -p 'test_*.py'
HF_HOME=/tmp/briefstamp-hf-cache /tmp/briefstamp-tinker-venv/bin/python scripts/model-train.py \
  --manifest eval/week2-alt-v2.manifest.json \
  --output eval/results/week2-alt-v2/training.json
```

The second command should print `validated_only`, 108 examples and the exact tokenizer bound with `providerCalls: 0`. Currently blocked by the absent tokenizer. The local allowance env values below are explicit ceilings, not evidence of grant funding:

```sh
FLOWPROOF_ALLOW_TINKER=1 FLOWPROOF_FREE_TOKEN_ALLOWANCE=250000 \
HF_HOME=/tmp/briefstamp-hf-cache /tmp/briefstamp-tinker-venv/bin/python scripts/model-train.py \
  --manifest eval/week2-alt-v2.manifest.json \
  --output eval/results/week2-alt-v2/training.json \
  --run --credits-confirmed --max-tokens 221184 \
  --budget-ledger "$BRIEFSTAMP_TINKER_BUDGET_LEDGER"
```

Run this training command once. If it fails or has an uncertain outcome, retain the partial receipt/reservation and stop. Do not issue another `create_lora_training_client` call. Read-only provider inspection can clarify the outcome.

Evaluate the saved sampler against exactly the same 24 heldout cases through the required existing script. Use structured subprocess arguments to read the checkpoint from its linked receipt without copying it into chat:

```sh
FLOWPROOF_ALLOW_TINKER=1 FLOWPROOF_FREE_TOKEN_ALLOWANCE=250000 \
HF_HOME=/tmp/briefstamp-hf-cache /tmp/briefstamp-tinker-venv/bin/python - <<'PY'
import json, os, subprocess, sys
training = 'eval/results/week2-alt-v2/training.json'
receipt = json.load(open(training))
assert receipt['status'] == 'completed'
subprocess.run([
    sys.executable, 'scripts/model-evaluate.py',
    '--manifest', 'eval/week2-alt-v2.manifest.json',
    '--configuration', 'fine-tuned', '--checkpoint', receipt['samplerPath'],
    '--training-receipt', training,
    '--output', 'eval/results/week2-alt-v2/fine-tuned.json',
    '--run', '--credits-confirmed', '--max-tokens', '17385',
    '--budget-ledger', os.environ['BRIEFSTAMP_TINKER_BUDGET_LEDGER'],
], check=True)
PY
```

Keep all failed examples and timings. Do not repair prose/JSON or silently replace malformed outputs. No new few-shot provider calls are required: use the immutable historical few-shot receipt, with the nonconcurrent latency limitation disclosed.

Run genuine local Chromium paired fixtures, explicitly labeled controlled synthetic approvals, then summarize:

```sh
node --import tsx scripts/model-browser-evaluate.ts \
  --receipt eval/results/week2-alt-v2/fine-tuned.json \
  --dataset eval/week2-alt-v2.jsonl \
  --output eval/browser/week2-alt-v2 --approve-synthetic-checks
python3 scripts/summarize-model-followup.py --append-markdown
```

If actual provider checkpoint metadata is collected read-only, pass its path with `--checkpoint-evidence PATH` before creating the summary. The existing metadata parser expects `{"provider":"tinker","checkpoints":[...]}` with both real sampler/state `tinker_path`, `size_bytes`, `time`, `expires_at` and `checkpoint_type` fields. Without this evidence, storage-inclusive measured cost is unavailable. Summary output is [eval/week2-alt-v2-summary.json](../eval/week2-alt-v2-summary.json) only after successful execution; that file does not yet exist. The summary appends a separate follow-up to MODEL_RESULTS, preserving the historical run.

The report includes reference agreement, per-kind image-alt agreement, inappropriate abstentions, input/output tokens, mean/median latency, false passes and conditional USD per successful synthetic handoff. A successful handoff requires both reference agreement and healthy-pass/broken-fail; all model requests, failures and manual outputs stay in the cost numerator. Actual provider-billed per-handoff USD remains `null` unless attributable billing evidence exists; token-price estimates must never be renamed actual cost.

## Checkpoint and hosted Render evidence

Both sampler/state saves request 86,400-second TTLs; `model-evaluate.py` checks linked receipt and expiry before contacting Tinker. Keep the returned path, save time and expiry privately/within the appropriate evidence receipt. Update only the existing authorized Render `TINKER_MODEL_PATH` configuration to that actual sampler. No new key, paid Render plan, card, auto-reload or Temporal Cloud setup is permitted.

**Carry the existing hosted reservation forward before any redeploy or proof refresh.** `server/hosted-tinker.ts` binds its on-disk ledger to the canonical entire proof; changing its timestamp creates a different identity. Render ephemeral disk replacement can also erase local consumption. Changing checkpoints intentionally does not replenish the allowance. A fresh account recheck does not create two more requests. Read the existing private proof, hosted ledger and prior evidence; subtract every completed, reserved, failed or uncertain request from the original two-request reservation, and preserve cumulative units. If the remaining allowance is zero or cannot be determined, stop the hosted request. `scripts/refresh-hosted-provider-proofs.mjs` supports only the exact initial carry-forward from 1 used call/8,912 reserved tokens to 1 remaining call/41,088 tokens; it explicitly rejects rolling an already refreshed proof again. Do not use it to bypass that restriction.

The hosted proof schema (strict, credential-bound; never put the credential in the proof) contains `credentialSha256`, current `checkedAt`, `expiresAt` (at most 24 hours and no later than October 20 00:00 UTC), evidence reference, `freeOnly:true`, `paidOverageDisabled:true`, `unit:"tokens"`, `operations:["generate-checks"]`, `confirmedFreeUnits`, `maxUnits` (at most 50,000), `usedUnits:0`, `maxCalls` (at most 2), `usedCalls:0`. The initializer's zero counters describe the **remaining** allocation after central carry-forward; the existing ledger retains consumed counters. Never set these values by guessing. Ordinary model configuration changes use the existing key and operator token; credential transfer requires specific confirmation.

After the central operator confirms one remaining reservation, the new unexpired checkpoint is configured/deployed through the existing authorized service, and the existing operator token is securely available as `BRIEFSTAMP_HOSTED_OPERATOR_TOKEN`, issue exactly one hosted model request using:

```sh
node --import tsx scripts/verify-hosted-open-model.ts --run-tinker
```

This verifier calls the real hosted application once for a Tinker proposal and runs three synthetic browser audits. It retains actual provider usage, generated checks, audits, screenshot bytes/hashes and failures under `work/hosted-open-model/TIMESTAMP/`; it labels its approvals as controlled agent test approvals, not a human visitor. Do not add Backboard/Tiger/provider flags or retry a failed/uncertain model call as part of this one-request reservation. After secret scanning, copy the real receipt and referenced artifacts to `docs/evidence/tinker-hosted/TIMESTAMP/`, with the linked training receipt/checkpoint expiry and deployment SHA. Do not invent success if output parsing, quota, expiry, proxy access or inference fails. Verify the public anonymous path separately without issuing extra paid model calls.

## Preparation checks completed

`python3 -m unittest discover -s eval -p 'test_model*.py'` passed **24 tests** locally after this preparation. These verify frozen holdout preservation, train/reserved exact-duplicate separation, provenance, conditional cost denominators, failed-run reservation retention and one training reservation. Python compilation of the added commands succeeded. These are offline checks, not proof of provider training, current grant validation, live deployment or hosted inference. The full repository CI and hosted work belong to central integration and must be tied to the final exact commit SHA.
