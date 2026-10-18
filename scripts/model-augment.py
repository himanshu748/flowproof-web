#!/usr/bin/env python3
"""Freeze a train-only synthetic follow-up; never print or use heldout wording."""
import argparse
import hashlib
import json
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'eval'))
from model_common import ROOT, create_manifest, read_manifest, now, sha256_file, write_json

# Written from the public assertion contract and training-side examples only.
# Aggregate historic failure counts motivated the category, not heldout wording.
IMAGE_REQUIREMENTS = [
    'On the homepage, product photographs need an alt attribute containing some text.',
    'Check that content images on the home page do not have missing or blank alt text.',
    'Homepage editorial pictures must expose a nonblank text alternative.',
    'Every informative homepage picture needs text in its alt attribute; ignore explicitly decorative images.',
    'For homepage images that convey content, verify only the presence of alternative text.',
    'Ensure nondecorative homepage graphics have an alt value that is not whitespace.',
    'The homepage image check should detect content photographs whose alt attributes are empty.',
    'Check for missing alternative text on meaningful images on the landing page.',
    'Homepage illustrations used as content must have nonempty alt attributes.',
    'Flag any homepage content image without a text alternative; visual description quality is outside this check.',
    'Verify nonblank alternative text exists for the homepage content pictures.',
    'On the home page, require text alternatives for nondecorative graphics.',
    'All informative images on the homepage need nonempty alternative text, without judging its wording.',
    'A content photograph on the homepage must not have an absent alt attribute.',
    'Homepage content pictures should provide text through their alt attribute.',
    'Confirm that homepage images not explicitly marked decorative have nonblank alt values.',
    'Detect blank alt attributes on informational homepage images.',
    'Only check whether meaningful homepage pictures contain alternative text; do not rate the descriptions.',
    'Require an existing, nonempty alt value for each content image on the homepage.',
    'Audit homepage image alternatives for presence rather than descriptive accuracy.',
    'For the home page, assert that content images have text alternatives, excluding decorative images.',
    'The homepage should have no informative photographs with missing alternative text.',
    'Nondecorative homepage illustrations must supply an alt attribute with a nonblank value.',
    'Verify presence of alternative text on homepage content imagery; a person reviews usefulness separately.',
]
MANUAL_REQUIREMENTS = [
    'Confirm each homepage alt description accurately captures the meaning of its photograph.',
    'Decide whether the homepage image descriptions are useful to a screen-reader user.',
    'All homepage image descriptions must be beautifully written.',
    'Check that every homepage alt attribute contains exactly twelve words.',
    'The homepage photograph must have the exact alternative description "Team at a kiln".',
    'Submit the inquiry form and confirm the recipient receives the message.',
    'Sign in to the dashboard and check the private invoice.',
    'Remove the archived customer record from the account.',
    'The homepage should look confident and approachable.',
    'Ensure the homepage is free of sideways scrolling on a 768px viewport.',
    'The homepage background must use the exact color #336699.',
    'Confirm the homepage banner disappears after three seconds.',
]
SUPPORTED_REQUIREMENTS = [
    ('heading', 'On the homepage, a visible heading must read "Kiln Collective".', 'Kiln Collective'),
    ('heading', 'Verify a homepage heading with the wording "Make room for craft".', 'Make room for craft'),
    ('heading', 'The homepage needs the heading "Objects for everyday rituals".', 'Objects for everyday rituals'),
    ('link', 'The homepage needs a visible link labelled "Browse ceramics".', 'Browse ceramics'),
    ('link', 'Verify that a homepage link displays "Visit the workshop".', 'Visit the workshop'),
    ('link', 'A link on the homepage must have the visible name "Meet our makers".', 'Meet our makers'),
    ('text_visible', 'The homepage must visibly show "Handmade in small batches".', 'Handmade in small batches'),
    ('text_visible', 'Confirm visitors can read "Workshop visits by appointment" on the homepage.', 'Workshop visits by appointment'),
    ('text_visible', 'Display the literal phrase "Fired with care since 2018" on the homepage.', 'Fired with care since 2018'),
    ('no_horizontal_overflow', 'Check that the homepage does not scroll horizontally at 390px viewport width.', None),
    ('no_horizontal_overflow', 'Keep the homepage document within the horizontal bounds of a 390px mobile viewport.', None),
    ('no_horizontal_overflow', 'The homepage layout must avoid sideways page scrolling when the viewport is 390px wide.', None),
]
EXPECTED = {
    'image_alt': 'Nonempty alternative text on every content image; description quality needs human review',
    'manual': 'A person must review this requirement; no supported deterministic assertion covers it.',
    'no_horizontal_overflow': 'No horizontal scrolling',
}


def additions(reviewed_at):
    rows = []
    specifications = [('image_alt', text, None) for text in IMAGE_REQUIREMENTS]
    specifications += [('manual', text, None) for text in MANUAL_REQUIREMENTS]
    specifications += SUPPORTED_REQUIREMENTS
    for number, (kind, requirement, literal) in enumerate(specifications, 1):
        rationale = ('Checks nonblank alt presence only; semantic quality remains human review.' if kind == 'image_alt' else
                     'No supported deterministic assertion covers the requested quality, action, exact alt, count, styling, timing or viewport.' if kind == 'manual' else
                     'A literal visible assertion or the supported 390px overflow predicate is directly executable; abstaining would be inappropriate.')
        rows.append({
            'id': f'upgrade-train-{number:02d}-{kind}', 'website_id': 'upgrade-train-kiln',
            'requirement_family': f'upgrade-train-{kind}-{number:02d}', 'split': 'train',
            'requirement': requirement,
            'expected': {'checks': [{'requirement': requirement, 'kind': kind, 'path': '/',
                        'expected': literal or EXPECTED[kind], 'viewport': 'mobile' if kind == 'no_horizontal_overflow' else 'desktop'}]},
            'review': {'status': 'approved', 'actorType': 'agent', 'reviewer': 'Codex',
                       'reviewed_at': reviewed_at, 'rationale': rationale},
            'provenance': 'Independently agent-authored synthetic training augmentation from public assertion contract and training examples; no heldout wording used; zero human validation.',
        })
    return rows


def raw_holdout_digest(path, ids):
    # Read only IDs for selection; hash and compare opaque original lines.
    selected = {json.loads(line)['id']: line for line in path.read_bytes().splitlines(keepends=True)
                if json.loads(line)['id'] in ids}
    return hashlib.sha256(b''.join(selected[row_id] for row_id in ids)).hexdigest()


def build(source, dataset, manifest_path):
    if dataset.exists() or manifest_path.exists():
        raise ValueError('Refusing to overwrite a frozen augmentation')
    base = json.loads(source.read_text())
    original = ROOT / base['datasetPath']
    if sha256_file(original) != base['datasetSha256']:
        raise ValueError('Original frozen dataset hash changed')
    rows = additions(now())
    dataset.parent.mkdir(parents=True, exist_ok=True)
    dataset.write_bytes(original.read_bytes() + ''.join(json.dumps(row, ensure_ascii=False) + '\n' for row in rows).encode())
    manifest = create_manifest(dataset, base['benchmarkMode'], manifest_path, 'flowproof-week2-alt-v2')
    for key in ('validationIds', 'heldoutIds', 'fewShotIds', 'sampling', 'training', 'promptSha256', 'model', 'renderer'):
        if manifest[key] != base[key]:
            raise ValueError(f'Follow-up changed frozen comparison property: {key}')
    holdout_hash = raw_holdout_digest(original, base['heldoutIds'])
    if raw_holdout_digest(dataset, base['heldoutIds']) != holdout_hash:
        raise ValueError('Heldout raw lines changed')
    manifest['augmentation'] = {
        'sourceManifestPath': str(source.relative_to(ROOT)), 'sourceManifestSha256': sha256_file(source),
        'sourceDatasetSha256': base['datasetSha256'], 'heldoutRawLinesSha256': holdout_hash,
        'addedTrainIds': [row['id'] for row in rows], 'addedTrainingExamples': len(rows),
        'synthesisInputs': ['public assertion contract', 'training examples', 'historical aggregate category metrics'],
        'heldoutWordingUsedForSynthesis': False,
        'limitation': 'Follow-up selected after observing aggregate benchmark failures. Reusing this holdout is development feedback, not an independent confirmatory test.',
    }
    write_json(manifest_path, manifest)
    read_manifest(manifest_path)
    return {'manifest': str(manifest_path.relative_to(ROOT)), 'trainingExamples': len(manifest['trainIds']),
            'addedTrainingExamples': len(rows), 'heldoutExamples': len(manifest['heldoutIds']),
            'heldoutRawLinesSha256': holdout_hash, 'providerCalls': 0}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-manifest', type=Path, default=ROOT / 'eval/pilot.manifest.json')
    parser.add_argument('--dataset', type=Path, default=ROOT / 'eval/week2-alt-v2.jsonl')
    parser.add_argument('--manifest', type=Path, default=ROOT / 'eval/week2-alt-v2.manifest.json')
    args = parser.parse_args()
    print(json.dumps(build(args.source_manifest.resolve(), args.dataset.resolve(), args.manifest.resolve())))


if __name__ == '__main__':
    main()
