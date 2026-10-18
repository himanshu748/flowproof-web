"""Offline checks for frozen holdout integrity and honest per-handoff denominators."""
import copy
import importlib.util
import json
import unittest
from pathlib import Path
from model_common import ROOT, read_manifest, sha256_file


def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'scripts' / filename)
    loaded = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(loaded)
    return loaded


augment = module('augment', 'model-augment.py')
followup = module('followup', 'summarize-model-followup.py')


class FrozenFollowup(unittest.TestCase):
    def test_augmentation_retains_raw_original_and_exact_comparison_contract(self):
        original_path = ROOT / 'eval/pilot.manifest.json'
        original, _, _ = read_manifest(original_path)
        candidate, rows, _ = read_manifest(ROOT / 'eval/week2-alt-v2.manifest.json')
        for field in ('heldoutIds', 'validationIds', 'fewShotIds', 'promptSha256', 'model', 'renderer', 'training', 'sampling'):
            self.assertEqual(candidate[field], original[field])
        self.assertEqual(candidate['augmentation']['sourceManifestSha256'], sha256_file(original_path))
        self.assertTrue((ROOT / candidate['datasetPath']).read_bytes().startswith((ROOT / original['datasetPath']).read_bytes()))
        self.assertEqual(augment.raw_holdout_digest(ROOT / candidate['datasetPath'], candidate['heldoutIds']), candidate['augmentation']['heldoutRawLinesSha256'])
        added = [row for row in rows if row['id'] in candidate['augmentation']['addedTrainIds']]
        self.assertEqual(len(added), 48)
        self.assertTrue(all(row['split'] == 'train' and row['review']['actorType'] == 'agent' for row in added))
        self.assertEqual(sum(row['expected']['checks'][0]['kind'] == 'image_alt' for row in added), 24)

    def test_no_synthetic_training_requirement_duplicates_a_reserved_row(self):
        candidate, rows, _ = read_manifest(ROOT / 'eval/week2-alt-v2.manifest.json')
        reserved = {row['requirement'] for row in rows if row['split'] != 'train'}
        additions = [row for row in rows if row['id'] in candidate['augmentation']['addedTrainIds']]
        self.assertFalse(any(row['requirement'] in reserved for row in additions))

    def test_handoff_requires_reference_agreement_and_browser_success(self):
        metrics = {'outcomes': [
            {'referenceKind': 'manual', 'referenceMatch': True},
            {'referenceKind': 'heading', 'referenceMatch': True},
            {'referenceKind': 'image_alt', 'referenceMatch': False},
            {'referenceKind': 'link', 'referenceMatch': True},
        ], 'browser': {'pairedOutcomes': [True, True, False]}, 'observedTokenCostEstimateUsd': '0.12'}
        result = followup.conditional_handoff_cost(metrics, '0.03', '0.01')
        self.assertEqual(result['successfulHandoffs'], 1)
        self.assertEqual(result['referenceExecutableCases'], 3)
        self.assertEqual(result['inferenceEstimateUsdPerSuccessfulHandoff'], '0.12')
        self.assertEqual(result['includingTrainingAndStorageEstimateUsdPerSuccessfulHandoff'], '0.16')
        self.assertIsNone(result['actualProviderBilledUsdPerSuccessfulHandoff'])
        bad = copy.deepcopy(metrics)
        bad['browser']['pairedOutcomes'] = []
        with self.assertRaises(ValueError):
            followup.conditional_handoff_cost(bad)

    def test_zero_successes_do_not_claim_zero_actual_cost(self):
        metrics = {'outcomes': [{'referenceKind': 'image_alt', 'referenceMatch': False}],
                   'browser': {'pairedOutcomes': [False]}, 'observedTokenCostEstimateUsd': '0.1'}
        result = followup.conditional_handoff_cost(metrics)
        self.assertIsNone(result['inferenceEstimateUsdPerSuccessfulHandoff'])
        self.assertIsNone(result['actualProviderBilledUsdPerSuccessfulHandoff'])


if __name__ == '__main__':
    unittest.main()
