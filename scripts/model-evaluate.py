#!/usr/bin/env python3
"""Measure the identical frozen holdout with base prompting or a linked Tinker checkpoint."""
import argparse
import json
import sys
import time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'eval'))
from model_common import (ROOT, MODEL, PROMPT, read_manifest, permit_tinker,
    parse_plan, semantic_match, load_tokenizer, tokenizer_metadata, prompt_tokens,
    base_receipt, package_versions, verify_training_receipt, reserve_budget,
    record_budget, write_json, now, relative_path)
from tinker_dispatch import install_single_dispatch_policy


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--configuration', choices=['zero-shot', 'few-shot', 'fine-tuned'], default='zero-shot')
    parser.add_argument('--checkpoint')
    parser.add_argument('--training-receipt', type=Path)
    parser.add_argument('--run', action='store_true')
    parser.add_argument('--credits-confirmed', action='store_true')
    parser.add_argument('--max-tokens', type=int, default=0)
    parser.add_argument('--budget-ledger', type=Path)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    manifest, rows, manifest_sha = read_manifest(args.manifest)
    by_id = {row['id']: row for row in rows}
    heldout = [by_id[row_id] for row_id in manifest['heldoutIds']]
    training_sha = None
    if args.configuration == 'fine-tuned':
        if not args.training_receipt:
            parser.error('Fine-tuned evaluation requires --training-receipt and --checkpoint')
        training_sha = verify_training_receipt(args.training_receipt, manifest_sha, args.checkpoint)
    elif args.checkpoint or args.training_receipt:
        parser.error('Baseline runs cannot use a training checkpoint')
    args.output = args.output or ROOT / f'eval/results/{args.configuration}.json'
    if args.output.exists():
        parser.error('Refusing to overwrite an experiment; choose another --output')
    if args.run:
        permit_tinker(args)
        if not args.budget_ledger:
            parser.error('--budget-ledger is required for provider work')
    tokenizer = load_tokenizer()
    shots = []
    if args.configuration == 'few-shot':
        for shot_id in manifest['fewShotIds']:
            shot = by_id[shot_id]
            shots.extend([{'role': 'user', 'content': shot['requirement']}, {'role': 'assistant', 'content': json.dumps(shot['expected'])}])
    prompts = [(row, prompt_tokens(tokenizer, [{'role': 'system', 'content': PROMPT}, *shots, {'role': 'user', 'content': row['requirement']}])) for row in heldout]
    token_bounds = {'input': sum(len(tokens) for _, tokens in prompts), 'output': len(prompts) * manifest['sampling']['maxOutputTokens']}
    upper_bound = sum(token_bounds.values())
    if not args.run:
        print(json.dumps({'status': 'validated_only', 'configuration': args.configuration, 'benchmarkMode': manifest['benchmarkMode'], 'heldoutExamples': len(heldout), 'tokenUpperBounds': token_bounds, 'manifestSha256': manifest_sha, 'providerCalls': 0})); return
    if upper_bound > args.max_tokens:
        raise ValueError(f'Worst-case inference uses {upper_bound} tokens, above explicit budget; no provider work performed')
    reservation = reserve_budget(args.budget_ledger, args.configuration, manifest['experimentId'], token_bounds)
    receipt = base_receipt(manifest, args.manifest, manifest_sha) | {
        'operation': 'evaluation', 'configuration': args.configuration,
        'checkpoint': args.checkpoint if args.configuration == 'fine-tuned' else None,
        'trainingReceiptPath': relative_path(args.training_receipt) if args.training_receipt else None,
        'trainingReceiptSha256': training_sha, 'sampling': manifest['sampling'],
        'heldoutIds': manifest['heldoutIds'], 'fewShotIds': manifest['fewShotIds'] if args.configuration == 'few-shot' else [],
        'tokenizer': tokenizer_metadata(tokenizer), 'packages': package_versions(),
        'budgetReservationId': reservation['id'], 'reservedCostUsd': reservation['reservedCostUsd'],
        'tokenUpperBounds': token_bounds, 'tokenUsageBasis': 'SDK input and generated token IDs; not provider billing usage.',
        'samplingOperationReplays': False,
        'dispatchPolicy': 'pinned-0.32.0-single-dispatch', 'transportHttpRetries': False,
        'measurements': [], 'limitations': ['Reference-field agreement is an automated proxy for interpretation accuracy.', 'Browser metrics require the separately linked paired-fixture execution receipt.'] + (['Agent-reviewed synthetic pilot; zero human validation and no real-client generalization claim.'] if manifest['benchmarkMode'] == 'agent-reviewed-pilot' else []),
    }
    write_json(args.output, receipt)
    usage = {'input': 0, 'output': 0}
    started = time.perf_counter()
    try:
        import tinker
        install_single_dispatch_policy()
        from tinker.lib.retry_handler import RetryConfig
        service = tinker.ServiceClient()
        supported = [item.model_name for item in service.get_server_capabilities().supported_models]
        if MODEL not in supported:
            raise ValueError('Requested model unavailable; no substitute will be used')
        # The SDK's outer retry restarts sampling with a fresh sequence ID.
        # That could consume another billable sample outside this reservation.
        retry_config = RetryConfig(enable_retry_logic=False)
        sampler = service.create_sampling_client(model_path=args.checkpoint, retry_config=retry_config) if args.configuration == 'fine-tuned' else service.create_sampling_client(base_model=MODEL, retry_config=retry_config)
        if sampler.get_base_model() != MODEL:
            raise ValueError('Sampler base model differs from frozen comparison')
        if tokenizer_metadata(sampler.get_tokenizer()) != receipt['tokenizer']:
            raise ValueError('Provider tokenizer differs from budgeted/frozen tokenizer')
        for row, tokens in prompts:
            receipt['pendingExampleId'] = row['id']
            write_json(args.output, receipt)
            before = time.perf_counter()
            result = sampler.sample(prompt=tinker.ModelInput.from_ints(tokens), num_samples=1, sampling_params=tinker.SamplingParams(max_tokens=manifest['sampling']['maxOutputTokens'], temperature=0, stop=[tokenizer.eos_token_id])).result()
            elapsed = (time.perf_counter() - before) * 1000
            sequence = result.sequences[0]
            output_tokens = list(sequence.tokens)
            # Remove only the protocol terminal EOS; never repair/extract model prose.
            content_tokens = output_tokens[:-1] if output_tokens and output_tokens[-1] == tokenizer.eos_token_id else output_tokens
            raw = tokenizer.decode(content_tokens, skip_special_tokens=False)
            usage['input'] += len(tokens); usage['output'] += len(output_tokens)
            valid = False; match = False; abstained = False
            try:
                plan = parse_plan(raw, row['requirement']); valid = True
                match = semantic_match(plan, row['expected']); abstained = plan['checks'][0]['kind'] == 'manual'
            except (ValueError, TypeError, KeyError):
                pass
            receipt['measurements'].append({'id': row['id'], 'rawOutput': raw, 'validSchema': valid, 'referenceMatch': match, 'shouldAbstain': row['expected']['checks'][0]['kind'] == 'manual', 'abstained': abstained, 'latencyMs': elapsed, 'inputTokens': len(tokens), 'outputTokens': len(output_tokens), 'outputTokenIds': output_tokens})
            receipt.pop('pendingExampleId', None)
            write_json(args.output, receipt)
            record_budget(args.budget_ledger, reservation['id'], 'running', usage)
        receipt.update(status='completed', completedAt=now(), durationMs=(time.perf_counter() - started) * 1000)
    except BaseException as error:
        receipt.update(status='failed', failedAt=now(), errorType=type(error).__name__, durationMs=(time.perf_counter() - started) * 1000)
        write_json(args.output, receipt)
        record_budget(args.budget_ledger, reservation['id'], 'failed', usage)
        raise RuntimeError(f'Provider evaluation stopped ({type(error).__name__}); partial receipt retained at {args.output}') from None
    write_json(args.output, receipt)
    record_budget(args.budget_ledger, reservation['id'], 'completed', usage)
    print(f'Measured {len(receipt["measurements"])} examples. Receipt: {args.output}')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, AssertionError, RuntimeError) as error:
        sys.exit(str(error))
