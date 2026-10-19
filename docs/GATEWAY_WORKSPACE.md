# Gateway workspace

Open `http://127.0.0.1:5174/gateway` after starting the local console. The workspace connects documented provider offers, observed request evidence, project budgets and controlled execution in one interface. It uses the existing tenant/workspace identity and permissions.

The five tabs are **Compare & route**, **Usage**, **Identity & recovery**, **Alerts & replay**, and **Access policies**. Empty history is displayed as empty history. Comparing offers never creates a measurement or a bill.

## What is implemented

| Feature | Behaviour and evidence boundary |
| --- | --- |
| Request cost and budgets | Input, cached-input and maximum-output token costs; quote range; UTC daily/monthly project limits; atomic reservations; budget rejection and cheaper eligible alternatives. Execution reserves an uncached upper estimate because a cache hit is not guaranteed. Currency balances remain separate. |
| Provider comparison | Exact model offers, source links, price-check dates, observed success/P95/TTFT, sample counts and eligibility reasons. Objectives: balanced, lowest cost, lowest observed latency, highest observed reliability. Manual selection passes the same eligibility checks. |
| Model identity | Requested model, documented provider alias, returned model, billed model, verification status and time. Only explicit approved identifiers match; unknown response/billing fields stay unknown. A matching provider self-report does not prove the model weights or establish an invoice. |
| Controlled recovery | Ordered primary/backup attempts, circuit skips, maximum two dispatched attempts in the API path, final channel, stop reason and full fallback trace. Retry requires a transient failure, no emitted output and explicit evidence that the attempt was not charged. |
| Cost and usage | UTC day/week/month views and grouping by model, final channel, project or user. Exact decimal currency totals, estimates versus settled bills, missing-bill coverage and unresolved charges. Final-channel request attribution may include fallback costs; it is not an attempt-level invoice allocation. |
| SLA and anomaly alerts | Observed success/P95 thresholds, P95 change against a preceding window, model mismatch, retired/unavailable offers, comparable documented price changes, and project budget warnings. Alerts appear in the application; no email, message or external notification is sent. |
| Historical replay | Re-rank stored request profiles with an alternative objective or excluded channels. Only observations available before the historical request inform the comparison. Costs are explicitly current-documented-price estimates, not reconstructed historic bills or proven savings. Unexecuted outcomes remain unknown. |
| Capability and privacy controls | Account-level streaming/tool support, context limits, storage regions, retention, training use, sensitive-task approval and evidence references. Unknown values cannot satisfy strict requirements. Compliance labels are recorded evidence labels, not independently certified claims. |

## Data and policy

The workspace reads `data/model_channel_mapping_v1.json` and `data/model_cost_catalog_v1.json`. Prices are source-linked local documentation snapshots. They are not polled from providers in real time, and stale/unavailable quotes cannot silently remain eligible. Provider/account activation and measured uptime are distinct from published availability.

`config/provider_access_policy_v1.json` starts account capabilities and privacy terms as pending confirmation. An authorised operator can save an evidenced account review in **Access policies**. A reviewed policy is tenant/workspace scoped and does not alter the published market catalog. A strict UK/EU, no-training, context, streaming or sensitive-task requirement blocks an offer when the corresponding evidence is missing or inadequate.

Observed performance uses real, completed request/attempt records for the exact model. The default window is 24 hours with at least five samples. Failed primary attempts remain visible when a backup succeeds. Mock, injected, future and unexecuted evidence is excluded. A lack of data is not a zero success rate or perfect reliability. Historical evidence with legacy channel/model IDs is not silently relabelled to a current provider offer.

`config/gateway_insights_policy_v1.json` configures the minimum sample count, rolling window, success/P95 limits, relative P95/price thresholds, budget remaining threshold and alert fingerprints/cooldown metadata. Alerts report active conditions when inspected; the application does not run an outbound reminder service. Price-change alerts require a previously observed comparable catalog snapshot, including matching model, channel, currency, billing unit and applicable tier. The initial snapshot has no invented price-change history.

The integrated budget warning concerns the `default` project's USD monthly budget. It is not a provider account credit balance or call quota. The insights service can analyse explicitly supplied observed quota records, but no provider quota is fetched automatically.

## Run

Follow the install instructions in the [README](../README.md), then run from the repository root:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/start-local.ps1 -RebuildFrontend -OpenBrowser
```

Visit `/gateway` in the local console. Choose a concrete model, request size and preference, then select **Compare providers**. Use the project field and budget editor for per-project limits. Existing authentication, workspace boundaries and role permissions also apply to these endpoints.

## Optional execution

Comparison and analytics work with the default execution configuration. `config/gateway_execution_policy_v1.json` ships with `real_execution_enabled=false`, `network_access_enabled=false` and an empty `enabled_channels` list.

For an operator-reviewed deployment, execution requires all of the following:

1. Both execution/network policy flags enabled and the exact channel ID added to `enabled_channels`.
2. The provider credential supplied through the environment variable named in `credential_environment_variables`; Alibaba workspace URLs also require `DASHSCOPE_WORKSPACE_ID`.
3. An eligible, fresh quote; sufficient project budget; required account/capability evidence; and `scheduler.execute` permission.
4. A text request within the adapter limits and per-request `explicit_confirmation=true`. The UI exposes this as a separate authorisation checkbox after comparison.

The current transport handles non-streaming text, using Anthropic Messages or the reviewed OpenAI-compatible endpoints. Streaming and tool-call execution remain blocked even if comparison has an account capability record. The default maximum output is 4,096 tokens, timeout 30 seconds and response limit 1 MB. Destinations come from the reviewed catalog, and redirects are not followed.

The API uses a conservative UTF-8 byte-based input estimate plus a framing allowance. It is not a model tokenizer or a guaranteed ceiling on the provider's bill. The provider reports observed usage after an actual call. Published token prices exclude taxes, tool fees, cache creation/storage and other provider-specific extras.

Local request IDs deduplicate dispatch within the workspace and are not provider request IDs. This does not guarantee provider billing idempotency. An interrupted, timed-out, charged or otherwise ambiguous attempt stops recovery unless billing is explicitly known to be `not_charged`; an unknown charge retains its budget reservation. A successful response without a confirmed bill is also unsettled. An authorised evidence-backed settlement records the final request cost and releases the corresponding reservation. Unknown partial charges are shown separately from complete settled bills.

Explicit environment safety settings (`OFFLINE_MODE=true` or `ALLOW_REAL_API_CALLS=false`) also veto dispatch, even if the JSON policy is enabled. No live provider inference was performed during implementation or verification. Unit/integration tests use injected transports; enabling the adapter is a separate operator action that can incur provider charges.

An execution left `in_progress` by a process crash is not automatically re-dispatched or settled. Its reservation remains held pending operator investigation; automated stale-execution reconciliation is not implemented in this phase.

## API

All paths below have the `/api/v1/gateway` prefix. Money values and budget limits are decimal strings. Currency totals are never automatically converted.

| Method and path | Purpose | Permission |
| --- | --- | --- |
| `GET /catalog` | Documented models/offers and adapter readiness without exposing keys | `decision.read` |
| `POST /compare` | Quote, rank, explain exclusions and check the project budget | `scheduler.decide` |
| `GET /budget?project_id=default&currency=USD` | Current limits, spend and reservations | `decision.read` |
| `PUT /budget` | Set/remove daily and monthly project limits | `tenant.manage` |
| `PUT /access-policy/{channel_id}` | Save a sourced account capability/privacy review | `tenant.manage` |
| `POST /execute` | Explicitly authorised configured provider execution | `scheduler.execute` |
| `POST /settlements/{request_id}` | Reconcile a confirmed final cost with an evidence reference | `evidence.import` |
| `GET /records?project_id=default` | Scoped execution, identity and recovery history | `decision.read` |
| `GET /analytics?period=month&project_id=default` | Observed usage; period is `day`, `week` or `month` | `decision.read` |
| `GET /alerts` | Current in-app conditions and local price-snapshot comparison | `decision.read` |
| `POST /replay` | Read-only alternative ranking and current-price repricing | `scheduler.decide` |

Example comparison body, which sends no provider request:

```json
{
  "project_id": "default",
  "model_id": "deepseek-v4.1-flash-1017",
  "input_tokens": 10000,
  "output_tokens": 2000,
  "cached_input_tokens": 0,
  "objective": "balanced",
  "manual_channel_id": null,
  "requirements": {
    "stream": false,
    "tool_calling": false,
    "context_tokens": 0,
    "sensitive": false,
    "allowed_regions": [],
    "require_no_training": false
  }
}
```

Replay accepts `objective` (`lowest_cost`, `highest_reliability` or `balanced`), `excluded_channels`, and optional `project_id`, `model_id`, `currency`. Each row explains its selection and price coverage. It never claims that switching an unexecuted channel would have prevented a failure. Request profile estimates and observed token values are identified separately; missing counts do not become fabricated usage.

## Verification

Focused backend checks:

```powershell
python -m pytest tests/test_provider_decision_service.py tests/test_gateway_runtime_service.py tests/test_gateway_insights_service.py tests/test_gateway_workspace_routes.py tests/test_gateway_provider_adapter.py -q
```

Focused UI checks and build:

```powershell
cd web
npm test -- src/pages/GatewayWorkspacePage.test.tsx
npm run build
```

These checks cover eligibility and manual selection, currency isolation, budget reservations and idempotency, unknown billing, recovery order, identity handling, partial-cost coverage, attempt-level SLA samples, deterministic repricing and the main UI states. They use temporary state and injected transports rather than live provider calls.

Some historical repository tests require raw UAT evidence, private logs or experiment artefacts intentionally absent from the public edition. These files are not copied into the release or replaced with invented records to obtain a green result. Run the complete suite separately to see the applicable checkout/environment limitations; focused test results do not certify every historical workflow or provider account.

### Validation on 19 October 2026

- New Gateway tests plus related market-catalog and enterprise authentication/authorisation regression checks: **250 passed** (one upstream Starlette deprecation warning).
- Gateway workspace UI: **16 passed**; production TypeScript/Vite build passed.
- Complete frontend suite: **177 passed, 1 failed**. The remaining failure is the existing local-time/UTC-sensitive fixture in `src/lib/logSyncRange.test.ts:23`.
- Complete historical Python suite snapshot: **1,536 passed, 215 failed, 134 setup errors**. Missing private UAT inputs and excluded experiment/report fixtures account for many failures; this is not an all-green repository result.
- A fresh, isolated local application was checked through the browser: documented quotes, sensitive-task rejection, empty usage and read-only replay. No provider inference was sent.
- SHA-256 checks of `src/strategy_engine.py`, `src/channel_health.py` and `config/strategy_catalog_v2.json` remained unchanged. No experiment dataset was edited.
