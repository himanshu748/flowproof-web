#!/usr/bin/env python3
"""Measure a reviewed holdout with zero-shot, few-shot or a Tinker checkpoint."""
import argparse
import datetime as dt
import hashlib
import json
import sys
import time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'eval'))
from model_common import ROOT, MODEL, PROMPT, read_dataset, permit_tinker, parse_plan, semantic_match


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dataset', type=Path, default=ROOT / 'eval/candidates.jsonl')
    parser.add_argument('--configuration', choices=['zero-shot', 'few-shot', 'fine-tuned'], default='zero-shot')
    parser.add_argument('--checkpoint', help='Saved tinker:// sampler weights; required for fine-tuned')
    parser.add_argument('--run', action='store_true')
    parser.add_argument('--credits-confirmed', action='store_true')
    parser.add_argument('--max-tokens', type=int, default=0)
    parser.add_argument('--max-output-tokens', type=int, default=512)
    parser.add_argument('--limit', type=int, default=72)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    rows, digest = read_dataset(args.dataset)
    heldout = [row for row in rows if row['split'] == 'test'][:args.limit]
    if not 1 <= args.limit <= 72 or not heldout or not 128 <= args.max_output_tokens <= 2048:
        parser.error('Use 1-72 heldout rows and an output token cap of 128-2048')
    if args.configuration == 'fine-tuned' and not (args.checkpoint or '').startswith('tinker://'):
        parser.error('A real Tinker checkpoint is required for fine-tuned evaluation')
    args.output = args.output or ROOT / f'eval/results/{args.configuration}.json'
    if args.output.exists():
        parser.error('Refusing to overwrite an experiment; choose another --output')
    if not args.run:
        print(json.dumps({'status': 'validated_only', 'configuration': args.configuration, 'heldoutExamples': len(heldout), 'datasetSha256': digest, 'providerCalls': 0})); return
    permit_tinker(args)
    import tinker
    from tinker_cookbook.renderers import get_renderer, get_text_content
    service = tinker.ServiceClient()
    sampler = service.create_sampling_client(model_path=args.checkpoint) if args.configuration == 'fine-tuned' else service.create_sampling_client(base_model=MODEL)
    if sampler.get_base_model() != MODEL:
        raise ValueError('Checkpoint base model differs from the pre-registered comparison')
    renderer = get_renderer('qwen3_5_disable_thinking', sampler.get_tokenizer())
    shots = []
    if args.configuration == 'few-shot':
        for kind in ('heading', 'link', 'text_visible', 'image_alt', 'no_horizontal_overflow', 'manual'):
            shot = next((row for row in rows if row['split'] == 'train' and row['expected']['checks'][0]['kind'] == kind), None)
            if not shot:
                raise ValueError(f'No reviewed training example for {kind}')
            shots.extend([{'role': 'user', 'content': shot['requirement']}, {'role': 'assistant', 'content': json.dumps(shot['expected'])}])
    prompts = []
    for row in heldout:
        prompt = renderer.build_generation_prompt([{'role': 'system', 'content': PROMPT}, *shots, {'role': 'user', 'content': row['requirement']}])
        prompts.append((row, prompt))
    upper_bound = sum(prompt.length + args.max_output_tokens for _, prompt in prompts)
    if upper_bound > args.max_tokens:
        raise ValueError(f'Worst-case inference uses {upper_bound} tokens, above the explicit budget; no samples requested')
    measurements = []
    receipt = {'schemaVersion': 1, 'status': 'running', 'provider': 'tinker', 'model': MODEL, 'configuration': args.configuration, 'checkpoint': args.checkpoint if args.configuration == 'fine-tuned' else None, 'datasetSha256': digest, 'datasetPath': str(args.dataset.resolve().relative_to(ROOT)), 'promptSha256': hashlib.sha256(PROMPT.encode()).hexdigest(), 'recordedAt': dt.datetime.now(dt.timezone.utc).isoformat(), 'sampling': {'temperature': 0, 'maxOutputTokens': args.max_output_tokens}, 'measurements': measurements, 'limitations': ['Reference-field agreement is an automated proxy for interpretation accuracy.', 'No browser execution in this command; executable correctness and false-pass rate remain null.']}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    for row, prompt in prompts:
        before = time.perf_counter()
        result = sampler.sample(prompt=prompt, num_samples=1, sampling_params=tinker.SamplingParams(max_tokens=args.max_output_tokens, temperature=0, stop=renderer.get_stop_sequences())).result()
        elapsed = (time.perf_counter() - before) * 1000
        sequence = result.sequences[0]
        message, _ = renderer.parse_response(sequence.tokens)
        raw = get_text_content(message)
        valid = False; match = False; abstained = False
        try:
            plan = parse_plan(raw, row['requirement']); valid = True
            match = semantic_match(plan, row['expected']); abstained = plan['checks'][0]['kind'] == 'manual'
        except (ValueError, TypeError, KeyError):
            pass
        measurements.append({'id': row['id'], 'rawOutput': raw, 'validSchema': valid, 'referenceMatch': match, 'shouldAbstain': row['expected']['checks'][0]['kind'] == 'manual', 'abstained': abstained, 'latencyMs': elapsed, 'inputTokens': prompt.length, 'outputTokens': len(sequence.tokens)})
        args.output.write_text(json.dumps(receipt, indent=2) + '\n')
    receipt['status'] = 'completed'
    args.output.write_text(json.dumps(receipt, indent=2) + '\n')
    print(f'Measured {len(measurements)} examples. Receipt: {args.output}')

if __name__ == '__main__':
    try:
        main()
    except (ValueError, AssertionError) as error:
        sys.exit(str(error))
