"""Offline controls; never import a provider SDK or perform provider calls."""
import copy
import datetime as dt
import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from model_common import (ROOT, MODEL, parse_plan, read_dataset, create_manifest,
    read_manifest, reserve_budget, record_budget, verify_training_receipt,
    write_json, now, sha256_file)


def dataset_module():
    spec = importlib.util.spec_from_file_location('dataset', ROOT / 'scripts/model-dataset.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class DatasetControls(unittest.TestCase):
    def test_existing_candidates_remain_unreviewed(self):
        rows = [json.loads(line) for line in (ROOT / 'eval/candidates.jsonl').read_text().splitlines()]
        self.assertEqual(dataset_module().validate(rows)['validated'], 0)
        with self.assertRaises(ValueError):
            read_dataset(ROOT / 'eval/candidates.jsonl')

    def test_agent_review_cannot_be_human_validation(self):
        rows, _ = read_dataset(ROOT / 'eval/pilot.jsonl', 'agent-reviewed-pilot')
        self.assertEqual(len(rows), 96)
        self.assertEqual(dataset_module().validate(rows)['validated'], 0)
        with self.assertRaises(ValueError):
            read_dataset(ROOT / 'eval/pilot.jsonl', 'human-reviewed')
        bad = copy.deepcopy(rows)
        bad[0]['review'].pop('actorType')
        with self.assertRaises(ValueError):
            dataset_module().validate(bad, True, 'agent-reviewed-pilot')

    def test_explicit_review_rationale_and_timestamp_required(self):
        rows, _ = read_dataset(ROOT / 'eval/pilot.jsonl', 'agent-reviewed-pilot')
        for field, invalid in [('rationale', ''), ('reviewed_at', 'yesterday'), ('reviewer', ' '), ('reviewed_at', '2026-10-13')]:
            bad = copy.deepcopy(rows)
            bad[0]['review'][field] = invalid
            with self.assertRaises(ValueError):
                dataset_module().validate(bad, True, 'agent-reviewed-pilot')

    def test_schema_rejects_nonexecutables_and_unsafe_fields(self):
        plan = {'checks': [{'requirement': 'Show "Hello".', 'kind': 'text_visible', 'path': '/', 'expected': 'Hello', 'viewport': 'desktop'}]}
        self.assertEqual(parse_plan(json.dumps(plan), 'Show "Hello".'), plan)
        for field, invalid in [('expected', '  '), ('path', '/..'), ('path', '/' + 'a' * 300), ('viewport', 'tablet'), ('approved', True)]:
            bad = copy.deepcopy(plan)
            bad['checks'][0][field] = invalid
            with self.assertRaises(ValueError):
                parse_plan(json.dumps(bad), 'Show "Hello".')
        for invalid in [None, [], {'checks': [None]}]:
            with self.assertRaises(ValueError):
                parse_plan(json.dumps(invalid), 'Show "Hello".')

    def test_manifest_freezes_all_holdout_ids_and_provenance(self):
        with tempfile.TemporaryDirectory(dir=ROOT / 'eval') as folder:
            path = Path(folder) / 'manifest.json'
            manifest = create_manifest(ROOT / 'eval/pilot.jsonl', 'agent-reviewed-pilot', path, 'test')
            self.assertEqual(len(read_manifest(path)[0]['heldoutIds']), 24)
            for field, invalid in [('heldoutIds', manifest['heldoutIds'][:-1]), ('fewShotIds', manifest['heldoutIds'][:6]), ('model', 'other/model'), ('promptSha256', '0' * 64), ('reviewProvenance', {'humanValidated': 96, 'agentReviewed': 0})]:
                bad = copy.deepcopy(manifest); bad[field] = invalid
                write_json(path, bad)
                with self.assertRaises(ValueError):
                    read_manifest(path)

    def test_website_or_family_leakage_is_rejected(self):
        rows, _ = read_dataset(ROOT / 'eval/pilot.jsonl', 'agent-reviewed-pilot')
        for field in ('website_id', 'requirement_family'):
            bad = copy.deepcopy(rows)
            bad[-1][field] = bad[0][field]
            with self.assertRaises(ValueError):
                dataset_module().validate(bad, True, 'agent-reviewed-pilot')

    def test_checkpoint_is_linked_to_completed_training(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'training.json'
            base = {'schemaVersion': 2, 'operation': 'training', 'status': 'completed', 'manifestSha256': 'abc', 'model': MODEL, 'samplerPath': 'tinker://actual', 'recordedAt': now(), 'completedAt': now(), 'checkpointTtlSeconds': 86400}
            write_json(path, base)
            self.assertEqual(verify_training_receipt(path, 'abc', 'tinker://actual'), sha256_file(path))
            for field, invalid in [('status', 'failed'), ('manifestSha256', 'other'), ('samplerPath', 'tinker://other'), ('recordedAt', '2000-01-01T00:00:00+00:00'), ('checkpointTtlSeconds', 0)]:
                bad = copy.deepcopy(base); bad[field] = invalid
                write_json(path, bad)
                with self.assertRaises(ValueError):
                    verify_training_receipt(path, 'abc', 'tinker://actual')


class BudgetControls(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.path = Path(self.folder.name) / 'ledger.json'
        self.ledger = {'schemaVersion': 1, 'currency': 'USD', 'model': MODEL, 'maxTokens': 100, 'maxCostUsd': '1', 'usdPerMillionTokens': {'training': '1', 'input': '1', 'output': '1'}, 'operationOverheadUsd': '0', 'freeAllowanceConfirmation': {'source': 'unit-test fixture; not real credit evidence', 'checkedAt': now(), 'expiresAt': (dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=1)).isoformat(), 'remainingFreeUsd': '1', 'overageDisabled': True}, 'reservations': []}
        write_json(self.path, self.ledger)

    def tearDown(self):
        self.folder.cleanup()

    def test_all_configurations_share_one_nonrefundable_upper_bound(self):
        first = reserve_budget(self.path, 'zero-shot', 'pilot', {'input': 10, 'output': 40})
        record_budget(self.path, first['id'], 'failed', {'input': 0, 'output': 0})
        reserve_budget(self.path, 'training', 'pilot', {'training': 50})
        with self.assertRaisesRegex(ValueError, 'Aggregate'):
            reserve_budget(self.path, 'fine-tuned', 'pilot', {'input': 1})
        ledger = json.loads(self.path.read_text())
        self.assertEqual(sum(item['reservedTokens'] for item in ledger['reservations']), 100)
        self.assertEqual(ledger['reservations'][0]['status'], 'failed')

    def test_cost_cap_independent_of_token_cap(self):
        self.ledger['usdPerMillionTokens']['input'] = '1000000'
        write_json(self.path, self.ledger)
        with self.assertRaisesRegex(ValueError, 'Aggregate'):
            reserve_budget(self.path, 'zero-shot', 'pilot', {'input': 1})
        self.assertEqual(json.loads(self.path.read_text())['reservations'], [])

    def test_exactly_one_training_reservation_even_after_failure(self):
        first = reserve_budget(self.path, 'training', 'one-lora', {'training': 1})
        record_budget(self.path, first['id'], 'failed', {'training': 0})
        with self.assertRaisesRegex(ValueError, 'one training run'):
            reserve_budget(self.path, 'training', 'one-lora', {'training': 1})
        self.assertEqual(len(json.loads(self.path.read_text())['reservations']), 1)

    def test_no_paid_overage_or_expired_confirmation(self):
        for field, invalid in [('overageDisabled', False), ('expiresAt', '2000-01-01T00:00:00+00:00'), ('checkedAt', '2000-01-01T00:00:00+00:00'), ('source', '')]:
            bad = copy.deepcopy(self.ledger)
            bad['freeAllowanceConfirmation'][field] = invalid
            write_json(self.path, bad)
            with self.assertRaises(ValueError):
                reserve_budget(self.path, 'zero-shot', 'pilot', {'input': 1})

    def test_negative_or_nonfinite_costs_rejected(self):
        for value in ['-1', 'NaN', 'Infinity']:
            bad = copy.deepcopy(self.ledger)
            bad['usdPerMillionTokens']['input'] = value
            write_json(self.path, bad)
            with self.assertRaises(ValueError):
                reserve_budget(self.path, 'zero-shot', 'pilot', {'input': 1})


if __name__ == '__main__':
    unittest.main()
