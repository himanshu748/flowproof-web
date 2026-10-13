#!/usr/bin/env python3
"""Guarded Tinker LoRA experiment. Offline validation is the default."""
import argparse
import datetime as dt
import hashlib
import json
import sys
import time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'eval'))
from model_common import ROOT, MODEL, PROMPT, read_dataset, permit_tinker


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dataset', type=Path, default=ROOT / 'eval/candidates.jsonl')
    parser.add_argument('--run', action='store_true', help='Perform provider work after all guards pass')
    parser.add_argument('--credits-confirmed', action='store_true')
    parser.add_argument('--max-tokens', type=int, default=0)
    parser.add_argument('--epochs', type=int, default=1)
    parser.add_argument('--batch-size', type=int, default=8)
    parser.add_argument('--output', type=Path, default=ROOT / 'eval/training-run.json')
    args = parser.parse_args()
    rows, digest = read_dataset(args.dataset)
    training = [row for row in rows if row['split'] == 'train']
    if not training or not 1 <= args.epochs <= 3 or not 1 <= args.batch_size <= 16:
        parser.error('Need reviewed training rows, 1-3 epochs, batch size 1-16')
    if args.output.exists():
        parser.error('Refusing to overwrite an experiment receipt; choose another --output')
    if not args.run:
        print(json.dumps({'status': 'validated_only', 'model': MODEL, 'trainingExamples': len(training), 'datasetSha256': digest, 'providerCalls': 0})); return
    permit_tinker(args)
    import tinker
    from tinker_cookbook.renderers import TrainOnWhat, get_renderer
    from tinker_cookbook.supervised.data import conversation_to_datum
    service = tinker.ServiceClient()
    supported = [item.model_name for item in service.get_server_capabilities().supported_models]
    if MODEL not in supported:
        raise ValueError('Requested base model unavailable; no substitute model will be used')
    client = service.create_lora_training_client(base_model=MODEL, rank=16, seed=42)
    renderer = get_renderer('qwen3_5_disable_thinking', client.get_tokenizer())
    data = []
    for row in training:
        conversation = [{'role': 'system', 'content': PROMPT}, {'role': 'user', 'content': row['requirement']}, {'role': 'assistant', 'content': json.dumps(row['expected'])}]
        datum = conversation_to_datum(conversation, renderer, max_length=2048, train_on_what=TrainOnWhat.LAST_ASSISTANT_MESSAGE)
        data.append(datum)
    token_count = sum(d.model_input.length for d in data) * args.epochs
    if token_count > args.max_tokens:
        raise ValueError(f'Training needs {token_count} tokens, above the explicit budget; no gradient steps performed')
    started = time.time(); steps = []
    for epoch in range(args.epochs):
        for index in range(0, len(data), args.batch_size):
            batch = data[index:index + args.batch_size]
            before = time.perf_counter()
            forward = client.forward_backward(batch, 'cross_entropy')
            optimizer = client.optim_step(tinker.AdamParams(learning_rate=0.0002))
            result = forward.result(); optimizer.result()
            steps.append({'epoch': epoch, 'batch': index // args.batch_size, 'durationMs': (time.perf_counter() - before) * 1000, 'metrics': result.metrics})
    sampler = client.save_weights_for_sampler('flowproof-v1').result()
    state = client.save_state('flowproof-v1').result()
    receipt = {'schemaVersion': 1, 'status': 'completed', 'model': MODEL, 'samplerPath': sampler.path, 'statePath': state.path, 'datasetSha256': digest, 'promptSha256': hashlib.sha256(PROMPT.encode()).hexdigest(), 'trainingExamples': len(training), 'trainingTokens': token_count, 'epochs': args.epochs, 'loraRank': 16, 'seed': 42, 'durationMs': (time.time() - started) * 1000, 'recordedAt': dt.datetime.now(dt.timezone.utc).isoformat(), 'steps': steps}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(receipt, indent=2) + '\n')
    print(f'Completed training. Experiment receipt: {args.output}')

if __name__ == '__main__':
    try:
        main()
    except (ValueError, AssertionError) as error:
        sys.exit(str(error))
