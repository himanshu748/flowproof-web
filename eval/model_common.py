"""Shared, offline-safe helpers for the optional Tinker experiment commands."""
import hashlib
import importlib.util
import json
import os
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODEL = 'Qwen/Qwen3.5-4B'
PROMPT = ('Convert one client website requirement to JSON with exactly a checks array. Each check has exactly requirement (copy the whole input), kind, path, expected, viewport. '
          'Kinds: text_visible, heading, link, image_alt, no_horizontal_overflow, manual. Use path /, viewport desktop or mobile (390px). '
          'For text_visible, heading, link, expected is literal client text. For image_alt expected is "Nonempty alternative text on every content image; description quality needs human review". '
          'For no_horizontal_overflow expected is "No horizontal scrolling". For manual expected is "A person must review this requirement; no supported deterministic assertion covers it." '
          'Use manual for subjective requirements, form submission, purchases, destructive actions, authentication, unknown expected text, unsupported dimensions, CSS styling, timing, counts or unsupported assertions. '
          'No JavaScript, selectors, tool calls or approval flags. Return JSON only.')


def read_dataset(path):
    raw = path.read_bytes()
    rows = [json.loads(line) for line in raw.decode().splitlines() if line.strip()]
    spec = importlib.util.spec_from_file_location('dataset_script', ROOT / 'scripts/model-dataset.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.validate(rows, reviewed=True)
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
    if set(plan) != {'checks'} or not isinstance(plan['checks'], list) or len(plan['checks']) != 1:
        raise ValueError('Expected one check')
    check = plan['checks'][0]
    if set(check) != {'requirement', 'kind', 'path', 'expected', 'viewport'}:
        raise ValueError('Unexpected check fields')
    if check['requirement'] != requirement or check['kind'] not in ('heading', 'link', 'text_visible', 'image_alt', 'no_horizontal_overflow', 'manual'):
        raise ValueError('Wrong original or unsupported kind')
    path = check['path']
    if not isinstance(path, str) or not re.fullmatch(r'/[A-Za-z0-9_/-]*', path) or path.startswith('//') or '..' in path:
        raise ValueError('Unsafe path')
    if not isinstance(check['expected'], str) or len(check['expected']) > 500 or check['viewport'] not in ('desktop', 'mobile'):
        raise ValueError('Invalid expected/viewport')
    return plan


def semantic_match(actual, expected):
    # Automated exact-field agreement, not a claim of human-scored interpretation.
    fields = ['kind', 'path', 'viewport']
    if actual['checks'][0]['kind'] in ('heading', 'link', 'text_visible'):
        fields.append('expected')
    return all(actual['checks'][0][key] == expected['checks'][0][key] for key in fields)
