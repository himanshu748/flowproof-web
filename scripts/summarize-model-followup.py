#!/usr/bin/env python3
"""Compare a completed follow-up to frozen historic baselines; no provider calls."""
import argparse
import importlib.util
import json
import sys
from decimal import Decimal
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'eval'))
from model_common import ROOT, read_manifest, sha256_file, write_json, now

spec = importlib.util.spec_from_file_location('original_summary', ROOT / 'scripts/summarize-model-experiment.py')
original = importlib.util.module_from_spec(spec)
spec.loader.exec_module(original)


def conditional_handoff_cost(metrics, training_usd='0', storage_usd=None, billed_usd=None):
    """A successful synthetic handoff requires BOTH reference agreement and a correct browser pair.

    Reference-manual cases are excluded: abstention alone is not an executed handoff.
    Include cost of ALL requests, including failed/manual outputs, in the numerator.
    """
    executable = [item for item in metrics['outcomes'] if item['referenceKind'] != 'manual']
    pairs = metrics['browser']['pairedOutcomes']
    if len(executable) != len(pairs):
        raise ValueError('Handoff denominator lacks paired browser outcomes')
    successes = sum(item['referenceMatch'] and passed for item, passed in zip(executable, pairs))
    inference = Decimal(metrics['observedTokenCostEstimateUsd'])
    return {
        'successfulHandoffs': successes, 'referenceExecutableCases': len(executable),
        'definition': 'Reference-executable case with reference agreement AND healthy-pass/broken-fail browser pair; synthetic proxy, not customer acceptance.',
        'allRequestInferenceEstimateUsd': str(inference),
        'inferenceEstimateUsdPerSuccessfulHandoff': str(inference / successes) if successes else None,
        'includingTrainingEstimateUsdPerSuccessfulHandoff': str((inference + Decimal(training_usd)) / successes) if successes else None,
        'includingTrainingAndStorageEstimateUsdPerSuccessfulHandoff': str((inference + Decimal(training_usd) + Decimal(storage_usd)) / successes) if successes and storage_usd is not None else None,
        'providerBilledInferenceUsd': str(billed_usd) if billed_usd is not None else None,
        'actualProviderBilledUsdPerSuccessfulHandoff': str(Decimal(billed_usd) / successes) if successes and billed_usd is not None else None,
        'actualBillingStatus': 'Not available: no attributable provider billing receipt; estimates are not actual cost.' if billed_usd is None else 'Attributable provider billing supplied.',
    }


def summarize(manifest_path, receipt_path, training_path, browser_path, checkpoint_evidence=None):
    manifest, all_rows, manifest_sha = read_manifest(manifest_path)
    source_path = ROOT / manifest['augmentation']['sourceManifestPath']
    source, source_rows, source_sha = read_manifest(source_path)
    if source_sha != manifest['augmentation']['sourceManifestSha256']:
        raise ValueError('Original comparison manifest changed')
    row_map = {row['id']: row for row in all_rows}
    source_map = {row['id']: row for row in source_rows}
    rows = [row_map[row_id] for row_id in manifest['heldoutIds']]
    if manifest['heldoutIds'] != source['heldoutIds'] or any(row != source_map[row['id']] for row in rows):
        raise ValueError('Follow-up must evaluate the exact unchanged original holdout')
    for key in ('model', 'renderer', 'promptSha256', 'sampling', 'fewShotIds'):
        if manifest[key] != source[key]:
            raise ValueError(f'Comparison property changed: {key}')
    training = json.loads(training_path.read_text())
    if training.get('status') != 'completed' or training.get('operation') != 'training' or training.get('manifestSha256') != manifest_sha:
        raise ValueError('Follow-up training receipt is not completed and linked')
    candidate = json.loads(receipt_path.read_text())
    original.validate_run(candidate, 'fine-tuned', manifest, manifest_sha)
    if candidate['trainingReceiptSha256'] != sha256_file(training_path) or candidate['checkpoint'] != training['samplerPath']:
        raise ValueError('Follow-up evaluation does not use this training checkpoint')
    metrics, sources = {}, {}
    for name, config, path, current_manifest, digest, current_browser in [
        ('few-shot', 'few-shot', ROOT / 'eval/results/few-shot.json', source, source_sha, ROOT / 'eval/browser/few-shot/browser-evaluation.json'),
        ('original-lora', 'fine-tuned', ROOT / 'eval/results/fine-tuned.json', source, source_sha, ROOT / 'eval/browser/fine-tuned/browser-evaluation.json'),
        ('followup-lora', 'fine-tuned', receipt_path, manifest, manifest_sha, browser_path),
    ]:
        run = json.loads(path.read_text())
        original.validate_run(run, config, current_manifest, digest)
        if run['tokenizer'] != candidate['tokenizer']:
            raise ValueError('Tokenizer changed between paired comparisons')
        metric = original.model_metrics(run, rows)
        metric['browser'] = original.browser_metrics(json.loads(current_browser.read_text()), run, path, metric['outcomes'], rows)
        metric['receiptSha256'] = sha256_file(path)
        metric['browserReceiptSha256'] = sha256_file(current_browser)
        metrics[name] = metric
        sources[name] = {'receipt': str(path.relative_to(ROOT)), 'browserReceipt': str(current_browser.relative_to(ROOT))}
    storage = original.checkpoint_storage(checkpoint_evidence, training) if checkpoint_evidence else None
    training_cost = original.dollars({'training': training['trainingTokens']})
    storage_cost = storage['conservative28DayMonthEstimateUsd'] if storage else None
    handoffs = {name: conditional_handoff_cost(metrics[name], training_cost if name == 'followup-lora' else '0', storage_cost if name == 'followup-lora' else '0') for name in ('few-shot', 'followup-lora')}
    return {'schemaVersion': 1, 'recordedAt': now(), 'experimentId': manifest['experimentId'],
            'manifestPath': str(manifest_path.relative_to(ROOT)), 'manifestSha256': manifest_sha,
            'heldoutCount': len(rows), 'heldoutUnchanged': True, 'augmentation': manifest['augmentation'],
            'configurations': metrics, 'sources': sources,
            'followupVsFewShot': original.paired_comparison([item['referenceMatch'] for item in metrics['few-shot']['outcomes']], [item['referenceMatch'] for item in metrics['followup-lora']['outcomes']]),
            'followupVsOriginalLora': original.paired_comparison([item['referenceMatch'] for item in metrics['original-lora']['outcomes']], [item['referenceMatch'] for item in metrics['followup-lora']['outcomes']]),
            'training': {'receipt': str(training_path.relative_to(ROOT)), 'receiptSha256': sha256_file(training_path), 'tokens': training['trainingTokens'], 'examples': training['trainingExamples'], 'durationMs': training['durationMs'], 'checkpoint': training['samplerPath'], 'checkpointExpiresAt': training.get('checkpointExpiresAt')},
            'cost': {'currency': 'USD', 'usdPerMillionTokens': {key: str(value) for key, value in original.RATES.items()}, 'pricingSource': original.PRICING_SOURCE,
                     'trainingObservedTokenEstimateUsd': training_cost, 'checkpointStorage': storage,
                     'conditionalHandoffs': handoffs, 'providerBillingReconciled': False},
            'limitations': ['Zero human validation; synthetic paired fixtures are not real customer acceptance.', manifest['augmentation']['limitation'], 'Historical baselines were not rerun concurrently; latency can reflect provider load.', 'Actual provider-billed per-handoff cost remains unavailable without attributable billing evidence.']}


def markdown(summary):
    lines = ['## Week 2 train-only follow-up', '',
             'The original comparison above is retained unchanged. This separate follow-up reuses the same 24 frozen examples after observing aggregate category failures; it is development feedback, not an independent confirmatory test.', '',
             '| Measured property | Historical few-shot | Original LoRA | Follow-up LoRA |', '|---|---:|---:|---:|']
    for label, getter in [
        ('Reference agreement', lambda m: original.percent(m['referenceAgreement'])),
        ('image_alt agreement', lambda m: f"{m['perKind']['image_alt']['referenceMatch']}/{m['perKind']['image_alt']['n']}"),
        ('Inappropriate abstentions', lambda m: str(m['inappropriateAbstentions'])),
        ('Input / output tokens', lambda m: f"{m['tokens']['input']} / {m['tokens']['output']}"),
        ('Mean / median latency, seconds', lambda m: f"{m['meanLatencyMs']/1000:.3f} / {m['medianLatencyMs']/1000:.3f}"),
        ('Correct browser pairs', lambda m: original.percent(m['browser']['executableCorrectness'])),
        ('False passes / executed broken assertions', lambda m: original.percent(m['browser']['falsePass'])),
    ]:
        lines.append('| ' + label + ' | ' + ' | '.join(getter(summary['configurations'][name]) for name in ('few-shot', 'original-lora', 'followup-lora')) + ' |')
    lines += ['', 'Conditional cost uses all inference requests in the numerator, including failures and abstentions. The denominator counts only reference-executable cases with both reference agreement and a correct healthy-pass/broken-fail browser pair.', '',
              '| Cost per successful synthetic handoff | Few-shot | Follow-up LoRA |', '|---|---:|---:|']
    for label, field in [('Successful handoffs', 'successfulHandoffs'), ('Inference token-price estimate, USD', 'inferenceEstimateUsdPerSuccessfulHandoff'), ('Including follow-up training estimate, USD', 'includingTrainingEstimateUsdPerSuccessfulHandoff'), ('Including training + measured storage estimate, USD', 'includingTrainingAndStorageEstimateUsdPerSuccessfulHandoff'), ('Actual attributable provider-billed inference, USD', 'actualProviderBilledUsdPerSuccessfulHandoff')]:
        values = [summary['cost']['conditionalHandoffs'][name][field] for name in ('few-shot', 'followup-lora')]
        lines.append('| ' + label + ' | ' + ' | '.join(str(value) if value is not None else 'Unavailable' for value in values) + ' |')
    lines += ['', f"Training: {summary['training']['examples']} examples, {summary['training']['tokens']} tokens, {summary['training']['durationMs']/1000:.3f}s; token-price estimate ${summary['cost']['trainingObservedTokenEstimateUsd']}. Checkpoint expiry: `{summary['training']['checkpointExpiresAt']}`.", '',
              'Actual cost is conditional on provider billing becoming attributable to these requests. Public token prices × observed token IDs are estimates; grant use is not a zero-dollar provider cost. Training/storage are excluded from inference-only rows and included only where explicitly shown.', '',
              'Receipts:', '']
    for name, source in summary['sources'].items():
        lines.append(f"- {name}: [model receipt](../{source['receipt']}), [browser receipt](../{source['browserReceipt']}); model SHA-256 `{summary['configurations'][name]['receiptSha256']}`.")
    lines += ['', *['- ' + limitation for limitation in summary['limitations']], '']
    return '\n'.join(lines)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', type=Path, default=ROOT / 'eval/week2-alt-v2.manifest.json')
    parser.add_argument('--receipt', type=Path, default=ROOT / 'eval/results/week2-alt-v2/fine-tuned.json')
    parser.add_argument('--training-receipt', type=Path, default=ROOT / 'eval/results/week2-alt-v2/training.json')
    parser.add_argument('--browser-receipt', type=Path, default=ROOT / 'eval/browser/week2-alt-v2/browser-evaluation.json')
    parser.add_argument('--checkpoint-evidence', type=Path)
    parser.add_argument('--output', type=Path, default=ROOT / 'eval/week2-alt-v2-summary.json')
    parser.add_argument('--append-markdown', action='store_true')
    args = parser.parse_args()
    if args.output.exists():
        parser.error('Refusing to overwrite a follow-up summary')
    summary = summarize(args.manifest.resolve(), args.receipt.resolve(), args.training_receipt.resolve(), args.browser_receipt.resolve(), args.checkpoint_evidence.resolve() if args.checkpoint_evidence else None)
    write_json(args.output, summary)
    if args.append_markdown:
        report = ROOT / 'docs/MODEL_RESULTS.md'
        if '## Week 2 train-only follow-up' in report.read_text():
            parser.error('Follow-up report already appended')
        with report.open('a') as stream:
            stream.write('\n' + markdown(summary))
    print(json.dumps({'summary': str(args.output.relative_to(ROOT)), 'providerCalls': 0, 'pairedReferenceComparison': summary['followupVsFewShot']}))


if __name__ == '__main__':
    main()
