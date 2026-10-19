# Week 5: Error Handling, Bounded Fallback, and Decision Evidence

This closes the gap the Week 4 MVP left open: `execution_engine.py` /
`retry_policy.py` existed as an isolated offline demo, never wired into
`Scheduler.route()`, and `decision["fallback_executed"]` was hardcoded
`False`. Week 5 connects them, without weakening any real-execution safety
gate — `real_execute` remains unconditionally blocked, and
`network_access_enabled` / `real_api_adapter_enabled` /
`real_execution_enabled` remain hard-blocked in `ExecutionGuard.check()`
regardless of the attempt/fallback configuration (see
`src/execution_guard.py`).

## What changed

1. **Unified 17-category error taxonomy** — `data/error_taxonomy_runtime_v1.json`
   is now the single source both the Console (`classify()`) and the
   Scheduler's fallback policy read from. See
   `docs/ERROR_TAXONOMY_UNIFICATION.md` for the full crosswalk against the
   Week 2 measurement taxonomy, which is untouched.
2. **Bounded fallback in `mock_execute`** — `Scheduler.route()` now tries the
   recommended candidate, and on a `fallback_allowed` error advances through
   `fallback_order`, up to `config/scheduler_runtime_v1.json`'s
   `max_attempts` (2, matching the base-tier spec of "不超过2次"). All
   attempts stay Mock; `network_called` is `False` on every attempt, enforced
   by `ExecutionEngine.execute()` raising if an executor ever reports
   `network_called=True`.
3. **`fallback_trace` is now real** — `bug_report()` looks up the supplied
   `decision_id` in the Scheduler's runtime decision log
   (`output/scheduler_decision_logs_v1.jsonl`) and returns the actual
   `fallback_trace`, never a fabricated one. A missing or unlinked
   `decision_id` yields an honest `fallback_evidence_status`
   (`no_decision_id_provided` / `decision_id_not_found_in_runtime_log`)
   instead of an empty list masquerading as "no fallback happened".

## Attempt-level log schema

Each `mock_execute` decision now carries an `attempts` array — the
per-single-attempt record the spec asked for. It is embedded in the decision
log entry (keyed by `decision_id`, queryable via
`DecisionLogger.find_by_decision_id` / `find_by_request_id`) rather than a
separate file, so a single query reconstructs the full attempt-by-attempt
story of one decision:

| Field | Meaning |
|---|---|
| `attempt_number` | 1-indexed position in this decision's attempt sequence |
| `candidate_id` | Which candidate this attempt targeted |
| `channel_id` | The candidate's channel, for cross-referencing with health/mapping views |
| `result` | `"success"` or `"failed"` |
| `error_category` | One of the 17 canonical runtime categories, or `null` on success |
| `is_mock` | Always `true` in Runtime v1 |
| `network_called` | Always `false`; enforced, not just claimed |
| `latency_ms` | Simulated latency reported by the Mock adapter for this candidate |
| `adapter_status` | Raw Mock adapter status string (`success`, `timeout`, `rate_limited`, `authentication_failed`, `upstream_error`, `invalid_response`) |

The decision itself gains three companion fields: `fallback_executed`
(`true` iff more than one attempt occurred), `fallback_trace` (ordered list
of `candidate_id`s actually attempted), and `stopped_reason`
(`"success"`, `"non_retryable_error_or_attempt_limit"`, or
`"candidate_order_exhausted"`).

## Querying a decision's fallback story

```python
from decision_logger import DecisionLogger
logger = DecisionLogger("output/scheduler_decision_logs_v1.jsonl")
decision = logger.find_by_decision_id("RUNTIME-...")
decision["attempts"]          # per-attempt schema above
decision["fallback_trace"]    # e.g. ["MOCK-DS-FAST", "MOCK-DS-BACKUP"]
decision["stopped_reason"]    # why the loop stopped
```

`find_by_request_id` returns every decision for a request across retries of
the CLI/demo, for the same correlation use case.

## Safety invariant that changed, and what did not

Before Week 5, `ExecutionGuard.check()` treated *any* `max_attempts != 1` or
`fallback_enabled` as unsafe and blocked the request outright — conflating
"more than one attempt" with "network risk". Week 5 separates the two:

- **Still unconditionally blocked, independent of attempts/fallback:**
  `network_access_enabled`, `real_api_adapter_enabled`,
  `real_execution_enabled` must all be `False`, or the guard returns
  `network_access_must_remain_disabled`. `real_execute` mode is blocked
  before any other check runs.
- **Now explicitly bounded rather than forbidden:** `max_attempts` must be an
  integer in `[1, MAX_SAFE_ATTEMPTS]` (`MAX_SAFE_ATTEMPTS = 2`, a code
  constant — raising it requires a code change and review, not a config
  edit). `fallback_enabled=True` requires `max_attempts >= 2`;
  `fallback_enabled=False` requires `max_attempts == 1`. Any other
  combination fails closed as `unsafe_attempt_configuration`.

See `tests/test_execution_guard.py` for the tests that pin these invariants
down, including `test_unsafe_config_cannot_reenable_network_regardless_of_attempts`.

## What Week 5 explicitly does not do

- No same-channel retry (only cross-candidate fallback exists).
- No real network adapter, no real execution path — `mock_execute` remains
  the only mode that ever calls `adapter.send()`, and it is always Mock.
- No automatic circuit breaking / health-based exclusion beyond what the
  existing candidate eligibility already provides.
- Does not touch the Week 2 measurement taxonomy or any protected evidence
  file (`data/request_records.csv`, `data/metrics_snapshot_v1.csv`, etc.).

## Tests

- `tests/test_error_taxonomy.py` — taxonomy file contract and validation.
- `tests/test_routing_quality_console_services.py` — all 17 categories
  independently reachable via `classify()`, the user-vs-upstream 401
  boundary, taxonomy/`ERRORS` consistency, and `bug_report()`'s real
  `fallback_trace` wiring (including the "unlinked decision_id" and "no
  decision_id" honest-failure cases).
- `tests/test_scheduler_runtime.py` — fallback to a second candidate on a
  `fallback_allowed` error, immediate stop on a non-fallback-allowed error,
  bounded-by-`max_attempts` behavior, and that the fallback policy is
  provably derived from (not duplicated from) the canonical taxonomy.
- `tests/test_execution_guard.py` — the safety invariants above.
