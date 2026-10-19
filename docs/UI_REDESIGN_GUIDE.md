# Operator interface guide

## Presentation system

The React console uses a shared circuit-paper design: navy navigation, cobalt route emphasis, quiet surfaces, consistent tables and forms, and distinct success/warning/error/Mock states. All original application routes and business controls remain available. A matching Streamlit theme is supplied in `.streamlit/config.toml`; its existing pages are unchanged.

Use the language selector above the workspace for English, 中文 or 日本語. English is the default when no valid preference exists. Use the adjacent theme button for light/dark. Locale and theme are the only new browser preferences. Switching either does not remount the active route, reset inputs, alter model/strategy IDs, modify request parameters, or dispatch provider calls.

Translation resources are applied at presentation render sites, not through DOM mutation. Raw prompts, model answers, technical JSON, evidence values, API enums and identifiers remain as received. A typed safety-confirmation phrase remains exact even when its surrounding instruction is translated. Dates and numbers use the selected display locale without converting currencies or changing exact decimal price strings.

## Routing topology

Open `/gateway`, select a documented model, and choose **Compare providers**. This is a local quote/comparison operation; it does not send an inference request.

- **Proposed graph:** request → exact model → eligible provider candidates → proposal. A selected proposal is not an executed request; candidate order is not a backup order.
- **Recorded graph:** built only from persisted attempts and fallback evidence. Failed final attempts remain failed; a skipped channel is not reported as failed. Unknown bills and unverified model identities remain unknown.
- Select a node, or focus it and press Enter, to inspect evidence. Escape closes details and restores focus. Pan, zoom, fit-to-view and the text route summary are available. The graph is read-only; manual routing choices still use the existing provider controls and guards.
- Recorded replay is user-started, bounded, pausable and resettable. It cannot retry requests or produce traffic. The operating system's reduced-motion preference disables playback and removes motion effects.

Empty histories stay empty. No illustrative execution records, uptime metrics, API results or bills were added to product data for the redesign.

## Implementation boundaries

- `web/src/theme/tokens.css` and `web/src/console-theme.css`: shared light/dark presentation.
- `web/src/i18n/`: English/Chinese/Japanese resources, safe local preference store and regression tests.
- `web/src/components/routing/`: deterministic graph builders, accessible graph presentation and trace playback tests.
- `web/src/pages/`: presentation-only localisation; existing API payloads and branching remain unchanged.
- `tools/localize-ui.mjs`: reviewable source migration tooling, including inline-space preservation and explicit legacy test locales. The fixed ordered source catalogs must not be regenerated or reordered without updating their bound translation rows.

React Flow and Motion provide the canvas and transitions. System fonts and repository-local assets avoid external font or image dependencies. Vendor, chart, graph and locale bundles are separately cacheable. No remote UI template code was copied.

## Verification (19 October 2026)

- Frontend regression suite: **225 passed**. Existing Chinese contracts explicitly select Chinese; additional checks cover English defaults, Japanese, persisted preferences, raw-data preservation, input state, no locale-triggered network calls, graph derivation, keyboard details, replay bounds and reduced motion.
- The two legacy Playwright specs also explicitly select Chinese. Their storage checks still reject every unexpected key/value and all session storage, allowing only validated locale/theme preferences. These specs were transpilation-checked; the managed end-to-end runner was not rerun for this release.
- TypeScript/Vite production build and ESLint: passed.
- Focused backend catalog, gateway, dashboard-language and HTTP security regression: **244 passed**. Tests use local services or controlled fixtures, not real provider inference.
- Full historical Python suite: **1,569 passed, 215 failed, 134 errors**. It is not fully green in this public edition. Historical private-evidence/experiment inputs are intentionally excluded and some legacy contracts remain unresolved; no replacement evidence was invented or historical tests disabled by this UI change.
- SHA-256 verification of **253 protected tracked files** across backend, routing source, configuration, data and output: **0 changes**.
- Browser checks cover desktop and narrow layouts, light/dark surfaces, EN/中文/日本語, proposed route evidence, and preservation of typed request content. Provider execution remains disabled during verification.

## Remaining limits

This is a presentation redesign, not production certification. The full historical suite still needs its legitimate private inputs and separate contract repairs. The main application bundle still exceeds Vite's 500 kB advisory threshold; further route-level lazy loading is a follow-up. Package audit advisories also require a separately scoped dependency-maintenance pass. Browser visual checks are not a full screen-reader or WCAG conformance audit. Provider prices and observations retain their existing freshness and evidence limitations; graph motion does not make them live telemetry.
