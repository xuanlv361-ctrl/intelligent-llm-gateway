# Model market catalog

The catalog contains **six concrete models, eight priced offers, and seven provider organisations**. Sources were checked on **19 October 2026**. These are documented commercial offerings and published list prices, rather than invented model prices or fictitious channel IDs.

- `data/model_channel_mapping_v1.json` records provider model IDs, endpoints, API dialects, source URLs, lifecycle dates, and required account configuration.
- `data/model_cost_catalog_v1.json` records per-offer prices and their context/time conditions. Its model-level prices are reference prices from one named channel; use `channel_prices` when comparing providers.
- `src/model_market_catalog.py` joins these records and calculates request estimates using decimal arithmetic without sending requests.

`channel_id` is an application-local identifier for a provider offer, not an ID issued by the vendor. `provider_model_id` is the documented identifier sent to that provider. The eight offers span seven provider organisations.

## Published token prices

All amounts below are **USD per 1,000,000 tokens** for the indicated Standard offer. Cached input is a subset of total input, not an extra token count. Output counts must include billable reasoning/thinking tokens where applicable.

| Concrete model | Provider | Uncached input | Output | Cached input read | Basis |
| --- | --- | ---: | ---: | ---: | --- |
| `claude-sonnet-5-5` | Anthropic | 2.00 | 10.00 | 0.10 | Global Standard |
| `deepseek-v4.1-flash-1017` | DeepSeek | 0.30 | 1.20 | 0.006 | Conservative peak rate; upstream `deepseek-flash` alias |
| `deepseek-v4.1-flash-1017` | Together AI | 0.30 | 1.20 | 0.006 | `deepseek-ai/DeepSeek-V4.1-Flash-1017` |
| `deepseek-v4.1-flash-1017` | Fireworks AI | 0.30 | 1.20 | 0.006 | `accounts/fireworks/models/deepseek-v4p1-flash-1017`; Standard serverless |
| `gpt-4.1-2025-04-14` | OpenAI | 2.00 | 8.00 | 0.50 | Standard text tokens; sunset 14 January 2027 |
| `gpt-4o-2024-11-20` | OpenAI | 2.50 | 10.00 | 1.25 | Standard text tokens; sunset 14 January 2027 |
| `gemini-3.8-flash` | Google Gemini Developer API | 0.75 | 3.75 | 0.075 | Paid Standard through 31 December 2026 |
| `qwen3.7-plus-2026-05-26` | Alibaba Cloud Model Studio | 0.40 | 1.60 | 0.08 | Singapore / International; input up to 256,000; implicit cache |

These estimates exclude taxes, negotiated account discounts, tools, cache writes/storage, currency conversion, and other separate charges. Zero cached tokens is the default; a cache hit must not be assumed. No unverified GBP or CNY conversion is applied.

### Conditions that change a quote

- **DeepSeek:** the direct endpoint uses rolling alias `deepseek-flash`, documented as resolving to the 1017 checkpoint at verification. Recheck its version before comparing it with the two pinned third-party offers. The published off-peak prices are 0.15 input, 0.60 output, and 0.003 cached input. The configured estimate uses peak prices because execution time and the Chinese holiday calendar are not resolved. Equal prices and checkpoint names do not establish equal serving behaviour or reliability.
- **Gemini:** from **1 January 2027**, the published Standard rates become 1.50 input, 7.50 output, and 0.15 cached input. Cache storage is separately priced at 0.50 per million tokens per hour during 2026, then 1.00 in 2027. The time-based tier is explicit; a future tier does not waive the seven-day freshness check.
- **Qwen:** input above **256,000** through **1,000,000** selects rates of 1.20 input, 4.80 output, and 0.24 implicit cached input. The selected input tier applies to all tokens in the request. These are dated-snapshot Singapore prices; do not substitute mainland-China rates or undated alias promotions. Explicit caching has different charges.
- **Claude:** US-only inference costs 1.1 times the global rate. Five-minute and one-hour cache writes are separately priced at 2.50 and 4.00. Sonnet 5.5 rejects non-default `temperature`, `top_p`, and `top_k`.
- **OpenAI:** GPT-4o and GPT-4.1 are separate models. Offers become `retired` at their configured sunset on **14 January 2027**. Context and modality limits still need validation before execution; this comparator provides a token quote, not a complete request validator.

## Documentation, configuration, and measurements

`provider_documented` means the provider publishes this model and endpoint. It does not mean this installation has credentials, quota, regional eligibility, a configured adapter, or an observed response from that model.

All catalog offers retain `execution_enabled: false`. Qwen's endpoint includes `{WorkspaceId}` and requires a real Singapore workspace and matching regional credentials. Those values are not supplied by this repository. Anthropic uses the Messages dialect; the other listed offers use Chat Completions dialects, with Google's compatibility interface labelled beta. Adding catalog rows does not configure or validate these adapters.

Health starts with `sample_count: 0`, `status: unmeasured`, and null success rate, P95 latency, and TTFT. Unknown values are not converted to fabricated reliability or latency scores. Account-authorised measurements must supply these observations before they can support stability comparisons.

The files are source-verified snapshots, not a real-time polling feed. After **seven days**, comparison returns `stale` and withholds a current cost estimate until the offer and price sources are reverified. Model identity, price, timestamp, and lifecycle status must be checked together.

The existing heuristic router's family preferences have explicit representative bindings: `claude-sonnet` to Sonnet 5.5, `deepseek-reasoner` to V4.1 Flash 1017, `gemini-flash` to Gemini 3.8 Flash, and `qwen` to the dated Qwen3.7 Plus snapshot. `deepseek-reasoner` does not identify DeepSeek R1. The legacy combined preference `gpt-4o-4-1` binds to GPT-4.1 for the existing model router; direct market queries reject that ambiguous name and require GPT-4o or GPT-4.1. Capability scores remain configurable application heuristics, not verified performance measurements.

## Local comparison

For source-backed model selection, the cost component uses the estimated cost of the actual input, cached-input and output token counts. If counts are omitted, the router uses 1,000 input and 500 output tokens as its comparison workload. Unmeasured latency is omitted consistently across all candidates, with the remaining policy weights renormalised and reported. No capability scores or channel health formulas are inferred from public price pages.

```powershell
python src/model_market_catalog.py --model deepseek-v4.1-flash-1017 --input-tokens 10000 --output-tokens 2000
```

At the verified peak/Standard rates, each of the three listed DeepSeek offers estimates **USD 0.0054** for 10,000 uncached input and 2,000 billable output tokens. This equality provides no reliability ranking. The JSON includes each upstream model ID, source links, applicable tier, cost breakdown, quote status, and unknown health fields.

## Official sources

| Provider | Price and model sources | Integration source |
| --- | --- | --- |
| Anthropic | [Sonnet 5.5](https://platform.claude.com/docs/en/models/sonnet-5-5/overview), [pricing](https://platform.claude.com/docs/en/about-claude/pricing) | [Messages API](https://platform.claude.com/docs/en/api/messages/create) |
| DeepSeek | [pricing and current alias](https://api-docs.deepseek.com/quick_start/pricing/), [cache](https://api-docs.deepseek.com/guides/kv_cache/) | [thinking mode](https://api-docs.deepseek.com/guides/thinking_mode/) |
| Together AI | [V4.1 Flash 1017 offer](https://www.together.ai/models/deepseek-v4-1-flash-1017) | [OpenAI compatibility](https://docs.together.ai/docs/inference/openai-compatibility) |
| Fireworks AI | [V4.1 Flash 1017 offer](https://fireworks.ai/models/deepseek-ai/deepseek-v4p1-flash-1017), [serverless pricing](https://docs.fireworks.ai/serverless/pricing) | [OpenAI compatibility](https://docs.fireworks.ai/tools-sdks/openai-compatibility) |
| OpenAI | [GPT-4.1](https://developers.openai.com/api/docs/models/gpt-4.1), [GPT-4o](https://developers.openai.com/api/docs/models/gpt-4o), [deprecations](https://developers.openai.com/api/docs/deprecations) | Model documentation above |
| Google | [Gemini 3.8 Flash](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash), [pricing](https://ai.google.dev/gemini-api/docs/pricing) | [OpenAI compatibility](https://ai.google.dev/gemini-api/docs/openai) |
| Alibaba Cloud | [pricing](https://www.alibabacloud.com/help/en/model-studio/model-pricing), [cache](https://www.alibabacloud.com/help/en/model-studio/context-cache) | [regional workspace endpoints](https://www.alibabacloud.com/help/en/model-studio/compatibility-of-openai-with-dashscope) |

No inference API calls or account-access checks were performed for this catalog update. No model credentials are included. The comparison layer is usable locally; provider execution and measured stability require subsequent configuration and evidence.
