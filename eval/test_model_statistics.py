"""Focused tests for descriptive inference and immutable cohort validation."""
import copy
import importlib.util
import json
import unittest
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('summary_script', ROOT / 'scripts/summarize-model-experiment.py')
summary = importlib.util.module_from_spec(spec)
spec.loader.exec_module(summary)


class StatisticsTests(unittest.TestCase):
    def test_exact_mcnemar_uses_only_discordant_pairs(self):
        result = summary.paired_comparison([True, True, False, True], [True, False, True, True])
        self.assertEqual(result['candidateWins'], 1)
        self.assertEqual(result['candidateLosses'], 1)
        self.assertEqual(result['exactMcNemarPValue'], 1)
        self.assertEqual(summary.paired_comparison([False] * 6, [True] * 6)['exactMcNemarPValue'], 0.03125)
        self.assertEqual(summary.paired_comparison([False, False], [False, False])['exactMcNemarPValue'], 1)

    def test_paired_difference_preserves_regressions(self):
        result = summary.paired_comparison([True, True, False], [False, False, True])
        self.assertAlmostEqual(result['difference'], -1/3)
        self.assertEqual((result['candidateWins'], result['candidateLosses']), (1, 2))
        with self.assertRaises(ValueError):
            summary.paired_comparison([True], [])

    def test_no_execution_is_not_zero_risk(self):
        self.assertIsNone(summary.proportion(0, 0)['rate'])
        self.assertIsNone(summary.proportion(0, 0)['wilson95'])
        interval = summary.wilson_interval(0, 19)
        self.assertAlmostEqual(interval[0], 0)
        self.assertGreater(interval[1], 0.16)
        self.assertLess(interval[1], 0.18)

    def test_wilson_interval_all_successes_still_has_uncertainty(self):
        low, high = summary.wilson_interval(24, 24)
        self.assertAlmostEqual(high, 1)
        self.assertGreater(low, 0.85)
        self.assertLess(low, 0.87)

    def test_cohort_validation_rejects_partial_or_mismatched_runs(self):
        manifest = json.loads((ROOT / 'eval/pilot.manifest.json').read_text())
        base = {key: manifest[key] for key in ('model', 'datasetSha256', 'promptSha256', 'renderer', 'benchmarkMode', 'experimentId', 'reviewProvenance', 'sampling')}
        base.update(schemaVersion=2, operation='evaluation', status='completed', configuration='zero-shot', manifestSha256='frozen', heldoutIds=manifest['heldoutIds'], fewShotIds=[], measurements=[{'id': row_id} for row_id in manifest['heldoutIds']])
        summary.validate_run(base, 'zero-shot', manifest, 'frozen')
        for field, value in [('status', 'running'), ('manifestSha256', 'other'), ('heldoutIds', manifest['heldoutIds'][:-1]), ('measurements', base['measurements'][:-1]), ('reviewProvenance', {'humanValidated': 96}), ('fewShotIds', manifest['fewShotIds'])]:
            changed = copy.deepcopy(base); changed[field] = value
            with self.assertRaises(ValueError):
                summary.validate_run(changed, 'zero-shot', manifest, 'frozen')

    def test_cost_is_decimal_and_not_billing_claim(self):
        self.assertEqual(summary.dollars({'training': 1_000_000, 'input': 1_000_000, 'output': 1_000_000}), '2.072')


if __name__ == '__main__':
    unittest.main()
