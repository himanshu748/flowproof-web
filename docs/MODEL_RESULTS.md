# Measured Tinker synthetic pilot

The strongest measured baseline was **few-shot**. Fine-tuning changed reference agreement by **-4.17 percentage points** on the same 24 heldout examples: 1 corrections and 2 regressions. The exact paired McNemar p-value is 1. This small synthetic pilot does not establish a general improvement over the strongest baseline.

**Provenance:** 96 agent-reviewed synthetic examples (60 train, 12 reserved validation, 24 heldout); **zero human-validated examples**. The four heldout website groups and related wording are not independent real-client sites.

| Measured property | Zero-shot | Few-shot | Fine-tuned |
|---|---:|---:|---:|
| Valid structured output | 0/24 (0.0%) | 24/24 (100.0%) | 24/24 (100.0%) |
| Reference agreement | 0/24 (0.0%) | 23/24 (95.8%) | 22/24 (91.7%) |
| Appropriate abstention | 0/4 (0.0%) | 4/4 (100.0%) | 4/4 (100.0%) |
| Healthy-pass + broken-fail pairs / all executable references | 0/20 (0.0%) | 19/20 (95.0%) | 18/20 (90.0%) |
| False passes / executed broken assertions | Not observed (0 executed) | 0/19 (0.0%) | 0/18 (0.0%) |
| Mean request latency | 2.29s | 2.29s | 5.63s |
| Median request latency | 2.27s | 2.27s | 5.34s |
| Input / output tokens | 5,097 / 1,759 | 16,737 / 1,410 | 5,097 / 1,398 |
| Malformed outputs | 24 | 0 | 0 |
| Inappropriate abstentions | 0 | 1 | 2 |
| Blocked / unverified browser pairs | 0 / 0 | 0 / 0 | 0 / 0 |

Zero-shot schema failures are retained as failures: responses are not wrapped, repaired or extracted from Markdown after generation. An absence of executable outputs does not establish a zero false-pass rate. Browser correctness uses every reference-executable example as its denominator; false-pass rate only uses broken assertions actually returning passed or failed.

## Per-kind reference agreement

| Reference kind | Zero-shot | Few-shot | Fine-tuned |
|---|---:|---:|---:|
| heading | 0/4 | 4/4 | 4/4 |
| image_alt | 0/4 | 4/4 | 2/4 |
| link | 0/4 | 4/4 | 4/4 |
| manual | 0/4 | 4/4 | 4/4 |
| no_horizontal_overflow | 0/4 | 3/4 | 4/4 |
| text_visible | 0/4 | 4/4 | 4/4 |

## Uncertainty and failure cases

The following 95% Wilson intervals treat individual outputs as independent Bernoulli observations. That assumption is unverified for this templated, four-website pilot, so these are descriptive intervals rather than evidence of real-world accuracy. Zero observed false passes does not prove zero risk.

- zero-shot, reference agreement: 0.0%–13.8%.
- zero-shot, false-pass rate: not estimable; no executed observations.
- few-shot, reference agreement: 79.8%–99.3%.
- few-shot, false-pass rate: 0.0%–16.8%.
- fine-tuned, reference agreement: 74.2%–97.7%.
- fine-tuned, false-pass rate: 0.0%–17.6%.

The paired browser-correctness difference against few-shot is -5.00 percentage points across 20 executable references (1 corrections, 2 regressions; exact McNemar p=1). The same dependence and small-sample limitations apply.

Nonmatching few-shot/fine-tuned examples (IDs refer to the frozen dataset):

- few-shot: `pilot-test-02-no_horizontal_overflow` — reference `no_horizontal_overflow`, model `manual`.
- fine-tuned: `pilot-test-01-image_alt` — reference `image_alt`, model `manual`.
- fine-tuned: `pilot-test-04-image_alt` — reference `image_alt`, model `manual`.

## Training, compute and cost evidence

Real Tinker LoRA training used 60 examples, 15,910 input tokens and 83.8s. Rank 16, one epoch, batch size 8, seed 42 and learning rate 0.0002 were frozen before evaluation. The sampler and state requested a 24-hour checkpoint TTL; saved artifacts are historical proof, not a guarantee that the remote checkpoint is still available.

At the [recorded provider rates](https://tinker-docs.thinkingmachines.ai/tinker/models/models_and_pricing/) of $0.737/M training, $0.33/M input and $1.005/M output tokens, the observed-token estimate is **$0.025203**. The frozen token-cap upper estimate is **$0.057661**, before the ledger's 25% reservation margin and checkpoint overhead. These figures are estimates, not a reconciled bill. Provider billing data had not yet covered the experiment when checked.

[Actual provider checkpoint metadata](evidence/tinker-checkpoints.json) reports **583,501,257 bytes** across the sampler and training state, each expiring after one day. At $0.10/GB-month this is approximately **$0.001945** using a 30-day month; the conservative 28-day-month variant is **$0.002084**. Observed tokens plus that conservative storage estimate total **$0.027287**. Provider rounding and billing reconciliation remain unverified.

The private budget ledger and account proof govern free-credit eligibility and paid-overage settings. This report does not infer those account facts from token counts. No provider API is called by the summary command.

## Reproduce the report

```sh
python3 scripts/summarize-model-experiment.py --manifest eval/pilot.manifest.json
```

Raw artifacts: [manifest](../eval/pilot.manifest.json), [dataset](../eval/pilot.jsonl), [training receipt](../eval/results/training.json), [zero-shot](../eval/results/zero-shot.json), [few-shot](../eval/results/few-shot.json), [fine-tuned](../eval/results/fine-tuned.json), [machine-readable summary](../eval/experiment-summary.json). Paired browser receipts and evidence are under `eval/browser/`.

Manifest SHA-256: `62ca7d765967ecfc3aa075aed13a0d7342f8fc91031df4d2aac4b4aee1e6f3da`. The summary verifies exact cohort order, dataset/prompt hashes, tokenizer identity, checkpoint training linkage and browser-to-model response hashes before publishing metrics.
