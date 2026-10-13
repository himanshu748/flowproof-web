#!/usr/bin/env python3
"""Recompute a frozen three-way comparison from raw, completed receipts; no provider calls."""
import argparse
import datetime as dt
import hashlib
import json
import math
import statistics
import sys
from decimal import Decimal
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'eval'))
from model_common import ROOT, read_manifest, parse_plan, semantic_match, sha256_file, write_json, now

CONFIGURATIONS = ('zero-shot', 'few-shot', 'fine-tuned')
RATES = {'training': Decimal('0.737'), 'input': Decimal('0.33'), 'output': Decimal('1.005')}
PRICING_SOURCE = 'https://tinker-docs.thinkingmachines.ai/tinker/models/models_and_pricing/'


def wilson_interval(successes, total, z=1.959963984540054):
    if total == 0:
        return None
    if not 0 <= successes <= total:
        raise ValueError('Invalid binomial counts')
    p = successes / total
    scale = 1 + z * z / total
    center = (p + z * z / (2 * total)) / scale
    half = z * math.sqrt(p * (1 - p) / total + z * z / (4 * total * total)) / scale
    return [max(0, center - half), min(1, center + half)]


def paired_comparison(baseline, candidate):
    if len(baseline) != len(candidate) or not baseline:
        raise ValueError('Paired outcomes need equal nonempty lengths')
    wins = sum(not left and right for left, right in zip(baseline, candidate))
    losses = sum(left and not right for left, right in zip(baseline, candidate))
    discordant = wins + losses
    # Exact two-sided conditional binomial/McNemar test. No asymptotic shortcut.
    p = min(1.0, 2 * sum(math.comb(discordant, k) for k in range(min(wins, losses) + 1)) / 2 ** discordant) if discordant else 1.0
    return {'n': len(baseline), 'candidateWins': wins, 'candidateLosses': losses,
            'bothCorrect': sum(left and right for left, right in zip(baseline, candidate)),
            'bothIncorrect': sum(not left and not right for left, right in zip(baseline, candidate)),
            'difference': (sum(candidate) - sum(baseline)) / len(baseline),
            'exactMcNemarPValue': p,
            'interpretation': 'Descriptive paired comparison only. Templated examples are clustered within four synthetic websites; the independent-pair assumption is not established.'}


def proportion(successes, total):
    return {'numerator': successes, 'denominator': total, 'rate': successes / total if total else None,
            'wilson95': wilson_interval(successes, total)}


def dollars(counts):
    return str(sum(Decimal(value) * RATES[key] / Decimal(1_000_000) for key, value in counts.items()))


def validate_run(run, configuration, manifest, manifest_sha):
    if run.get('schemaVersion') != 2 or run.get('operation') != 'evaluation' or run.get('status') != 'completed':
        raise ValueError(f'{configuration} has no completed v2 evaluation receipt')
    for key in ('model', 'datasetSha256', 'promptSha256', 'renderer', 'benchmarkMode', 'experimentId', 'reviewProvenance', 'sampling'):
        if run.get(key) != manifest[key]:
            raise ValueError(f'{configuration} mismatches manifest {key}')
    if run.get('manifestSha256') != manifest_sha or run.get('configuration') != configuration:
        raise ValueError('Receipt identity mismatch')
    if run.get('heldoutIds') != manifest['heldoutIds'] or [item['id'] for item in run['measurements']] != manifest['heldoutIds']:
        raise ValueError('Not the complete ordered frozen holdout')
    if run.get('fewShotIds') != (manifest['fewShotIds'] if configuration == 'few-shot' else []):
        raise ValueError('Few-shot demonstration cohort changed')


def model_metrics(run, rows):
    outcomes = []
    for sample, row in zip(run['measurements'], rows):
        valid = False; match = False; kind = None
        try:
            plan = parse_plan(sample['rawOutput'], row['requirement'])
            valid = True; match = semantic_match(plan, row['expected']); kind = plan['checks'][0]['kind']
        except (ValueError, TypeError, KeyError):
            pass
        expected_kind = row['expected']['checks'][0]['kind']
        for field in ('inputTokens', 'outputTokens'):
            if not isinstance(sample[field], int) or sample[field] < 0:
                raise ValueError('Invalid measured token count')
        if len(sample['outputTokenIds']) != sample['outputTokens']:
            raise ValueError('Output token IDs differ from recorded count')
        if not math.isfinite(sample['latencyMs']) or sample['latencyMs'] < 0:
            raise ValueError('Invalid latency')
        outcomes.append({'id': row['id'], 'referenceKind': expected_kind, 'validSchema': valid,
                         'referenceMatch': match, 'modelKind': kind,
                         'appropriateAbstention': kind == 'manual' and expected_kind == 'manual',
                         'inappropriateAbstention': kind == 'manual' and expected_kind != 'manual'})
    manual = sum(row['referenceKind'] == 'manual' for row in outcomes)
    totals = {'input': sum(item['inputTokens'] for item in run['measurements']), 'output': sum(item['outputTokens'] for item in run['measurements'])}
    latencies = [item['latencyMs'] for item in run['measurements']]
    return {'structuredOutput': proportion(sum(row['validSchema'] for row in outcomes), len(outcomes)),
            'referenceAgreement': proportion(sum(row['referenceMatch'] for row in outcomes), len(outcomes)),
            'appropriateAbstention': proportion(sum(row['appropriateAbstention'] for row in outcomes), manual),
            'inappropriateAbstentions': sum(row['inappropriateAbstention'] for row in outcomes),
            'meanLatencyMs': statistics.mean(latencies), 'medianLatencyMs': statistics.median(latencies),
            'tokens': totals, 'observedTokenCostEstimateUsd': dollars(totals),
            'tokenCapCostUpperEstimateUsd': dollars(run['tokenUpperBounds']),
            'perKind': {kind: {'n': sum(row['referenceKind'] == kind for row in outcomes),
                               'validSchema': sum(row['referenceKind'] == kind and row['validSchema'] for row in outcomes),
                               'referenceMatch': sum(row['referenceKind'] == kind and row['referenceMatch'] for row in outcomes)}
                        for kind in sorted({row['referenceKind'] for row in outcomes})},
            'outcomes': outcomes}


def browser_metrics(browser, run, receipt_path, model_outcomes, rows):
    if browser.get('status') != 'completed' or browser.get('sourceReceiptSha256') != sha256_file(receipt_path):
        raise ValueError('Browser receipt missing or not linked to this completed model receipt')
    for key in ('datasetSha256', 'manifestSha256', 'benchmarkMode', 'experimentId', 'configuration', 'reviewProvenance'):
        if browser.get(key) != run[key]:
            raise ValueError(f'Browser cohort mismatch: {key}')
    observations = browser['observations']
    if [item['id'] for item in observations] != run['heldoutIds']:
        raise ValueError('Browser observations do not cover the exact heldout cohort')
    executable = paired = completed = blocked = unverified = broken_executed = false_pass = 0
    malformed = inappropriate = 0
    paired_outcomes = []
    for observation, sample, outcome, row in zip(observations, run['measurements'], model_outcomes, rows):
        if observation['rawOutputSha256'] != hashlib.sha256(sample['rawOutput'].encode()).hexdigest() or observation['validSchema'] != outcome['validSchema']:
            raise ValueError('Browser output provenance or schema result mismatch')
        automatic = row['expected']['checks'][0]['kind'] != 'manual'
        if observation['referenceAutomatable'] != automatic:
            raise ValueError('Browser reference-automation label differs')
        if not automatic:
            continue
        executable += 1
        healthy = observation.get('healthy', {}).get('status')
        broken = observation.get('broken', {}).get('status')
        if not outcome['validSchema']:
            if healthy is not None or broken is not None:
                raise ValueError('Malformed output cannot have browser pass/fail observations')
            malformed += 1
        elif outcome['modelKind'] == 'manual':
            if healthy is not None or broken is not None:
                raise ValueError('Manual abstention cannot have browser pass/fail observations')
            inappropriate += 1
        else:
            if healthy not in ('passed', 'failed', 'blocked', 'unverified') or broken not in ('passed', 'failed', 'blocked', 'unverified'):
                raise ValueError('Missing execution outcome for an executable model plan')
            completed += healthy in ('passed', 'failed') and broken in ('passed', 'failed')
            blocked += 'blocked' in (healthy, broken)
            unverified += 'unverified' in (healthy, broken)
            broken_executed += broken in ('passed', 'failed')
            false_pass += broken == 'passed'
        correct = healthy == 'passed' and broken == 'failed'
        paired += correct
        paired_outcomes.append(correct)
    return {'executableCorrectness': proportion(paired, executable),
            'falsePass': proportion(false_pass, broken_executed), 'completedPairs': completed,
            'malformedExecutableOutputs': malformed, 'inappropriateAbstentions': inappropriate,
            'blockedPairs': blocked, 'unverifiedPairs': unverified, 'pairedOutcomes': paired_outcomes}


def checkpoint_storage(evidence_path, training):
    if not evidence_path.exists():
        return None
    evidence = json.loads(evidence_path.read_text())
    checkpoints = evidence['checkpoints']
    if evidence.get('provider') != 'tinker' or {item['tinker_path'] for item in checkpoints} != {training['samplerPath'], training['statePath']}:
        raise ValueError('Checkpoint metadata does not match this training run')
    byte_seconds = Decimal(0)
    for item in checkpoints:
        created = dt.datetime.fromisoformat(item['time'].replace('Z', '+00:00'))
        expires = dt.datetime.fromisoformat(item['expires_at'].replace('Z', '+00:00'))
        seconds = math.ceil((expires - created).total_seconds())
        if not isinstance(item['size_bytes'], int) or item['size_bytes'] < 0 or not 0 < seconds <= 86400:
            raise ValueError('Invalid measured checkpoint size or TTL')
        byte_seconds += Decimal(item['size_bytes']) * Decimal(seconds)
    price = Decimal('0.10')
    def estimate(days):
        return str(byte_seconds / Decimal(1_000_000_000) * price / Decimal(days * 86400))
    return {'providerMetadataSha256': sha256_file(evidence_path), 'totalBytes': sum(item['size_bytes'] for item in checkpoints),
            'usdPerGbMonth': str(price), 'decimalBytesPerGb': 1_000_000_000,
            'estimate30DayMonthUsd': estimate(30), 'conservative28DayMonthEstimateUsd': estimate(28),
            'checkpointExpirations': {item['checkpoint_type']: item['expires_at'] for item in checkpoints},
            'note': 'Estimated prorated storage from actual provider bytes and expiry times, using decimal GB and a 30-day month; 28-day variant is conservative for month duration. Provider rounding/invoicing remains unreconciled.'}


def summarize(manifest_path, results_folder, browser_folder, checkpoint_evidence=None):
    manifest, all_rows, manifest_sha = read_manifest(manifest_path)
    by_id = {row['id']: row for row in all_rows}
    rows = [by_id[row_id] for row_id in manifest['heldoutIds']]
    training_path = results_folder / 'training.json'
    training = json.loads(training_path.read_text())
    if training.get('status') != 'completed' or training.get('manifestSha256') != manifest_sha or training.get('operation') != 'training':
        raise ValueError('No matching completed training receipt')
    runs, metrics = {}, {}
    for configuration in CONFIGURATIONS:
        receipt_path = results_folder / f'{configuration}.json'
        run = json.loads(receipt_path.read_text())
        validate_run(run, configuration, manifest, manifest_sha)
        if configuration == 'fine-tuned' and (run['trainingReceiptSha256'] != sha256_file(training_path) or run['checkpoint'] != training['samplerPath']):
            raise ValueError('Fine-tuned evaluation is not linked to this training checkpoint')
        runs[configuration] = run
        metrics[configuration] = model_metrics(run, rows)
        metrics[configuration]['receiptSha256'] = sha256_file(receipt_path)
        browser_path = browser_folder / configuration / 'browser-evaluation.json'
        metrics[configuration]['browser'] = browser_metrics(json.loads(browser_path.read_text()), run, receipt_path, metrics[configuration]['outcomes'], rows)
        metrics[configuration]['browserReceiptSha256'] = sha256_file(browser_path)
    if len({json.dumps(run['tokenizer'], sort_keys=True) for run in runs.values()}) != 1:
        raise ValueError('Tokenizers differ across comparison')
    strongest = max(('zero-shot', 'few-shot'), key=lambda configuration: metrics[configuration]['referenceAgreement']['rate'])
    reference_pairs = paired_comparison([item['referenceMatch'] for item in metrics[strongest]['outcomes']], [item['referenceMatch'] for item in metrics['fine-tuned']['outcomes']])
    browser_pairs = paired_comparison(metrics[strongest]['browser']['pairedOutcomes'], metrics['fine-tuned']['browser']['pairedOutcomes'])
    training_cost = dollars({'training': training['trainingTokens']})
    inference_cost = sum(Decimal(item['observedTokenCostEstimateUsd']) for item in metrics.values())
    inference_upper = sum(Decimal(item['tokenCapCostUpperEstimateUsd']) for item in metrics.values())
    storage = checkpoint_storage(checkpoint_evidence, training) if checkpoint_evidence else None
    return {'schemaVersion': 1, 'recordedAt': now(), 'manifestPath': str(manifest_path.relative_to(ROOT)), 'manifestSha256': manifest_sha,
            'experimentId': manifest['experimentId'], 'model': manifest['model'], 'benchmarkMode': manifest['benchmarkMode'], 'reviewProvenance': manifest['reviewProvenance'],
            'heldoutCount': len(rows), 'heldoutWebsiteGroups': len({row['website_id'] for row in rows}),
            'configurations': metrics, 'strongestBaseline': strongest,
            'fineTunedVsStrongestBaseline': {'referenceAgreement': reference_pairs, 'browserCorrectness': browser_pairs},
            'training': {'examples': training['trainingExamples'], 'tokens': training['trainingTokens'], 'durationMs': training['durationMs'], 'checkpoint': training['samplerPath'], 'checkpointTtlSeconds': training['checkpointTtlSeconds'], 'receiptSha256': sha256_file(training_path)},
            'cost': {'currency': 'USD', 'usdPerMillionTokens': {key: str(value) for key, value in RATES.items()}, 'pricingSource': PRICING_SOURCE,
                     'trainingObservedTokenEstimateUsd': training_cost, 'inferenceObservedTokenEstimateUsd': str(inference_cost),
                     'totalObservedTokenEstimateUsd': str(Decimal(training_cost) + inference_cost),
                     'totalTokenCapUpperEstimateUsd': str(Decimal(dollars({'training': training['trainingTokensUpperBound']})) + inference_upper),
                     'checkpointStorage': storage, 'providerBillingReconciled': False,
                     'totalObservedTokensPlusConservativeStorageEstimateUsd': str(Decimal(training_cost) + inference_cost + Decimal(storage['conservative28DayMonthEstimateUsd'])) if storage else None,
                     'note': 'Token-count-based estimate only; not a provider invoice. Provider billing data had not covered the experiment when checked. No caching, billing-rounding or retry adjustment is inferred.'},
            'limitations': ['96 agent-reviewed synthetic examples; zero human validation.', '24 templated heldout examples from four synthetic website groups are not independent customer observations.', 'Wilson intervals and exact McNemar p-values are descriptive under assumptions not established by this small clustered dataset.', 'No holdout-driven retraining or prompt change was performed for this frozen comparison.', 'Browser results measure synthetic mutation sensitivity; they do not establish correctness on real client websites.']}


def percent(record):
    if record['denominator'] == 0:
        return 'Not observed (0 executed)'
    return f"{record['numerator']}/{record['denominator']} ({record['rate']:.1%})"


def markdown(summary):
    configs = summary['configurations']; comparison = summary['fineTunedVsStrongestBaseline']['referenceAgreement']
    best = summary['strongestBaseline']
    lines = ['# Measured Tinker synthetic pilot', '',
             f"The strongest measured baseline was **{best}**. Fine-tuning changed reference agreement by **{comparison['difference'] * 100:+.2f} percentage points** on the same {summary['heldoutCount']} heldout examples: {comparison['candidateWins']} corrections and {comparison['candidateLosses']} regressions. The exact paired McNemar p-value is {comparison['exactMcNemarPValue']:.4g}. This small synthetic pilot does not establish a general improvement over the strongest baseline.", '',
             '**Provenance:** 96 agent-reviewed synthetic examples (60 train, 12 reserved validation, 24 heldout); **zero human-validated examples**. The four heldout website groups and related wording are not independent real-client sites.', '',
             '| Measured property | Zero-shot | Few-shot | Fine-tuned |', '|---|---:|---:|---:|']
    for label, getter in [('Valid structured output', lambda x: percent(x['structuredOutput'])), ('Reference agreement', lambda x: percent(x['referenceAgreement'])), ('Appropriate abstention', lambda x: percent(x['appropriateAbstention'])), ('Healthy-pass + broken-fail pairs / all executable references', lambda x: percent(x['browser']['executableCorrectness'])), ('False passes / executed broken assertions', lambda x: percent(x['browser']['falsePass'])), ('Mean request latency', lambda x: f"{x['meanLatencyMs']/1000:.2f}s"), ('Median request latency', lambda x: f"{x['medianLatencyMs']/1000:.2f}s"), ('Input / output tokens', lambda x: f"{x['tokens']['input']:,} / {x['tokens']['output']:,}"), ('Malformed outputs', lambda x: str(x['structuredOutput']['denominator'] - x['structuredOutput']['numerator'])), ('Inappropriate abstentions', lambda x: str(x['inappropriateAbstentions'])), ('Blocked / unverified browser pairs', lambda x: f"{x['browser']['blockedPairs']} / {x['browser']['unverifiedPairs']}")]:
        lines.append('| ' + label + ' | ' + ' | '.join(getter(configs[name]) for name in CONFIGURATIONS) + ' |')
    lines += ['', 'Zero-shot schema failures are retained as failures: responses are not wrapped, repaired or extracted from Markdown after generation. An absence of executable outputs does not establish a zero false-pass rate. Browser correctness uses every reference-executable example as its denominator; false-pass rate only uses broken assertions actually returning passed or failed.', '',
              '## Per-kind reference agreement', '', '| Reference kind | Zero-shot | Few-shot | Fine-tuned |', '|---|---:|---:|---:|']
    for kind in configs['zero-shot']['perKind']:
        lines.append('| ' + kind + ' | ' + ' | '.join(f"{configs[name]['perKind'][kind]['referenceMatch']}/{configs[name]['perKind'][kind]['n']}" for name in CONFIGURATIONS) + ' |')
    lines += ['', '## Uncertainty and failure cases', '',
              'The following 95% Wilson intervals treat individual outputs as independent Bernoulli observations. That assumption is unverified for this templated, four-website pilot, so these are descriptive intervals rather than evidence of real-world accuracy. Zero observed false passes does not prove zero risk.', '']
    for name in CONFIGURATIONS:
        for label, prop in [('reference agreement', configs[name]['referenceAgreement']), ('false-pass rate', configs[name]['browser']['falsePass'])]:
            interval = prop['wilson95']
            lines.append(f"- {name}, {label}: " + (f"{interval[0]:.1%}–{interval[1]:.1%}." if interval else 'not estimable; no executed observations.'))
    browser_comparison = summary['fineTunedVsStrongestBaseline']['browserCorrectness']
    lines += ['', f"The paired browser-correctness difference against {best} is {browser_comparison['difference'] * 100:+.2f} percentage points across {browser_comparison['n']} executable references ({browser_comparison['candidateWins']} corrections, {browser_comparison['candidateLosses']} regressions; exact McNemar p={browser_comparison['exactMcNemarPValue']:.4g}). The same dependence and small-sample limitations apply.", '', 'Nonmatching few-shot/fine-tuned examples (IDs refer to the frozen dataset):', '']
    failures = False
    for name in ('few-shot', 'fine-tuned'):
        for outcome in configs[name]['outcomes']:
            if not outcome['referenceMatch']:
                failures = True
                lines.append(f"- {name}: `{outcome['id']}` — reference `{outcome['referenceKind']}`, model `{outcome['modelKind'] or 'invalid schema'}`.")
    if not failures:
        lines.append('- None observed in these two configurations.')
    train, cost = summary['training'], summary['cost']
    lines += ['', '## Training, compute and cost evidence', '',
              f"Real Tinker LoRA training used {train['examples']} examples, {train['tokens']:,} input tokens and {train['durationMs']/1000:.1f}s. Rank 16, one epoch, batch size 8, seed 42 and learning rate 0.0002 were frozen before evaluation. The sampler and state requested a 24-hour checkpoint TTL; saved artifacts are historical proof, not a guarantee that the remote checkpoint is still available.", '',
              f"At the [recorded provider rates]({cost['pricingSource']}) of $0.737/M training, $0.33/M input and $1.005/M output tokens, the observed-token estimate is **${Decimal(cost['totalObservedTokenEstimateUsd']):.6f}**. The frozen token-cap upper estimate is **${Decimal(cost['totalTokenCapUpperEstimateUsd']):.6f}**, before the ledger's 25% reservation margin and checkpoint overhead. These figures are estimates, not a reconciled bill. Provider billing data had not yet covered the experiment when checked.", '',
              'The private budget ledger and account proof govern free-credit eligibility and paid-overage settings. This report does not infer those account facts from token counts. No provider API is called by the summary command.', '',
              '## Reproduce the report', '', '```sh', 'python3 scripts/summarize-model-experiment.py --manifest eval/pilot.manifest.json', '```', '',
              'Raw artifacts: [manifest](../eval/pilot.manifest.json), [dataset](../eval/pilot.jsonl), [training receipt](../eval/results/training.json), [zero-shot](../eval/results/zero-shot.json), [few-shot](../eval/results/few-shot.json), [fine-tuned](../eval/results/fine-tuned.json), [machine-readable summary](../eval/experiment-summary.json). Paired browser receipts and evidence are under `eval/browser/`.', '',
              f"Manifest SHA-256: `{summary['manifestSha256']}`. The summary verifies exact cohort order, dataset/prompt hashes, tokenizer identity, checkpoint training linkage and browser-to-model response hashes before publishing metrics.", '']
    storage = cost['checkpointStorage']
    if storage:
        marker = lines.index('The private budget ledger and account proof govern free-credit eligibility and paid-overage settings. This report does not infer those account facts from token counts. No provider API is called by the summary command.')
        lines[marker:marker] = [f"[Actual provider checkpoint metadata](evidence/tinker-checkpoints.json) reports **{storage['totalBytes']:,} bytes** across the sampler and training state, each expiring after one day. At $0.10/GB-month this is approximately **${Decimal(storage['estimate30DayMonthUsd']):.6f}** using a 30-day month; the conservative 28-day-month variant is **${Decimal(storage['conservative28DayMonthEstimateUsd']):.6f}**. Observed tokens plus that conservative storage estimate total **${Decimal(cost['totalObservedTokensPlusConservativeStorageEstimateUsd']):.6f}**. Provider rounding and billing reconciliation remain unverified.", '']
    return '\n'.join(lines)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', type=Path, default=ROOT / 'eval/pilot.manifest.json')
    parser.add_argument('--results', type=Path, default=ROOT / 'eval/results')
    parser.add_argument('--browser-results', type=Path, default=ROOT / 'eval/browser')
    parser.add_argument('--output', type=Path, default=ROOT / 'eval/experiment-summary.json')
    parser.add_argument('--markdown', type=Path, default=ROOT / 'docs/MODEL_RESULTS.md')
    parser.add_argument('--checkpoint-evidence', type=Path, default=ROOT / 'docs/evidence/tinker-checkpoints.json')
    args = parser.parse_args()
    summary = summarize(args.manifest.resolve(), args.results.resolve(), args.browser_results.resolve(), args.checkpoint_evidence.resolve())
    write_json(args.output, summary)
    args.markdown.parent.mkdir(parents=True, exist_ok=True)
    args.markdown.write_text(markdown(summary))
    print(json.dumps({'summary': str(args.output), 'report': str(args.markdown), 'strongestBaseline': summary['strongestBaseline'], 'pairedReferenceComparison': summary['fineTunedVsStrongestBaseline']['referenceAgreement']}))


if __name__ == '__main__':
    try:
        main()
    except (ValueError, KeyError, FileNotFoundError) as error:
        sys.exit(str(error))
