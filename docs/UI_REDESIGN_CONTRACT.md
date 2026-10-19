# Console presentation redesign

## Scope and invariants

Redesign the React console and align the separate offline Streamlit dashboard. Preserve every route, API payload, controlled input, confirmation gate, source/provenance marker, and existing business operation. No backend, strategy, policy, experiment, or data changes. Do not activate provider execution.

## Design contract

- Audience: developers and operators evaluating an LLM gateway.
- Main job: inspect a request's proposed or recorded route and its cost/evidence boundaries.
- Palette: circuit paper `#F3F6FB`, white `#FFFFFF`, navigation ink `#102238`, cobalt `#245DE8`, telemetry teal `#087F8C`, steel border `#D9E3ED`. Preserve distinct success, warning, danger, and Mock semantics.
- Type: Bahnschrift/Aptos Display for restrained headings; Aptos/Segoe UI with CJK system fallbacks for UI; Consolas/monospace for identifiers and exact costs. No remote font dependency.
- Layout: compact collapsible navigation, one aligned utility bar, a consistent content grid, progressive disclosure for technical fields, accessible drawers and tables.
- Signature: a deterministic routing topology. Proposed routes never look like executed traffic. Recorded replay is bounded, user-started, pausable, and explicitly labelled.
- Motion: Motion layout/detail transitions and React Flow paths. No perpetual invented traffic. Reduced-motion and textual alternatives are mandatory.
- Language: English default, persistent Chinese and Japanese choices. Translate presentation strings, never prompts, model answers, raw JSON, IDs, option values, or request payloads.
- Theme: light and dark choices, persisted locally, with semantic tokens across all existing pages.

## Work packets

| Packet | Owner | Files | Dependencies | Checks |
| --- | --- | --- | --- | --- |
| P0 foundations | Main | locale foundation, source-localisation tooling, package/lock | Read-only audits | scope/coverage, no raw-data rewriting |
| P1 shell/theme | Main | App shell, global theme/tokens, main entry, shared presentation helpers | P0 | route parity, responsive layout, state preservation |
| P2 resources A | Translation worker A | catalog-a resource only | P0 inventory | English/Chinese/Japanese key parity |
| P3 resources B | Translation worker B | catalog-b resource only | P0 inventory | English/Chinese/Japanese key parity |
| P4 routing topology | Graph worker | graph components/builders/tests; Gateway insertion | P0 API contract | proposed/recorded honesty, controls, no dispatch |
| P5 integration | Main + subsequent independent packets | remaining resource/sharing, test adaptations, docs | P1–P4 | full UI suite, backend regression, browser/locale/theme checks |

No owner edits another packet's files concurrently. Source localisation is a mechanical, reviewed presentation-only rewrite, not a runtime DOM translation mechanism. Existing Chinese regression tests explicitly choose Chinese; new tests verify the English default and all language choices.
