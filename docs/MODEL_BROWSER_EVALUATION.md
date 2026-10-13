# Browser evaluation of saved model responses

The browser evaluator measures whether each saved, schema-valid model assertion passes a healthy synthetic page and fails its paired broken page. It does not call a model provider or contact an external website. The production Playwright runner performs the assertions and captures actual DOM observations and screenshots.

Run it after a Tinker configuration has produced a completed receipt:

```sh
npx tsx scripts/model-browser-evaluate.ts \
  --receipt eval/results/zero-shot.json \
  --dataset eval/pilot.jsonl \
  --output work/browser-zero-shot \
  --approve-synthetic-checks
```

Choose a new output directory for each run. Repeat with the few-shot and fine-tuned receipts using the same frozen dataset. The explicit approval applies only to finite, validated assertions on isolated synthetic pages. It is agent approval for this experiment, not a human approval record or permission to audit a client website.

The command verifies the dataset digest against the model receipt, reparses each original raw response, rejects extra fields and changed requirements, and preserves the model receipt digest. It does not trust precomputed model metrics. Fixture HTML is constructed from the reference labels, independently of model output. An unexpected path receives an actual 404 and is classified as blocked rather than being silently repaired.

| Reference assertion    | Healthy fixture                           | Broken fixture                                                                                       |
| ---------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Heading                | Expected text in a visible heading        | Same text in a paragraph, exposing checks that incorrectly downgrade the requirement to visible text |
| Visible text           | Expected paragraph is visible             | Expected paragraph is hidden                                                                         |
| Link label             | Expected label belongs to an anchor       | Same text belongs to a paragraph                                                                     |
| Link destination       | Anchor has the expected destination       | Anchor has a different destination                                                                   |
| Image alternative text | Embedded image has a nonempty alternative | Same image omits its alternative text attribute                                                      |
| No horizontal overflow | Content fits the reference viewport       | Content extends past the reference viewport; a mobile mutation still fits a desktop viewport         |
| Manual                 | No browser oracle                         | Abstention is classified separately; no invented passing/failing page                                |

`browser-evaluation.json` links every response to healthy/broken audit JSON, fixture HTML and PNG evidence. It also records source and dataset SHA-256 digests, available experiment/manifest identifiers, reference type, model type and the original response digest. Receipts are written incrementally with `running` status and become `completed` only after every response is handled.

The metrics have explicit denominators:

- **Executable correctness:** healthy pass plus broken fail, divided by every reference-automatable heldout requirement. Malformed responses, abstentions and blocked executions remain in this denominator.
- **Completed-pair correctness:** the same successful pairs, divided only by pairs that returned pass/fail for both variants.
- **False-pass rate:** broken pages marked passed, divided by broken-page assertions that actually returned passed or failed. Malformed responses, abstentions, blocked executions and unverified observations are separately counted and excluded.
- **Appropriate abstention rate:** model manual checks divided by all reference-manual requirements, including malformed responses in the denominator.

An absent denominator produces `null`, never a fabricated zero. Counts for malformed responses, inappropriate abstentions, unexpected automation of manual requirements, blocked pairs and unverified pairs accompany every result. A schema-valid plan is not counted as executable correctness until both browser observations support that conclusion.

These results measure synthetic mutation sensitivity only. They do not establish correctness on real client websites, human interpretation accuracy, alternative-description quality or complete coverage of a requirement. Agent-reviewed pilot labels remain agent-reviewed; this command does not promote them to human validation.

The focused control test uses known fixture responses (not model inference) and real Chromium to verify all five automatable kinds, deliberate false passes, malformed output, wrong paths, unverified observations and abstentions:

```sh
npx vitest run tests/model-browser-evaluate.test.ts
```
