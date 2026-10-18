"""Shared, offline-safe helpers for the optional Tinker experiment commands."""
import hashlib
import importlib.util
import json
import os
import re
import datetime as dt
import fcntl
import uuid
from contextlib import contextmanager
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODEL = 'Qwen/Qwen3.5-4B'
# Frozen from the original completed comparison, not a newly downloaded default.
# Transformers can construct a 33-special-token fallback from an incomplete
# cache. That silently undercounts the reservation and invalidates comparison.
TOKENIZER_FINGERPRINT = {
    'model': MODEL, 'class': 'Qwen3_5Tokenizer',
    'chatTemplateSha256': 'a4aee8afcf2e0711942cf848899be66016f8d14a889ff9ede07bca099c28f715',
    'vocabularySha256': '365c2d8a0c0e72d4bcc5dbc6c2e9330a87dae7ffc77e9fcd9d65739f4d16bfff',
    'enableThinking': False, 'eosTokenId': 248046,
}
PROMPT = ('Convert one client website requirement to JSON with exactly a checks array. Each check has exactly requirement (copy the whole input), kind, path, expected, viewport. '
          'Kinds: text_visible, heading, link, image_alt, no_horizontal_overflow, manual. Use path /, viewport desktop or mobile (390px). '
          'For text_visible, heading, link, expected is literal client text. For image_alt expected is "Nonempty alternative text on every content image; description quality needs human review". '
          'For no_horizontal_overflow expected is "No horizontal scrolling". For manual expected is "A person must review this requirement; no supported deterministic assertion covers it." '
          'Use manual for subjective requirements, form submission, purchases, destructive actions, authentication, unknown expected text, unsupported dimensions, CSS styling, timing, counts or unsupported assertions. '
          'No JavaScript, selectors, tool calls or approval flags. Return JSON only.')


def read_dataset(path, benchmark_mode='human-reviewed'):
    raw = path.read_bytes()
    rows = [json.loads(line) for line in raw.decode().splitlines() if line.strip()]
    spec = importlib.util.spec_from_file_location('dataset_script', ROOT / 'scripts/model-dataset.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.validate(rows, reviewed=True, benchmark_mode=benchmark_mode)
    return rows, hashlib.sha256(raw).hexdigest()


def permit_tinker(args):
    if os.getenv('FLOWPROOF_ALLOW_TINKER') != '1' or not args.credits_confirmed:
        raise ValueError('No provider calls permitted. Requires FLOWPROOF_ALLOW_TINKER=1 and --credits-confirmed after checking a sufficient free allowance.')
    if not os.getenv('TINKER_API_KEY'):
        raise ValueError('TINKER_API_KEY is absent. No provider calls made.')
    allowance = int(os.getenv('FLOWPROOF_FREE_TOKEN_ALLOWANCE', '0'))
    if args.max_tokens <= 0 or args.max_tokens > allowance:
        raise ValueError('The explicit token budget must fit FLOWPROOF_FREE_TOKEN_ALLOWANCE. This local guard is not a provider billing cap.')


def parse_plan(raw, requirement):
    # No extraction from prose and no repairs: malformed model outputs count as failures.
    plan = json.loads(raw)
    if not isinstance(plan, dict) or set(plan) != {'checks'} or not isinstance(plan['checks'], list) or len(plan['checks']) != 1:
        raise ValueError('Expected one check')
    check = plan['checks'][0]
    if not isinstance(check, dict) or set(check) != {'requirement', 'kind', 'path', 'expected', 'viewport'}:
        raise ValueError('Unexpected check fields')
    if check['requirement'] != requirement or check['kind'] not in ('heading', 'link', 'text_visible', 'image_alt', 'no_horizontal_overflow', 'manual'):
        raise ValueError('Wrong original or unsupported kind')
    path = check['path']
    if not isinstance(path, str) or len(path) > 300 or not re.fullmatch(r'/[A-Za-z0-9_/-]*', path) or path.startswith('//') or '..' in path:
        raise ValueError('Unsafe path')
    if not isinstance(check['expected'], str) or len(check['expected']) > 500 or check['viewport'] not in ('desktop', 'mobile'):
        raise ValueError('Invalid expected/viewport')
    if not isinstance(requirement, str) or not requirement.strip() or len(requirement) > 3000:
        raise ValueError('Invalid requirement')
    if check['kind'] in ('heading', 'link', 'text_visible') and not check['expected'].strip():
        raise ValueError('A literal text assertion requires nonempty expected text')
    return plan


def semantic_match(actual, expected):
    # Automated exact-field agreement, not a claim of human-scored interpretation.
    fields = ['kind', 'path', 'viewport']
    if actual['checks'][0]['kind'] in ('heading', 'link', 'text_visible'):
        fields.append('expected')
    return all(actual['checks'][0][key] == expected['checks'][0][key] for key in fields)


RENDERER = 'qwen3.5-hf-chat-template-disable-thinking'
MODES = ('human-reviewed', 'agent-reviewed-pilot')


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def sha256_file(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + '.tmp')
    temporary.write_text(json.dumps(value, indent=2) + '\n')
    temporary.replace(path)


def relative_path(path):
    return str(path.resolve().relative_to(ROOT))


def review_provenance(rows):
    return {
        'humanValidated': sum(row['review'].get('actorType') == 'human' for row in rows),
        'agentReviewed': sum(row['review'].get('actorType') == 'agent' for row in rows),
        'note': 'Agent review is not human validation. Synthetic pilot results do not establish accuracy on client websites.',
    }


def create_manifest(dataset_path, mode, output, experiment_id, max_output_tokens=512, epochs=1, batch_size=8):
    if output.exists():
        raise ValueError('Manifest already exists; freeze a new experiment instead of overwriting it')
    if not re.fullmatch(r'[a-zA-Z0-9_-]{1,80}', experiment_id):
        raise ValueError('Invalid experiment ID')
    rows, digest = read_dataset(dataset_path, mode)
    groups = {split: [row['id'] for row in rows if row['split'] == split] for split in ('train', 'validation', 'test')}
    if not groups['train'] or not 1 <= len(groups['test']) <= 72:
        raise ValueError('Manifest needs training rows and 1-72 heldout rows')
    shots = []
    for kind in ('heading', 'link', 'text_visible', 'image_alt', 'no_horizontal_overflow', 'manual'):
        shot = next((row for row in rows if row['split'] == 'train' and row['expected']['checks'][0]['kind'] == kind), None)
        if shot is None:
            raise ValueError(f'Missing training demonstration for {kind}')
        shots.append(shot['id'])
    if not 128 <= max_output_tokens <= 2048 or not 1 <= epochs <= 3 or not 1 <= batch_size <= 16:
        raise ValueError('Invalid frozen generation/training limits')
    manifest = {
        'schemaVersion': 2, 'experimentId': experiment_id, 'benchmarkMode': mode,
        'datasetPath': relative_path(dataset_path), 'datasetSha256': digest,
        'model': MODEL, 'renderer': RENDERER, 'promptSha256': hashlib.sha256(PROMPT.encode()).hexdigest(),
        'trainIds': groups['train'], 'validationIds': groups['validation'], 'heldoutIds': groups['test'], 'fewShotIds': shots,
        'sampling': {'temperature': 0, 'maxOutputTokens': max_output_tokens},
        'training': {'epochs': epochs, 'batchSize': batch_size, 'loraRank': 16, 'seed': 42, 'learningRate': 0.0002},
        'reviewProvenance': review_provenance(rows), 'createdAt': now(),
    }
    write_json(output, manifest)
    return manifest


def read_manifest(path):
    manifest = json.loads(path.read_text())
    if manifest.get('schemaVersion') != 2 or manifest.get('benchmarkMode') not in MODES:
        raise ValueError('Invalid experiment manifest version or review mode')
    if manifest.get('model') != MODEL or manifest.get('renderer') != RENDERER or manifest.get('promptSha256') != hashlib.sha256(PROMPT.encode()).hexdigest():
        raise ValueError('Manifest model, renderer or prompt does not match this experiment implementation')
    dataset_path = (ROOT / manifest['datasetPath']).resolve()
    if not dataset_path.is_relative_to(ROOT / 'eval'):
        raise ValueError('Experiment datasets must be within eval/')
    rows, digest = read_dataset(dataset_path, manifest['benchmarkMode'])
    if digest != manifest['datasetSha256']:
        raise ValueError('Frozen dataset hash changed')
    for split, field in [('train', 'trainIds'), ('validation', 'validationIds'), ('test', 'heldoutIds')]:
        ids = [row['id'] for row in rows if row['split'] == split]
        if manifest[field] != ids:
            raise ValueError(f'Frozen {field} differs from the dataset')
    if not manifest['trainIds'] or not 1 <= len(manifest['heldoutIds']) <= 72:
        raise ValueError('Invalid frozen sample counts')
    shots = [row for shot_id in manifest['fewShotIds'] for row in rows if row['id'] == shot_id and row['split'] == 'train']
    if len(shots) != 6 or {row['expected']['checks'][0]['kind'] for row in shots} != {'heading', 'link', 'text_visible', 'image_alt', 'no_horizontal_overflow', 'manual'}:
        raise ValueError('Few-shot IDs must cover six kinds using training rows only')
    sampling, training = manifest['sampling'], manifest['training']
    if sampling['temperature'] != 0 or not 128 <= sampling['maxOutputTokens'] <= 2048:
        raise ValueError('Invalid frozen sampling configuration')
    if not 1 <= training['epochs'] <= 3 or not 1 <= training['batchSize'] <= 16 or training['loraRank'] != 16 or training['seed'] != 42 or training['learningRate'] != 0.0002:
        raise ValueError('Invalid frozen training configuration')
    if manifest.get('reviewProvenance') != review_provenance(rows):
        raise ValueError('Review provenance changed')
    return manifest, rows, sha256_file(path)


def base_receipt(manifest, manifest_path, manifest_sha):
    return {key: manifest[key] for key in ('experimentId', 'benchmarkMode', 'model', 'renderer', 'datasetPath', 'datasetSha256', 'promptSha256', 'reviewProvenance')} | {
        'schemaVersion': 2, 'provider': 'tinker', 'manifestPath': relative_path(manifest_path),
        'manifestSha256': manifest_sha, 'status': 'running', 'recordedAt': now(),
    }


def verify_training_receipt(path, manifest_sha, checkpoint):
    receipt = json.loads(path.read_text())
    if receipt.get('schemaVersion') != 2 or receipt.get('status') != 'completed' or receipt.get('operation') != 'training' or receipt.get('manifestSha256') != manifest_sha or receipt.get('model') != MODEL or receipt.get('samplerPath') != checkpoint:
        raise ValueError('Checkpoint does not match a completed training receipt for this manifest')
    if not isinstance(checkpoint, str) or not checkpoint.startswith('tinker://'):
        raise ValueError('A real Tinker sampler checkpoint is required')
    ttl = receipt.get('checkpointTtlSeconds')
    if not isinstance(ttl, int) or not 1 <= ttl <= 86400:
        raise ValueError('Checkpoint TTL evidence is missing or exceeds the experiment cap')
    # Earlier v2 receipts predate the saved-at fields. Their recordedAt predates
    # training and is a conservative expiry anchor, never the later state save.
    anchor = receipt.get('samplerSavedAt') or receipt.get('recordedAt')
    try:
        saved_at = dt.datetime.fromisoformat(anchor.replace('Z', '+00:00'))
        if saved_at.tzinfo is None:
            raise ValueError('Checkpoint timestamp needs a timezone')
        expires_at = saved_at + dt.timedelta(seconds=ttl)
        if receipt.get('checkpointExpiresAt'):
            explicit_expiry = dt.datetime.fromisoformat(receipt['checkpointExpiresAt'].replace('Z', '+00:00'))
            expires_at = min(expires_at, explicit_expiry)
        if dt.datetime.now(dt.timezone.utc) >= expires_at:
            raise ValueError('Checkpoint has expired; no provider work permitted')
    except (TypeError, AttributeError) as error:
        raise ValueError('Checkpoint expiry evidence is missing or invalid') from error
    return sha256_file(path)


@contextmanager
def locked_ledger(path):
    # A separate lock survives atomic ledger replacement and serializes local processes.
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.with_suffix(path.suffix + '.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(lock, fcntl.LOCK_UN)


def reserve_budget(path, operation, experiment_id, token_counts):
    """Never release upper-bound reservations, including after failures or retries.

    The ledger is an additional local control, not a replacement for independently
    confirmed provider free credits and overage controls. Dollar limits include a
    caller-configured operation overhead and 25% price/token safety margin.
    """
    with locked_ledger(path):
        ledger = json.loads(path.read_text())
        confirmation = ledger['freeAllowanceConfirmation']
        checked = dt.datetime.fromisoformat(confirmation['checkedAt'].replace('Z', '+00:00'))
        expires = dt.datetime.fromisoformat(confirmation['expiresAt'].replace('Z', '+00:00'))
        current = dt.datetime.now(dt.timezone.utc)
        if ledger.get('schemaVersion') != 1 or ledger.get('currency') != 'USD' or ledger.get('model') != MODEL:
            raise ValueError('Invalid budget ledger identity')
        if not confirmation.get('source') or confirmation.get('overageDisabled') is not True or not checked <= current < expires or (current - checked).total_seconds() > 86400:
            raise ValueError('Free credit/overage confirmation is missing, stale or expired')
        if not token_counts or any(not isinstance(value, int) or value < 0 for value in token_counts.values()):
            raise ValueError('Invalid token reservation')
        if not set(token_counts) <= {'training', 'input', 'output'}:
            raise ValueError('Unknown token billing category')
        token_upper_bound = sum(token_counts.values())
        prices = ledger['usdPerMillionTokens']
        rates = {key: Decimal(str(prices[key])) for key in token_counts}
        if any(not rate.is_finite() or rate < 0 for rate in rates.values()):
            raise ValueError('Invalid confirmed token prices')
        overhead = Decimal(str(ledger.get('operationOverheadUsd', '0')))
        if not overhead.is_finite() or overhead < 0:
            raise ValueError('Invalid operation overhead')
        cost = (sum(Decimal(token_counts[key]) * rates[key] / Decimal(1_000_000) for key in token_counts) + overhead) * Decimal('1.25')
        max_cost = Decimal(str(ledger['maxCostUsd']))
        available = Decimal(str(confirmation['remainingFreeUsd']))
        if not max_cost.is_finite() or not available.is_finite() or max_cost <= 0 or max_cost > available:
            raise ValueError('Budget must fit confirmed remaining free credits')
        reservations = ledger.setdefault('reservations', [])
        if operation == 'training' and any(item['operation'] == 'training' and item['experimentId'] == experiment_id for item in reservations):
            raise ValueError('This experiment already reserved its one training run; failed or uncertain runs must not be retried')
        used_tokens = sum(item['reservedTokens'] for item in reservations)
        used_cost = sum(Decimal(str(item['reservedCostUsd'])) for item in reservations)
        if used_tokens + token_upper_bound > ledger['maxTokens'] or used_cost + cost > max_cost:
            raise ValueError('Aggregate experiment token/cost allowance exhausted; no provider work permitted')
        reservation = {
            'id': str(uuid.uuid4()), 'operation': operation, 'experimentId': experiment_id,
            'reservedAt': now(), 'reservedTokens': token_upper_bound, 'tokenUpperBounds': token_counts,
            'reservedCostUsd': str(cost), 'status': 'reserved',
        }
        reservations.append(reservation)
        write_json(path, ledger)
        return reservation


def record_budget(path, reservation_id, status, observed_tokens):
    with locked_ledger(path):
        ledger = json.loads(path.read_text())
        reservation = next(item for item in ledger['reservations'] if item['id'] == reservation_id)
        reservation.update(status=status, observedTokens=observed_tokens, updatedAt=now())
        write_json(path, ledger)


def package_versions():
    from importlib.metadata import version
    return {name: version(name) for name in ('tinker', 'transformers', 'tokenizers')}


def load_tokenizer():
    from transformers import AutoTokenizer
    # Cached tokenizer assets only; no model weights, inference or remote code.
    tokenizer = AutoTokenizer.from_pretrained(MODEL, local_files_only=True, trust_remote_code=False)
    if not tokenizer.chat_template or tokenizer.eos_token_id is None:
        raise ValueError('Exact model tokenizer must provide a chat template and EOS')
    if tokenizer_metadata(tokenizer) != TOKENIZER_FINGERPRINT:
        raise ValueError('Cached tokenizer differs from the frozen comparison; complete and verify tokenizer assets before reserving provider work')
    return tokenizer


def tokenizer_metadata(tokenizer):
    return {
        'model': MODEL, 'class': type(tokenizer).__name__,
        'chatTemplateSha256': hashlib.sha256(tokenizer.chat_template.encode()).hexdigest(),
        'vocabularySha256': hashlib.sha256(json.dumps(tokenizer.get_vocab(), sort_keys=True).encode()).hexdigest(),
        'enableThinking': False, 'eosTokenId': tokenizer.eos_token_id,
    }


def prompt_tokens(tokenizer, messages):
    text = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True, enable_thinking=False)
    return tokenizer.encode(text, add_special_tokens=False)


def training_tokens(tokenizer, row):
    prompt = prompt_tokens(tokenizer, [{'role': 'system', 'content': PROMPT}, {'role': 'user', 'content': row['requirement']}])
    answer = tokenizer.encode(json.dumps(row['expected']), add_special_tokens=False) + [tokenizer.eos_token_id]
    tokens = prompt + answer
    if len(tokens) > 2048:
        raise ValueError(f"Training row {row['id']} exceeds token cap; truncation is forbidden")
    return tokens[:-1], tokens[1:], [0.0] * (len(prompt) - 1) + [1.0] * len(answer)
