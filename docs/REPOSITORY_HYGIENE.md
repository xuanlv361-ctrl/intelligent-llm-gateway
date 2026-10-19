# Repository hygiene

The workspace contains a valid Git repository rooted exactly at
`E:\wy\intelligent_channel_scheduler`. It had no recoverable historical commits,
so the 2026-07-29 closure created one verified initial local baseline rather
than inventing earlier history. No remote is configured and nothing was pushed.

## Protected material

`data/`, `output/`, and `evidence/` contain a mixture of source fixtures,
generated reports, runtime databases, and protected evidence. They are
deliberately not ignored wholesale. Before the first commit:

1. Verify the existing protected SHA-256 manifests without rewriting evidence.
2. Classify every database, report, screenshot, and evidence directory.
3. Copy nothing into source folders merely to make it trackable.
4. Never commit API keys, cookies, browser storage state, authorization headers,
   local `.env` files, SQLite WAL/SHM files, or Playwright login state.
5. Run a current-tree secret scan before staging and a staged/history scan after
   Git is initialized.

The ignore rules cover local secrets, caches, dependencies, build output,
runtime databases, test results, and newly collected browser evidence. An
ignored file is not automatically safe to retain or share.

## CI boundary

CI is mock-only. It disables real execution and runs backend tests, frontend
lint, Vitest, and a production build. CI must never receive a real Weimeta key
or perform model-catalog, completion, console-login, or collector network calls.

## Initial-baseline checklist

- [x] Protected hashes independently verified.
- [x] Current-tree secret scan completed with zero findings.
- [x] Large/generated artifacts classified.
- [x] `.gitignore` and explicit staging allowlist reviewed.
- [x] Runtime databases, browser sessions, raw responses and backups excluded.
- [x] Backend, frontend, lint, build and local Mock E2E passed.
- [x] Initial local commit contents reviewed.
- [ ] Remote destination and access policy approved; no remote is configured.
