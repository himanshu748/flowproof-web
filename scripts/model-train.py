#!/usr/bin/env python3
"""Run a frozen, budget-reserved Tinker LoRA experiment; offline by default."""
import argparse
import datetime as dt
import json
import sys
import time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'eval'))
from model_common import (ROOT, MODEL, read_manifest, permit_tinker, load_tokenizer,
    training_tokens, tokenizer_metadata, base_receipt, package_versions,
    reserve_budget, record_budget, write_json, now)
from tinker_dispatch import install_single_dispatch_policy


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--run', action='store_true')
    parser.add_argument('--credits-confirmed', action='store_true')
    parser.add_argument('--max-tokens', type=int, default=0)
    parser.add_argument('--budget-ledger', type=Path)
    parser.add_argument('--output', type=Path, default=ROOT / 'eval/training-run.json')
    args = parser.parse_args()
    manifest, rows, manifest_sha = read_manifest(args.manifest)
    settings = manifest['training']
    training = [row for row in rows if row['id'] in manifest['trainIds']]
    if args.output.exists():
        parser.error('Refusing to overwrite an experiment receipt; choose another --output')
    if args.run:
        permit_tinker(args)
        if not args.budget_ledger:
            parser.error('--budget-ledger is required for provider work')
    tokenizer = load_tokenizer()
    encoded = [training_tokens(tokenizer, row) for row in training]
    token_count = sum(len(item[0]) for item in encoded) * settings['epochs']
    if not args.run:
        print(json.dumps({'status': 'validated_only', 'model': MODEL, 'benchmarkMode': manifest['benchmarkMode'], 'trainingExamples': len(training), 'trainingTokensUpperBound': token_count, 'manifestSha256': manifest_sha, 'providerCalls': 0})); return
    if token_count > args.max_tokens:
        raise ValueError(f'Training needs {token_count} tokens, above explicit budget; no provider work performed')
    reservation = reserve_budget(args.budget_ledger, 'training', manifest['experimentId'], {'training': token_count})
    receipt = base_receipt(manifest, args.manifest, manifest_sha) | {
        'operation': 'training', 'budgetReservationId': reservation['id'], 'reservedCostUsd': reservation['reservedCostUsd'],
        'settings': settings, 'trainingExamples': len(training), 'trainingTokensUpperBound': token_count,
        'trainingTokens': 0, 'tokenUsageBasis': 'SDK input token IDs submitted per completed forward/backward operation; not provider billing usage.',
        'tokenizer': tokenizer_metadata(tokenizer), 'packages': package_versions(),
        'checkpointTtlSeconds': 86400, 'steps': [], 'limitations': ['Agent review is not human validation.'] if manifest['benchmarkMode'] == 'agent-reviewed-pilot' else [],
        'dispatchPolicy': 'pinned-0.32.0-single-dispatch', 'transportHttpRetries': False,
    }
    write_json(args.output, receipt)
    started = time.perf_counter()
    try:
        import tinker
        install_single_dispatch_policy()
        data = [tinker.Datum(model_input=tinker.ModelInput.from_ints(inputs), loss_fn_inputs={'target_tokens': targets, 'weights': weights}) for inputs, targets, weights in encoded]
        service = tinker.ServiceClient()
        supported = [item.model_name for item in service.get_server_capabilities().supported_models]
        if MODEL not in supported:
            raise ValueError('Requested model unavailable; no substitute will be used')
        client = service.create_lora_training_client(base_model=MODEL, rank=settings['loraRank'], seed=settings['seed'])
        if tokenizer_metadata(client.get_tokenizer()) != receipt['tokenizer']:
            raise ValueError('Provider tokenizer differs from budgeted tokenizer')
        for epoch in range(settings['epochs']):
            for index in range(0, len(data), settings['batchSize']):
                batch = data[index:index + settings['batchSize']]
                step = {'epoch': epoch, 'batch': index // settings['batchSize'], 'status': 'submitting', 'inputTokens': sum(d.model_input.length for d in batch)}
                receipt['steps'].append(step)
                write_json(args.output, receipt)
                before = time.perf_counter()
                result = client.forward_backward(batch, 'cross_entropy').result()
                receipt['trainingTokens'] += step['inputTokens']
                step.update(status='gradient_completed', metrics=result.metrics)
                write_json(args.output, receipt)
                client.optim_step(tinker.AdamParams(learning_rate=settings['learningRate'])).result()
                step.update(status='completed', durationMs=(time.perf_counter() - before) * 1000)
                write_json(args.output, receipt)
                record_budget(args.budget_ledger, reservation['id'], 'running', {'training': receipt['trainingTokens']})
        name = manifest['experimentId']
        receipt['samplerSaveRequestedAt'] = now()
        write_json(args.output, receipt)
        receipt['samplerPath'] = client.save_weights_for_sampler(name, ttl_seconds=86400).result().path
        receipt['samplerSavedAt'] = now()
        receipt['checkpointExpiresAt'] = (dt.datetime.fromisoformat(receipt['samplerSaveRequestedAt']) + dt.timedelta(seconds=86400)).isoformat()
        write_json(args.output, receipt)
        receipt['statePath'] = client.save_state(name, ttl_seconds=86400).result().path
        receipt.update(status='completed', completedAt=now(), durationMs=(time.perf_counter() - started) * 1000)
    except BaseException as error:
        receipt.update(status='failed', failedAt=now(), errorType=type(error).__name__, durationMs=(time.perf_counter() - started) * 1000)
        write_json(args.output, receipt)
        record_budget(args.budget_ledger, reservation['id'], 'failed', {'training': receipt['trainingTokens']})
        raise RuntimeError(f'Provider training stopped ({type(error).__name__}); partial receipt retained at {args.output}') from None
    write_json(args.output, receipt)
    record_budget(args.budget_ledger, reservation['id'], 'completed', {'training': receipt['trainingTokens']})
    print(f'Completed training. Experiment receipt: {args.output}')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, AssertionError, RuntimeError) as error:
        sys.exit(str(error))
