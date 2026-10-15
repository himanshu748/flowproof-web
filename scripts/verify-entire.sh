#!/usr/bin/env bash
set -euo pipefail

# A local, single-session proof. No hook installation, login, push or model calls.
python3 - "$@" <<'PY'
import argparse, datetime, hashlib, json, os, re, shutil, subprocess, sys
from pathlib import Path

parser = argparse.ArgumentParser(description="Import exactly one existing Codex session into local Entire checkpoints.")
parser.add_argument('--binary', required=True)
parser.add_argument('--transcript', required=True)
parser.add_argument('--session', required=True)
parser.add_argument('--run', action='store_true', help='Permit the local checkpoint write after a validated dry run')
args = parser.parse_args()
if not args.run:
    print(json.dumps({'status': 'not_run', 'reason': 'Pass --run only for the authorized exact session.'}))
    sys.exit(0)
if not re.fullmatch(r'[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}', args.session):
    raise SystemExit('A complete session UUID is required.')

os.umask(0o077)
root = Path(subprocess.check_output(['git', 'rev-parse', '--show-toplevel'], text=True).strip()).resolve()
binary = Path(args.binary).resolve()
transcript = Path(args.transcript).resolve()
expected_binary = '74c008fe881a3c06600f78afdd978c18864e67a11b10f4d6bbfe21c3f9104f2f'
expected_archive = '6636dd5bf1b2ff9a9c52d4ea1ad936799ada962142f0f5e5c3c8611f3acd347b'
def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''): h.update(chunk)
    return h.hexdigest()
if digest(binary) != expected_binary:
    raise SystemExit('This proof requires the verified v0.11.4 macOS ARM64 executable.')
archive = binary.parent / 'entire_darwin_arm64.tar.gz'
if not archive.is_file() or digest(archive) != expected_archive:
    raise SystemExit('The verified official release archive must be retained beside the executable.')
if args.session not in transcript.name or transcript.suffix != '.jsonl':
    raise SystemExit('The exact rollout filename must identify the authorized session.')

# Read metadata from this file only; never enumerate or open other transcripts.
with transcript.open('rb') as source:
    meta = json.loads(source.readline())
if meta.get('type') != 'session_meta' or meta.get('payload', {}).get('id') != args.session:
    raise SystemExit('The transcript session does not match the exact authorized UUID.')
if Path(meta['payload']['cwd']).resolve() != root:
    raise SystemExit('The transcript does not belong to this repository root.')
if shutil.disk_usage(root).free < 250 * 1024 * 1024:
    raise SystemExit('At least 250 MiB of free workspace disk is required before importing.')

now = lambda: datetime.datetime.now(datetime.timezone.utc).isoformat()
run_id = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
private = root / 'work' / 'entire-proof' / run_id
private.mkdir(parents=True, exist_ok=False)
if subprocess.run(['git', 'check-ignore', '-q', str(private)], cwd=root).returncode != 0:
    raise SystemExit('The private proof directory must be ignored by Git.')
snapshot = private / 'selected-rollout.jsonl'
shutil.copyfile(transcript, snapshot)
snapshot.chmod(0o600)

# Preserve system paths; isolate Entire state and omit inherited provider secrets.
env = {key: value for key, value in os.environ.items() if key in ['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'SHELL']}
env.update({'ENTIRE_TELEMETRY_OPTOUT': '1', 'ENTIRE_NO_AUTO_UPDATE': '1',
            'ENTIRE_CONFIG_DIR': str(private / 'entire-config'), 'GIT_TERMINAL_PROMPT': '0', 'NO_COLOR': '1'})
def git(*arguments):
    return subprocess.check_output(['git', *arguments], cwd=root, env=env, stderr=subprocess.DEVNULL, text=True).strip()
git_dir = Path(git('rev-parse', '--absolute-git-dir'))
def file_hash(path): return digest(path) if path.is_file() else None
def hook_manifest():
    hooks = git_dir / 'hooks'
    records = [(p.name, digest(p)) for p in sorted(hooks.iterdir()) if p.is_file()] if hooks.exists() else []
    return hashlib.sha256(json.dumps(records).encode()).hexdigest()
def invariant():
    return {'head': git('rev-parse', 'HEAD'), 'branch': git('symbolic-ref', '-q', 'HEAD'),
            'gitConfig': file_hash(git_dir / 'config'), 'gitHooks': hook_manifest(),
            'codexHooks': file_hash(root / '.codex' / 'hooks.json')}
before = invariant()
receipt = {'status': 'running', 'startedAt': now(), 'integration': 'Entire', 'scope': 'one local Codex session',
           'toolVersion': '0.11.4', 'archiveSha256': expected_archive, 'binarySha256': expected_binary,
           'sourceRevision': before['head'], 'sourceSnapshotSha256': digest(snapshot),
           'sessionIdentityVerified': True, 'repositoryIdentityVerified': True,
           'checkpointPublished': False, 'hostedVerified': False, 'modelCalls': 0,
           'limits': ['Imported afterward; not live capture.',
                      'Private checkpoint content is withheld; only anonymous execution metadata is published.',
                      'Import may read remote checkpoint ref names for deduplication.',
                      'No hosted Entire account, sharing, semantic search or model-generated summary was used.']}
stage = 'version'
def invoke(label, arguments, timeout=180):
    destination = private / (label + '.stdout')
    errors = private / (label + '.stderr')
    with destination.open('wb') as stdout, errors.open('wb') as stderr:
        result = subprocess.run([str(binary), *arguments], cwd=root, env=env, stdout=stdout, stderr=stderr, timeout=timeout)
    if result.returncode != 0: raise RuntimeError('Entire command failed')
    return destination
def find_values(value, key):
    if isinstance(value, dict):
        if key in value: yield value[key]
        for item in value.values(): yield from find_values(item, key)
    elif isinstance(value, list):
        for item in value: yield from find_values(item, key)

try:
    version = invoke('version', ['version']).read_text()
    if '0.11.4' not in version: raise RuntimeError('Unexpected CLI version')
    command = ['import', 'codex', '--path', str(snapshot), '--session', args.session]
    stage = 'dry_run'
    dry_log = invoke('dry-run', [*command, '--dry-run'])
    dry = re.search(r'Would import (\d+) turn\(s\) from (\d+) session\(s\) \((\d+) already imported\)', dry_log.read_text())
    if not dry or int(dry[2]) != 1 or int(dry[1]) + int(dry[3]) < 1:
        raise RuntimeError('Dry run did not select exactly one nonempty session')
    receipt['dryRun'] = {'sessions': int(dry[2]), 'newTurns': int(dry[1]), 'alreadyImported': int(dry[3])}
    if invariant() != before: raise RuntimeError('Repository identity or hooks changed during dry run')
    stage = 'import'
    actual_log = invoke('import', command, timeout=300)
    actual = re.search(r'Imported (\d+) turn\(s\) from (\d+) session\(s\) \((\d+) already imported\)', actual_log.read_text())
    if not actual or tuple(actual.groups()) != tuple(dry.groups()):
        raise RuntimeError('Import counts did not match the validated dry run')
    receipt['import'] = {'sessions': int(actual[2]), 'newTurns': int(actual[1]), 'alreadyImported': int(actual[3])}
    stage = 'checkpoint_read'
    listed = invoke('checkpoint-list', ['checkpoint', 'list', '--session', args.session, '--json', '--no-pager'])
    listing = json.loads(listed.read_text())
    ids = sorted(set(value for value in find_values(listing, 'checkpoint_id') if isinstance(value, str)))
    if not ids: raise RuntimeError('No imported checkpoints were readable')
    explained = invoke('checkpoint-read', ['checkpoint', 'explain', ids[-1], '--json', '--no-pager'])
    details = json.loads(explained.read_text())
    sessions = set(value for value in find_values(details, 'session_id') if isinstance(value, str))
    if sessions != {args.session}: raise RuntimeError('Checkpoint did not resolve to exactly the selected session')
    receipt['checkpointRead'] = {'listedCount': len(ids), 'selectedSessionMatches': True,
                                 'listSha256': digest(listed), 'metadataSha256': digest(explained)}
    stage = 'unchanged_repository'
    if invariant() != before: raise RuntimeError('HEAD, branch, configuration or hooks changed')
    receipt.update({'status': 'verified_local', 'headUnchanged': True, 'branchUnchanged': True,
                    'gitConfigurationUnchanged': True, 'gitHooksUnchanged': True, 'codexHooksUnchanged': True})
except Exception as error:
    receipt.update({'status': 'blocked', 'failedStage': stage, 'errorClass': type(error).__name__,
                    'reason': 'Local proof did not complete. Inspect only the private run logs before retrying.'})
finally:
    receipt['completedAt'] = now()
    receipt['verifierSha256'] = digest(root / 'scripts' / 'verify-entire.sh')
    (private / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
    public = root / 'docs' / 'evidence' / 'entire-local-receipt.json'
    public.parent.mkdir(parents=True, exist_ok=True)
    public.write_text(json.dumps(receipt, indent=2) + '\n')
    print(json.dumps({'status': receipt['status'], 'failedStage': receipt.get('failedStage'),
                      'receipt': 'docs/evidence/entire-local-receipt.json'}))
    if receipt['status'] != 'verified_local': sys.exit(1)
PY
