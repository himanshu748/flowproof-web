#!/usr/bin/env python3
"""Create review candidates; never label generated examples as human validated."""
import argparse
import datetime as dt
import hashlib
import json
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPLITS = ['train'] * 12 + ['validation'] * 4 + ['test'] * 4
KINDS = ['heading', 'link', 'text_visible', 'image_alt', 'no_horizontal_overflow', 'manual']
TEMPLATES = {
    'train': {
        'heading': ['The homepage heading must say "{name}".', 'Display the heading "{name}" on the homepage.', 'The main heading must read "{name}".'],
        'link': ['A contact link must say "{name}".', 'Display a link labelled "{name}".', 'The homepage must contain the link "{name}".'],
        'text_visible': ['The homepage must show "{name}".', 'Display the text "{name}" on the homepage.', 'The page must include visible text "{name}".'],
        'image_alt': ['All content images need nonempty alternative text.', 'Every image must have alternative text unless marked decorative.', 'Content photos must include alt text.'],
        'no_horizontal_overflow': ['The homepage must fit a 390px mobile screen without horizontal scrolling.', 'Prevent horizontal overflow on the mobile homepage.', 'At 390px, there must be no horizontal scrolling.'],
        'manual': ['The site must feel trustworthy.', 'Submit the contact form and confirm email delivery.', 'The checkout must complete a purchase.'],
    },
    'validation': {
        'heading': ['Visitors should see a heading that reads "{name}".', 'Use "{name}" as the visible homepage heading.', 'The homepage headline text should be "{name}".'],
        'link': ['A visible anchor should have the label "{name}".', 'Visitors need a link with text "{name}".', 'Use "{name}" for the contact link label.'],
        'text_visible': ['Readers should find "{name}" in the homepage copy.', 'Make "{name}" visible on the homepage.', 'The words "{name}" should appear on the page.'],
        'image_alt': ['All nondecorative pictures need alternative descriptions.', 'Provide nonblank alt attributes for content photographs.', 'Each meaningful image requires an alt attribute with text.'],
        'no_horizontal_overflow': ['Nothing may extend beyond the horizontal page boundary at 390px.', 'At mobile width 390px, the page must not scroll sideways.', 'The mobile homepage should stay within its viewport width.'],
        'manual': ['The layout must communicate luxury.', 'Log in with my password and verify my profile.', 'The background must match the exact brand color.'],
    },
    'test': {
        'heading': ['Acceptance: a heading on the landing page says "{name}".', 'Publish the headline "{name}" on the homepage.', 'Require the visible header wording "{name}".'],
        'link': ['Acceptance: "{name}" is the visible wording of an anchor.', 'Publish a homepage link called "{name}".', 'Require an anchor whose label is "{name}".'],
        'text_visible': ['Acceptance: the phrase "{name}" is readable on the homepage.', 'Publish "{name}" in the visible page content.', 'Require that visitors can read "{name}" on arrival.'],
        'image_alt': ['Acceptance: meaningful photos expose nonempty text alternatives.', 'Require alt descriptions on content illustrations.', 'Publish a text alternative for each nondecorative image.'],
        'no_horizontal_overflow': ['Acceptance: a 390px-wide phone view has no sideways page scroll.', 'Require that homepage content fits horizontally on a 390px screen.', 'The 390px phone layout must stay inside the page width.'],
        'manual': ['The design must impress enterprise clients.', 'Delete the old customer profile.', 'Payment details must be encrypted in the database.'],
    },
}


def generate():
    rows = []
    for site, split in enumerate(SPLITS, 1):
        for kind in KINDS:
            for variant, template in enumerate(TEMPLATES[split][kind]):
                name = {'heading': f'Studio {site:02d}: make your next move', 'link': f'Contact studio {site:02d}', 'text_visible': f'Independent studio {site:02d}, established 2020'}.get(kind, '')
                requirement = template.format(name=name)
                expected = name or {'image_alt': 'Nonempty alternative text on every content image; description quality needs human review', 'no_horizontal_overflow': 'No horizontal scrolling', 'manual': 'A person must review this requirement; no supported deterministic assertion covers it.'}[kind]
                rows.append({'id': f'candidate-{site:02d}-{kind}-{variant}', 'website_id': f'synthetic-studio-{site:02d}', 'requirement_family': f'{split}-{kind}-wording-{variant}', 'split': split, 'requirement': requirement, 'expected': {'checks': [{'requirement': requirement, 'kind': kind, 'path': '/', 'expected': expected, 'viewport': 'mobile' if kind == 'no_horizontal_overflow' else 'desktop'}]}, 'review': {'status': 'unreviewed', 'reviewer': None, 'reviewed_at': None}, 'provenance': 'Programmatically generated synthetic candidate; no human validation.'})
    return rows


def validate(rows, reviewed=False, benchmark_mode='human-reviewed'):
    import sys
    sys.path.insert(0, str(ROOT / 'eval'))
    from model_common import parse_plan
    if benchmark_mode not in ('human-reviewed', 'agent-reviewed-pilot'):
        raise ValueError('Unknown benchmark mode')
    def require(condition, message):
        if not condition:
            raise ValueError(message)
    ids = set(); sites = {}; families = {}; reviews = 0
    for row in rows:
        require(row['id'] not in ids, f"Duplicate id {row['id']}")
        ids.add(row['id'])
        require(row['split'] in ('train', 'validation', 'test'), 'Invalid split')
        for field, seen in [('website_id', sites), ('requirement_family', families)]:
            key = row[field]
            require(seen.get(key, row['split']) == row['split'], f'Leaking {field}: {key}')
            seen[key] = row['split']
        parse_plan(json.dumps(row['expected']), row['requirement'])
        review = row.get('review', {})
        timestamp_valid = False
        try:
            timestamp_valid = dt.datetime.fromisoformat(review.get('reviewed_at', '').replace('Z', '+00:00')).tzinfo is not None
        except (ValueError, AttributeError):
            pass
        actor = review.get('actorType')
        approved = review.get('status') == 'approved' and bool((review.get('reviewer') or '').strip()) and timestamp_valid and actor in ('human', 'agent') and bool((review.get('rationale') or '').strip())
        human_approved = approved and actor == 'human'
        reviews += bool(human_approved)
        if reviewed:
            expected_actor = 'human' if benchmark_mode == 'human-reviewed' else 'agent'
            require(approved and actor == expected_actor, f"{row['id']} lacks explicit {expected_actor} review; refuse {benchmark_mode} model work")
    return {'candidates': len(rows), 'validated': reviews, 'splits': dict(Counter(row['split'] for row in rows)), 'websiteGroups': len(sites), 'requirementFamilies': len(families), 'splitPolicy': 'Disjoint website_id and wording-family groups; six assertion kinds occur in each split. Synthetic candidates require human review.'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--validate', type=Path, help='Validate an existing JSONL file without regenerating')
    parser.add_argument('--require-reviewed', action='store_true')
    parser.add_argument('--benchmark-mode', choices=['human-reviewed', 'agent-reviewed-pilot'], default='human-reviewed')
    parser.add_argument('--freeze-manifest', type=Path, help='Freeze an existing reviewed --validate dataset and all holdout IDs')
    parser.add_argument('--experiment-id', default='flowproof-pilot-v1')
    parser.add_argument('--max-output-tokens', type=int, default=512)
    parser.add_argument('--output', type=Path, default=ROOT / 'eval/candidates.jsonl')
    args = parser.parse_args()
    if args.validate:
        rows = [json.loads(line) for line in args.validate.read_text().splitlines() if line.strip()]
        if args.freeze_manifest:
            import sys
            sys.path.insert(0, str(ROOT / 'eval'))
            from model_common import create_manifest
            print(json.dumps(create_manifest(args.validate, args.benchmark_mode, args.freeze_manifest, args.experiment_id, args.max_output_tokens), indent=2))
        else:
            print(json.dumps(validate(rows, args.require_reviewed, args.benchmark_mode), indent=2))
        return
    if args.output.exists():
        parser.error('Output already exists. Choose another --output to preserve review work.')
    rows = generate(); summary = validate(rows)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    content = ''.join(json.dumps(row, ensure_ascii=False) + '\n' for row in rows)
    args.output.write_text(content)
    summary['sha256'] = hashlib.sha256(content.encode()).hexdigest()
    args.output.with_suffix('.manifest.json').write_text(json.dumps(summary, indent=2) + '\n')
    print(json.dumps(summary, indent=2))

if __name__ == '__main__':
    main()
