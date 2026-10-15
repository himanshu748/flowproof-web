# Entire development provenance

The local proof imports one existing Codex development session into Entire's checkpoint store. It does not install agent or Git hooks, create an Entire account, upload transcripts, rewrite source commits or invoke a model. The public proof is limited to [anonymous execution metadata](evidence/entire-local-receipt.json); checkpoint content remains private.

**Verified locally on October 15, 2026, at 07:37:54 UTC.** The dry run and actual import each selected exactly one session with 43 turns. All 43 checkpoints were listed successfully, and one checkpoint's metadata resolved to the selected session. HEAD, branch, Git configuration, Git hooks and Codex hooks were unchanged. The earlier attempt was interrupted during its dry run; inspection found no new checkpoint and no remaining process before the successful attempt.

## Why it is useful

Briefstamp's acceptance results deliberately come from approved browser assertions rather than model confidence. Entire can retain the development context behind that decision alongside the code. This proof exercises actual local transcript import and checkpoint retrieval; it does not claim live capture of earlier work, hosted semantic search or a public session link. Imported checkpoints are labeled as imported afterward.

## Reproduce the bounded proof

The verifier is [scripts/verify-entire.sh](../scripts/verify-entire.sh). It accepts one explicit transcript file and one complete session UUID. Before invoking Entire, it checks the file's session identity and repository working directory. It copies only that file to a Git-ignored private directory to keep the dry run and actual import consistent while the live conversation continues.

The pinned [Entire v0.11.4 release](https://github.com/entireio/cli/releases/tag/v0.11.4) is MIT-licensed. This verifier targets its macOS ARM64 executable, extracted locally from the official archive. The [archive](https://github.com/entireio/cli/releases/download/v0.11.4/entire_darwin_arm64.tar.gz) SHA-256 is `6636dd5bf1b2ff9a9c52d4ea1ad936799ada962142f0f5e5c3c8611f3acd347b`; the official release metadata and [checksums file](https://github.com/entireio/cli/releases/download/v0.11.4/checksums.txt) agree. The verifier also pins the extracted executable's digest. It neither downloads nor executes a moving `latest` release.

```sh
# Omit --run to print not_run and perform no import.
scripts/verify-entire.sh \
  --binary work/tools/entire/entire \
  --transcript /absolute/path/to/the-selected-rollout.jsonl \
  --session THE-EXACT-AUTHORIZED-SESSION-UUID \
  --run
```

The tool first runs `entire import codex --dry-run` with both `--path` and `--session`. It proceeds only when exactly one nonempty session is selected. The actual import must match the dry-run counts. It then reads back the imported checkpoint list and one checkpoint's metadata, verifying that the returned session matches. HEAD, branch, Git configuration, Git hooks and Codex hook configuration must remain unchanged.

The official [import command](https://github.com/entireio/cli/blob/v0.11.4/cmd/entire/cli/import_cmd.go) and [Codex importer](https://github.com/entireio/cli/blob/v0.11.4/cmd/entire/cli/agentimport/codex.go) support this exact selection. The importer accepts an exact file as its search root; it does not need the complete session directory. This route requires an existing Git commit but does not require `entire enable`. Import may read remote checkpoint ref names for deduplication. It does not push checkpoint data.

## Privacy and limits

Private source snapshots, CLI output, imported checkpoint records and author metadata are withheld. The retained public receipt contains timestamps, anonymous counts, checksums and verification outcomes, with no prompts, tool results, account addresses or raw session identifiers. The CLI receives an isolated configuration directory and no inherited provider keys; telemetry and auto-update are disabled. No `session attach`, `--generate`, login, hook enablement or checkpoint push command is used.

Entire's [security documentation](https://docs.entire.io/security) describes automatic secret redaction but also its gaps: images and assets are not scanned, and PII protection is optional. Consequently, the raw checkpoint branch must remain local. A future public session export requires separate review of its actual content. A successful local receipt establishes local functionality only; it is not evidence that judges can browse a hosted Entire session.
