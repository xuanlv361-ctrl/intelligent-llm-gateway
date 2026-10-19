# Architecture

The primary product is a local operations console:

```text
React/Vite browser UI
  → local FastAPI API and execution guards
  → SQLite metadata plus immutable/redacted evidence
  → existing scheduler, strategy, health, cost, replay, and reporting services
```

The browser never receives backend API keys and does not receive local absolute
evidence paths. Environment configuration separates China UAT and overseas
credentials, endpoints, model catalogs, histories, collector sources, and
currency. Unknown overseas settings remain unconfirmed and fail closed.

The visible browser collector uses a new non-persistent Chromium context,
manual operator login, exact HTTPS host/path validation, read-only extraction,
redaction, preview hashing, and explicit import confirmation. It does not save
cookies, storage state, passwords, or authorization headers.

## Experimental Agent Extensions

The prompt-complexity analyzer, agent planner, offline agent runtime, skill
router, tool simulator, memory, evaluation, reflection, and self-correction
modules are **Experimental Agent Extensions**. They provide deterministic,
offline research and demonstration workflows. They are not part of the trusted
real-API execution path, do not establish production multi-agent capability,
and must not be presented as autonomous live agents.

## Trust boundaries

- Remote model and console services are untrusted external systems.
- API keys remain in backend environment/session credential storage.
- Real execution is opt-in, one attempt, guarded, audited, and non-streaming.
- Imported logs and actual-route claims require measured evidence.
- Mock/demo/simulation data remains visibly separate from genuine evidence.
- CI is mock-only and cannot perform human acceptance.
